import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { TOOL_DEFINITIONS } from "@robinexis/tool-contracts";
import { RuntimeApiClient, signPostCall } from "./apiClient.js";
import { loadVoiceRuntimeEnv } from "./env.js";
import { parseJobMetadata, stableCallId } from "./metadata.js";
import { normalizedUsage } from "./telemetry.js";
import { createToolBridge } from "./toolBridge.js";

const completeEnv = {
  VOICE_RUNTIME_ENABLED: "true",
  LIVEKIT_URL: "wss://livekit.example",
  LIVEKIT_API_KEY: "key",
  LIVEKIT_API_SECRET: "secret",
  DEEPGRAM_API_KEY: "deepgram",
  VOICE_LLM_PROVIDER: "groq",
  GROQ_API_KEY: "groq",
  ELEVENLABS_API_KEY: "elevenlabs",
  ELEVENLABS_VOICE_ID: "voice",
  VOICE_RUNTIME_API_BASE_URL: "https://api.example",
  VOICE_RUNTIME_INTERNAL_SECRET: "internal",
  VOICE_RUNTIME_SIGNING_SECRET: "signing",
};

describe("voice runtime safety contracts", () => {
  it("is off by default and lists missing required variables", () => {
    expect(() => loadVoiceRuntimeEnv({})).toThrow("voice_runtime_disabled");
    expect(() => loadVoiceRuntimeEnv({ VOICE_RUNTIME_ENABLED: "true" })).toThrow(
      "missing_voice_runtime_env:LIVEKIT_URL",
    );
    expect(loadVoiceRuntimeEnv(completeEnv)).toMatchObject({
      llmProvider: "groq",
      groqModel: "openai/gpt-oss-120b",
      elevenLabsTtsModel: "eleven_flash_v2_5",
    });
    expect(() => loadVoiceRuntimeEnv({ ...completeEnv, VOICE_LLM_PROVIDER: "invalid" }))
      .toThrow("invalid_voice_llm_provider");
    const googleEnv = { ...completeEnv, VOICE_LLM_PROVIDER: "google", GOOGLE_API_KEY: "google" };
    delete (googleEnv as Partial<typeof googleEnv>).GROQ_API_KEY;
    expect(loadVoiceRuntimeEnv(googleEnv)).toMatchObject({ llmProvider: "google" });
  });

  it("accepts trusted tenant metadata, rejects clientId, and makes stable IDs", () => {
    const metadata = parseJobMetadata(JSON.stringify({
      tenantId: "tenant-a",
      deploymentId: "deployment-123",
      direction: "inbound",
      objective: "Reception",
    }));
    expect(stableCallId(metadata.tenantId, "job-123")).toMatch(/^call_[a-f0-9]{32}$/);
    expect(stableCallId(metadata.tenantId, "job-123"))
      .toBe(stableCallId(metadata.tenantId, "job-123"));
    expect(() => parseJobMetadata(JSON.stringify({ ...metadata, clientId: "attacker" })))
      .toThrow("caller_client_id_forbidden");
    expect(() => parseJobMetadata(JSON.stringify({ ...metadata, providerJobId: "attacker" })))
      .toThrow("caller_provider_job_id_forbidden");
  });

  it("signs the exact post-call bytes with timestamp binding", () => {
    const body = JSON.stringify({ callId: "call_123" });
    const expected = createHmac("sha256", "secret").update(`123.${body}`).digest("hex");
    expect(signPostCall(body, "secret", 123)).toBe(expected);
  });

  it("authenticates runtime config and signs post-call delivery", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ tenantId: "tenant-a" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = new RuntimeApiClient(
      "https://api.example/",
      "internal-secret",
      "signing-secret",
      fetchImpl,
    );
    await client.getPublishedConfig("tenant/a", "deployment-1");
    expect(fetchImpl.mock.calls[0][0]).toContain("tenant%2Fa?deploymentId=deployment-1");
    expect(fetchImpl.mock.calls[0][1]?.headers).toEqual({
      "x-voice-runtime-secret": "internal-secret",
    });
    const payload = { tenantId: "tenant-a", callId: "call-1" } as never;
    await client.sendPostCall(payload);
    const request = fetchImpl.mock.calls[1][1]!;
    const headers = request.headers as Record<string, string>;
    expect(headers["x-voice-runtime-signature"]).toMatch(/^[a-f0-9]{64}$/);
    expect(headers["x-voice-runtime-timestamp"]).toMatch(/^\d+$/);
    expect(request.body).toBe(JSON.stringify(payload));
  });

  it("bridges every provider-neutral tool without caller-selected tenant fields", async () => {
    const requests: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push([input, init]);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    const history: Array<any> = [];
    const tools = createToolBridge({
      apiBaseUrl: "https://api.example/",
      tenantId: "tenant-a",
      toolSecret: "tenant-bound-secret",
      callId: "call_stable",
      history,
      fetchImpl,
    });
    expect(tools.map((tool) => tool.name)).toEqual(TOOL_DEFINITIONS.map((tool) => tool.name));
    await (tools[0] as any).execute({ clientId: "bad", tenantId: "bad", topic: "hours" }, {});
    const request = requests[0][1]!;
    expect(request.headers).toMatchObject({ "x-voice-tool-secret": "tenant-bound-secret" });
    expect(request.headers).toMatchObject({ "x-voice-tool-tenant": "tenant-a" });
    expect(JSON.parse(String(request.body))).toEqual({ topic: "hours", conversationId: "call_stable" });
    expect(history[0].result).toEqual({ ok: true });
  });

  it("normalizes LiveKit and model usage into provider-neutral units", () => {
    expect(normalizedUsage([
      { type: "stt_usage", audioDurationMs: 2500 },
      { type: "llm_usage", inputTokens: 10, outputTokens: 4 },
      { type: "tts_usage", charactersCount: 80, audioDurationMs: 1500 },
    ], 3)).toEqual({
      livekit: { roomSeconds: 3 },
      stt: { provider: "deepgram", audioSeconds: 2.5 },
      llm: { provider: "groq", inputTokens: 10, outputTokens: 4 },
      tts: { provider: "elevenlabs", characters: 80, audioSeconds: 1.5 },
    });
  });
});
