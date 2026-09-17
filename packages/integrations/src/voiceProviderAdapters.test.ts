import { describe, expect, it, vi } from "vitest";
import { robinexisDemoSeed, type ProviderDeployment } from "@robinexis/database";
import {
  ElevenLabsVoiceProviderAdapter,
  LiveKitVoiceProviderAdapter,
} from "./voiceProviderAdapters.js";

describe("LiveKit provider routing adapter", () => {
  it("fails preflight closed when external ingress is absent", async () => {
    const routing = { inspect: vi.fn(), setVoiceUrl: vi.fn() };
    const adapter = new LiveKitVoiceProviderAdapter(routing);
    const health = await adapter.health(context({
      phoneNumberId: "PN1",
      suspendVoiceUrl: "https://example.test/suspended",
    }));
    expect(health.healthy).toBe(false);
    expect(routing.setVoiceUrl).not.toHaveBeenCalled();
  });

  it("does not mark SIP live when external SIP ingress cannot be verified", async () => {
    const routing = {
      inspect: vi.fn(async () => ({
        phoneNumberId: "PN1",
        voiceUrl: "https://example.test/sip-twiml",
      })),
      setVoiceUrl: vi.fn(),
    };
    const adapter = new LiveKitVoiceProviderAdapter(routing);
    const health = await adapter.health(context({
      phoneNumberId: "PN1",
      suspendVoiceUrl: "https://example.test/suspended",
      ingress: {
        kind: "sip_uri",
        sipUri: "sip:tenant@sip.livekit.example",
        twilioVoiceUrl: "https://example.test/sip-twiml",
      },
    }, "active"));
    expect(health.healthy).toBe(false);
    expect(health.checks).toContainEqual(expect.objectContaining({
      key: "external_sip_ingress",
      passed: false,
    }));
  });

  it("writes and reads back an exact Twilio VoiceUrl", async () => {
    let voiceUrl = "https://example.test/elevenlabs";
    const routing = {
      inspect: vi.fn(async () => ({ phoneNumberId: "PN1", voiceUrl })),
      setVoiceUrl: vi.fn(async (_id: string, value: string) => { voiceUrl = value; }),
    };
    const adapter = new LiveKitVoiceProviderAdapter(routing);
    const result = await adapter.route(context({
      phoneNumberId: "PN1",
      suspendVoiceUrl: "https://example.test/suspended",
      ingress: { kind: "twilio_voice_url", voiceUrl: "https://example.test/livekit" },
    }));
    expect(result.route).toBe("https://example.test/elevenlabs");
    expect(voiceUrl).toBe("https://example.test/livekit");
  });
});

describe("ElevenLabs provider routing adapter", () => {
  it("allows a staged route mismatch but requires an exact active route", async () => {
    const routing = {
      inspect: vi.fn(async () => ({ phoneNumberId: "PN_TWILIO", voiceUrl: "https://example.test/livekit" })),
      setVoiceUrl: vi.fn(),
    };
    const management = {
      assignAgentToPhoneNumber: vi.fn(),
      unassignAgentFromPhoneNumber: vi.fn(),
    };
    const adapter = new ElevenLabsVoiceProviderAdapter(management as never, routing);
    const base = {
      client: { ...robinexisDemoSeed(), id: "client-el-adapter" },
      deployment: {
        id: "deployment-el",
        clientId: "client-el-adapter",
        provider: "elevenlabs-convai" as const,
        providerDeploymentId: "agent-el",
        status: "staged" as const,
        config: {
          phoneNumberId: "PN_ELEVENLABS",
          twilioPhoneNumberId: "PN_TWILIO",
          twilioVoiceUrl: "https://example.test/elevenlabs",
        },
        createdAt: "2026-09-16T00:00:00.000Z",
        updatedAt: "2026-09-16T00:00:00.000Z",
      },
      operationKey: "operation-test",
      now: "2026-09-16T00:00:00.000Z",
    };
    expect((await adapter.health(base)).healthy).toBe(true);
    expect((await adapter.health({
      ...base,
      deployment: { ...base.deployment, status: "active" },
    })).healthy).toBe(false);
  });
});

function context(config: Record<string, unknown>, status: ProviderDeployment["status"] = "staged") {
  return {
    client: { ...robinexisDemoSeed(), id: "client-adapter-test" },
    deployment: {
      id: "deployment-livekit",
      clientId: "client-adapter-test",
      provider: "livekit-cascade" as const,
      providerDeploymentId: "dispatch-livekit",
      status,
      config,
      createdAt: "2026-09-16T00:00:00.000Z",
      updatedAt: "2026-09-16T00:00:00.000Z",
    },
    operationKey: "operation-test",
    now: "2026-09-16T00:00:00.000Z",
  };
}
