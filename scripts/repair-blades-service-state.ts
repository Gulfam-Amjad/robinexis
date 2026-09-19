import { createHash } from "node:crypto";
import { createPool, PostgresStore } from "@robinexis/database";

const environment = process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_ENVIRONMENT || "";
if (environment !== "production" || process.env.CONFIRM_BLADES_SERVICE_REPAIR !== "true") {
  throw new Error("confirmed production Blades repair required");
}
const pool = createPool(process.env.DATABASE_URL || "");
const store = new PostgresStore(pool);
const client = await store.getClient("client_blades_hair");
if (!client) throw new Error("protected Blades tenant missing");
if (
  client.elevenlabsAgentId !== "agent_6101m1c3n4wnfsgskgzr13w2gt9s" ||
  !client.inboundNumbers.includes("+447446868067")
) {
  throw new Error("protected identity mismatch");
}
const subscription = await store.getCurrentSubscription(client.id);
if (!subscription || !["active", "trialing"].includes(subscription.status)) {
  throw new Error("active_or_trialing_subscription_required");
}
const before = {
  serviceStatus: client.serviceStatus,
  onboardingStatus: client.onboardingStatus,
  subscribedProduct: client.subscribedProduct,
  agentId: client.elevenlabsAgentId,
  inboundNumbers: client.inboundNumbers,
};
client.serviceStatus = subscription.status;
client.onboardingStatus = "active";
client.subscribedProduct ||= subscription.planTier;
await store.upsertClient(client);
await store.appendOperatorAudit({
  id: `audit_blades_service_repair_${Date.now()}`,
  clientId: client.id,
  actorId: "delivery-gate",
  action: "client.service_state_repaired",
  detail: {
    fromStatus: before.serviceStatus,
    toStatus: client.serviceStatus,
    subscriptionId: subscription.id,
    provider: subscription.provider,
  },
  createdAt: new Date().toISOString(),
});
const identityHash = (value: unknown) => createHash("sha256")
  .update(JSON.stringify(value))
  .digest("hex");
console.log(JSON.stringify({
  ok: true,
  fromStatus: before.serviceStatus,
  toStatus: client.serviceStatus,
  onboardingStatus: client.onboardingStatus,
  planTier: subscription.planTier,
  subscriptionProvider: subscription.provider,
  identityUnchanged: identityHash({
    agentId: before.agentId,
    numbers: before.inboundNumbers,
  }) === identityHash({
    agentId: client.elevenlabsAgentId,
    numbers: client.inboundNumbers,
  }),
}));
await pool.end();
