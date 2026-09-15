import { afterEach, describe, expect, it, vi } from "vitest";
import { createEventType, listEventTypes, updateEventType } from "./calcom.js";

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
