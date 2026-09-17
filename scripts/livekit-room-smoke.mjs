import {
  AgentDispatchClient,
  RoomServiceClient,
} from "livekit-server-sdk";
import pg from "pg";

const tenantId = process.env.VOICE_RUNTIME_SMOKE_TENANT_ID;
const required = [
  "DATABASE_URL",
  "LIVEKIT_URL",
  "LIVEKIT_API_KEY",
  "LIVEKIT_API_SECRET",
  "VOICE_RUNTIME_INTERNAL_SECRET",
];
const missing = [
  ...required.filter((name) => !process.env[name]?.trim()),
  ...(!tenantId ? ["VOICE_RUNTIME_SMOKE_TENANT_ID"] : []),
];
if (missing.length) throw new Error(`missing_livekit_smoke_env:${missing.join(",")}`);

const liveKitHost = `https://${new URL(process.env.LIVEKIT_URL).hostname}`;
const rooms = new RoomServiceClient(
  liveKitHost,
  process.env.LIVEKIT_API_KEY,
  process.env.LIVEKIT_API_SECRET,
);
const dispatches = new AgentDispatchClient(
  liveKitHost,
  process.env.LIVEKIT_API_KEY,
  process.env.LIVEKIT_API_SECRET,
);
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true"
    ? { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false" }
    : undefined,
});
const suffix = `${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
const deploymentId = `provider_deployment_smoke_${suffix}`;
const roomName = `voice-runtime-smoke-${suffix}`;
const startedAt = new Date().toISOString();
let roomCreated = false;

try {
  const client = await pool.query(
    "SELECT id FROM clients WHERE id = $1 AND config->>'published' = 'true'",
    [tenantId],
  );
  if (client.rowCount !== 1) throw new Error("smoke_tenant_not_published");
  await pool.query(
    `INSERT INTO provider_deployments
      (id, client_id, provider, status, config, created_at, updated_at)
     VALUES ($1, $2, 'livekit-cascade', 'staged', '{}'::jsonb, now(), now())`,
    [deploymentId, tenantId],
  );
  const apiBaseUrl = process.env.API_PUBLIC_BASE_URL || "https://api.robinexis.com";
  const configResponse = await fetch(
    `${apiBaseUrl}/internal/voice-runtime/config/${encodeURIComponent(tenantId)}?deploymentId=${encodeURIComponent(deploymentId)}`,
    { headers: { "x-voice-runtime-secret": process.env.VOICE_RUNTIME_INTERNAL_SECRET } },
  );
  if (!configResponse.ok) throw new Error(`runtime_config_smoke_failed:${configResponse.status}`);
  const runtimeConfig = await configResponse.json();
  const toolResponse = await fetch(`${apiBaseUrl}/api/v1/voice-tools/get-business-info`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-voice-tool-secret": runtimeConfig.toolSecret,
      "x-voice-tool-tenant": tenantId,
    },
    body: JSON.stringify({
      conversationId: `call_tool_smoke_${suffix}`,
      topic: "hours",
    }),
  });
  const toolBody = await toolResponse.text();
  if (toolResponse.status === 401 || toolResponse.status === 404) {
    throw new Error(`runtime_tool_smoke_failed:${toolResponse.status}:${toolBody.slice(0, 300)}`);
  }
  const toolStatus = toolResponse.ok ? "ok" : `authorized_business_block_${toolResponse.status}`;
  await rooms.createRoom({
    name: roomName,
    emptyTimeout: 120,
    departureTimeout: 20,
    maxParticipants: 4,
  });
  roomCreated = true;
  await dispatches.createDispatch(
    roomName,
    "robinexis-alternate-runtime",
    {
      metadata: JSON.stringify({
        tenantId,
        deploymentId,
        direction: "inbound",
        objective: "Dark room provider smoke test",
      }),
    },
  );

  const participants = await poll(async () => {
    const current = await rooms.listParticipants(roomName);
    return current.length ? current : undefined;
  }, 45_000);
  if (!participants) throw new Error("livekit_agent_did_not_join");

  await wait(5_000);
  await rooms.deleteRoom(roomName);
  roomCreated = false;

  const call = await poll(async () => {
    const result = await pool.query(
      `SELECT payload FROM call_sessions
       WHERE client_id = $1
         AND updated_at >= $2::timestamptz
         AND payload->'collected'->>'provider' = 'livekit-cascade'
       ORDER BY updated_at DESC LIMIT 1`,
      [tenantId, startedAt],
    );
    return result.rows[0]?.payload;
  }, 45_000);
  if (!call) throw new Error("livekit_post_call_not_stored");
  console.log(JSON.stringify({
    status: "ok",
    tenantId,
    roomName,
    agentParticipants: participants.length,
    configAuth: "ok",
    providerTool: toolStatus,
    callId: call.id,
    callStatus: call.status,
  }));
} finally {
  if (roomCreated) {
    await rooms.deleteRoom(roomName).catch(() => undefined);
  }
  await pool.query(
    "DELETE FROM provider_deployments WHERE id = $1 AND status = 'staged'",
    [deploymentId],
  ).catch(() => undefined);
  await pool.end();
}

async function poll(read, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await wait(1_000);
  }
  return undefined;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
