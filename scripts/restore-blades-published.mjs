import { config as loadEnv } from "dotenv";
import pg from "pg";

loadEnv({ path: ".env", quiet: true });

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is not configured");
if (process.env.CONFIRM_RESTORE_BLADES_PUBLISHED !== "true") {
  throw new Error("Set CONFIRM_RESTORE_BLADES_PUBLISHED=true for this guarded repair");
}

const expected = {
  clientId: "client_blades_hair",
  agentId: "agent_6101m1c3n4wnfsgskgzr13w2gt9s",
  inboundNumber: "+447446868067",
};
const isSupabase =
  databaseUrl.includes("supabase.co") || databaseUrl.includes("pooler.supabase.com");
const pool = new pg.Pool({
  connectionString: databaseUrl,
  ssl: {
    rejectUnauthorized:
      process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === "true" ? true : !isSupabase,
  },
});

const connection = await pool.connect();
try {
  await connection.query("BEGIN");
  const current = await connection.query(
    `SELECT config
     FROM clients
     WHERE id = $1
     FOR UPDATE`,
    [expected.clientId],
  );
  const config = current.rows[0]?.config;
  if (!config) throw new Error("Blades client row is missing");
  if (config.elevenlabsAgentId !== expected.agentId) {
    throw new Error("Blades agent mapping changed; refusing repair");
  }
  if (!Array.isArray(config.inboundNumbers) || !config.inboundNumbers.includes(expected.inboundNumber)) {
    throw new Error("Blades inbound number mapping changed; refusing repair");
  }
  if (!["trialing", "active"].includes(config.serviceStatus)) {
    throw new Error(`Blades service status is ${config.serviceStatus}; refusing repair`);
  }

  const result = await connection.query(
    `UPDATE clients
     SET config = jsonb_set(config, '{published}', 'true'::jsonb, true)
     WHERE id = $1
       AND COALESCE((config->>'published')::boolean, false) = false
     RETURNING config->>'published' AS published`,
    [expected.clientId],
  );
  await connection.query("COMMIT");
  console.log(JSON.stringify({
    ok: true,
    changed: result.rowCount === 1,
    clientId: expected.clientId,
    published: result.rows[0]?.published || String(config.published),
  }, null, 2));
} catch (error) {
  await connection.query("ROLLBACK");
  throw error;
} finally {
  connection.release();
  await pool.end();
}
