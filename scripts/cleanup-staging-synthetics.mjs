import pg from "pg";

const connectionString = process.env.STAGING_DATABASE_URL;
if (!connectionString || !/eqirspcbsopchzrbyczq|staging/i.test(connectionString)) {
  console.error("Refusing cleanup: STAGING_DATABASE_URL is not the isolated staging database.");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString, ssl: { rejectUnauthorized: false } });
try {
  await pool.query("BEGIN");
  await pool.query("DELETE FROM call_sessions WHERE client_id LIKE 'client_stage_%'");
  const result = await pool.query("DELETE FROM clients WHERE id LIKE 'client_stage_%' RETURNING id");
  await pool.query("COMMIT");
  console.log(JSON.stringify({ ok: true, removedSyntheticTenants: result.rowCount }));
} catch (error) {
  await pool.query("ROLLBACK");
  throw error;
} finally {
  await pool.end();
}
