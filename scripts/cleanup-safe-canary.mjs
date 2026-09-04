import { config as loadEnv } from "dotenv";
import pg from "pg";

loadEnv({ path: ".env", quiet: true });

if (process.env.CONFIRM_CLEANUP_SAFE_CANARY !== "true") {
  throw new Error("Set CONFIRM_CLEANUP_SAFE_CANARY=true for this exact test-artifact cleanup");
}
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is not configured");
const isSupabase =
  databaseUrl.includes("supabase.co") || databaseUrl.includes("pooler.supabase.com");
const pool = new pg.Pool({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: !isSupabase },
});
const connection = await pool.connect();
try {
  await connection.query("BEGIN");
  const call = await connection.query(
    `SELECT id, client_id, payload->>'objective' AS objective
     FROM call_sessions
     WHERE id = 'safe-readonly-canary' AND client_id = 'client_blades_hair'
     FOR UPDATE`,
  );
  if (call.rows[0] && call.rows[0].objective !== "ElevenLabs receptionist booking") {
    throw new Error("Canary ID belongs to an unexpected call; refusing cleanup");
  }
  const actions = await connection.query(
    `DELETE FROM tool_actions
     WHERE call_id = 'safe-readonly-canary' AND client_id = 'client_blades_hair'`,
  );
  const calls = await connection.query(
    `DELETE FROM call_sessions
     WHERE id = 'safe-readonly-canary' AND client_id = 'client_blades_hair'`,
  );
  await connection.query("COMMIT");
  console.log(JSON.stringify({
    ok: true,
    callsDeleted: calls.rowCount,
    toolActionsDeleted: actions.rowCount,
  }));
} catch (error) {
  await connection.query("ROLLBACK");
  throw error;
} finally {
  connection.release();
  await pool.end();
}
