import { describe, expect, it } from "vitest";
import { isAiServiceEnabled } from "./access.js";

describe("self-serve activation gate", () => {
  it("keeps paid and published workspaces disabled until provisioning is active", () => {
    const result = isAiServiceEnabled({
      serviceStatus: "active",
      published: true,
      onboardingStatus: "provisioning",
    });
    expect(result.inbound).toBe(false);
    expect(result.reason).toBe("onboarding_provisioning");
  });

  it("enables a completely provisioned workspace", () => {
    const result = isAiServiceEnabled({
      serviceStatus: "active",
      published: true,
      onboardingStatus: "active",
    });
    expect(result.inbound).toBe(true);
  });
});
