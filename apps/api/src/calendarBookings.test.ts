import type http from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_CLIENT_ID, MemoryStore, SMITH_ENGLAND_ID, seedStore } from "@robinexis/database";
import type { AuthenticatedActor } from "./auth.js";
import { handleProductRoute } from "./productRoutes.js";

const demoOwner: AuthenticatedActor = {
  subject: "calendar_owner",
  email: "owner@example.test",
  role: "salon",
  clientRoles: { [DEMO_CLIENT_ID]: "owner" },
};

async function request(store: MemoryStore, actor: AuthenticatedActor, path: string, method = "GET", input?: unknown) {
  let status = 0;
  let body: any;
  await handleProductRoute({
    req: { method } as http.IncomingMessage,
    res: {} as http.ServerResponse,
    url: new URL(path, "http://localhost"),
    store,
    actor,
    readRaw: async () => Buffer.from(input === undefined ? "" : JSON.stringify(input)),
    send: (_res, code, value) => { status = code; body = value; },
  });
  return { status, body };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("shared Cal.com booking diary isolation", () => {
  beforeEach(() => {
    vi.stubEnv("CALCOM_SHARED_ACCOUNT_ENABLED", "true");
    vi.stubEnv("CALCOM_API_KEY", "cal_live_shared");
    vi.stubEnv("CALCOM_USERNAME", "admin");
    vi.stubEnv("CALCOM_API_BASE_URL", "https://cal-api.example.test/v2");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  async function sharedDemoStore() {
    const store = new MemoryStore();
    await seedStore(store);
    const now = new Date().toISOString();
    await store.upsertCalendarConnection({
      id: `calendar_${DEMO_CLIENT_ID}_primary`,
      clientId: DEMO_CLIENT_ID,
      provider: "calcom",
      credentialRef: "CALCOM_API_KEY",
      mode: "shared",
      status: "active",
      metadata: { isolation: "tenant_prefixed_event_types" },
      createdAt: now,
      updatedAt: now,
    });
    await store.upsertCalendarEventType({
      id: `calendar_event_${DEMO_CLIENT_ID}_cut`,
      clientId: DEMO_CLIENT_ID,
      calendarConnectionId: `calendar_${DEMO_CLIENT_ID}_primary`,
      serviceSlug: "cut",
      providerEventTypeId: "10",
      providerSlug: "robinexis-demo-cut",
      title: "Cut",
      durationMinutes: 30,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    return store;
  }

  it("hides other workspaces' Cal.com bookings from this workspace diary", async () => {
    const store = await sharedDemoStore();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({
      data: [
        {
          uid: "demo-cut",
          title: "Demo Salon — Cut",
          start: "2026-09-19T10:00:00.000Z",
          eventTypeId: 10,
          attendees: [{ name: "Alex", email: "alex@example.test" }],
        },
        {
          uid: "dentist-check",
          title: "Michael Dentist — Check-up",
          start: "2026-09-19T11:00:00.000Z",
          eventType: { id: 99, slug: "michael-dentist-checkup" },
          attendees: [{ name: "Pat", email: "pat@example.test" }],
        },
      ],
    }));

    const result = await request(
      store,
      demoOwner,
      `/api/v1/calendar/bookings?clientId=${DEMO_CLIENT_ID}`,
    );

    expect(result.status).toBe(200);
    expect(result.body.source).toBe("calcom");
    expect(result.body.items.map((item: { uid: string }) => item.uid)).toEqual(["demo-cut"]);
  });

  it("refuses to cancel a booking that belongs to another workspace event type", async () => {
    const store = await sharedDemoStore();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({
      data: {
        uid: "dentist-check",
        eventTypeId: 99,
        eventTypeSlug: "michael-dentist-checkup",
      },
    }));

    const result = await request(
      store,
      demoOwner,
      `/api/v1/calendar/bookings/dentist-check/cancel`,
      "POST",
      { clientId: DEMO_CLIENT_ID, confirmed: true },
    );

    expect(result).toMatchObject({ status: 404, body: { error: "booking_not_found" } });
    expect(String((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] || "")).not.toContain("/cancel");
  });

  it("does not let a tenant owner list another workspace diary", async () => {
    const store = await sharedDemoStore();
    const result = await request(
      store,
      demoOwner,
      `/api/v1/calendar/bookings?clientId=${SMITH_ENGLAND_ID}`,
    );
    expect(result.status).toBe(404);
  });
});
