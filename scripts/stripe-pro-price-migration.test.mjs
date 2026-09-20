import test from "node:test";
import assert from "node:assert/strict";
import {
  LIVE_CONFIRMATION,
  assertMigrationConfirmation,
  configuredProPriceId,
  isTargetPrice,
  migratableItems,
  subscriptionUpdate,
  updatedFeatureMapping,
  updatedPriceIds,
  validateConfiguredPrice,
} from "./stripe-pro-price-migration.mjs";

test("requires an explicit phrase before applying a live migration", () => {
  assert.doesNotThrow(() => assertMigrationConfirmation({ apply: false, liveMode: true }));
  assert.throws(
    () => assertMigrationConfirmation({ apply: true, liveMode: true, confirmation: "yes" }),
    /live_confirmation_required/,
  );
  assert.doesNotThrow(() => assertMigrationConfirmation({
    apply: true,
    liveMode: true,
    confirmation: LIVE_CONFIRMATION,
  }));
});

test("validates the configured monthly GBP Pro price", () => {
  const price = {
    id: "price_old",
    object: "price",
    currency: "gbp",
    unit_amount: 24_900,
    recurring: { interval: "month" },
  };
  assert.doesNotThrow(() => validateConfiguredPrice(price));
  assert.equal(isTargetPrice(price), false);
  assert.equal(isTargetPrice({ ...price, unit_amount: 19_900 }), true);
  assert.throws(() => validateConfiguredPrice({ ...price, currency: "usd" }), /monthly_gbp/);
});

test("selects only eligible subscription items on the old price", () => {
  const subscription = {
    status: "active",
    items: {
      data: [
        { id: "si_old", price: { id: "price_old" }, quantity: 2 },
        { id: "si_other", price: { id: "price_other" }, quantity: 1 },
      ],
    },
  };
  assert.deepEqual(migratableItems(subscription, "price_old").map((item) => item.id), ["si_old"]);
  assert.deepEqual(migratableItems({ ...subscription, status: "canceled" }, "price_old"), []);
});

test("builds an immediate prorated update without dropping metadata or quantity", () => {
  const update = subscriptionUpdate(
    [{ id: "si_old", quantity: 2 }],
    "price_new",
    { clientId: "client_1", plan: "starter" },
  );
  assert.deepEqual(update.items, [{ id: "si_old", price: "price_new", quantity: 2 }]);
  assert.equal(update.proration_behavior, "always_invoice");
  assert.deepEqual(update.metadata, {
    clientId: "client_1",
    plan: "pro",
    robinexis_price_migration: "pro_199_gbp_2026_09",
  });
});

test("rewrites price and feature mappings idempotently", () => {
  const prices = updatedPriceIds(
    JSON.stringify({ starter: "price_starter", pro: "price_old" }),
    "price_new",
  );
  assert.deepEqual(JSON.parse(prices), { starter: "price_starter", pro: "price_new" });
  const features = updatedFeatureMapping(
    JSON.stringify({
      price_old: { enabledFeatures: ["inbound"], monthlyMinuteLimit: 1500 },
    }),
    "price_old",
    "price_new",
  );
  assert.deepEqual(JSON.parse(features), {
    price_new: { enabledFeatures: ["inbound"], monthlyMinuteLimit: 1500 },
  });
  assert.equal(configuredProPriceId(prices), "price_new");
});
