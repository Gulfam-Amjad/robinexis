import Stripe from "stripe";

const secret = process.env.STRIPE_SECRET_KEY || "";
if (!secret) throw new Error("STRIPE_SECRET_KEY is required");

const stripe = new Stripe(secret);
const active = await stripe.billingPortal.configurations.list({ active: true, limit: 1 });
const features = {
  customer_update: { enabled: true, allowed_updates: ["address", "email", "tax_id"] },
  invoice_history: { enabled: true },
  payment_method_update: { enabled: true },
  subscription_cancel: { enabled: true, mode: "at_period_end", cancellation_reason: { enabled: true, options: ["too_expensive", "missing_features", "switched_service", "unused", "other"] } },
};
const businessProfile = {
  headline: "Manage your Robinexis plan and payment details",
  privacy_policy_url: "https://app.robinexis.com/privacy",
  terms_of_service_url: "https://app.robinexis.com/terms",
};

const configuration = active.data[0]
  ? await stripe.billingPortal.configurations.update(active.data[0].id, {
      business_profile: businessProfile,
      features,
    })
  : await stripe.billingPortal.configurations.create({
      business_profile: businessProfile,
      features,
      default_return_url: "https://app.robinexis.com/billing",
    });

console.log(JSON.stringify({
  ok: true,
  livemode: configuration.livemode,
  active: configuration.active,
  paymentMethodUpdate: configuration.features.payment_method_update.enabled,
  cancellation: configuration.features.subscription_cancel.enabled,
}));
