import Stripe from "stripe";
import {
  LIVE_CONFIRMATION,
  TARGET_PRO_PRICE,
  assertMigrationConfirmation,
  configuredProPriceId,
  isTargetPrice,
  migratableItems,
  subscriptionUpdate,
  updatedFeatureMapping,
  updatedPriceIds,
  validateConfiguredPrice,
} from "./stripe-pro-price-migration.mjs";

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const archiveOldPrice = args.has("--archive-old-price");
const secret = process.env.STRIPE_SECRET_KEY?.trim() || "";
if (!/^(sk|rk|rkcs)_(test|live)_/.test(secret)) throw new Error("valid_STRIPE_SECRET_KEY_required");

const liveMode = secret.includes("_live_");
assertMigrationConfirmation({
  apply,
  liveMode,
  confirmation: process.env.CONFIRM_LIVE_STRIPE_PRO_PRICE_MIGRATION,
});

const priceIdsRaw = process.env.STRIPE_PRICE_IDS_JSON || "";
const configuredPriceId = configuredProPriceId(priceIdsRaw);
const oldPriceId = process.env.OLD_PRO_PRICE_ID?.trim() || configuredPriceId;
const stripe = new Stripe(secret);
const oldPrice = await stripe.prices.retrieve(oldPriceId);
validateConfiguredPrice(oldPrice);

async function listAllSubscriptions() {
  const subscriptions = [];
  let startingAfter;
  do {
    const page = await stripe.subscriptions.list({
      status: "all",
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    subscriptions.push(...page.data);
    startingAfter = page.has_more ? page.data.at(-1)?.id : undefined;
  } while (startingAfter);
  return subscriptions;
}

const productId = typeof oldPrice.product === "string" ? oldPrice.product : oldPrice.product?.id;
if (!productId) throw new Error("configured_pro_product_missing");

let targetPrice;
const requestedTargetId = process.env.NEW_PRO_PRICE_ID?.trim();
if (requestedTargetId) {
  targetPrice = await stripe.prices.retrieve(requestedTargetId);
  if (!isTargetPrice(targetPrice) ||
      (typeof targetPrice.product === "string" ? targetPrice.product : targetPrice.product?.id) !== productId) {
    throw new Error("NEW_PRO_PRICE_ID_must_be_199_gbp_monthly_on_pro_product");
  }
} else {
  const prices = await stripe.prices.list({ product: productId, active: true, limit: 100 });
  targetPrice = prices.data.find(isTargetPrice);
}

if (!targetPrice && apply) {
  targetPrice = await stripe.prices.create({
    product: productId,
    currency: TARGET_PRO_PRICE.currency,
    unit_amount: TARGET_PRO_PRICE.unitAmount,
    recurring: { interval: TARGET_PRO_PRICE.interval },
    metadata: {
      robinexis_plan: "pro",
      robinexis_price_version: "199_gbp_2026_09",
    },
  });
}

const subscriptions = await listAllSubscriptions();

const candidates = targetPrice?.id === oldPriceId
  ? []
  : subscriptions
      .map((subscription) => ({
        subscription,
        items: migratableItems(subscription, oldPriceId),
      }))
      .filter(({ items }) => items.length > 0);

const migrated = [];
if (apply) {
  if (!targetPrice) throw new Error("target_price_creation_failed");
  for (const { subscription, items } of candidates) {
    const updated = await stripe.subscriptions.update(
      subscription.id,
      subscriptionUpdate(items, targetPrice.id, subscription.metadata),
    );
    const remaining = migratableItems(updated, oldPriceId);
    if (remaining.length) throw new Error(`subscription_price_verification_failed:${subscription.id}`);
    migrated.push(subscription.id);
  }
}

const targetPriceId = targetPrice?.id;
let oldPriceArchived = false;
let productDefaultPriceUpdated = false;
if (apply && archiveOldPrice) {
  if (!targetPriceId) throw new Error("target_price_required_before_archive");
  const verification = await listAllSubscriptions();
  const remaining = verification.some((subscription) =>
    migratableItems(subscription, oldPriceId).length > 0);
  if (remaining) throw new Error("old_price_still_has_migratable_subscriptions");
  if (configuredPriceId === oldPriceId) {
    throw new Error("update_STRIPE_PRICE_IDS_JSON_before_archiving_old_price");
  }
  const product = await stripe.products.retrieve(productId);
  const defaultPriceId = typeof product.default_price === "string"
    ? product.default_price
    : product.default_price?.id;
  if (defaultPriceId === oldPriceId) {
    await stripe.products.update(productId, { default_price: targetPriceId });
    productDefaultPriceUpdated = true;
  }
  await stripe.prices.update(oldPriceId, { active: false });
  oldPriceArchived = true;
}

const result = {
  ok: true,
  mode: apply ? "apply" : "dry-run",
  livemode: liveMode,
  target: {
    currency: TARGET_PRO_PRICE.currency,
    unitAmount: TARGET_PRO_PRICE.unitAmount,
    interval: TARGET_PRO_PRICE.interval,
    priceId: targetPriceId || null,
    wouldCreate: !targetPrice,
  },
  oldPriceId,
  configuredPriceId,
  candidateSubscriptions: candidates.map(({ subscription }) => subscription.id),
  migratedSubscriptions: migrated,
  productDefaultPriceUpdated,
  oldPriceArchived,
  nextEnvironment: targetPriceId
    ? {
        STRIPE_PRICE_IDS_JSON: updatedPriceIds(priceIdsRaw, targetPriceId),
        STRIPE_PRICE_FEATURES_JSON: updatedFeatureMapping(
          process.env.STRIPE_PRICE_FEATURES_JSON,
          oldPriceId,
          targetPriceId,
        ),
      }
    : undefined,
  liveConfirmationRequired: liveMode ? LIVE_CONFIRMATION : undefined,
};

console.log(JSON.stringify(result, null, 2));
