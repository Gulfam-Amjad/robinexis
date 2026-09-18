import { createPool, PostgresStore } from "@robinexis/database";
import { calcom, resolveCalcomTenantConnection } from "@robinexis/integrations";

const environment = process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_ENVIRONMENT || "";
if (environment !== "production" || process.env.CONFIRM_BLADES_BOOKING_CANARY !== "true") {
  throw new Error("confirmed production Blades booking canary required");
}
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
const mappings = await store.listCalendarEventTypes(client.id);
const mapping = mappings.find((item) => item.status === "active");
if (!mapping) throw new Error("active Blades calendar mapping required");
const { tenant } = await resolveCalcomTenantConnection(store, client);
const start = new Date(Date.now() + 60 * 60 * 1_000);
const end = new Date(Date.now() + 8 * 24 * 60 * 60 * 1_000);
const availability = await calcom.checkAvailability(tenant, {
  eventTypeSlug: mapping.providerSlug,
  eventTypeId: mapping.providerEventTypeId,
  start: start.toISOString(),
  end: end.toISOString(),
});
const slot = availability.slots.find((value) => Date.parse(value) > Date.now() + 30 * 60 * 1_000);
if (!slot) throw new Error("no disposable Blades slot available");
const booking = await calcom.createBooking(tenant, {
  eventTypeSlug: mapping.providerSlug,
  eventTypeId: mapping.providerEventTypeId,
  start: slot,
  attendeeName: "Robinexis Delivery Canary",
  attendeeEmail: "delivery-canary@robinexis.com",
  attendeeTimeZone: "Europe/London",
  notes: "Disposable production handover canary. Cancel immediately.",
  conversationId: `blades-delivery-canary-${Date.now()}`,
});
if (!booking.uid || !["accepted", "pending", "confirmed"].includes(booking.status.toLowerCase())) {
  throw new Error(`Blades booking canary failed:${booking.status}`);
}
const cancellation = await calcom.cancelBooking(tenant, booking.uid);
await pool.end();
const ok = cancellation.status === "cancelled";
console.log(JSON.stringify({
  ok,
  availabilityFound: availability.slots.length > 0,
  bookingCreated: true,
  bookingStatus: booking.status,
  bookingCancelled: ok,
  serviceSlug: mapping.serviceSlug,
}));
if (!ok) process.exitCode = 1;
