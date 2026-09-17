import type { OnboardingStatus } from "./types.js";

const transitions: Record<OnboardingStatus, readonly OnboardingStatus[]> = {
  payment_required: ["details_required", "failed"],
  details_required: ["integrations_required", "needs_attention", "failed"],
  integrations_required: ["ready_to_provision", "needs_attention", "failed"],
  ready_to_provision: ["provisioning", "needs_attention", "failed"],
  provisioning: ["testing", "needs_attention", "failed"],
  testing: ["awaiting_approval", "needs_attention", "failed"],
  awaiting_approval: ["active", "needs_attention", "failed"],
  active: ["needs_attention", "failed"],
  needs_attention: [
    "details_required",
    "integrations_required",
    "ready_to_provision",
    "provisioning",
    "testing",
    "awaiting_approval",
    "failed",
  ],
  failed: [
    "details_required",
    "integrations_required",
    "ready_to_provision",
    "provisioning",
    "needs_attention",
  ],
  // Assisted setup remains accepted, but can only move into the canonical path.
  setup_queued: ["setup_in_progress", "ready_to_provision", "provisioning", "needs_attention", "failed"],
  setup_in_progress: ["ready_to_provision", "provisioning", "needs_attention", "failed"],
};

export function canTransitionOnboarding(
  from: OnboardingStatus | undefined,
  to: OnboardingStatus,
): boolean {
  if (!from) return to === "payment_required" || to === "details_required";
  return from === to || transitions[from].includes(to);
}

export function assertOnboardingTransition(
  from: OnboardingStatus | undefined,
  to: OnboardingStatus,
): void {
  if (!canTransitionOnboarding(from, to)) {
    throw new Error(`invalid_onboarding_transition:${from ?? "unset"}:${to}`);
  }
}

export function canonicalOnboardingStatus(status: OnboardingStatus): OnboardingStatus {
  if (status === "setup_queued") return "ready_to_provision";
  if (status === "setup_in_progress") return "provisioning";
  return status;
}
