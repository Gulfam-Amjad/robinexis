import { createPool, PostgresStore } from "@robinexis/database";
import { calcom, resolveCalcomTenantConnection } from "@robinexis/integrations";

const environment = process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_ENVIRONMENT || "";
if (environment !== "staging") throw new Error("staging environment required");
const clientId = "client_staging_launch_canary";
const pool = createPool(process.env.DATABASE_URL || "");
const store = new PostgresStore(pool);
const client = await store.getClient(clientId);
if (!client) throw new Error("staging canary client is missing");
const bookings = await store.listBookingRecords(clientId);
let cancelled = 0;
if (process.env.CLEANUP_STAGING_BOOKINGS === "true") {
  const { tenant } = await resolveCalcomTenantConnection(store, client);
  for (const booking of bookings.filter((item) =>
    !["cancelled", "canceled"].includes(item.status) && item.providerBookingId)) {
    const result = await calcom.cancelBooking(tenant, booking.providerBookingId!);
    if (result.status === "cancelled") {
      booking.status = "cancelled";
      booking.updatedAt = new Date().toISOString();
      await store.saveBookingRecord(booking);
      cancelled += 1;
    }
  }
}
const [calls, costs] = await Promise.all([
  store.listCallsForClient(clientId, 100),
  store.listProviderUsageCostEvents(clientId),
]);
console.log(JSON.stringify({
  ok: true,
  bookingRecords: bookings.length,
  activeBookingRecords: bookings.filter((item) =>
    !["cancelled", "canceled"].includes(item.status)).length - cancelled,
  cancelledNow: cancelled,
  callRecords: Array.isArray(calls) ? calls.length : calls.items.length,
  providerCostEvents: costs.length,
}));
await pool.end();
