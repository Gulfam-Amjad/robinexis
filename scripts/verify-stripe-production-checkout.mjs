import Stripe from "stripe";

const environment = process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_ENVIRONMENT || "";
if (environment !== "production" || process.env.CONFIRM_PRODUCTION_CHECKOUT_CANARY !== "true") {
  throw new Error("confirmed production checkout canary required");
}

const secret = (process.env.STRIPE_SECRET_KEY || "").trim();
if (!secret.startsWith("sk_live_")) throw new Error("live Stripe key required");
const priceIds = JSON.parse(process.env.STRIPE_PRICE_IDS_JSON || "{}");
if (!priceIds.pro) throw new Error("configured Pro price required");

const stripe = new Stripe(secret);
const session = await stripe.checkout.sessions.create({
  mode: "subscription",
  line_items: [{ price: priceIds.pro, quantity: 1 }],
  success_url: "https://app.robinexis.com/app?checkout=success",
  cancel_url: "https://app.robinexis.com/app?checkout=cancelled",
  metadata: { canary: "pilot-handover", plan: "pro" },
});

try {
  const items = await stripe.checkout.sessions.listLineItems(session.id, { limit: 1 });
  const item = items.data[0];
  const ok = item?.price?.id === priceIds.pro &&
    item.price.unit_amount === 19_900 &&
    item.price.currency === "gbp";
  console.log(JSON.stringify({
    ok,
    sessionId: session.id,
    priceId: item?.price?.id,
    unitAmount: item?.price?.unit_amount,
    currency: item?.price?.currency,
  }));
  if (!ok) process.exitCode = 1;
} finally {
  await stripe.checkout.sessions.expire(session.id);
}
