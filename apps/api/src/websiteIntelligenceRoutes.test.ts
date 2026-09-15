import type http from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEMO_CLIENT_ID, MemoryStore, seedStore } from "@robinexis/database";
import type { AuthenticatedActor } from "./auth.js";
import { handleProductRoute } from "./productRoutes.js";

const owner: AuthenticatedActor = {
  subject: "website_owner",
  email: "owner@example.test",
  role: "salon",
  clientRoles: { [DEMO_CLIENT_ID]: "owner" },
};

async function request(store: MemoryStore, path: string, method = "GET", requestBody?: unknown) {
  let status = 0;
  let body: any;
  await handleProductRoute({
    req: { method } as http.IncomingMessage,
    res: {} as http.ServerResponse,
    url: new URL(path, "http://localhost"),
    store,
    actor: owner,
    readRaw: async () => Buffer.from(requestBody === undefined ? "" : JSON.stringify(requestBody)),
    send: (_res, responseStatus, responseBody) => {
      status = responseStatus;
      body = responseBody;
    },
  });
  return { status, body };
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.FIRECRAWL_API_KEY;
  delete process.env.GEMINI_API_KEY;
});

describe("website intelligence API", () => {
  it("scans, reviews, approves to draft, and never publishes", async () => {
    const store = new MemoryStore();
    await seedStore(store);
    const liveBefore = structuredClone(await store.getClient(DEMO_CLIENT_ID));
    process.env.FIRECRAWL_API_KEY = "test-key";
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "crawl_api" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: "completed",
        data: [{
          markdown: "# New Name\nMonday–Friday 09:00–17:00",
          json: {
            businessName: "New Name",
            locations: [],
            contacts: { phones: [], emails: [] },
            hours: "Monday–Friday 09:00–17:00",
            timezone: "Europe/London",
            services: [{ name: "Consultation", durationMinutes: 30, price: "£30" }],
            bookingRules: [],
            cancellationRules: [],
            faqs: [],
            transferEscalation: [],
            transferDestination: "+442071234567",
            recordingConsent: "Ask for consent before recording",
            tone: "Warm",
          },
          metadata: { sourceURL: "https://business-example.co.uk/" },
        }],
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);

    const scanned = await request(
      store,
      `/api/v1/clients/${DEMO_CLIENT_ID}/website-intelligence`,
      "POST",
      { url: "https://business-example.co.uk/" },
    );
    expect(scanned.status).toBe(201);
    expect(scanned.body.run.status).toBe("succeeded");
    expect(scanned.body.facts.length).toBeGreaterThan(5);
    const source = (await store.listWebsiteSources(DEMO_CLIENT_ID))[0]!;
    expect(source.metadata).not.toHaveProperty("markdown");
    expect(source.metadata).toMatchObject({
      contentChecksum: expect.stringMatching(/^[a-f0-9]{64}$/),
      contentChars: expect.any(Number),
    });

    for (const fact of scanned.body.facts) {
      const reviewed = await request(
        store,
        `/api/v1/clients/${DEMO_CLIENT_ID}/website-intelligence/runs/${scanned.body.run.id}/facts/${fact.id}`,
        "PATCH",
        { action: "confirm" },
      );
      expect(reviewed.status).toBe(200);
    }
    const approved = await request(
      store,
      `/api/v1/clients/${DEMO_CLIENT_ID}/website-intelligence/runs/${scanned.body.run.id}/approve-indexing`,
      "POST",
      { indexKnowledge: false },
    );
    expect(approved).toMatchObject({
      status: 200,
      body: { approved: true, published: false, indexingStatus: "not_requested" },
    });
    expect((await store.getDraftClient(DEMO_CLIENT_ID))?.config.businessName).toBe("New Name");
    expect(await store.getClient(DEMO_CLIENT_ID)).toEqual(liveBefore);
    expect((await store.listOperatorAudit(DEMO_CLIENT_ID)).map((item) => item.action))
      .toContain("website_intelligence.indexing_approved");
  });

  it("does not expose another tenant's scan", async () => {
    const store = new MemoryStore();
    await seedStore(store);
    const response = await request(store, "/api/v1/clients/client_not_owned/website-intelligence");
    expect(response).toMatchObject({ status: 404, body: { error: "client_not_found" } });
  });
});
