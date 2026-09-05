import { describe, expect, it } from "vitest";
import type { SessionActor } from "@robinexis/api-contracts";
import {
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

  it.each(["past_due", "canceled", "unpaid", "incomplete", "incomplete_expired", "paused"] as const)(
    "sends %s salon accounts to Sophie",
    (status) => {
      const salon = actor("salon", status);
      expect(dashboardPath(salon)).toBe(SOPHIE_DEMO_PATH);
      expect(nonAdminPath(salon)).toBe(SOPHIE_DEMO_PATH);
      expect(canAccessProduct(salon)).toBe(false);
    },
  );

  it("sends pending and unassigned accounts to Sophie", () => {
    expect(dashboardPath(actor("pending"))).toBe(SOPHIE_DEMO_PATH);
    expect(dashboardPath(undefined)).toBe(SOPHIE_DEMO_PATH);
  });
});
