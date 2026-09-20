import Stripe from "stripe";
import pg from "pg";

const environment = process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_ENVIRONMENT || "";
if (environment !== "staging" || process.env.LIVE_STAGING_CANARY !== "true") {
  throw new Error("staging_environment_and_confirmation_required");
}
const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const secret = required("STRIPE_SECRET_KEY");
if (!secret.startsWith("sk_test_")) throw new Error("stripe_test_key_required");
const stripe = new Stripe(secret);
const clientId = "client_staging_launch_canary";
const customer = await stripe.customers.create({
  email: "staging-billing-canary@invalid.example",
  name: "Robinexis staging billing canary",
  metadata: { clientId, canary: "true" },
});
const checkout = await stripe.checkout.sessions.create({
  mode: "subscription",
  customer: customer.id,
  line_items: [{ price: required("STRIPE_STARTER_PRICE_ID"), quantity: 1 }],
  client_reference_id: clientId,
  metadata: { clientId, plan: "starter", canary: "true" },
  subscription_data: { metadata: { clientId, plan: "starter", canary: "true" } },
  success_url: `${required("WEB_ORIGIN").split(",")[0]}/billing?checkout=success`,
  cancel_url: `${required("WEB_ORIGIN").split(",")[0]}/billing?checkout=cancelled`,
});
const configurations = await stripe.billingPortal.configurations.list({ active: true, limit: 1 });
const configuration = configurations.data[0] || await stripe.billingPortal.configurations.create({
  business_profile: {
    headline: "Manage your Robinexis subscription",
    privacy_policy_url: "https://app.robinexis.com/privacy-policy",
    terms_of_service_url: "https://app.robinexis.com/terms-and-conditions",
  },
  features: { invoice_history: { enabled: true } },
});
const portal = await stripe.billingPortal.sessions.create({
  customer: customer.id,
  return_url: `${required("WEB_ORIGIN").split(",")[0]}/billing`,
  configuration: configuration.id,
});

const now = Math.floor(Date.now() / 1000);
const eventId = `evt_staging_canary_${now}`;
const subscriptionId = `sub_staging_canary_${now}`;
const event = {
  id: eventId,
  object: "event",
  api_version: "2025-08-27.basil",
  created: now,
  livemode: false,
  pending_webhooks: 1,
  request: null,
  type: "customer.subscription.created",
  data: {
    object: {
      id: subscriptionId,
      object: "subscription",
      cancel_at_period_end: false,
      created: now,
      current_period_start: now,
      current_period_end: now + 30 * 24 * 60 * 60,
      customer: customer.id,
      items: {
        object: "list",
        data: [{
          id: `si_staging_canary_${now}`,
          object: "subscription_item",
          price: { id: required("STRIPE_STARTER_PRICE_ID"), object: "price" },
          quantity: 1,
        }],
      },
      metadata: { clientId, plan: "starter", canary: "true" },
      status: "active",
      trial_end: null,
      trial_start: null,
    },
  },
};
const payload = JSON.stringify(event);
const signature = stripe.webhooks.generateTestHeaderString({
  payload,
  secret: required("STRIPE_WEBHOOK_SECRET"),
});
const deliver = () => fetch(`${required("API_PUBLIC_BASE_URL").replace(/\/$/, "")}/webhooks/stripe`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "stripe-signature": signature },
  body: payload,
});
const first = await deliver();
const firstBody = await first.json();
const replay = await deliver();
const replayBody = await replay.json();
if (!first.ok || !replay.ok || firstBody.status !== "active" || replayBody.status !== "duplicate") {
  throw new Error("stripe_webhook_idempotency_failed");
}

const pool = new pg.Pool({
  connectionString: required("DATABASE_URL"),
  ssl: { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === "true" },
});
const [events, credits, subscription] = await Promise.all([
  pool.query("SELECT count(*)::int AS count FROM stripe_events WHERE id=$1", [eventId]),
  pool.query(
    "SELECT count(*)::int AS count FROM credit_ledger WHERE client_id=$1 AND reference_id=$2",
    [clientId, `${subscriptionId}:${now}`],
  ),
  pool.query(
    "SELECT status, plan_tier FROM subscriptions WHERE client_id=$1 AND provider_subscription_id=$2",
    [clientId, subscriptionId],
  ),
]);
await stripe.checkout.sessions.expire(checkout.id);
await stripe.customers.del(customer.id);
const ok = events.rows[0]?.count === 1 &&
  credits.rows[0]?.count === 1 &&
  subscription.rows[0]?.status === "active";
await pool.query("BEGIN");
try {
  await pool.query(
    "DELETE FROM credit_ledger WHERE client_id=$1 AND reference_id LIKE 'sub_staging_canary_%'",
    [clientId],
  );
  await pool.query(
    "DELETE FROM subscriptions WHERE client_id=$1 AND provider_subscription_id LIKE 'sub_staging_canary_%'",
    [clientId],
  );
  await pool.query(
    "DELETE FROM stripe_events WHERE client_id=$1 AND id LIKE 'evt_staging_canary_%'",
    [clientId],
  );
  await pool.query("COMMIT");
} catch (error) {
  await pool.query("ROLLBACK");
  throw error;
}
await pool.end();
console.log(JSON.stringify({
  ok,
  checkoutCreated: Boolean(checkout.url),
  portalCreated: Boolean(portal.url),
  webhookFirst: firstBody.status,
  webhookReplay: replayBody.status,
  storedEvents: events.rows[0]?.count,
  allowanceGrants: credits.rows[0]?.count,
  subscriptionStatus: subscription.rows[0]?.status,
  plan: subscription.rows[0]?.plan_tier,
}));
if (!ok) process.exitCode = 1;
