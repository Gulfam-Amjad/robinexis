/**
 * Assigns an approved WhatsApp sender to a receptionist tenant that already has
 * a Pro (or other non-zero message) subscription.
 *
 * Required env:
 *   DATABASE_URL
 *   WHATSAPP_SENDER=+E164
 * Optional:
 *   WHATSAPP_ASSIGN_CLIENT_ID (default: client_blades_hair)
 *   ALLOW_INTERNAL_PRO_WHATSAPP=true  — create an internal Pro subscription if missing
 */
import { BLADES_HAIR_ID, getStore, newId } from "@robinexis/database";
import {
  ENABLE_MANAGED_WHATSAPP,
  configureManagedWhatsAppSender,
  managedWhatsAppReadiness,
  planDefinition,
} from "@robinexis/integrations";

const clientId = process.env.WHATSAPP_ASSIGN_CLIENT_ID?.trim() || BLADES_HAIR_ID;
const sender = process.env.WHATSAPP_SENDER?.trim() || "";
if (!sender) {
  console.error("WHATSAPP_SENDER is required");
  process.exit(1);
}

const store = await getStore();
const client = await store.getClient(clientId);
if (!client) {
  console.error("client_not_found");
  process.exit(1);
}

let subscription = await store.getCurrentSubscription(clientId);
const included = subscription ? planDefinition(subscription.planTier).includedMessages : 0;
if (included <= 0) {
  if (subscription?.provider === "stripe") {
    console.error("stripe_subscription_must_be_upgraded_in_billing");
    process.exit(1);
  }
  if (process.env.ALLOW_INTERNAL_PRO_WHATSAPP !== "true") {
    console.error("whatsapp_pro_subscription_required");
    process.exit(1);
  }
  const now = new Date();
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
  subscription = {
    id: subscription?.id || newId("subscription_"),
    clientId,
    provider: "internal",
    planTier: "pro",
    status: "active",
    currentPeriodStart: subscription?.currentPeriodStart || periodStart,
    currentPeriodEnd: subscription?.currentPeriodEnd || periodEnd,
    cancelAtPeriodEnd: false,
    metadata: { ...subscription?.metadata, whatsappInternalPro: true },
    createdAt: subscription?.createdAt || now.toISOString(),
    updatedAt: now.toISOString(),
  };
  await store.upsertSubscription(subscription);
}

const configured = await configureManagedWhatsAppSender({
  store,
  clientId,
  sender,
  actorId: "operator:whatsapp-assign-script",
  confirmation: ENABLE_MANAGED_WHATSAPP,
});
if (!configured.ok) {
  console.error(configured.error);
  process.exit(1);
}

const readiness = await managedWhatsAppReadiness({ store, clientId });
console.log(JSON.stringify({
  clientId,
  senderConfigured: readiness.sender.configured,
  senderStatus: readiness.sender.status,
  templates: readiness.templates.status,
  runtime: readiness.runtime.status,
}, null, 2));
