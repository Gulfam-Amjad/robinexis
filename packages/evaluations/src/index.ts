import type {
  ProviderBenchmarkMetrics,
  ProviderLaunchGateCheck,
  ProviderLaunchGateInput,
} from "@robinexis/api-contracts";
export { UK_SALON_QUALITY_SCENARIOS } from "./fixtures/ukSalonScenarios.js";
export type { UkSalonQualityScenario } from "./fixtures/ukSalonScenarios.js";

export const PROVIDER_QUALITY_THRESHOLDS = Object.freeze({
  minimumCostReductionRatio: 0.25,
  minimumBlindVoiceTieOrWinRate: 0.8,
  maximumBookingSuccessRegressionPoints: 2,
  maximumP95FirstResponseRegressionMs: 150,
  maximumFailedCallRegressionPoints: 0.5,
});

export interface ProviderQualityEvaluation {
  passed: boolean;
  checks: ProviderLaunchGateCheck[];
}

export function evaluateProviderQuality(input: ProviderLaunchGateInput): ProviderQualityEvaluation {
  validateMetrics("baseline", input.baseline);
  validateMetrics("candidate", input.candidate);

  const baselineCost = costPerSuccessfulBooking(input.baseline);
  const candidateCost = costPerSuccessfulBooking(input.candidate);
  const costReduction = baselineCost === 0 ? 0 : (baselineCost - candidateCost) / baselineCost;
  const voiceRate = ratio(
    input.candidate.blindVoiceWins + input.candidate.blindVoiceTies,
    input.candidate.blindVoiceComparisons,
  );
  const baselineBookingRate = ratio(input.baseline.successfulBookings, input.baseline.bookingAttempts) * 100;
  const candidateBookingRate = ratio(input.candidate.successfulBookings, input.candidate.bookingAttempts) * 100;
  const baselineFailedRate = ratio(input.baseline.failedCalls, input.baseline.totalCalls) * 100;
  const candidateFailedRate = ratio(input.candidate.failedCalls, input.candidate.totalCalls) * 100;

  const checks: ProviderLaunchGateCheck[] = [
    metricCheck(
      "cost_per_successful_booking",
      costReduction >= PROVIDER_QUALITY_THRESHOLDS.minimumCostReductionRatio,
      baselineCost,
      candidateCost,
      PROVIDER_QUALITY_THRESHOLDS.minimumCostReductionRatio,
      `Candidate cost per successful booking must be at least 25% lower (${formatPercent(costReduction)} lower).`,
    ),
    metricCheck(
      "blind_voice_tie_or_win",
      voiceRate >= PROVIDER_QUALITY_THRESHOLDS.minimumBlindVoiceTieOrWinRate,
      true,
      voiceRate,
      PROVIDER_QUALITY_THRESHOLDS.minimumBlindVoiceTieOrWinRate,
      `Blind voice tie/win must be at least 80% (${formatPercent(voiceRate)}).`,
    ),
    metricCheck(
      "booking_success",
      candidateBookingRate >= baselineBookingRate - PROVIDER_QUALITY_THRESHOLDS.maximumBookingSuccessRegressionPoints,
      baselineBookingRate,
      candidateBookingRate,
      PROVIDER_QUALITY_THRESHOLDS.maximumBookingSuccessRegressionPoints,
      `Booking success may be no more than 2 percentage points worse (${formatPoints(candidateBookingRate - baselineBookingRate)}).`,
    ),
    metricCheck(
      "p95_first_response",
      input.candidate.p95FirstResponseMs <= input.baseline.p95FirstResponseMs +
        PROVIDER_QUALITY_THRESHOLDS.maximumP95FirstResponseRegressionMs,
      input.baseline.p95FirstResponseMs,
      input.candidate.p95FirstResponseMs,
      PROVIDER_QUALITY_THRESHOLDS.maximumP95FirstResponseRegressionMs,
      `p95 first response may be no more than 150ms worse (${input.candidate.p95FirstResponseMs - input.baseline.p95FirstResponseMs}ms).`,
    ),
    metricCheck(
      "failed_call_rate",
      candidateFailedRate <= baselineFailedRate + PROVIDER_QUALITY_THRESHOLDS.maximumFailedCallRegressionPoints,
      baselineFailedRate,
      candidateFailedRate,
      PROVIDER_QUALITY_THRESHOLDS.maximumFailedCallRegressionPoints,
      `Failed-call rate may be no more than 0.5 percentage points worse (${formatPoints(candidateFailedRate - baselineFailedRate)}).`,
    ),
    metricCheck(
      "barge_in",
      input.candidate.bargeInPassed,
      input.baseline.bargeInPassed,
      input.candidate.bargeInPassed,
      undefined,
      `Candidate barge-in test must pass (${input.candidate.bargeInPassed ? "passed" : "failed"}).`,
    ),
  ];
  return { passed: checks.every((check) => check.passed), checks };
}

function validateMetrics(label: string, metrics: ProviderBenchmarkMetrics) {
  if (!metrics || typeof metrics !== "object") throw new Error(`${label}_metrics_required`);
  const numericKeys = [
    "totalCostMinor",
    "successfulBookings",
    "bookingAttempts",
    "blindVoiceWins",
    "blindVoiceTies",
    "blindVoiceComparisons",
    "p95FirstResponseMs",
    "totalCalls",
    "failedCalls",
  ] as const;
  for (const key of numericKeys) {
    const value = metrics[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new Error(`${label}_${key}_invalid`);
    }
  }
  if (typeof metrics.bargeInPassed !== "boolean") throw new Error(`${label}_barge_in_invalid`);
  if (metrics.successfulBookings <= 0) throw new Error(`${label}_successful_bookings_required`);
  if (metrics.bookingAttempts <= 0 || metrics.successfulBookings > metrics.bookingAttempts) {
    throw new Error(`${label}_booking_counts_invalid`);
  }
  if (metrics.blindVoiceComparisons <= 0 ||
      metrics.blindVoiceWins + metrics.blindVoiceTies > metrics.blindVoiceComparisons) {
    throw new Error(`${label}_blind_voice_counts_invalid`);
  }
  if (metrics.totalCalls <= 0 || metrics.failedCalls > metrics.totalCalls) {
    throw new Error(`${label}_call_counts_invalid`);
  }
}

function costPerSuccessfulBooking(metrics: ProviderBenchmarkMetrics) {
  return metrics.totalCostMinor / metrics.successfulBookings;
}

function ratio(numerator: number, denominator: number) {
  return numerator / denominator;
}

function metricCheck(
  key: string,
  passed: boolean,
  baseline: number | boolean,
  candidate: number | boolean,
  threshold: number | undefined,
  detail: string,
): ProviderLaunchGateCheck {
  return { key, passed, blocking: true, detail, baseline, candidate, threshold };
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function formatPoints(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}pp`;
}
