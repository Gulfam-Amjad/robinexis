import { config as loadEnv } from "dotenv";
import pg from "pg";

/**
 * Guarded Blades tenant repair. Default is dry-run (prints planned changes).
 * Does not run unless you set CONFIRM_REPAIR_BLADES_TENANT=true.
 *
 * Optional:
 *   BLADES_SERVICE_STATUS=active|trialing   (only these two are allowed)
 *   DEDUPE_SERVICES=true                    (keep first 15min + first 30min)
 *
 * Example:
 *   DEDUPE_SERVICES=true BLADES_SERVICE_STATUS=active node scripts/repair-blades-tenant.mjs
 *   CONFIRM_REPAIR_BLADES_TENANT=true DEDUPE_SERVICES=true BLADES_SERVICE_STATUS=active node scripts/repair-blades-tenant.mjs
 */
loadEnv({ path: ".env", quiet: true });

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is not configured");

const apply = process.env.CONFIRM_REPAIR_BLADES_TENANT === "true";
const requestedStatus = process.env.BLADES_SERVICE_STATUS?.trim();
const dedupe = process.env.DEDUPE_SERVICES === "true";
if (requestedStatus && !["active", "trialing"].includes(requestedStatus)) {
  throw new Error("BLADES_SERVICE_STATUS must be active or trialing");
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

function uniqueServices(services) {
  const seen = new Set();
  const next = [];
  for (const service of Array.isArray(services) ? services : []) {
    const slug = String(service?.slug || "");
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    next.push(service);
  }
  return next;
}

const connection = await pool.connect();
try {
  await connection.query("BEGIN");
  const current = await connection.query(
    `SELECT config FROM clients WHERE id = $1 FOR UPDATE`,
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

  const before = {
    serviceStatus: config.serviceStatus,
    published: config.published,
    serviceSlugs: (config.services || []).map((service) => service.slug),
  };
  const next = { ...config };
  if (requestedStatus) next.serviceStatus = requestedStatus;
  if (dedupe) next.services = uniqueServices(config.services);

  const plan = {
    apply,
    clientId: expected.clientId,
    before,
    after: {
      serviceStatus: next.serviceStatus,
      published: next.published,
      serviceSlugs: (next.services || []).map((service) => service.slug),
    },
  };

  if (!apply) {
    await connection.query("ROLLBACK");
    console.log(JSON.stringify({ ...plan, ok: true, changed: false }, null, 2));
  } else {
    await connection.query(`UPDATE clients SET config = $2::jsonb WHERE id = $1`, [
      expected.clientId,
      JSON.stringify(next),
    ]);
    await connection.query("COMMIT");
    console.log(JSON.stringify({ ...plan, ok: true, changed: true }, null, 2));
  }
} catch (error) {
  await connection.query("ROLLBACK");
  throw error;
} finally {
  connection.release();
  await pool.end();
}
