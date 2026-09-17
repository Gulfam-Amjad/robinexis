import { createHash, createHmac, randomUUID } from "node:crypto";
import { config as loadEnv } from "dotenv";
import pg from "pg";

loadEnv({ path: ".env", quiet: true });

const clientId = process.argv[2];
if (!clientId || clientId === "client_blades_hair") {
  throw new Error("Pass the disposable non-Blades client ID");
}
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
const databaseUrl = process.env.DATABASE_URL;
if (!webhookSecret || !databaseUrl) throw new Error("Stripe webhook or database config is missing");

const pool = new pg.Pool({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
});
const runId = randomUUID().replaceAll("-", "");
const now = Math.floor(Date.now() / 1000);
const subscription = (status) => ({
  id: `sub_safe_${runId}`,
  object: "subscription",
  customer: `cus_safe_${runId}`,
  status,
  created: now,
  trial_end: status === "trialing" ? now + 259_200 : null,
  current_period_start: now,
  current_period_end: now + 2_592_000,
  cancel_at_period_end: false,
  metadata: { clientId, plan: "starter" },
  items: {
    data: [{ price: { id: "price_1Ty6ZxAjOdGkTMNXJQzYBcPx" } }],
  },
});

const bladesHash = async () => {
  const result = await pool.query(
    "SELECT config FROM clients WHERE id = 'client_blades_hair'",
  );
  return createHash("sha256").update(JSON.stringify(result.rows[0]?.config)).digest("hex");
};

async function send(type, object, expected) {
  const event = {
    id: `evt_safe_${runId}_${type.replaceAll(".", "_")}`,
    object: "event",
    api_version: "2025-08-27.basil",
    created: now,
    data: { object },
    livemode: true,
    pending_webhooks: 1,
    request: null,
    type,
  };
  const body = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", webhookSecret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
  const response = await fetch("https://api.robinexis.com/webhooks/stripe", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "stripe-signature": `t=${timestamp},v1=${signature}`,
    },
    body,
  });
  const result = await response.json();
  if (!response.ok || result.status !== expected) {
    throw new Error(`${type} returned ${response.status}: ${JSON.stringify(result)}`);
  }
  return { type, status: result.status };
}

try {
  const before = await bladesHash();
  const results = [];
  results.push(await send("customer.subscription.created", subscription("trialing"), "trialing"));
  results.push(await send("customer.subscription.updated", subscription("active"), "active"));
  results.push(
    await send(
      "invoice.payment_failed",
      { id: `in_failed_${runId}`, object: "invoice", subscription: subscription("active") },
      "past_due",
    ),
  );
  results.push(
    await send(
      "invoice.payment_succeeded",
      { id: `in_succeeded_${runId}`, object: "invoice", subscription: subscription("active") },
      "active",
    ),
  );
  results.push(await send("customer.subscription.deleted", subscription("canceled"), "canceled"));

  const target = await pool.query(
    `SELECT c.id,
            c.config->>'serviceStatus' AS client_status,
            c.config->>'subscribedProduct' AS plan,
            s.provider,
            s.status AS subscription_status
     FROM clients c
     LEFT JOIN subscriptions s ON s.client_id = c.id AND s.provider = 'stripe'
     WHERE c.id = $1`,
    [clientId],
  );
  const after = await bladesHash();
  if (before !== after) throw new Error("Blades config changed during webhook isolation check");
  console.log(JSON.stringify({ ok: true, results, target: target.rows[0], bladesUnchanged: true }, null, 2));
} finally {
  await pool.end();
}
