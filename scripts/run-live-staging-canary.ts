import { randomBytes } from "node:crypto";
import {
  createPool,
  PostgresStore,
  robinexisDemoSeed,
  type ClientConfig,
} from "@robinexis/database";
import { ElevenLabsManagementClient, findOwnedTwilioNumber } from "@robinexis/integrations";
import { provisionClientAgent } from "../apps/api/src/provisioningService.js";

const environment = process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_ENVIRONMENT || "";
if (environment !== "staging" || process.env.LIVE_STAGING_CANARY !== "true") {
  throw new Error("staging_environment_and_confirmation_required");
}
const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const clientId = "client_staging_launch_canary";
const operationKey = "live-integrations-launch-v1";
const phoneNumber = required("STAGING_CANARY_PHONE_NUMBER");
if (phoneNumber === "+447446868067") throw new Error("protected_number_forbidden");
const pool = createPool(required("DATABASE_URL"));
const store = new PostgresStore(pool);
const base = robinexisDemoSeed();
const client: ClientConfig = {
  ...base,
  id: clientId,
  slug: "staging-launch-canary",
  businessName: "Robinexis Staging Canary",
  email: "staging-canary@invalid.example",
  transferNumber: "+15005550006",
  inboundNumbers: [],
  elevenlabsAgentId: undefined,
  published: true,
  serviceStatus: "active",
  subscribedProduct: "starter",
  enabledFeatures: [...new Set([...base.enabledFeatures, "booking"])],
};
delete client.onboardingStatus;
delete client.phoneAcquisitionMode;
delete client.requestedPhoneNumber;
await store.upsertClient(client);
const now = new Date().toISOString();
await store.upsertCalendarConnection({
  id: `calendar_${clientId}_primary`,
  clientId,
  provider: "calcom",
  externalAccountId: required("CALCOM_USERNAME"),
  credentialRef: "CALCOM_API_KEY",
  mode: "shared",
  status: "active",
  metadata: { isolation: "tenant_prefixed_event_types", canary: true },
  createdAt: now,
  updatedAt: now,
});

const elevenLabs = new ElevenLabsManagementClient({ apiKey: required("ELEVENLABS_API_KEY") });
const input = {
  clientId,
  operationKey,
  apiBaseUrl: required("API_PUBLIC_BASE_URL"),
  twilioNumber: phoneNumber,
  twilioAccountSid: required("TWILIO_ACCOUNT_SID"),
  twilioAuthToken: required("TWILIO_AUTH_TOKEN"),
};
const dependencies = {
  store,
  elevenLabs,
  randomSecret: () => randomBytes(32).toString("base64url"),
};
const first = await provisionClientAgent(input, dependencies);
const replay = await provisionClientAgent(input, dependencies);
if (first.runId !== replay.runId || first.elevenlabsAgentId !== replay.elevenlabsAgentId) {
  throw new Error("provisioning_idempotency_failed");
}

const imported = await elevenLabs.importTwilioNumber({
  phoneNumber,
  label: "Robinexis staging canary",
  accountSid: required("TWILIO_ACCOUNT_SID"),
  authToken: required("TWILIO_AUTH_TOKEN"),
  agentId: first.elevenlabsAgentId,
  enableSms: false,
}, `${operationKey}:phone-import`);
if (!imported.phone_number_id) throw new Error("elevenlabs_phone_import_failed");
await elevenLabs.assignAgentToPhoneNumber(
  imported.phone_number_id,
  first.elevenlabsAgentId,
  `${operationKey}:phone-assign`,
);
const [agent, owned] = await Promise.all([
  elevenLabs.getAgent(first.elevenlabsAgentId),
  findOwnedTwilioNumber(phoneNumber),
]);
const toolIds = (agent.conversation_config as {
  agent?: { prompt?: { tool_ids?: string[] } };
} | undefined)?.agent?.prompt?.tool_ids || [];
if (toolIds.length < 2 || !owned) throw new Error("live_provider_verification_failed");

console.log(JSON.stringify({
  ok: first.readinessReport.passed,
  clientId,
  idempotent: true,
  elevenLabsAgentId: first.elevenlabsAgentId,
  elevenLabsPhoneId: imported.phone_number_id,
  toolCount: toolIds.length,
  phoneNumber,
  twilioVoiceRouteConfigured: Boolean(owned.voiceUrl),
  calendarEventTypes: first.calendarEventTypes?.length || 0,
  readinessChecks: first.readinessReport.checks.map((check) => ({
    key: check.key,
    status: check.status,
  })),
  syntheticBookingCreated: first.readinessReport.syntheticBooking.created,
  syntheticBookingCancelled: first.readinessReport.syntheticBooking.cancelled,
}));
await pool.end();
if (!first.readinessReport.passed) process.exitCode = 1;
