import Stripe from "stripe";
import type { ClientConfig, PlatformStore, ServiceStatus } from "@robinexis/database";
import { stripeStatusToLocal, structuredLog } from "@robinexis/database";
import { isPlanTier, planDefinition, type PlanTier } from "./plans.js";

export function createStripe(secret = process.env.STRIPE_SECRET_KEY || "") {
  return secret ? new Stripe(secret) : null;
}

function stripePriceId(tier: PlanTier): string | undefined {
  const raw = process.env.STRIPE_PRICE_IDS_JSON;
  if (!raw) return undefined;
  try {
    const value = JSON.parse(raw) as Partial<Record<PlanTier, string>>;
    const priceId = value[tier]?.trim();
    return priceId || undefined;
  } catch {
    structuredLog("stripe_price_mapping_invalid", {});
    return undefined;
  }
}

function tenantMetadata(opts: { clientId: string; plan: PlanTier; authUserId?: string }) {
  return {
    clientId: opts.clientId,
    plan: opts.plan,
    ...(opts.authUserId ? { authUserId: opts.authUserId } : {}),
  };
}

export async function createCheckoutSession(opts: {
  clientId: string;
  plan: PlanTier;
  successUrl: string;
  cancelUrl: string;
  customerId?: string;
  customerEmail?: string;
  authUserId?: string;
  stripe?: Stripe | null;
}): Promise<
  | { configured: false; reason: "stripe_not_configured" | "plan_price_not_configured" }
  | { configured: true; id: string; url: string | null }
> {
  const stripe = opts.stripe === undefined ? createStripe() : opts.stripe;
  if (!stripe) return { configured: false, reason: "stripe_not_configured" };
  const price = stripePriceId(opts.plan);
  if (!price) return { configured: false, reason: "plan_price_not_configured" };

  const metadata = tenantMetadata(opts);
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price, quantity: 1 }],
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
    allow_promotion_codes: true,
    payment_method_collection: "if_required",
    client_reference_id: opts.clientId,
    customer: opts.customerId,
    customer_email: opts.customerId ? undefined : opts.customerEmail,
    metadata,
    subscription_data: {
      trial_period_days: planDefinition(opts.plan).trialDays,
      metadata,
    },
  });
  return { configured: true, id: session.id, url: session.url };
}

export async function handleStripeWebhook(opts: {
  store: PlatformStore;
  rawBody: Buffer | string;
  signature: string;
  webhookSecret: string;
  stripe?: Stripe | null;
}): Promise<{ ok: boolean; status?: string }> {
  const stripe = opts.stripe === undefined ? createStripe() : opts.stripe;
  if (!stripe || !opts.webhookSecret) {
    structuredLog("stripe_webhook_skipped", { reason: "not_configured" });
    return { ok: false };
  }
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(opts.rawBody, opts.signature, opts.webhookSecret);
  } catch (error) {
    structuredLog("stripe_webhook_rejected", {
      reason: error instanceof Error ? error.message : "invalid_signature",
    });
    return { ok: false, status: "invalid_signature" };
  }
  const handled = [
    "checkout.session.completed",
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
    "invoice.paid",
    "invoice.payment_failed",
  ];
  if (!handled.includes(event.type)) return { ok: true, status: "ignored" };

  const checkout =
    event.type === "checkout.session.completed"
      ? (event.data.object as Stripe.Checkout.Session)
      : undefined;
  let sub = subscriptionFrom(event);
  if (!sub && checkout) {
    const subscriptionId =
      typeof checkout.subscription === "string"
        ? checkout.subscription
        : checkout.subscription?.id;
    if (subscriptionId) sub = await stripe.subscriptions.retrieve(subscriptionId);
  }
  if (!sub && event.type.startsWith("invoice.")) {
    const invoice = event.data.object as Stripe.Invoice & { subscription?: string };
    if (typeof invoice.subscription === "string") {
      sub = await stripe.subscriptions.retrieve(invoice.subscription);
    }
  }
  if (!sub) return { ok: true, status: "no_subscription" };

  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
  if (!customerId) return { ok: true, status: "no_customer" };
  const metadataPlan = sub.metadata?.plan || checkout?.metadata?.plan;
  const client = await resolveStripeClient(opts.store, {
    subscription: sub,
    checkout,
    customerId,
  });
  if (!client) {
    await opts.store.claimStripeEvent({
      id: event.id,
      eventType: event.type,
      livemode: event.livemode,
      payload: { customerId, subscriptionId: sub.id },
      status: "processed",
      receivedAt: new Date(event.created * 1_000).toISOString(),
      processedAt: new Date().toISOString(),
    });
    structuredLog("stripe_webhook_unmatched", { customerId, subscriptionId: sub.id });
    return { ok: true, status: "unmatched" };
  }

  const eventRow = {
    id: event.id,
    clientId: client.id,
    eventType: event.type,
    livemode: event.livemode,
    payload: { customerId, subscriptionId: sub.id },
    status: "processing" as const,
    receivedAt: new Date(event.created * 1_000).toISOString(),
  };
  const claimed = await opts.store.claimStripeEvent(eventRow);
  if (!claimed) {
    const existing = await opts.store.getStripeEvent(client.id, event.id);
    if (existing?.status !== "failed") return { ok: true, status: "duplicate" };
  }

  try {
    const local = localStatusForEvent(event.type, sub.status);
    client.serviceStatus = local;
    client.stripeSubscriptionId = sub.id;
    if (customerId) client.stripeCustomerId = customerId;
    if (local === "past_due") client.pastDueAt = new Date().toISOString();
    if (local === "active" || local === "trialing") client.pastDueAt = undefined;
    applyPlanMapping(client, sub);
    if (isPlanTier(metadataPlan)) client.subscribedProduct = metadataPlan;
    const planTier = isPlanTier(client.subscribedProduct) ? client.subscribedProduct : "starter";
    await opts.store.upsertClient(client);
    const period = sub as Stripe.Subscription & {
      current_period_start?: number;
      current_period_end?: number;
    };
    await opts.store.upsertSubscription({
      id: `subscription_${client.id}_stripe`,
      clientId: client.id,
      provider: "stripe",
      providerCustomerId: customerId,
      providerSubscriptionId: sub.id,
      planTier,
      status: local,
      priceId: sub.items.data[0]?.price.id,
      trialEndsAt: sub.trial_end ? new Date(sub.trial_end * 1_000).toISOString() : undefined,
      currentPeriodStart: period.current_period_start
        ? new Date(period.current_period_start * 1_000).toISOString()
        : undefined,
      currentPeriodEnd: period.current_period_end
        ? new Date(period.current_period_end * 1_000).toISOString()
        : undefined,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
      metadata: {},
      createdAt: new Date(sub.created * 1_000).toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await opts.store.saveStripeEvent({
      ...eventRow,
      status: "processed",
      processedAt: new Date().toISOString(),
    });
    structuredLog("stripe_access_updated", { clientId: client.id, serviceStatus: local, event: event.type });
    return { ok: true, status: local };
  } catch (error) {
    await opts.store.saveStripeEvent({
      ...eventRow,
      status: "failed",
      error: error instanceof Error ? error.message : "stripe_processing_failed",
    });
    throw error;
  }
}

function localStatusForEvent(eventType: string, stripeStatus: string): ServiceStatus {
  if (eventType === "customer.subscription.deleted") return "canceled";
  if (eventType === "invoice.payment_failed") return "past_due";
  return stripeStatusToLocal(stripeStatus);
}

async function resolveStripeClient(
  store: PlatformStore,
  opts: {
    subscription: Stripe.Subscription;
    checkout?: Stripe.Checkout.Session;
    customerId: string;
  },
): Promise<ClientConfig | undefined> {
  const metadataClientId = String(
    opts.subscription.metadata?.clientId ||
      opts.checkout?.metadata?.clientId ||
      opts.checkout?.client_reference_id ||
      "",
  );
  if (metadataClientId) {
    const byId = await store.getClient(metadataClientId);
    if (byId) return byId;
  }
  const authUserId = String(
    opts.subscription.metadata?.authUserId || opts.checkout?.metadata?.authUserId || "",
  );
  if (authUserId) {
    const profile = await store.getUserProfileByAuthUserId(authUserId);
    if (profile?.clientId) {
      const byProfile = await store.getClient(profile.clientId);
      if (byProfile) return byProfile;
    }
  }
  const clients = await store.listClients();
  return clients.find(
    (c) => c.stripeCustomerId === opts.customerId || c.stripeSubscriptionId === opts.subscription.id,
  );
}

function subscriptionFrom(event: Stripe.Event): Stripe.Subscription | undefined {
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
