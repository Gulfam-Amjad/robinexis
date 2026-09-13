import type { SessionActor } from "@robinexis/api-contracts";

export const SOPHIE_DEMO_PATH = "/demo/blades-hair";
export const ONBOARDING_PATH = "/onboarding";
export const BILLING_PATH = "/billing";

export function hasActiveSubscription(actor: SessionActor | undefined): boolean {
  return actor?.subscriptionStatus === "active" || actor?.subscriptionStatus === "trialing";
}

export function canAccessProduct(actor: SessionActor | undefined): boolean {
  return actor?.role === "operator" || (actor?.role === "salon" && hasActiveSubscription(actor));
}

export function dashboardPath(
  actor: SessionActor | undefined,
): "/admin" | "/app" | typeof ONBOARDING_PATH | typeof BILLING_PATH | typeof SOPHIE_DEMO_PATH {
  if (actor?.role === "operator") return "/admin";
  if (actor?.role === "salon" && hasActiveSubscription(actor)) {
    return actor.onboardingStatus && actor.onboardingStatus !== "active"
      ? ONBOARDING_PATH
      : "/app";
  }
  // A verified account with no live plan needs checkout, not the shared demo:
  // /billing/checkout creates the workspace for a pending actor on first pay.
  if (actor?.role === "pending" || actor?.role === "salon") return BILLING_PATH;
  return SOPHIE_DEMO_PATH;
}

export function nonAdminPath(actor: SessionActor | undefined): "/app" | typeof SOPHIE_DEMO_PATH {
  return actor?.role === "salon" && hasActiveSubscription(actor) ? "/app" : SOPHIE_DEMO_PATH;
}
