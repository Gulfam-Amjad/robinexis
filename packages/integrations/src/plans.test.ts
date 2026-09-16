import { afterEach, describe, expect, it } from "vitest";
import {
  featureOperationallyAvailable,
  isPlanTier,
  planCatalog,
  planHasFeature,
} from "./plans.js";

afterEach(() => {
  delete process.env.PLAN_STARTER_INCLUDED_MINUTES;
  delete process.env.OUTBOUND_AUTOMATION_ENABLED;
});

describe("plan catalog", () => {
  it("matches the published names, prices, trial, and calendar limits", () => {
    const plans = planCatalog();
    expect(plans.starter).toMatchObject({
      name: "Starter",
      monthlyPricePence: 9_900,
      trialDays: 3,
      calendarLimit: 1,
    });
    expect(plans.pro).toMatchObject({
      name: "Pro",
      monthlyPricePence: 24_900,
      trialDays: 3,
      calendarLimit: 5,
    });
    expect(plans.enterprise.monthlyPricePence).toBeNull();
    expect(plans.enterprise.calendarLimit).toBeNull();
    expect(Object.values(plans).every((plan) =>
      plan.phoneProvisioning.customerOwned && !plan.phoneProvisioning.managed
    )).toBe(true);
  });

  it("allows minutes to be changed without scattering magic numbers", () => {
    process.env.PLAN_STARTER_INCLUDED_MINUTES = "420";
    expect(planCatalog().starter.includedMinutes).toBe(420);
  });

  it("keeps entitlement separate from unavailable outbound automation", () => {
    expect(planHasFeature("pro", "automatic-waitlist-filling")).toBe(true);
    expect(featureOperationallyAvailable("automatic-waitlist-filling")).toBe(false);
    process.env.OUTBOUND_AUTOMATION_ENABLED = "true";
    expect(featureOperationallyAvailable("automatic-waitlist-filling")).toBe(true);
  });

  it("validates tiers", () => {
    expect(isPlanTier("starter")).toBe(true);
    expect(isPlanTier("trial")).toBe(false);
  });
});
