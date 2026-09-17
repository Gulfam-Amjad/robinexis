import { describe, expect, it } from "vitest";
import type { ProviderLaunchGateInput } from "@robinexis/api-contracts";
import { evaluateProviderQuality } from "./index.js";

const passing: ProviderLaunchGateInput = {
  deploymentId: "deployment-livekit",
  candidateProvider: "livekit-cascade",
  source: "import",
  baseline: {
    totalCostMinor: 10_000,
    successfulBookings: 100,
    bookingAttempts: 125,
    blindVoiceWins: 0,
    blindVoiceTies: 25,
    blindVoiceComparisons: 25,
    p95FirstResponseMs: 500,
    totalCalls: 1_000,
    failedCalls: 20,
    bargeInPassed: true,
  },
  candidate: {
    totalCostMinor: 7_500,
    successfulBookings: 100,
    bookingAttempts: 128,
    blindVoiceWins: 16,
    blindVoiceTies: 4,
    blindVoiceComparisons: 25,
    p95FirstResponseMs: 650,
    totalCalls: 1_000,
    failedCalls: 25,
    bargeInPassed: true,
  },
};

describe("provider-neutral quality evaluator", () => {
  it("passes exact inclusive boundaries deterministically", () => {
    const first = evaluateProviderQuality(passing);
    const second = evaluateProviderQuality(structuredClone(passing));
    expect(first).toEqual(second);
    expect(first.passed).toBe(true);
    expect(first.checks).toHaveLength(6);
  });

  it.each([
    ["cost_per_successful_booking", { candidate: { totalCostMinor: 7_501 } }],
    ["blind_voice_tie_or_win", { candidate: { blindVoiceTies: 3 } }],
    ["booking_success", { candidate: { bookingAttempts: 129 } }],
    ["p95_first_response", { candidate: { p95FirstResponseMs: 651 } }],
    ["failed_call_rate", { candidate: { failedCalls: 26 } }],
    ["barge_in", { candidate: { bargeInPassed: false } }],
  ] as const)("blocks when %s misses its threshold", (key, patch) => {
    const input = structuredClone(passing);
    Object.assign(input.candidate, patch.candidate);
    const result = evaluateProviderQuality(input);
    expect(result.passed).toBe(false);
    expect(result.checks.find((check) => check.key === key)?.passed).toBe(false);
  });

  it("rejects invalid or empty samples instead of producing a pass", () => {
    const input = structuredClone(passing);
    input.candidate.totalCalls = 0;
    expect(() => evaluateProviderQuality(input)).toThrow("candidate_call_counts_invalid");
  });
});
