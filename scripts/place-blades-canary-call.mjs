import pg from "pg";
import twilio from "twilio";

const environment = process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_ENVIRONMENT || "";
if (environment !== "production" || process.env.CONFIRM_BLADES_CALL !== "true") {
  throw new Error("confirmed production Blades call required");
}
const number = "+447446868067";
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === "true" },
});
const clientRow = await pool.query("SELECT config FROM clients WHERE id='client_blades_hair'");
const config = clientRow.rows[0]?.config;
if (
  config?.elevenlabsAgentId !== "agent_6101m1c3n4wnfsgskgzr13w2gt9s" ||
  !config?.inboundNumbers?.includes(number)
) {
  throw new Error("protected Blades identity mismatch");
}
const startedAt = new Date();
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const owned = await client.incomingPhoneNumbers.list({ phoneNumber: number, limit: 1 });
if (owned[0]?.phoneNumber !== number || !owned[0]?.voiceUrl) {
  throw new Error("protected Twilio route unavailable");
}
const verifiedCallerIds = await client.outgoingCallerIds.list({ limit: 20 });
const callerId = process.env.BLADES_CANARY_CALLER_ID ||
  verifiedCallerIds.find((item) =>
    item.phoneNumber?.match(/^\+[1-9]\d{7,14}$/) &&
    item.phoneNumber !== number)?.phoneNumber;
if (!callerId) throw new Error("verified canary caller ID unavailable");
const call = await client.calls.create({
  to: number,
  from: callerId,
  twiml: `<Response>
    <Pause length="3"/>
    <Say voice="Polly.Amy">Hello. This is the Robinexis delivery check. What are your opening hours?</Say>
    <Pause length="8"/>
    <Say voice="Polly.Amy">Thank you. Goodbye.</Say>
    <Pause length="3"/>
  </Response>`,
  timeout: 30,
});
let current = call;
for (let attempt = 0; attempt < 36 && !["completed", "busy", "failed", "no-answer", "canceled"].includes(current.status); attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 2_500));
  current = await client.calls(call.sid).fetch();
}
let calls = 0;
let usageEvents = 0;
for (let attempt = 0; attempt < 30; attempt += 1) {
  const [callRows, usageRows] = await Promise.all([
    pool.query(
      "SELECT count(*)::int AS count FROM call_sessions WHERE client_id='client_blades_hair' AND updated_at >= $1",
      [startedAt],
    ),
    pool.query(
      "SELECT count(*)::int AS count FROM provider_usage_cost_events WHERE client_id='client_blades_hair' AND provider='elevenlabs-convai' AND created_at >= $1",
      [startedAt],
    ),
  ]);
  calls = callRows.rows[0]?.count || 0;
  usageEvents = usageRows.rows[0]?.count || 0;
  if (calls >= 1 && usageEvents >= 1) break;
  await new Promise((resolve) => setTimeout(resolve, 4_000));
}
await pool.end();
const ok = current.status === "completed" && calls === 1 && usageEvents === 1;
console.log(JSON.stringify({
  ok,
  twilioStatus: current.status,
  twilioCallCompleted: current.status === "completed",
  durationSeconds: Number(current.duration || 0),
  attributedCallRecords: calls,
  attributedUsageEvents: usageEvents,
}));
if (!ok) process.exitCode = 1;
