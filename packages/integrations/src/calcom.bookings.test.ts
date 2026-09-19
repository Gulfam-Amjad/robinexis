import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bookingBelongsToTenant,
  getBooking,
  listBookings,
  normalizeCalcomBooking,
} from "./calcom.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Cal.com tenant booking isolation", () => {
  it("keeps a booking when the event type id or slug is mapped to the tenant", () => {
    const eventTypes = [
      { providerEventTypeId: "7082310", providerSlug: "blades-hair-30min" },
    ];
    expect(bookingBelongsToTenant(
      { uid: "blades-uid", eventTypeId: "7082310" },
      { eventTypes },
    )).toBe(true);
    expect(bookingBelongsToTenant(
      { uid: "slug-only", eventTypeSlug: "blades-hair-30min" },
      { eventTypes },
    )).toBe(true);
    expect(bookingBelongsToTenant(
      { uid: "dentist-uid", eventTypeId: "99", eventTypeSlug: "dentist-checkup" },
      { eventTypes },
    )).toBe(false);
  });

  it("keeps a booking this workspace already stored even if Cal.com omits the event type", () => {
    expect(bookingBelongsToTenant(
      { uid: "stored-uid" },
      { eventTypes: [], knownBookingUids: ["stored-uid"] },
    )).toBe(true);
    expect(bookingBelongsToTenant(
      { uid: "other-uid" },
      { eventTypes: [], knownBookingUids: ["stored-uid"] },
    )).toBe(false);
  });

  it("normalizes nested eventType objects from list payloads", () => {
    expect(normalizeCalcomBooking({
      uid: "abc",
      title: "Blades Hair — 30 minute appointment",
      eventType: { id: 7082310, slug: "blades-hair-30min" },
      attendees: [{ name: "Sam", email: "sam@example.test" }],
    })).toMatchObject({
      uid: "abc",
      eventTypeId: "7082310",
      eventTypeSlug: "blades-hair-30min",
      attendees: [{ name: "Sam", email: "sam@example.test" }],
    });
  });

  it("lists bookings and reads a single booking through the v2 API", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [
          { uid: "keep", eventTypeId: 10, title: "Cut" },
          { uid: "drop", eventType: { id: 99, slug: "other" }, title: "Other" },
        ],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: { uid: "keep", eventTypeId: 10, title: "Cut" },
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const tenant = { apiKey: "cal_test_key", username: "admin" };

    const listed = await listBookings(tenant, { status: "upcoming" });
    expect(listed.bookings.map((booking) => booking.uid)).toEqual(["keep", "drop"]);
    expect(listed.bookings[0]?.eventTypeId).toBe("10");
    await expect(getBooking(tenant, "keep")).resolves.toMatchObject({
      uid: "keep",
      eventTypeId: "10",
    });
    expect(String(fetchMock.mock.calls[1][0])).toContain("/bookings/keep");
  });
});
