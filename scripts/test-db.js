require("dotenv").config();
const { Pool } = require("pg");

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is missing from .env");
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 10000,
    max: 1
  });

  try {
    const result = await pool.query(`
      SELECT current_database() AS database,
             current_user AS role,
             version() AS version
    `);

    console.log("Neon connection successful.");
    console.log("Database:", result.rows[0].database);
    console.log("Connected role:", result.rows[0].role);
    console.log("PostgreSQL version:", result.rows[0].version);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Database connection failed:", err.message);
  process.exitCode = 1;
});
