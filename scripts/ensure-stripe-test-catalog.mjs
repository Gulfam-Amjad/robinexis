import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import Stripe from "stripe";

function loadTestSecret() {
  if (process.env.STRIPE_SECRET_KEY) return process.env.STRIPE_SECRET_KEY;
  const configPath = join(homedir(), ".config", "stripe", "config.toml");
  const raw = readFileSync(configPath, "utf8");
  const match = raw.match(/test_mode_api_key\s*=\s*'([^']+)'/);
  return match?.[1] || "";
}

const secret = loadTestSecret();
if (!secret.startsWith("sk_test_") && !secret.startsWith("rk_test_") && !secret.startsWith("rkcs_test_")) {
  console.error("Refusing to run: STRIPE_SECRET_KEY must be a test-mode key.");
  process.exit(1);
}

const stripe = new Stripe(secret);
const catalog = [
  { tier: "starter", name: "Starter", amount: 9900, minutes: 300, features: ["inbound", "booking", "transfer"] },
  { tier: "pro", name: "Pro", amount: 24900, minutes: 1500, features: ["inbound", "booking", "transfer", "knowledge"] },
];

async function findOrCreatePrice(spec) {
  const products = await stripe.products.list({ limit: 100, active: true });
  let product = products.data.find((item) => item.metadata?.robinexis_plan === spec.tier)
    || products.data.find((item) => item.name === spec.name && item.metadata?.robinexis_plan);
  if (!product) {
    product = await stripe.products.create({
      name: spec.name,
      description: `Robinexis ${spec.name} monthly subscription`,
      metadata: { robinexis_plan: spec.tier },
    });
  } else if (product.metadata?.robinexis_plan !== spec.tier) {
    await stripe.products.update(product.id, { metadata: { robinexis_plan: spec.tier } });
  }

  const prices = await stripe.prices.list({ product: product.id, active: true, limit: 100 });
  let price = prices.data.find((item) =>
    item.currency === "gbp"
    && item.unit_amount === spec.amount
    && item.recurring?.interval === "month"
    && item.metadata?.robinexis_plan === spec.tier,
  );
  if (!price) {
    price = await stripe.prices.create({
      product: product.id,
      currency: "gbp",
      unit_amount: spec.amount,
      recurring: { interval: "month" },
      metadata: { robinexis_plan: spec.tier },
    });
  }
  return { productId: product.id, priceId: price.id, ...spec };
}

const created = [];
for (const spec of catalog) created.push(await findOrCreatePrice(spec));

const priceIds = Object.fromEntries(created.map((item) => [item.tier, item.priceId]));
const features = Object.fromEntries(created.map((item) => [item.priceId, {
  enabledFeatures: item.features,
  monthlyMinuteLimit: item.minutes,
}]));

const webhookUrl = `${(process.env.API_PUBLIC_BASE_URL || "https://api.robinexis.com").replace(/\/$/, "")}/webhooks/stripe`;
let existing;
let webhookError;
try {
  const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
  existing = endpoints.data.find((item) => item.url === webhookUrl);
} catch (error) {
  webhookError = error instanceof Error ? error.message : "webhook_list_failed";
}
const requiredEvents = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.trial_will_end",
  "invoice.payment_succeeded",
  "invoice.payment_failed",
];

if (process.env.FORCE_RECREATE_STRIPE_WEBHOOK === "true" && existing) {
  await stripe.webhookEndpoints.del(existing.id);
  existing = undefined;
}

let webhook = existing;
if (webhook && !requiredEvents.every((event) => webhook.enabled_events.includes(event))) {
  webhook = await stripe.webhookEndpoints.update(webhook.id, { enabled_events: requiredEvents });
}
if (!webhook && !webhookError) {
  try {
    webhook = await stripe.webhookEndpoints.create({
      url: webhookUrl,
      enabled_events: requiredEvents,
      description: "Robinexis API subscription access",
    });
    if (webhook.secret) {
      writeFileSync(".env.stripe-webhook.secret", webhook.secret, { encoding: "utf8", mode: 0o600 });
    }
  } catch (error) {
    webhookError = error instanceof Error ? error.message : "webhook_create_failed";
  }
}

console.log(JSON.stringify({
  livemode: false,
  priceIds,
  features,
  webhook: webhook
    ? {
        id: webhook.id,
        url: webhook.url,
        status: webhook.status,
        secretReturned: Boolean(webhook.secret),
        reusedExisting: Boolean(existing),
      }
    : { skipped: true, error: webhookError },
}, null, 2));
