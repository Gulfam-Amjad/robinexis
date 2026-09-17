import { describe, expect, it } from "vitest";
import type { ClientSummary } from "@robinexis/api-contracts";
import { filterClients, validateCreditAdjustment, validateServiceAction } from "./admin";

const clients: ClientSummary[] = [
  { id: "client_1", slug: "blades-hair", businessName: "Blades Hair", published: true, serviceStatus: "active", onboardingStatus: "active" },
  { id: "client_2", slug: "north-star", businessName: "North Star", published: false, serviceStatus: "paused", onboardingStatus: "needs_attention" },
];

describe("admin helpers", () => {
  it("searches customer identity and status fields case-insensitively", () => {
    expect(filterClients(clients, "BLADES")).toEqual([clients[0]]);
    expect(filterClients(clients, "needs_attention")).toEqual([clients[1]]);
    expect(filterClients(clients, "  ")).toEqual(clients);
  });

  it("validates audited whole-minute credit adjustments", () => {
    expect(validateCreditAdjustment("12.5", "Correction").minutesError).toBeTruthy();
    expect(validateCreditAdjustment("10", "x").reasonError).toBeTruthy();
    expect(validateCreditAdjustment("-10", "Usage correction")).toMatchObject({
      minutes: -10,
      reason: "Usage correction",
      minutesError: undefined,
      reasonError: undefined,
    });
  });

  it("requires a reason and exact customer confirmation for service actions", () => {
    expect(validateServiceAction("no", "CONFIRM Blades Hair", "Blades Hair").reasonError).toBeTruthy();
    expect(validateServiceAction("Billing request", "confirm blades hair", "Blades Hair").confirmationError).toBeTruthy();
    expect(validateServiceAction(" Billing request ", "CONFIRM Blades Hair", "Blades Hair")).toMatchObject({
      reason: "Billing request",
      reasonError: undefined,
      confirmationError: undefined,
    });
  });
});
