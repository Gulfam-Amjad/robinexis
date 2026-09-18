import { afterEach, describe, expect, it, vi } from "vitest";
import { BLADES_HAIR_ID, MemoryStore, seedStore } from "@robinexis/database";
import {
  createProviderComparisonSession,
  handleProviderComparisonRoute,
  providerComparisonReadiness,
} from "./providerComparisonRoutes.js";
import type { ProductRouteContext } from "./productRoutes.js";

afterEach(() => vi.unstubAllEnvs());

describe("provider comparison routes", () => {
  it("rejects tenant users before inspecting runtime configuration", async () => {
    const send = vi.fn();
    await handleProviderComparisonRoute({
      req: { method: "GET" },
      res: {},
      url: new URL("https://api.test/api/v1/admin/provider-comparison/readiness"),
      store: new MemoryStore(),
      actor: {
        subject: "tenant",
        email: "tenant@example.test",
        role: "salon",
        clientRoles: { [BLADES_HAIR_ID]: "owner" },
      },
      send,
      readRaw: async () => Buffer.from(""),
    } as unknown as ProductRouteContext, "/admin/provider-comparison/readiness");
    expect(send).toHaveBeenCalledWith(expect.anything(), 403, {
      error: "platform_admin_required",
    });
  });

  it("reports the exact missing runtime settings without inventing readiness", async () => {
    const store = new MemoryStore();
    await seedStore(store);
    const result = await providerComparisonReadiness(store);
    expect(result.premium.ready).toBe(true);
    expect(result.costSaver.ready).toBe(false);
    expect(result.costSaver.missing).toContain("VOICE_RUNTIME_ENABLED");
    expect(result.costSaver.reason).toMatch(/not fully configured/i);
  });

  it("creates an isolated browser room and trusted Blades dispatch metadata", async () => {
    configureRuntime();
    const store = new MemoryStore();
    await seedStore(store);
    const management = {
      createRoom: vi.fn(async () => ({})),
      createDispatch: vi.fn(async (
        _room: string,
        _agentName: string,
        _options: { metadata?: string },
      ) => ({})),
      createToken: vi.fn(async () => "short-lived-token"),
    };

    const session = await createProviderComparisonSession(store, management);

    expect(session).toMatchObject({
      url: "wss://project.livekit.cloud",
      token: "short-lived-token",
      clientId: BLADES_HAIR_ID,
      expiresInSeconds: 300,
    });
    expect(management.createRoom).toHaveBeenCalledWith(expect.objectContaining({
      maxParticipants: 2,
      metadata: expect.stringContaining(BLADES_HAIR_ID),
    }));
    const dispatchMetadata = JSON.parse(
      management.createDispatch.mock.calls[0]![2]!.metadata!,
    );
    expect(dispatchMetadata).toMatchObject({
      tenantId: BLADES_HAIR_ID,
      direction: "inbound",
      objective: "Browser provider comparison",
    });
    const deployments = await store.listProviderDeployments(BLADES_HAIR_ID);
    expect(deployments).toContainEqual(expect.objectContaining({
      provider: "livekit-cascade",
      status: "staged",
      config: expect.objectContaining({
        browserOnly: true,
        routingChanged: false,
      }),
    }));
    expect((await store.getClient(BLADES_HAIR_ID))?.voicePipeline)
      .toBe("elevenlabs-convai");
  });
});

function configureRuntime() {
  vi.stubEnv("VOICE_RUNTIME_ENABLED", "true");
  vi.stubEnv("LIVEKIT_URL", "wss://project.livekit.cloud");
  vi.stubEnv("LIVEKIT_API_KEY", "api-key");
  vi.stubEnv("LIVEKIT_API_SECRET", "api-secret");
  vi.stubEnv("DEEPGRAM_API_KEY", "deepgram-key");
  vi.stubEnv("GROQ_API_KEY", "groq-key");
  vi.stubEnv("ELEVENLABS_API_KEY", "eleven-key");
}
