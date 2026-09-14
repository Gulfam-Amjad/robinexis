import { describe, expect, it } from "vitest";
import type { SessionActor } from "@robinexis/api-contracts";
import {
  BILLING_PATH,
  canAccessProduct,
  dashboardPath,
  nonAdminPath,
  SOPHIE_DEMO_PATH,
} from "./routing.js";

function actor(
  role: SessionActor["role"],
  subscriptionStatus?: SessionActor["subscriptionStatus"],
): SessionActor {
  return {
    email: `${role}@example.test`,
    role,
    clientRoles: {},
    subscriptionStatus,
  };
}

describe("post-login routing policy", () => {
  it("sends operators to the complete admin workspace", () => {
    const operator = actor("operator");
    expect(dashboardPath(operator)).toBe("/admin");
    expect(canAccessProduct(operator)).toBe(true);
  });

  it.each(["active", "trialing"] as const)("sends %s salon accounts to the product", (status) => {
    const salon = actor("salon", status);
    expect(dashboardPath(salon)).toBe("/app");
    expect(nonAdminPath(salon)).toBe("/app");
    expect(canAccessProduct(salon)).toBe(true);
  });

  it("sends paid but incomplete salons to onboarding", () => {
    const salon = { ...actor("salon", "active"), onboardingStatus: "details_required" as const };
    expect(dashboardPath(salon)).toBe("/onboarding");
    expect(canAccessProduct(salon)).toBe(true);
  });

  it.each(["past_due", "canceled", "unpaid", "incomplete", "incomplete_expired", "paused"] as const)(
    "sends %s salon accounts to billing recovery",
    (status) => {
      const salon = actor("salon", status);
      expect(dashboardPath(salon)).toBe(BILLING_PATH);
      expect(nonAdminPath(salon)).toBe(BILLING_PATH);
      expect(canAccessProduct(salon)).toBe(false);
    },
  );

  it("sends a self-serve signup with no plan yet to billing", () => {
    expect(dashboardPath(actor("pending"))).toBe(BILLING_PATH);
    expect(dashboardPath(actor("salon"))).toBe(BILLING_PATH);
  });

  it("sends an unidentified visitor to Sophie", () => {
    expect(dashboardPath(undefined)).toBe(SOPHIE_DEMO_PATH);
  });
});
