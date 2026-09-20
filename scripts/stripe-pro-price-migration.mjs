export const TARGET_PRO_PRICE = Object.freeze({
  currency: "gbp",
  unitAmount: 19_900,
  interval: "month",
});

export const LIVE_CONFIRMATION = "IMMEDIATE_PRORATED_199_GBP";

const MIGRATABLE_STATUSES = new Set(["active", "trialing", "past_due", "unpaid", "paused"]);

export function configuredProPriceId(raw) {
  if (!raw?.trim()) throw new Error("STRIPE_PRICE_IDS_JSON_required");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("STRIPE_PRICE_IDS_JSON_invalid");
  }
  const priceId = parsed?.pro;
  if (typeof priceId !== "string" || !priceId.startsWith("price_")) {
    throw new Error("configured_pro_price_id_required");
  }
  return priceId;
}

export function assertMigrationConfirmation({ apply, liveMode, confirmation }) {
  if (!apply) return;
  if (liveMode && confirmation !== LIVE_CONFIRMATION) {
    throw new Error(`live_confirmation_required:${LIVE_CONFIRMATION}`);
  }
}

export function validateConfiguredPrice(price) {
  if (!price || price.object !== "price") throw new Error("configured_pro_price_not_found");
  if (price.currency !== TARGET_PRO_PRICE.currency ||
      price.recurring?.interval !== TARGET_PRO_PRICE.interval) {
    throw new Error("configured_pro_price_must_be_monthly_gbp");
  }
}

export function isTargetPrice(price) {
  return price?.currency === TARGET_PRO_PRICE.currency &&
    price?.unit_amount === TARGET_PRO_PRICE.unitAmount &&
    price?.recurring?.interval === TARGET_PRO_PRICE.interval;
}

export function migratableItems(subscription, oldPriceId) {
  if (!MIGRATABLE_STATUSES.has(subscription.status)) return [];
  return (subscription.items?.data || []).filter((item) => item.price?.id === oldPriceId);
}

export function subscriptionUpdate(items, newPriceId, metadata = {}) {
  return {
    items: items.map((item) => ({
      id: item.id,
      price: newPriceId,
      quantity: item.quantity || 1,
    })),
    proration_behavior: "always_invoice",
    metadata: {
      ...metadata,
      plan: "pro",
      robinexis_price_migration: "pro_199_gbp_2026_09",
    },
  };
}

export function updatedPriceIds(raw, newPriceId) {
  const parsed = JSON.parse(raw);
  return JSON.stringify({ ...parsed, pro: newPriceId });
}

export function updatedFeatureMapping(raw, oldPriceId, newPriceId) {
  if (!raw?.trim()) return undefined;
  const parsed = JSON.parse(raw);
  if (!parsed[oldPriceId]) return raw;
  const next = { ...parsed, [newPriceId]: parsed[oldPriceId] };
  delete next[oldPriceId];
  return JSON.stringify(next);
}
