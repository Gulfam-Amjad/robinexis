import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import pg from "pg";
import twilio from "twilio";

loadEnv({ path: ".env", quiet: true });

const CLIENT_ID = "client_blades_hair";
const EXPECTED_AGENT = "agent_6101m1c3n4wnfsgskgzr13w2gt9s";
const EXPECTED_NUMBER = "+447446868067";
const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const databaseUrl = required("DATABASE_URL");
const pool = new pg.Pool({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === "true" },
});

const clientRow = await pool.query("SELECT config FROM clients WHERE id=$1", [CLIENT_ID]);
const config = clientRow.rows[0]?.config;
if (!config) throw new Error("protected Blades tenant is missing");
if (config.elevenlabsAgentId !== EXPECTED_AGENT) throw new Error("protected agent mapping mismatch");
if (!config.inboundNumbers?.includes(EXPECTED_NUMBER)) throw new Error("protected number mapping mismatch");

const [calendarConnections, eventTypes, resources, prompt] = await Promise.all([
  pool.query(
    "SELECT id,provider,status,external_account_id,calendar_id FROM calendar_connections WHERE client_id=$1 ORDER BY id",
    [CLIENT_ID],
  ),
  pool.query(
    "SELECT service_slug,provider_event_type_id,provider_slug,status FROM calendar_event_types WHERE client_id=$1 ORDER BY service_slug",
    [CLIENT_ID],
  ),
  pool.query(
    "SELECT provider,resource_type,provider_resource_id,lifecycle_status FROM provider_resources WHERE client_id=$1 ORDER BY provider,resource_type",
    [CLIENT_ID],
  ),
  pool.query(
    "SELECT id,version,compiled FROM prompt_versions WHERE client_id=$1 ORDER BY version DESC LIMIT 1",
    [CLIENT_ID],
  ),
]);

const twilioClient = twilio(required("TWILIO_ACCOUNT_SID"), required("TWILIO_AUTH_TOKEN"));
const numbers = await twilioClient.incomingPhoneNumbers.list({ phoneNumber: EXPECTED_NUMBER, limit: 1 });
const liveNumber = numbers[0];
if (!liveNumber) throw new Error("protected number is not present in the configured Twilio account");

const agentResponse = await fetch(
  `https://api.elevenlabs.io/v1/convai/agents/${encodeURIComponent(EXPECTED_AGENT)}`,
  { headers: { "xi-api-key": required("ELEVENLABS_API_KEY") } },
);
if (!agentResponse.ok) throw new Error(`ElevenLabs agent probe failed: ${agentResponse.status}`);
const agent = await agentResponse.json();

const baseline = {
  capturedAt: new Date().toISOString(),
  clientId: CLIENT_ID,
  database: {
    configHash: digest(config),
    promptId: prompt.rows[0]?.id,
    promptVersion: prompt.rows[0]?.version,
    promptHash: digest(prompt.rows[0]?.compiled || ""),
    calendarConnections: calendarConnections.rows,
    eventTypes: eventTypes.rows,
    resources: resources.rows,
  },
  twilio: {
    number: liveNumber.phoneNumber,
    sid: liveNumber.sid,
    voiceUrl: liveNumber.voiceUrl,
    statusCallback: liveNumber.statusCallback,
    routingHash: digest({
      voiceUrl: liveNumber.voiceUrl,
      voiceMethod: liveNumber.voiceMethod,
      statusCallback: liveNumber.statusCallback,
    }),
  },
  elevenlabs: {
    agentId: EXPECTED_AGENT,
    agentHash: digest(agent),
    toolCount: agent?.conversation_config?.agent?.prompt?.tool_ids?.length || 0,
  },
};

const outputDir = path.join(
  process.env.LOCALAPPDATA || process.env.TEMP || process.cwd(),
  "Robinexis",
  "baselines",
);
mkdirSync(outputDir, { recursive: true });
const output = path.join(outputDir, `blades-${Date.now()}.json`);
writeFileSync(output, `${JSON.stringify(baseline, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({
  ok: true,
  output,
  capturedAt: baseline.capturedAt,
  calendarConnections: baseline.database.calendarConnections.length,
  eventTypes: baseline.database.eventTypes.length,
  providerResources: baseline.database.resources.length,
  twilioRouteConfigured: Boolean(baseline.twilio.voiceUrl),
  elevenLabsToolCount: baseline.elevenlabs.toolCount,
}));
await pool.end();
