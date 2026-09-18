import { describe, expect, it } from "vitest";
import { lowBalanceThresholdMinutes, shouldWarnLowBalance } from "./usageAlerts.js";

describe("low-balance warning threshold", () => {
  it("uses the existing in-app allowance threshold and does not invent a recipient", () => {
    expect(lowBalanceThresholdMinutes(300)).toBe(30);
    expect(lowBalanceThresholdMinutes(1500)).toBe(150);
    expect(shouldWarnLowBalance(30, 300)).toBe(true);
    expect(shouldWarnLowBalance(31, 300)).toBe(false);
    expect(shouldWarnLowBalance(150, 1500)).toBe(true);
    expect(shouldWarnLowBalance(151, 1500)).toBe(false);
  });
});
