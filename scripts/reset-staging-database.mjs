import pg from "pg";

const environment = process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_ENVIRONMENT || "";
if (environment !== "staging" || process.env.CONFIRM_STAGING_RESET !== "true") {
  throw new Error("staging_environment_and_confirmation_required");
}
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === "true" },
});
await pool.query("DROP SCHEMA public CASCADE");
await pool.query("CREATE SCHEMA public");
await pool.end();
console.log(JSON.stringify({ ok: true, environment, reset: true }));
