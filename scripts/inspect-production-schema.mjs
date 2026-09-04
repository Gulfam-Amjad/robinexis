import { config as loadEnv } from "dotenv";
import pg from "pg";

loadEnv({ path: ".env", quiet: true });

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is not configured");

const isSupabase =
  databaseUrl.includes("supabase.co") || databaseUrl.includes("pooler.supabase.com");
const pool = new pg.Pool({
  connectionString: databaseUrl,
  ssl:
    process.env.DATABASE_SSL === "false"
      ? undefined
      : {
          rejectUnauthorized:
            process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === "true"
              ? true
              : !isSupabase,
        },
});

try {
  const [migrations, blades, counts, normalized] = await Promise.all([
    pool.query("SELECT id, applied_at FROM schema_migrations ORDER BY id"),
    pool.query(
      `SELECT id, slug,
              config->>'elevenlabsAgentId' AS agent_id,
              config->>'voicePipeline' AS voice_pipeline,
              config->>'serviceStatus' AS service_status,
              config->>'published' AS published,
              config->'inboundNumbers' AS inbound_numbers
       FROM clients
       WHERE id = 'client_blades_hair'`,
    ),
    pool.query(
      `SELECT
         (SELECT count(*)::int FROM locations WHERE client_id = 'client_blades_hair') AS locations,
         (SELECT count(*)::int FROM agent_instances WHERE client_id = 'client_blades_hair') AS agents,
         (SELECT count(*)::int FROM phone_endpoints WHERE client_id = 'client_blades_hair') AS phones,
         (SELECT count(*)::int FROM calendar_connections WHERE client_id = 'client_blades_hair') AS calendars,
         (SELECT count(*)::int FROM subscriptions WHERE client_id = 'client_blades_hair') AS subscriptions,
         (SELECT provider_agent_id FROM agent_instances WHERE client_id = 'client_blades_hair' LIMIT 1) AS agent_id,
         (SELECT e164 FROM phone_endpoints WHERE client_id = 'client_blades_hair' LIMIT 1) AS phone`,
    ),
    pool.query(
      `SELECT
         (SELECT count(*)::int FROM clients) AS clients,
         (SELECT count(*)::int FROM call_sessions WHERE client_id = 'client_blades_hair') AS blades_calls,
         (SELECT count(*)::int FROM prompt_versions WHERE client_id = 'client_blades_hair') AS blades_prompts`,
    ),
  ]);
  console.log(JSON.stringify({
    migrations: migrations.rows,
    blades: blades.rows[0] || null,
    counts: normalized.rows[0],
    normalized: counts.rows[0],
  }, null, 2));
} finally {
  await pool.end();
}
