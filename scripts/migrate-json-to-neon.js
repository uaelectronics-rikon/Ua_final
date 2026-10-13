require("dotenv").config();

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");

const DATA_DIR = path.join(process.cwd(), "data");
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
  if (Array.isArray(value)) {
    return value.map(stable);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map(key => [key, stable(value[key])])
    );
  }

  return value;
}

function fingerprint(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(stable(value)))
    .digest("hex");
}

function recordKey(collection, record, index) {
  let key;

  if (collection === "orders") key = record.orderId;
  else if (collection === "users" || collection === "products") key = record.id;
  else if (collection === "payment_intents") {
    key = record.order?.orderId ?? record.orderId ?? record.id;
  } else if (collection === "email_queue") {
    key = record.id;
  }

  // Logs and records without native identifiers use stable source positions.
  if (key === undefined || key === null || String(key).trim() === "") {
    key = `row-${String(index + 1).padStart(8, "0")}`;
  }

  return String(key).trim();
}

function loadSources() {
  const result = [];
  const expectedKeys = new Set();

  for (const source of SOURCES) {
    const filePath = path.join(DATA_DIR, source.file);

    if (!fs.existsSync(filePath)) {
      if (source.required) {
        throw new Error(`Required source file is missing: data/${source.file}`);
      }

      console.log(`${source.file}: absent; skipped without deleting anything`);
      result.push({ ...source, rows: [], present: false });
      continue;
    }

    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));

    if (!Array.isArray(parsed)) {
      throw new Error(`Expected a JSON array in data/${source.file}`);
    }

    const rows = parsed.map((record, index) => {
      if (!record || typeof record !== "object" || Array.isArray(record)) {
        throw new Error(`Invalid record in data/${source.file} at index ${index}`);
      }

      const key = recordKey(source.collection, record, index);
      const uniqueKey = `${source.collection}\u0000${key}`;

      if (expectedKeys.has(uniqueKey)) {
        throw new Error(`Duplicate identifier found in ${source.file}`);
      }

      expectedKeys.add(uniqueKey);
      return { key, payload: record };
    });

    console.log(`${source.file}: validated ${rows.length} records`);
    result.push({ ...source, rows, present: true });
  }

  return result;
}

async function main() {
  const sources = loadSources();
  const expected = new Map();

  for (const source of sources) {
    for (const row of source.rows) {
      expected.set(`${source.collection}\u0000${row.key}`, row.payload);
    }
  }

  if (!APPLY) {
    console.log("\nDRY RUN ONLY: no database connection or changes made.");
    console.log("Validated records:", expected.size);
    console.log("To import after reviewing this output, use: --apply");
    return;
  }

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is missing from .env");
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 10000,
    max: 1,
    application_name: "ua-electronics-json-migration"
  });

  try {
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      await client.query(`
        CREATE TABLE IF NOT EXISTS ua_json_records (
          collection TEXT NOT NULL,
          record_key TEXT NOT NULL,
          payload JSONB NOT NULL,
          imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (collection, record_key)
        )
      `);

      const existing = await client.query(`
        SELECT collection, record_key, payload
        FROM ua_json_records
      `);

      // Never overwrite or silently ignore conflicting destination data.
      for (const row of existing.rows) {
        const lookup = `${row.collection}\u0000${row.record_key}`;

        if (!expected.has(lookup)) {
          throw new Error(
            "The destination contains records absent from the local sources. " +
            "No changes will be committed; investigate before proceeding."
          );
        }

        if (fingerprint(row.payload) !== fingerprint(expected.get(lookup))) {
          throw new Error(
            "A destination record differs from its source. " +
            "No changes will be committed; investigate before proceeding."
          );
        }
      }

      for (const source of sources) {
        for (const row of source.rows) {
          await client.query(
            `INSERT INTO ua_json_records (collection, record_key, payload)
             VALUES ($1, $2, $3::jsonb)
             ON CONFLICT (collection, record_key) DO NOTHING`,
            [source.collection, row.key, JSON.stringify(row.payload)]
          );
        }
      }

      for (const source of sources) {
        const result = await client.query(
          `SELECT COUNT(*)::int AS count
           FROM ua_json_records WHERE collection = $1`,
          [source.collection]
        );

        const actual = result.rows[0].count;
        const wanted = source.rows.length;

        if (actual !== wanted) {
          throw new Error(
            `Verification failed for ${source.collection}: ` +
            `expected ${wanted}, found ${actual}`
          );
        }

        console.log(`${source.collection}: verified ${actual} records`);
      }

      await client.query("COMMIT");
      console.log("\nImport committed successfully.");
      console.log("Original JSON files have not been modified or deleted.");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error("\nMigration stopped:", error.message);
  process.exitCode = 1;
});
