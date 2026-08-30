import Stripe from "stripe";
import type { PlatformStore } from "@robinexis/database";
import { stripeStatusToLocal, structuredLog } from "@robinexis/database";

export function createStripe(secret = process.env.STRIPE_SECRET_KEY || "") {
  return secret ? new Stripe(secret) : null;
}

export async function handleStripeWebhook(opts: {
  store: PlatformStore;
  rawBody: Buffer | string;
  signature: string;
  webhookSecret: string;
}): Promise<{ ok: boolean; status?: string }> {
  const stripe = createStripe();
  if (!stripe || !opts.webhookSecret) {
    structuredLog("stripe_webhook_skipped", { reason: "not_configured" });
    return { ok: false };
  }
  const event = stripe.webhooks.constructEvent(opts.rawBody, opts.signature, opts.webhookSecret);
  const handled = [
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
    "invoice.paid",
    "invoice.payment_failed",
  ];
  if (!handled.includes(event.type)) return { ok: true, status: "ignored" };

  let sub = subscriptionFrom(event);
  if (!sub && event.type.startsWith("invoice.")) {
    const invoice = event.data.object as Stripe.Invoice & { subscription?: string };
    if (typeof invoice.subscription === "string") {
      sub = await stripe.subscriptions.retrieve(invoice.subscription);
    }
  }
  if (!sub) return { ok: true, status: "no_subscription" };

  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
  const clients = await opts.store.listClients();
  const client = clients.find((c) => c.stripeCustomerId === customerId || c.stripeSubscriptionId === sub.id);
  if (!client) {
    structuredLog("stripe_webhook_unmatched", { customerId, subscriptionId: sub.id });
    return { ok: true, status: "unmatched" };
  }

  const local = event.type === "customer.subscription.deleted" ? "canceled" : stripeStatusToLocal(sub.status);
  client.serviceStatus = local;
  client.stripeSubscriptionId = sub.id;
  if (customerId) client.stripeCustomerId = customerId;
  if (local === "past_due") client.pastDueAt = new Date().toISOString();
  if (local === "active" || local === "trialing") client.pastDueAt = undefined;
  applyPlanMapping(client, sub);
  await opts.store.upsertClient(client);
  structuredLog("stripe_access_updated", { clientId: client.id, serviceStatus: local, event: event.type });
  return { ok: true, status: local };
}

function subscriptionFrom(event: Stripe.Event): Stripe.Subscription | undefined {
  const obj = event.data.object as { object?: string; subscription?: string | Stripe.Subscription };
  if (event.type.startsWith("customer.subscription")) return event.data.object as Stripe.Subscription;
  if (event.type.startsWith("invoice.")) {
    const inv = event.data.object as Stripe.Invoice & { subscription?: string | Stripe.Subscription };
    const sub = inv.subscription;
    if (sub && typeof sub !== "string") return sub;
  }
  return undefined;
}

export async function reconcileStripe(store: PlatformStore, stripe = createStripe()) {
  if (!stripe) return { checked: 0 };
  const clients = await store.listClients();
  let checked = 0;
  for (const c of clients) {
    if (!c.stripeSubscriptionId) continue;
    try {
      const sub = await stripe.subscriptions.retrieve(c.stripeSubscriptionId);
      c.serviceStatus = stripeStatusToLocal(sub.status);
      applyPlanMapping(c, sub);
      await store.upsertClient(c);
      checked++;
    } catch (err) {
      structuredLog("stripe_reconcile_error", { clientId: c.id, err: String(err) });
    }
  }
  return { checked };
}

function applyPlanMapping(
  client: {
    subscribedProduct?: string;
    monthlyMinuteLimit?: number;
    enabledFeatures: string[];
  },
  subscription: Stripe.Subscription,
) {
  const priceId = subscription.items.data[0]?.price.id;
  if (!priceId) return;
  client.subscribedProduct = priceId;
  const raw = process.env.STRIPE_PRICE_FEATURES_JSON;
  if (!raw) return;
  try {
    const mapping = JSON.parse(raw) as Record<
      string,
      { enabledFeatures?: string[]; monthlyMinuteLimit?: number }
    >;
    const plan = mapping[priceId];
    if (!plan) return;
    if (plan.enabledFeatures) client.enabledFeatures = [...plan.enabledFeatures];
    if (Number.isFinite(plan.monthlyMinuteLimit)) {
      client.monthlyMinuteLimit = plan.monthlyMinuteLimit;
    }
  } catch {
    structuredLog("stripe_plan_mapping_invalid", { priceId });
  }
}
