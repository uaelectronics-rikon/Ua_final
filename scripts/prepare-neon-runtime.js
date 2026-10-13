require("dotenv").config();

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const db = require("../db");

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");
const RECEIPT_DIR = path.join(ROOT, "Orders");
const APPLY = process.argv.includes("--apply");

const SOURCES = [
  { collection: "orders", file: "orders.json", required: true },
  { collection: "users", file: "users.json", required: true },
  { collection: "products", file: "products.json", required: true },
  { collection: "payment_intents", file: "payment-intents.json", required: false },
  { collection: "email_queue", file: "email-queue.json", required: false },
  { collection: "email_logs", file: "email-log.json", required: false }
];

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])]));
  }
  return value;
}
function fingerprint(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}
function keyFor(collection, record, index) {
  let key;
  if (collection === "orders") key = record.orderId;
  else if (collection === "users" || collection === "products") key = record.id;
  else if (collection === "payment_intents") key = record.order?.orderId ?? record.orderId ?? record.id;
  else if (collection === "email_queue") key = record.id;
  else if (collection === "email_logs") key = `row-${String(index + 1).padStart(8, "0")}`;
  if (key === undefined || key === null || String(key).trim() === "") {
    throw new Error(`Missing stable ID in ${collection} record ${index + 1}`);
  }
  return String(key).trim();
}
function readSources() {
  const sources = [];
  for (const source of SOURCES) {
    const filePath = path.join(DATA_DIR, source.file);
    if (!fs.existsSync(filePath)) {
      if (source.required) throw new Error(`Required file missing: data/${source.file}`);
      console.log(`${source.file}: absent; not imported or changed`);
      sources.push({ ...source, present: false, records: [] });
      continue;
    }
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!Array.isArray(parsed)) throw new Error(`Expected an array in data/${source.file}`);
    const seen = new Set();
    const records = parsed.map((payload, index) => {
      const recordKey = keyFor(source.collection, payload, index);
      if (seen.has(recordKey)) throw new Error(`Duplicate key in ${source.file}`);
      seen.add(recordKey);
      return { recordKey, payload, sortOrder: index };
    });
    sources.push({ ...source, present: true, records });
    console.log(`${source.file}: ${records.length} records read`);
  }
  return sources;
}
function listFilesRecursive(dir) {
  if (!fs.existsSync(dir)) return [];
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...listFilesRecursive(full));
    else if (entry.isFile() && /-receipt\.pdf$/i.test(entry.name)) found.push(full);
  }
  return found;
}

async function main() {
  const sources = readSources();
  if (!APPLY) {
    console.log("\nDRY RUN ONLY: no Neon schema or data changes were made.");
    console.log("Validated JSON records:", sources.reduce((n, s) => n + s.records.length, 0));
    console.log("To prepare ordering metadata and receipt storage: node scripts/prepare-neon-runtime.js --apply");
    return;
  }
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required in .env");

  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");

    const requiredTable = await client.query(`
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = current_schema() AND table_name = 'ua_json_records'
    `);
    if (!requiredTable.rowCount) {
      throw new Error("ua_json_records not found. Run the initial JSON-to-Neon migration first.");
    }

    // Verify source rows against staging before adding ordering metadata.
    for (const source of sources) {
      if (!source.present) continue;
      const tableRows = await client.query(
        "SELECT record_key, payload FROM ua_json_records WHERE collection = $1",
        [source.collection]
      );
      if (tableRows.rowCount !== source.records.length) {
        throw new Error(
          `${source.collection} count mismatch: local ${source.records.length}, Neon ${tableRows.rowCount}`
        );
      }
      const existing = new Map(tableRows.rows.map(row => [String(row.record_key), row.payload]));
      for (const record of source.records) {
        if (!existing.has(record.recordKey)) {
          throw new Error(`Neon is missing ${source.collection} record ${record.recordKey}`);
        }
        if (fingerprint(existing.get(record.recordKey)) !== fingerprint(record.payload)) {
          throw new Error(`Neon record differs from local source in ${source.collection}; nothing committed`);
        }
      }
    }

    await client.query(
      "ALTER TABLE ua_json_records ADD COLUMN IF NOT EXISTS sort_order BIGINT"
    );

    for (const source of sources) {
      if (!source.present) continue;
      for (const record of source.records) {
        await client.query(
          `UPDATE ua_json_records SET sort_order = $3
           WHERE collection = $1 AND record_key = $2`,
          [source.collection, record.recordKey, record.sortOrder]
        );
      }
    }

    await client.query(`
      CREATE TABLE IF NOT EXISTS ua_receipts (
        order_id TEXT PRIMARY KEY,
        filename TEXT NOT NULL,
        pdf_data BYTEA NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    let receiptsImported = 0;
    for (const fullPath of listFilesRecursive(RECEIPT_DIR)) {
      const filename = path.basename(fullPath);
      const match = filename.match(/^(.+)-receipt\.pdf$/i);
      if (!match) continue;

      const orderId = match[1];
      const pdfBuffer = fs.readFileSync(fullPath);
      const existingReceipt = await client.query(
        "SELECT filename, pdf_data FROM ua_receipts WHERE order_id = $1",
        [orderId]
      );

      if (existingReceipt.rowCount) {
        const old = existingReceipt.rows[0];
        if (old.filename !== filename || !Buffer.from(old.pdf_data).equals(pdfBuffer)) {
          throw new Error(`A different receipt already exists for order ${orderId}; nothing committed`);
        }
      } else {
        await client.query(
          "INSERT INTO ua_receipts (order_id, filename, pdf_data) VALUES ($1, $2, $3)",
          [orderId, filename, pdfBuffer]
        );
        receiptsImported++;
      }
    }

    for (const source of sources) {
      if (!source.present) continue;
      const countResult = await client.query(
        "SELECT COUNT(*)::int AS count FROM ua_json_records WHERE collection = $1",
        [source.collection]
      );
      if (countResult.rows[0].count !== source.records.length) {
        throw new Error(`Post-update count check failed for ${source.collection}`);
      }
    }

    await client.query("COMMIT");
    console.log("\nNeon runtime schema prepared successfully.");
    console.log("Record payloads verified; only sort_order metadata was updated.");
    console.log("Receipt PDFs imported:", receiptsImported);
    console.log("Original JSON files and PDF files were not deleted.");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    throw error;
  } finally {
    client.release();
    await db.close();
  }
}

main().catch(async error => {
  console.error("Preparation failed:", error.message);
  try { await db.close(); } catch (_) {}
  process.exitCode = 1;
});
