import { afterEach, describe, expect, it, vi } from "vitest";
import { checkAvailability, createBooking, createEventType, listEventTypes, updateEventType } from "./calcom.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Cal.com event type adapter", () => {
  it("lists and writes event types using the platform credential", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [{ id: 7, slug: "workspace-cut", title: "Cut", lengthInMinutes: 45 }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: { id: 8, slug: "workspace-colour", title: "Colour", lengthInMinutes: 60 },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: { id: 8, slug: "workspace-colour", title: "Colour", lengthInMinutes: 75 },
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("CALCOM_API_BASE_URL", "https://cal-api.example.test/v2/");
    const tenant = {
      apiKey: "cal_test_key",
      username: "robinexis",
      mode: "managed" as const,
      clientId: "platform-client",
    };

    await expect(listEventTypes(tenant)).resolves.toEqual([
      { id: 7, slug: "workspace-cut", title: "Cut", lengthInMinutes: 45 },
    ]);
    await createEventType(tenant, {
      title: "Colour",
      slug: "workspace-colour",
      durationMinutes: 60,
    });
    await updateEventType(tenant, 8, {
      title: "Colour",
      slug: "workspace-colour",
      durationMinutes: 75,
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0][0]).toBe("https://cal-api.example.test/v2/event-types");
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      method: "POST",
      headers: expect.objectContaining({
        Authorization: "Bearer cal_test_key",
        "x-cal-client-id": "platform-client",
        "x-cal-user-mode": "managed",
      }),
    });
    expect(fetchMock.mock.calls[2][0]).toContain("/event-types/8");
  });
});

describe("Cal.com event type addressing", () => {
  const tenant = { apiKey: "cal_test_key", username: "robinexis" };
  const range = { start: "2026-09-16T00:00:00.000Z", end: "2026-09-23T00:00:00.000Z" };

  /**
   * Slug lookups resolve through the public username handle, which stopped
   * resolving when the account moved into a Cal.com organisation.
   */
  it("addresses availability by event type id when the mapping has one", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: {} }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await checkAvailability(tenant, { eventTypeSlug: "blades-hair-30min", eventTypeId: "7082310", ...range });
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("eventTypeId=7082310");
    expect(url).not.toContain("username=");
    expect(url).not.toContain("eventTypeSlug=");
  });

  it("falls back to username and slug for legacy mappings without an id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: {} }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await checkAvailability(tenant, { eventTypeSlug: "30min", ...range });
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("username=robinexis");
    expect(url).toContain("eventTypeSlug=30min");
  });

  it("books by event type id when the mapping has one", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { uid: "bk_1", status: "accepted" } }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await createBooking(tenant, {
      eventTypeSlug: "blades-hair-30min",
      eventTypeId: "7082310",
      start: range.start,
      attendeeName: "Test",
      attendeeEmail: "test@example.test",
      conversationId: "conv_1",
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body.eventTypeId).toBe(7082310);
    expect(body.eventTypeSlug).toBeUndefined();
    expect(body.username).toBeUndefined();
  });
});
