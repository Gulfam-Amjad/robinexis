import pg from "pg";

const protectedValues = [
  "client_blades_hair",
  "agent_6101m1c3n4wnfsgskgzr13w2gt9s",
  "+447446868067",
];
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === "true" },
});

const clients = await pool.query("SELECT id, config::text AS config FROM clients");
const providerResources = await pool.query(
  "SELECT client_id, provider_resource_id FROM provider_resources",
);
const serialized = JSON.stringify({
  clients: clients.rows,
  providerResources: providerResources.rows,
});
const matches = protectedValues.filter((value) => serialized.includes(value));
console.log(JSON.stringify({
  ok: matches.length === 0,
  clientCount: clients.rows.length,
  providerResourceCount: providerResources.rows.length,
  protectedIdentifierMatches: matches.length,
}));
await pool.end();
if (matches.length) process.exitCode = 1;
