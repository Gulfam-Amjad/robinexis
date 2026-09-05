import type { SessionActor } from "@robinexis/api-contracts";

export const SOPHIE_DEMO_PATH = "/demo/blades-hair";

export function hasActiveSubscription(actor: SessionActor | undefined): boolean {
  return actor?.subscriptionStatus === "active" || actor?.subscriptionStatus === "trialing";
}

export function canAccessProduct(actor: SessionActor | undefined): boolean {
  return actor?.role === "operator" || (actor?.role === "salon" && hasActiveSubscription(actor));
}

export function dashboardPath(actor: SessionActor | undefined): "/admin" | "/app" | typeof SOPHIE_DEMO_PATH {
  if (actor?.role === "operator") return "/admin";
  if (actor?.role === "salon" && hasActiveSubscription(actor)) return "/app";
  return SOPHIE_DEMO_PATH;
}

export function nonAdminPath(actor: SessionActor | undefined): "/app" | typeof SOPHIE_DEMO_PATH {
  return actor?.role === "salon" && hasActiveSubscription(actor) ? "/app" : SOPHIE_DEMO_PATH;
}
