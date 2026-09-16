import { describe, expect, it, vi } from "vitest";
import {
  BLADES_HAIR_ID,
  MemoryStore,
  robinexisDemoSeed,
  type ActiveVoiceProvider,
  type ClientConfig,
  type ProviderDeployment,
} from "@robinexis/database";
import type { VoiceProviderAdapter } from "@robinexis/integrations";
import { ProviderSwitchService } from "./providerSwitchService.js";

const NOW = "2026-09-16T10:00:00.000Z";

describe("provider safe switch", () => {
  it("lazily represents an existing ElevenLabs tenant without routing writes", async () => {
    const store = new MemoryStore();
    const client = {
      ...robinexisDemoSeed(),
      id: "client_existing_el",
      slug: "existing-el",
      voicePipeline: "elevenlabs-convai" as const,
      elevenlabsAgentId: "agent_existing",
    };
    await store.upsertClient(client);
    await store.upsertProviderResource({
      id: "resource_existing_el",
      clientId: client.id,
      provider: "elevenlabs",
      resourceType: "phone_number",
      providerResourceId: "PN_EXISTING",
      lifecycleStatus: "active",
      metadata: {},
      createdAt: NOW,
      updatedAt: NOW,
    });
    const adapters = {
      "elevenlabs-convai": adapter("elevenlabs-convai"),
      "livekit-cascade": adapter("livekit-cascade"),
    };
    await new ProviderSwitchService(store, adapters).preview(client.id, "livekit-cascade");
    expect(await store.getActiveProviderDeployment(client.id)).toMatchObject({
      provider: "elevenlabs-convai",
      providerDeploymentId: "agent_existing",
      config: { phoneNumberId: "PN_EXISTING" },
    });
    expect(adapters["elevenlabs-convai"].route).not.toHaveBeenCalled();
    expect(await store.listOperatorAudit(client.id)).toContainEqual(expect.objectContaining({
      action: "provider_deployment.elevenlabs_backfilled",
      detail: expect.objectContaining({ routingChanged: false }),
    }));
  });

  it("prepares an isolated staged LiveKit deployment without routing", async () => {
    const { store, adapters, client } = await fixture();
    const deployment = await new ProviderSwitchService(
      store,
      adapters,
      { enabled: true, routingEnabled: false },
    ).prepare({
      clientId: client.id,
      provider: "livekit-cascade",
      actorId: "operator-1",
      livekit: {
        providerDeploymentId: "dispatch-prepared",
        phoneNumberId: "PN1",
        suspendVoiceUrl: "https://example.test/suspended",
        ingressKind: "twilio_voice_url",
        voiceUrl: "https://runtime.example.test/inbound",
      },
    });
    expect(deployment).toMatchObject({
      provider: "livekit-cascade",
      status: "staged",
      providerDeploymentId: "dispatch-prepared",
    });
    expect(adapters["livekit-cascade"].route).not.toHaveBeenCalled();
  });

  it("is blocked by default without making routing writes", async () => {
    const { store, adapters, client } = await fixture();
    const result = await new ProviderSwitchService(store, adapters).preview(client.id, "livekit-cascade");
    expect(result.status).toBe("blocked");
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "feature_enabled", passed: false }),
      expect.objectContaining({ key: "routing_enabled", passed: false }),
    ]));
    expect(adapters["livekit-cascade"].route).not.toHaveBeenCalled();
  });

  it("blocks healthy LiveKit until an explicit stored gate passes", async () => {
    const { store, adapters, client } = await fixture();
    const target = (await store.listProviderDeployments(client.id)).find((item) => item.id === "deployment_lk")!;
    target.launchGate = undefined;
    await store.upsertProviderDeployment(target);
    const service = new ProviderSwitchService(store, adapters, {
      enabled: true,
      routingEnabled: true,
      qualityEvaluationEnabled: true,
    });

    const blocked = await service.preview(client.id, "livekit-cascade");
    expect(blocked.status).toBe("blocked");
    expect(blocked.checks).toContainEqual(expect.objectContaining({
      key: "quality_launch_gate",
      passed: false,
    }));
    expect(adapters["livekit-cascade"].route).not.toHaveBeenCalled();
  });

  it("evaluates and stores a passing gate without live routing", async () => {
    const { store, adapters, client } = await fixture();
    const service = new ProviderSwitchService(store, adapters, {
      enabled: true,
      routingEnabled: true,
      qualityEvaluationEnabled: true,
    });
    const gate = await service.evaluateLaunchGate(client.id, benchmarkInput(), "operator-1");

    expect(gate.passed).toBe(true);
    expect(await service.getLaunchGate(client.id, "deployment_lk")).toEqual(gate);
    expect(adapters["livekit-cascade"].health).not.toHaveBeenCalled();
    expect(adapters["livekit-cascade"].provision).not.toHaveBeenCalled();
    expect(adapters["livekit-cascade"].route).not.toHaveBeenCalled();
    expect(await store.listOperatorAudit(client.id)).toContainEqual(expect.objectContaining({
      id: gate.id,
      action: "provider_launch_gate.evaluated",
    }));
  });

  it("fails closed when a passed gate is stale", async () => {
    const { store, adapters, client } = await fixture();
    const target = (await store.listProviderDeployments(client.id)).find((item) => item.id === "deployment_lk")!;
    target.launchGate!.evaluatedAt = "2000-01-01T00:00:00.000Z";
    await store.upsertProviderDeployment(target);
    const service = new ProviderSwitchService(store, adapters, {
      enabled: true,
      routingEnabled: true,
      launchGateMaxAgeMs: 60_000,
    });
    const preview = await service.preview(client.id, "livekit-cascade");
    expect(preview.status).toBe("blocked");
    expect(preview.checks).toContainEqual(expect.objectContaining({
      key: "quality_launch_gate",
      passed: false,
    }));
    expect(adapters["livekit-cascade"].route).not.toHaveBeenCalled();
  });

  it("switches once for an idempotency key and keeps an immutable snapshot", async () => {
    const { store, adapters, client } = await fixture();
    const service = new ProviderSwitchService(store, adapters, { enabled: true, routingEnabled: true });
    const input = {
      clientId: client.id,
      toProvider: "livekit-cascade" as const,
      idempotencyKey: "switch-1",
      confirmation: `SWITCH ${client.businessName}`,
      actorId: "operator-1",
    };
    const first = await service.start(input);
    const second = await service.start(input);
    expect(first.status).toBe("live");
    expect(second.id).toBe(first.id);
    expect(adapters["livekit-cascade"].route).toHaveBeenCalledTimes(1);
    expect((await store.getActiveProviderDeployment(client.id))?.provider).toBe("livekit-cascade");
    expect((await store.listOperatorAudit(client.id)).map((item) => item.action))
      .toEqual(expect.arrayContaining(["provider_switch.requested", "provider_switch.succeeded"]));

    const rolledBack = await service.rollback(client.id, first.id, "operator-2");
    expect(rolledBack.status).toBe("rolled_back");
    expect((await store.getActiveProviderDeployment(client.id))?.provider).toBe("elevenlabs-convai");
    expect(adapters["livekit-cascade"].suspend).toHaveBeenCalled();
    expect(adapters["elevenlabs-convai"].restore).toHaveBeenCalled();
  });

  it("compensates every routing failure and restores the source", async () => {
    const { store, adapters, client } = await fixture();
    vi.mocked(adapters["livekit-cascade"].route).mockRejectedValueOnce(new Error("route_failed"));
    const result = await new ProviderSwitchService(
      store,
      adapters,
      { enabled: true, routingEnabled: true },
    ).start({
      clientId: client.id,
      toProvider: "livekit-cascade",
      idempotencyKey: "switch-failure",
      confirmation: `SWITCH ${client.businessName}`,
      actorId: "operator-1",
    });
    expect(result.status).toBe("rolled_back");
    expect(adapters["livekit-cascade"].suspend).toHaveBeenCalled();
    expect(adapters["elevenlabs-convai"].restore).toHaveBeenCalled();
    expect((await store.getActiveProviderDeployment(client.id))?.provider).toBe("elevenlabs-convai");
  });

  it("restores the source without suspending untouched routing when provisioning fails", async () => {
    const { store, adapters, client } = await fixture();
    vi.mocked(adapters["livekit-cascade"].provision).mockRejectedValueOnce(new Error("provision_failed"));
    const result = await new ProviderSwitchService(
      store,
      adapters,
      { enabled: true, routingEnabled: true },
    ).start({
      clientId: client.id,
      toProvider: "livekit-cascade",
      idempotencyKey: "switch-provision-failure",
      confirmation: `SWITCH ${client.businessName}`,
      actorId: "operator-1",
    });
    expect(result.status).toBe("rolled_back");
    expect(adapters["livekit-cascade"].suspend).not.toHaveBeenCalled();
    expect(adapters["elevenlabs-convai"].restore).toHaveBeenCalled();
  });

  it("blocks Blades and protected live numbers before switching", async () => {
    const { store, adapters } = await fixture({
      id: BLADES_HAIR_ID,
      slug: "blades-hair",
      businessName: "Blades Hair",
    });
    const preview = await new ProviderSwitchService(
      store,
      adapters,
      { enabled: true, routingEnabled: true },
    ).preview(BLADES_HAIR_ID, "livekit-cascade");
    expect(preview.status).toBe("blocked");
    expect(preview.checks).toContainEqual(expect.objectContaining({ key: "protected_number", passed: false }));
    expect(adapters["livekit-cascade"].route).not.toHaveBeenCalled();
  });
});

async function fixture(overrides: Partial<ClientConfig> = {}) {
  const store = new MemoryStore();
  const client: ClientConfig = {
    ...robinexisDemoSeed(),
    id: "client_switch_test",
    slug: "switch-test",
    businessName: "Switch Test",
    voicePipeline: "elevenlabs-convai",
    published: true,
    ...overrides,
  };
  await store.upsertClient(client);
  await store.upsertProviderDeployment(deployment(client.id, "deployment_el", "elevenlabs-convai", "active", {
    phoneNumberId: "PN1",
    agentId: "agent_el",
  }));
  await store.upsertProviderDeployment(deployment(client.id, "deployment_lk", "livekit-cascade", "staged", {
    phoneNumberId: "PN1",
    suspendVoiceUrl: "https://example.test/suspended",
    ingress: { kind: "twilio_voice_url", voiceUrl: "https://runtime.example.test/inbound" },
  }));
  return {
    store,
    client,
    adapters: {
      "elevenlabs-convai": adapter("elevenlabs-convai"),
      "livekit-cascade": adapter("livekit-cascade"),
    },
  };
}

function deployment(
  clientId: string,
  id: string,
  provider: ActiveVoiceProvider,
  status: ProviderDeployment["status"],
  config: Record<string, unknown>,
): ProviderDeployment {
  const result: ProviderDeployment = {
    id,
    clientId,
    provider,
    providerDeploymentId: provider === "elevenlabs-convai" ? "agent_el" : "livekit_dispatch",
    status,
    config,
    createdAt: NOW,
    updatedAt: NOW,
  };
  if (provider === "livekit-cascade") {
    result.launchGate = {
      id: "gate_fixture",
      ...benchmarkInput(),
      evaluatedAt: new Date().toISOString(),
      evaluatedBy: "operator-fixture",
      passed: true,
      checks: [],
    };
  }
  return result;
}

function benchmarkInput() {
  return {
    deploymentId: "deployment_lk",
    candidateProvider: "livekit-cascade" as const,
    source: "manual" as const,
    baseline: {
      totalCostMinor: 10_000,
      successfulBookings: 100,
      bookingAttempts: 125,
      blindVoiceWins: 0,
      blindVoiceTies: 25,
      blindVoiceComparisons: 25,
      p95FirstResponseMs: 500,
      totalCalls: 1_000,
      failedCalls: 20,
      bargeInPassed: true,
    },
    candidate: {
      totalCostMinor: 7_500,
      successfulBookings: 100,
      bookingAttempts: 128,
      blindVoiceWins: 16,
      blindVoiceTies: 4,
      blindVoiceComparisons: 25,
      p95FirstResponseMs: 650,
      totalCalls: 1_000,
      failedCalls: 25,
      bargeInPassed: true,
    },
  };
}

function adapter(provider: ActiveVoiceProvider): VoiceProviderAdapter {
  return {
    provider,
    health: vi.fn(async () => ({
      healthy: true,
      checks: [{ key: "configured", passed: true, detail: "Configured." }],
    })),
    provision: vi.fn(async (context) => ({ providerDeploymentId: context.deployment.providerDeploymentId! })),
    route: vi.fn(async (context) => ({
      provider,
      phoneNumberId: String(context.deployment.config.phoneNumberId),
      route: "https://elevenlabs.example.test/inbound",
      capturedAt: NOW,
    })),
    suspend: vi.fn(async () => undefined),
    restore: vi.fn(async () => undefined),
    usage: vi.fn(async () => []),
  };
}
