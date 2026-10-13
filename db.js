const { Pool } = require("pg");

const COLLECTIONS = new Set([
  "orders",
  "users",
  "products",
  "payment_intents",
  "email_queue",
  "email_logs"
]);

function normalizedConnectionString() {
  const value = process.env.DATABASE_URL;
  if (!value) return undefined;
  const url = new URL(value);
  // Explicit TLS hostname verification avoids pg-connection-string's legacy
  // interpretation of sslmode=require/prefer/verify-ca.
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must be a PostgreSQL connection URL");
  }
  url.searchParams.set("sslmode", "verify-full");
  return url.toString();
}

const pool = new Pool({
  connectionString: normalizedConnectionString(),
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  max: Number(process.env.PG_POOL_MAX || 5),
  application_name: "ua-electronics-backend"
});

function assertCollection(collection) {
  if (!COLLECTIONS.has(collection)) {
    throw new Error(`Unsupported database collection: ${collection}`);
  }
}

function keyForRecord(collection, record, index) {
  let key;

  switch (collection) {
    case "orders":
      key = record.orderId;
      break;
    case "users":
    case "products":
      key = record.id;
      break;
    case "payment_intents":
      key = record.order?.orderId ?? record.orderId ?? record.id;
      break;
    case "email_queue":
      key = record.id;
      break;
    case "email_logs":
      key = `row-${String(index + 1).padStart(8, "0")}`;
      break;
    default:
      throw new Error(`Unsupported collection: ${collection}`);
  }

  if (key === undefined || key === null || String(key).trim() === "") {
    throw new Error(`Record ${index + 1} in ${collection} has no stable identifier`);
  }
  return String(key).trim();
}

function parsePayload(payload) {
  return typeof payload === "string" ? JSON.parse(payload) : payload;
}

async function verifySchema() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const result = await pool.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'ua_json_records'
  `);
  const columns = new Set(result.rows.map(row => row.column_name));
  for (const required of ["collection", "record_key", "payload", "sort_order"]) {
    if (!columns.has(required)) {
      throw new Error(
        `Neon schema is not prepared: ua_json_records.${required} is missing. ` +
        "Run scripts/prepare-neon-runtime.js --apply before starting the server."
      );
    }
  }

  const receiptTable = await pool.query(`
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_name = 'ua_receipts'
  `);
  if (receiptTable.rowCount === 0) {
    throw new Error(
      "Neon schema is not prepared: ua_receipts is missing. " +
      "Run scripts/prepare-neon-runtime.js --apply before starting the server."
    );
  }

  await pool.query("SELECT 1");
}

async function readCollection(collection) {
  assertCollection(collection);
  const result = await pool.query(
    `SELECT payload
     FROM ua_json_records
     WHERE collection = $1
     ORDER BY sort_order ASC NULLS LAST, imported_at ASC, record_key ASC`,
    [collection]
  );
  return result.rows.map(row => parsePayload(row.payload));
}

// Serializes a collection's updates across all app instances with a PostgreSQL
// transaction advisory lock. Use this rather than separate read-modify-write calls.
async function mutateCollection(collection, mutator) {
  assertCollection(collection);
  if (typeof mutator !== "function") throw new TypeError("mutator must be a function");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`ua-electronics:${collection}`]
    );

    const query = await client.query(
      `SELECT record_key, payload
       FROM ua_json_records
       WHERE collection = $1
       ORDER BY sort_order ASC NULLS LAST, imported_at ASC, record_key ASC
       FOR UPDATE`,
      [collection]
    );
    const current = query.rows.map(row => parsePayload(row.payload));
    const outcome = await mutator(current);

    if (!outcome || !Array.isArray(outcome.records)) {
      throw new Error(`Mutation for ${collection} must return { records: [...] }`);
    }

    if (outcome.commit !== false) {
      const nextRecords = outcome.records;
      const entries = [];
      const seen = new Set();

      nextRecords.forEach((record, index) => {
        if (!record || typeof record !== "object" || Array.isArray(record)) {
          throw new Error(`Invalid record at index ${index} for ${collection}`);
        }
        const recordKey = keyForRecord(collection, record, index);
        if (seen.has(recordKey)) {
          throw new Error(`Duplicate record identifier in ${collection}`);
        }
        seen.add(recordKey);
        entries.push({ recordKey, payload: record, sortOrder: index });
      });

      await client.query("DELETE FROM ua_json_records WHERE collection = $1", [collection]);
      for (const entry of entries) {
        await client.query(
          `INSERT INTO ua_json_records (collection, record_key, payload, sort_order)
           VALUES ($1, $2, $3::jsonb, $4)`,
          [collection, entry.recordKey, JSON.stringify(entry.payload), entry.sortOrder]
        );
      }
    }

    await client.query("COMMIT");
    return outcome.result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (_) {
      // Preserve the original database error.
    }
    throw error;
  } finally {
    client.release();
  }
}

async function replaceCollection(collection, records) {
  if (!Array.isArray(records)) throw new TypeError("records must be an array");
  return mutateCollection(collection, () => ({ records, result: records.length }));
}

async function getReceipt(orderId) {
  const result = await pool.query(
    `SELECT order_id, filename, pdf_data, created_at
     FROM ua_receipts WHERE order_id = $1`,
    [String(orderId)]
  );
  return result.rows[0] || null;
}

async function saveReceipt(orderId, filename, pdfBuffer) {
  if (!orderId || !filename || !Buffer.isBuffer(pdfBuffer)) {
    throw new TypeError("saveReceipt requires an order ID, filename, and PDF buffer");
  }
  await pool.query(
    `INSERT INTO ua_receipts (order_id, filename, pdf_data)
     VALUES ($1, $2, $3)
     ON CONFLICT (order_id)
     DO UPDATE SET filename = EXCLUDED.filename,
                   pdf_data = EXCLUDED.pdf_data,
                   created_at = NOW()`,
    [String(orderId), String(filename), pdfBuffer]
  );
}

async function close() {
  await pool.end();
}

module.exports = {
  pool,
  verifySchema,
  readCollection,
  mutateCollection,
  replaceCollection,
  getReceipt,
  saveReceipt,
  close,
  keyForRecord
};
