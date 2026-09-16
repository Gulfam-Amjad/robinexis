import { describe, expect, it, vi } from "vitest";
import { MemoryStore, robinexisDemoSeed } from "@robinexis/database";
import {
  handleProviderUsageRoute,
  providerUsagePortfolio,
  refreshElevenLabsAccountSnapshot,
} from "./providerUsageRoutes.js";
import type { ProductRouteContext } from "./productRoutes.js";

describe("provider usage operations", () => {
  it("rejects tenant users from portfolio usage", async () => {
    const send = vi.fn();
    await handleProviderUsageRoute({
      req: { method: "GET" },
      res: {},
      url: new URL("https://api.test/api/v1/admin/provider-usage"),
      store: new MemoryStore(),
      actor: {
        subject: "tenant",
        email: "tenant@example.test",
        role: "salon",
        clientRoles: { client_usage: "owner" },
      },
      send,
      readRaw: async () => Buffer.from(""),
    } as unknown as ProductRouteContext, "/admin/provider-usage");
    expect(send).toHaveBeenCalledWith(expect.anything(), 403, { error: "platform_admin_required" });
  });

  it("stores a sanitized account-wide ElevenLabs snapshot", async () => {
    const store = new MemoryStore();
    const reader = {
      getSubscription: vi.fn(async () => ({
        tier: "creator",
        status: "active",
        characterCount: 1200,
        characterLimit: 10000,
        nextResetUnix: 1_800_000_000,
      })),
    };
    const snapshot = await refreshElevenLabsAccountSnapshot(
      store,
      reader,
      new Date("2026-09-16T10:00:00.000Z"),
    );
    expect(snapshot).toMatchObject({
      scope: "account",
      status: "healthy",
      usage: { characters: 1200 },
      limits: { tier: "creator", characterLimit: 10000 },
    });
    expect(snapshot).not.toHaveProperty("clientId");
    expect(await store.getLatestProviderAccountSnapshot("elevenlabs-convai")).toEqual(snapshot);
  });

  it("records unavailable rather than inventing account values", async () => {
    const store = new MemoryStore();
    const snapshot = await refreshElevenLabsAccountSnapshot(store, {
      getSubscription: vi.fn(async () => { throw new Error("endpoint_unavailable"); }),
    });
    expect(snapshot).toMatchObject({
      scope: "account",
      status: "unavailable",
      usage: {},
      limits: {},
      cost: {},
    });
  });

  it("aggregates provider events separately from customer allowance", async () => {
    const store = new MemoryStore();
    const client = { ...robinexisDemoSeed(), id: "client_usage", businessName: "Usage Test" };
    await store.upsertClient(client);
    await store.appendProviderUsageCostEvent({
      id: "usage-1",
      clientId: client.id,
      provider: "elevenlabs-convai",
      providerEventId: "conversation-1",
      occurredAt: "2026-09-16T10:00:00.000Z",
      usageQuantity: 120,
      usageUnit: "seconds",
      costMinor: 24,
      currency: "GBP",
      metadata: { estimated: true },
      createdAt: "2026-09-16T10:00:00.000Z",
    });
    const result = await providerUsagePortfolio(
      store,
      "2026-09-01T00:00:00.000Z",
      "2026-10-01T00:00:00.000Z",
    );
    expect(result.totals).toMatchObject({ usageMinutes: 2, estimatedCostMinor: 24 });
    expect(result.clients[0]).toMatchObject({
      clientId: client.id,
      provider: "elevenlabs-convai",
      usageMinutes: 2,
      estimatedCostMinor: 24,
    });
  });
});
