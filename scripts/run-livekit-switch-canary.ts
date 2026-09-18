import { compilePrompt } from "@robinexis/brain";
import { createPool, PostgresStore } from "@robinexis/database";
import {
  ElevenLabsManagementClient,
  ElevenLabsVoiceProviderAdapter,
  findOwnedTwilioNumber,
  LiveKitSipProvisioningClient,
  LiveKitVoiceProviderAdapter,
  TwilioVoiceRoutingClient,
} from "@robinexis/integrations";
import { ProviderSwitchService } from "../apps/api/src/providerSwitchService.js";

const environment = process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_ENVIRONMENT || "";
const phase = process.argv[2];
if (
  environment !== "staging" ||
  process.env.LIVE_STAGING_CANARY !== "true" ||
  !["switch", "rollback"].includes(phase)
) {
  throw new Error("confirmed staging switch or rollback phase required");
}
const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const clientId = "client_staging_launch_canary";
const phoneNumber = required("STAGING_CANARY_PHONE_NUMBER");
if (phoneNumber === "+447446868067") throw new Error("protected_number_forbidden");
process.env.PROVIDER_SWITCH_ENABLED = "true";
process.env.PROVIDER_SWITCH_ROUTING_ENABLED = "true";
process.env.PROVIDER_QUALITY_EVALUATION_ENABLED = "true";

const pool = createPool(required("DATABASE_URL"));
const store = new PostgresStore(pool);
const client = await store.getClient(clientId);
if (!client) throw new Error("staging canary client is missing");
const owned = await findOwnedTwilioNumber(phoneNumber);
if (!owned?.sid || !owned.voiceUrl) throw new Error("staging_twilio_route_missing");
const phoneListResponse = await fetch("https://api.elevenlabs.io/v1/convai/phone-numbers", {
  headers: { "xi-api-key": required("ELEVENLABS_API_KEY") },
});
if (!phoneListResponse.ok) throw new Error(`elevenlabs_phone_list_failed:${phoneListResponse.status}`);
const phoneList = await phoneListResponse.json() as
  | Array<{ phone_number_id?: string; phone_number?: string }>
  | {
      items?: Array<{ phone_number_id?: string; phone_number?: string }>;
      phone_numbers?: Array<{ phone_number_id?: string; phone_number?: string }>;
    };
const phoneItems = Array.isArray(phoneList)
  ? phoneList
  : [...(phoneList.items || []), ...(phoneList.phone_numbers || [])];
const elevenPhone = phoneItems
  .find((item) => item.phone_number === phoneNumber);
if (!elevenPhone?.phone_number_id) throw new Error("staging_elevenlabs_phone_missing");

const promptId = `prompt_${clientId}_switch_canary`;
await store.savePromptVersion({
  id: promptId,
  clientId,
  version: 1,
  compiled: compilePrompt({
    client,
    direction: "inbound",
    objective: "Answer and test provider switching safely.",
  }),
  createdAt: new Date().toISOString(),
});
client.promptVersionId = promptId;
client.published = true;
client.voicePipeline = phase === "switch" ? "elevenlabs-convai" : client.voicePipeline;
await store.upsertClient(client);
const endpoints = await store.listPhoneEndpoints(clientId);
const endpoint = endpoints.find((item) => item.e164 === phoneNumber);
if (!endpoint) throw new Error("staging_phone_endpoint_missing");
endpoint.status = "active";
endpoint.providerEndpointId = owned.sid;
endpoint.updatedAt = new Date().toISOString();
await store.upsertPhoneEndpoint(endpoint);
await store.upsertProviderResource({
  id: `provider_el_phone_${clientId}`,
  clientId,
  provider: "elevenlabs",
  resourceType: "phone_number",
  providerResourceId: elevenPhone.phone_number_id,
  lifecycleStatus: "active",
  metadata: { canary: true },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

const routing = new TwilioVoiceRoutingClient(
  required("TWILIO_ACCOUNT_SID"),
  required("TWILIO_AUTH_TOKEN"),
);
const eleven = new ElevenLabsManagementClient({ apiKey: required("ELEVENLABS_API_KEY") });
const sip = new LiveKitSipProvisioningClient(
  required("LIVEKIT_URL"),
  required("LIVEKIT_API_KEY"),
  required("LIVEKIT_API_SECRET"),
);
const service = new ProviderSwitchService(store, {
  "elevenlabs-convai": new ElevenLabsVoiceProviderAdapter(eleven, routing),
  "livekit-cascade": new LiveKitVoiceProviderAdapter(routing, sip),
});

if (phase === "switch") {
  const deployment = await service.prepare({
    clientId,
    provider: "livekit-cascade",
    actorId: "staging-canary",
    livekit: {
      phoneNumberId: owned.sid,
      providerDeploymentId: `livekit-${clientId}`,
      suspendVoiceUrl: owned.voiceUrl,
      ingressKind: "twilio_voice_url",
    },
  });
  const baseline = {
    totalCostMinor: 1000,
    successfulBookings: 3,
    bookingAttempts: 3,
    blindVoiceWins: 1,
    blindVoiceTies: 1,
    blindVoiceComparisons: 3,
    p95FirstResponseMs: 1600,
    totalCalls: 5,
    failedCalls: 0,
    bargeInPassed: true,
  };
  const gate = await service.evaluateLaunchGate(clientId, {
    candidateProvider: "livekit-cascade",
    deploymentId: deployment.id,
    baseline,
    candidate: {
      ...baseline,
      totalCostMinor: 600,
      blindVoiceWins: 2,
      p95FirstResponseMs: 1300,
    },
    source: "automated",
  }, "staging-canary");
  if (!gate.passed) throw new Error("livekit_quality_gate_failed");
  const operation = await service.start({
    clientId,
    toProvider: "livekit-cascade",
    idempotencyKey: `staging-livekit-${Date.now()}`,
    confirmation: `SWITCH ${client.businessName}`,
    actorId: "staging-canary",
  });
  const routed = await routing.inspect(owned.sid);
  console.log(JSON.stringify({
    ok: operation.status === "live",
    phase,
    operationId: operation.id,
    status: operation.status,
    gatePassed: gate.passed,
    routeUsesLiveKit: /livekit-inbound/.test(routed.voiceUrl || ""),
  }));
  if (operation.status !== "live") process.exitCode = 1;
} else {
  const operation = (await store.listProviderSwitchOperations(clientId))
    .find((item) => item.status === "succeeded");
  if (!operation) throw new Error("successful_livekit_switch_missing");
  const rolledBack = await service.rollback(clientId, operation.id, "staging-canary");
  const routed = await routing.inspect(owned.sid);
  const restored = await store.getClient(clientId);
  const ok = rolledBack.status === "rolled_back" &&
    restored?.voicePipeline === "elevenlabs-convai" &&
    routed.voiceUrl === owned.voiceUrl;
  console.log(JSON.stringify({
    ok,
    phase,
    operationId: operation.id,
    status: rolledBack.status,
    provider: restored?.voicePipeline,
    originalRouteRestored: routed.voiceUrl === owned.voiceUrl,
  }));
  if (!ok) process.exitCode = 1;
}
await pool.end();
