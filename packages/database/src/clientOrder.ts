import { DEMO_CLIENT_ID } from "./ids.js";
import type { ClientConfig } from "./types.js";

type OrderableClient = Pick<ClientConfig, "id" | "slug" | "businessName" | "published">;

export function isSandboxTenant(client: Pick<ClientConfig, "id" | "slug">): boolean {
  return client.id === DEMO_CLIENT_ID || client.slug === DEMO_CLIENT_ID;
}

/**
 * Dashboards select the first client as the default workspace, so real published
 * tenants must lead and the sandbox must trail.
 */
export function compareClientsForDashboard(left: OrderableClient, right: OrderableClient): number {
  const sandbox = Number(isSandboxTenant(left)) - Number(isSandboxTenant(right));
  if (sandbox !== 0) return sandbox;
  const published = Number(Boolean(right.published)) - Number(Boolean(left.published));
  if (published !== 0) return published;
  const name = left.businessName.localeCompare(right.businessName);
  return name !== 0 ? name : left.id.localeCompare(right.id);
}

export function sortClientsForDashboard<T extends OrderableClient>(clients: T[]): T[] {
  return [...clients].sort(compareClientsForDashboard);
}
