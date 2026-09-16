import { describe, expect, it, vi } from "vitest";
import { MemoryStore, robinexisDemoSeed } from "@robinexis/database";
import { handleProviderSwitchRoute } from "./providerSwitchRoutes.js";
import type { ProductRouteContext } from "./productRoutes.js";

describe("provider switch route authorization", () => {
  it("returns 403 to tenant users before configuration is inspected", async () => {
    const send = vi.fn();
    const handled = await handleProviderSwitchRoute({
      req: { method: "POST" },
      res: {},
      url: new URL("https://api.test/api/v1/admin/clients/client-1/provider-switch/preview"),
      store: new MemoryStore(),
      actor: {
        subject: "tenant-user",
        email: "tenant@example.test",
        role: "salon",
        clientRoles: { "client-1": "owner" },
      },
      send,
      readRaw: async () => Buffer.from("{}"),
    } as unknown as ProductRouteContext, "/admin/clients/client-1/provider-switch/preview");
    expect(handled).toBe(true);
    expect(send).toHaveBeenCalledWith(expect.anything(), 403, { error: "platform_admin_required" });
  });

  it("rejects generic methods on dedicated switch endpoints", async () => {
    const send = vi.fn();
    await handleProviderSwitchRoute({
      req: { method: "PATCH" },
      res: {},
      url: new URL("https://api.test/api/v1/admin/clients/client-1/provider-switch/start"),
      store: new MemoryStore(),
      actor: {
        subject: "operator",
        email: "operator@example.test",
        role: "operator",
        clientRoles: {},
      },
      send,
      readRaw: async () => Buffer.from("{}"),
    } as unknown as ProductRouteContext, "/admin/clients/client-1/provider-switch/start");
    expect(send).toHaveBeenCalledWith(expect.anything(), 405, { error: "method_not_allowed" });
  });

  it("allows an operator to evaluate and retrieve a gate without provider calls", async () => {
    const previous = process.env.PROVIDER_SWITCH_ENABLED;
    const previousQuality = process.env.PROVIDER_QUALITY_EVALUATION_ENABLED;
    process.env.PROVIDER_SWITCH_ENABLED = "true";
    process.env.PROVIDER_QUALITY_EVALUATION_ENABLED = "true";
    try {
      const store = new MemoryStore();
      const client = { ...robinexisDemoSeed(), id: "client-gate", slug: "client-gate", published: true };
      await store.upsertClient(client);
      await store.upsertProviderDeployment({
        id: "deployment-gate",
        clientId: client.id,
        provider: "livekit-cascade",
        providerDeploymentId: "dispatch-gate",
        status: "staged",
        config: {},
        createdAt: "2026-09-16T10:00:00.000Z",
        updatedAt: "2026-09-16T10:00:00.000Z",
      });
      const send = vi.fn();
      const actor = {
        subject: "operator",
        email: "operator@example.test",
        role: "operator" as const,
        clientRoles: {},
      };
      const body = {
        deploymentId: "deployment-gate",
        candidateProvider: "livekit-cascade",
        source: "import",
        baseline: metrics({ totalCostMinor: 10_000 }),
        candidate: metrics({ totalCostMinor: 7_500 }),
      };
      await handleProviderSwitchRoute({
        req: { method: "POST" },
        res: {},
        url: new URL("https://api.test/api/v1/admin/clients/client-gate/provider-switch/launch-gate"),
        store,
        actor,
        send,
        readRaw: async () => Buffer.from(JSON.stringify(body)),
      } as unknown as ProductRouteContext, "/admin/clients/client-gate/provider-switch/launch-gate");
      expect(send).toHaveBeenLastCalledWith(expect.anything(), 201, expect.objectContaining({ passed: true }));

      await handleProviderSwitchRoute({
        req: { method: "GET" },
        res: {},
        url: new URL("https://api.test/api/v1/admin/clients/client-gate/provider-switch/launch-gate?deploymentId=deployment-gate"),
        store,
        actor,
        send,
        readRaw: async () => Buffer.from(""),
      } as unknown as ProductRouteContext, "/admin/clients/client-gate/provider-switch/launch-gate");
      expect(send).toHaveBeenLastCalledWith(expect.anything(), 200, expect.objectContaining({ passed: true }));
    } finally {
      if (previous === undefined) delete process.env.PROVIDER_SWITCH_ENABLED;
      else process.env.PROVIDER_SWITCH_ENABLED = previous;
      if (previousQuality === undefined) delete process.env.PROVIDER_QUALITY_EVALUATION_ENABLED;
      else process.env.PROVIDER_QUALITY_EVALUATION_ENABLED = previousQuality;
    }
  });
});

function metrics(overrides: Record<string, number | boolean> = {}) {
  return {
    totalCostMinor: 10_000,
    successfulBookings: 100,
    bookingAttempts: 125,
    blindVoiceWins: 20,
    blindVoiceTies: 0,
    blindVoiceComparisons: 25,
    p95FirstResponseMs: 500,
    totalCalls: 1_000,
    failedCalls: 20,
    bargeInPassed: true,
    ...overrides,
  };
}
