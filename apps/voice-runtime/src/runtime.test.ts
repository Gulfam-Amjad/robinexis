import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { TOOL_DEFINITIONS } from "@robinexis/tool-contracts";
import { signPostCall } from "./apiClient.js";
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
  GOOGLE_API_KEY: "google",
  CARTESIA_API_KEY: "cartesia",
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
    expect(loadVoiceRuntimeEnv(completeEnv).geminiModel).toBe("gemini-2.5-flash");
  });

  it("accepts trusted tenant metadata, rejects clientId, and makes stable IDs", () => {
    const metadata = parseJobMetadata(JSON.stringify({
      tenantId: "tenant-a",
      providerJobId: "job-123",
      direction: "inbound",
      objective: "Reception",
    }));
    expect(stableCallId(metadata)).toMatch(/^call_[a-f0-9]{32}$/);
    expect(stableCallId(metadata)).toBe(stableCallId(metadata));
    expect(() => parseJobMetadata(JSON.stringify({ ...metadata, clientId: "attacker" })))
      .toThrow("caller_client_id_forbidden");
  });

  it("signs the exact post-call bytes with timestamp binding", () => {
    const body = JSON.stringify({ callId: "call_123" });
    const expected = createHmac("sha256", "secret").update(`123.${body}`).digest("hex");
    expect(signPostCall(body, "secret", 123)).toBe(expected);
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
      toolSecret: "tenant-bound-secret",
      callId: "call_stable",
      history,
      fetchImpl,
    });
    expect(tools.map((tool) => tool.name)).toEqual(TOOL_DEFINITIONS.map((tool) => tool.name));
    await (tools[0] as any).execute({ clientId: "bad", tenantId: "bad", topic: "hours" }, {});
    const request = requests[0][1]!;
    expect(request.headers).toMatchObject({ "x-voice-tool-secret": "tenant-bound-secret" });
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
      llm: { provider: "google", inputTokens: 10, outputTokens: 4 },
      tts: { provider: "cartesia", characters: 80, audioSeconds: 1.5 },
    });
  });
});
