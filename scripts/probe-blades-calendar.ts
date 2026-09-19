import { createPool, PostgresStore } from "@robinexis/database";
import { calcom, resolveCalcomTenantConnection } from "@robinexis/integrations";
import { probeTenantCalendar } from "../apps/api/src/productRoutes.js";

const environment = process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_ENVIRONMENT || "";
if (environment !== "production") throw new Error("production environment required");
const pool = createPool(process.env.DATABASE_URL || "");
const store = new PostgresStore(pool);
const client = await store.getClient("client_blades_hair");
if (!client) throw new Error("protected Blades tenant missing");
if (
  client.elevenlabsAgentId !== "agent_6101m1c3n4wnfsgskgzr13w2gt9s" ||
  !client.inboundNumbers.includes("+447446868067")
) {
  throw new Error("protected identity mismatch");
}
const { tenant } = await resolveCalcomTenantConnection(store, client);
const [probe, liveEventTypes, mappings] = await Promise.all([
  probeTenantCalendar(store, client),
  calcom.listEventTypes(tenant),
  store.listCalendarEventTypes(client.id),
]);
console.log(JSON.stringify({
  ok: probe.ok,
  probe,
  services: client.services.map((service) => ({
    slug: service.slug,
    name: service.name,
    durationMinutes: service.durationMinutes,
  })),
  liveEventTypes: liveEventTypes.map((item) => ({
    id: item.id,
    slug: item.slug,
    title: item.title,
    durationMinutes: item.lengthInMinutes,
  })),
  mappings: mappings.map((item) => ({
    serviceSlug: item.serviceSlug,
    providerEventTypeId: item.providerEventTypeId,
    providerSlug: item.providerSlug,
    status: item.status,
  })),
}));
await pool.end();
