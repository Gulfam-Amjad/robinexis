import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { bladesHairSeed } from "@robinexis/database";
import { RuntimeApiClient, signPostCall } from "./apiClient.js";
import {
  classifySessionError,
  runtimeInstructions,
  sanitizeProviderError,
  voiceKeyterms,
} from "./agent.js";
import { loadVoiceRuntimeEnv } from "./env.js";
import { resolveSpeechProvider } from "./speech.js";
import { parseJobMetadata, stableCallId } from "./metadata.js";
import {
  collectLatency,
  createLatencyTracker,
  normalizedUsage,
  summarizeLatency,
} from "./telemetry.js";
import {
  createToolBridge,
  prepareToolInput,
  rememberBookingState,
  VOICE_TOOL_NAMES,
} from "./toolBridge.js";

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
      ttsProvider: "deepgram",
      deepgramTtsModel: "aura-2-pandora-en",
      deepgramModel: "nova-3",
      deepgramEndpointingMs: 250,
      llmMaxCompletionTokens: 480,
      llmTemperature: 0.28,
      endpointingMinDelayMs: 500,
      endpointingMaxDelayMs: 2_200,
      interruptionMinDurationMs: 300,
      interruptionMinWords: 1,
      preemptiveGenerationEnabled: true,
    });
    expect(() => loadVoiceRuntimeEnv({ ...completeEnv, VOICE_LLM_PROVIDER: "invalid" }))
      .toThrow("invalid_voice_llm_provider");
    expect(() => loadVoiceRuntimeEnv({ ...completeEnv, VOICE_TTS_PROVIDER: "cartesia" }))
      .toThrow("invalid_voice_tts_provider");
    expect(loadVoiceRuntimeEnv({ ...completeEnv, VOICE_TTS_PROVIDER: "elevenlabs" }))
      .toMatchObject({ ttsProvider: "elevenlabs" });
    expect(loadVoiceRuntimeEnv({
      ...completeEnv,
      VOICE_LLM_TEMPERATURE: "0.41",
      VOICE_PREEMPTIVE_GENERATION: "false",
    })).toMatchObject({ llmTemperature: 0.41, preemptiveGenerationEnabled: false });
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

  it("uses the frozen published prompt and adds live turn discipline without greeting twice", () => {
    const instructions = runtimeInstructions({
      client: bladesHairSeed(),
      deploymentId: "deployment-1",
      promptVersionId: "prompt-7",
      compiledPrompt: "FROZEN PREMIUM PERSONA\nApproved fact: weekdays ten till seven.",
      toolSecret: "secret",
    }, "inbound", "Browser provider comparison");
    expect(instructions).toContain("FROZEN PREMIUM PERSONA");
    expect(instructions).toContain("weekdays ten till seven");
    expect(instructions).not.toContain("Objective: Browser provider comparison");
    expect(instructions).toMatch(/opening greeting is delivered separately/i);
    expect(instructions).toMatch(/exactly one missing detail per turn/i);
    expect(instructions).toMatch(/under 35 spoken words/i);
  });

  it("bridges only voice tools without caller-selected tenant fields", async () => {
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
    expect(tools.map((tool) => tool.name)).toEqual(VOICE_TOOL_NAMES);
    await (tools[0] as any).execute({ clientId: "bad", tenantId: "bad", topic: "hours" }, {});
    const request = requests[0][1]!;
    expect(request.headers).toMatchObject({ "x-voice-tool-secret": "tenant-bound-secret" });
    expect(request.headers).toMatchObject({ "x-voice-tool-tenant": "tenant-a" });
    expect(JSON.parse(String(request.body))).toEqual({ topic: "hours", conversationId: "call_stable" });
    expect(history[0].result).toEqual({ ok: true });
  });

  it("returns structured tool rejections to the model and classifies rate limits", async () => {
    const history: Array<any> = [];
    const tools = createToolBridge({
      apiBaseUrl: "https://api.example",
      tenantId: "tenant-a",
      toolSecret: "secret",
      callId: "call-1",
      history,
      fetchImpl: async () => new Response(JSON.stringify({
        ok: false,
        error: "attendee_phone_invalid_ask_for_complete_number_from_beginning",
      }), { status: 400 }),
    });
    const booking = tools.find((tool) => tool.name === "create_booking")!;
    await expect((booking as any).execute({ attendeePhone: "short" }, {})).resolves.toEqual({
      ok: false,
      error: "attendee_phone_invalid_ask_for_complete_number_from_beginning",
    });
    expect(history[0].result).toMatchObject({ ok: false });
    expect(classifySessionError(new Error("429 tokens per minute"))).toBe("rate_limit");
    expect(classifySessionError(new Error("LLM completion failed"))).toBe("llm");
    expect(classifySessionError(new Error(
      'ElevenLabs API error: {"detail":{"code":"payment_issue","message":"incomplete payment"}}',
    ))).toBe("tts");
    expect(classifySessionError(new Error("Could not synthesize"))).toBe("tts");
    expect(sanitizeProviderError(new Error(
      'ElevenLabs API error: {"detail":{"code":"payment_issue"}} sk_live_secret',
    ))).toBe("payment_issue");
  });

  it("speaks with Deepgram and falls back when ElevenLabs cannot synthesize", async () => {
    const blocked = await resolveSpeechProvider({
      configured: "elevenlabs",
      elevenLabsApiKey: "secret-key",
      elevenLabsVoiceId: "voice",
      elevenLabsTtsModel: "eleven_flash_v2_5",
      fetchImpl: async () => new Response(
        JSON.stringify({ detail: { code: "payment_issue", message: "incomplete payment" } }),
        { status: 401 },
      ),
    });
    expect(blocked).toEqual({ provider: "deepgram", fallbackReason: "payment_issue" });
    const unpaid = await resolveSpeechProvider({
      configured: "elevenlabs",
      elevenLabsApiKey: "secret-key",
      elevenLabsVoiceId: "voice",
      elevenLabsTtsModel: "eleven_flash_v2_5",
      fetchImpl: async () => new Response("payment required", { status: 402 }),
    });
    expect(unpaid).toEqual({ provider: "deepgram", fallbackReason: "payment_required" });
    const available = await resolveSpeechProvider({
      configured: "elevenlabs",
      elevenLabsApiKey: "secret-key",
      elevenLabsVoiceId: "voice",
      elevenLabsTtsModel: "eleven_flash_v2_5",
      fetchImpl: async (_input, init) => {
        expect(String(init?.body)).toContain("Hello.");
        expect((init?.headers as Record<string, string>)["xi-api-key"]).toBe("secret-key");
        return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
      },
    });
    expect(available).toEqual({ provider: "elevenlabs" });
    expect(await resolveSpeechProvider({
      configured: "deepgram",
      elevenLabsApiKey: "secret-key",
      elevenLabsVoiceId: "voice",
      elevenLabsTtsModel: "eleven_flash_v2_5",
      fetchImpl: async () => {
        throw new Error("elevenlabs should not be called");
      },
    })).toEqual({ provider: "deepgram" });
  });

  it("retains corrected booking details inside one call without cross-call leakage", () => {
    const first = {};
    rememberBookingState(first, {
      eventTypeSlug: "gentlemans-cut",
      start: "2026-09-21T10:00:00.000Z",
      attendeeName: "Michael",
    }, { ok: true });
    rememberBookingState(first, {
      start: "2026-09-21T11:30:00.000Z",
      attendeePhone: "07443 443532",
      callerConfirmed: true,
    }, { ok: true, bookingUid: "bk_123" });
    expect(first).toEqual({
      eventTypeSlug: "gentlemans-cut",
      start: "2026-09-21T11:30:00.000Z",
      attendeeName: "Michael",
      attendeePhone: "07443 443532",
      callerConfirmed: true,
      bookingUid: "bk_123",
    });
    expect({}).not.toHaveProperty("attendeeName");
  });

  it("uses the exact offered slot and derives correction-safe booking idempotency", () => {
    const ledger = {
      eventTypeSlug: "gentlemans-cut",
      offeredSlots: ["2026-09-21T14:00:00.000Z"],
      attendeeName: "Jason",
    };
    const first = prepareToolInput("create_booking", {
      start: "2026-09-21T15:00:00+01:00",
      attendeePhone: "07443 245443",
      callerConfirmed: true,
    }, ledger, "call-jason");
    const replay = prepareToolInput("create_booking", {
      start: "2026-09-21T14:00:00.000Z",
      attendeePhone: "07443 245443",
      callerConfirmed: true,
    }, ledger, "call-jason");
    const corrected = prepareToolInput("create_booking", {
      start: "2026-09-21T14:00:00.000Z",
      attendeePhone: "07911 123456",
      callerConfirmed: true,
    }, ledger, "call-jason");

    expect(first).toMatchObject({
      conversationId: "call-jason",
      eventTypeSlug: "gentlemans-cut",
      attendeeName: "Jason",
      start: "2026-09-21T14:00:00.000Z",
    });
    expect(first.idempotencyKey).toBe(replay.idempotencyKey);
    expect(corrected.idempotencyKey).not.toBe(first.idempotencyKey);
  });

  it("builds tenant speech keyterms without duplicate or empty values", () => {
    expect(voiceKeyterms({
      businessName: "Blades Hair",
      location: "Cullum Street",
      services: [
        { title: "Gentleman's Cut", slug: "gentlemans-cut" },
        { title: "Gentleman's Cut", slug: "gentlemans-cut" },
      ],
      staff: ["Sophie", ""],
    })).toEqual([
      "Blades Hair",
      "Cullum Street",
      "Gentleman's Cut",
      "gentlemans-cut",
      "Sophie",
    ]);
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

  it("reports latency count, latest value, p50, and p95 instead of a misleading minimum", () => {
    const tracker = createLatencyTracker();
    for (const ttftMs of [100, 200, 300, 900]) {
      collectLatency(tracker, { type: "llm_metrics", ttftMs } as never);
    }
    expect(summarizeLatency(tracker).llmTtft).toEqual({
      count: 4,
      lastMs: 900,
      p50Ms: 200,
      p95Ms: 900,
    });
  });
});
