import { defineAgent, AgentSessionEventTypes, llm, voice } from "@livekit/agents";
import * as deepgram from "@livekit/agents-plugin-deepgram";
import * as elevenlabs from "@livekit/agents-plugin-elevenlabs";
import * as google from "@livekit/agents-plugin-google";
import * as openai from "@livekit/agents-plugin-openai";
import { compilePrompt, redactSensitiveText } from "@robinexis/brain";
import type { PostCallPayload, RuntimeConfig, TranscriptItem } from "./contracts.js";
import { loadVoiceRuntimeEnv } from "./env.js";
import { runtimeLog } from "./logger.js";
import { parseJobMetadata, stableCallId } from "./metadata.js";
import { RuntimeApiClient } from "./apiClient.js";
import {
  collectLatency,
  createLatencyTracker,
  normalizedUsage,
  summarizeLatency,
} from "./telemetry.js";
import { resolveSpeechProvider, type SpeechProvider } from "./speech.js";
import { createToolBridge } from "./toolBridge.js";

export default defineAgent({
  entry: async (ctx) => {
    const env = loadVoiceRuntimeEnv();
    const metadata = parseJobMetadata(ctx.job.metadata);
    const providerJobId = ctx.job.id;
    const callId = stableCallId(metadata.tenantId, providerJobId);
    const api = new RuntimeApiClient(
      env.apiBaseUrl,
      env.internalSecret,
      env.signingSecret,
    );
    const config = await api.getPublishedConfig(metadata.tenantId, metadata.deploymentId);
    const startedAt = new Date();
    const toolHistory: PostCallPayload["toolHistory"] = [];
    const latency = createLatencyTracker();
    let lastRecoveryAt = 0;
    let recoveryCount = 0;

    const speech = await resolveSpeechProvider({
      configured: env.ttsProvider,
      elevenLabsApiKey: env.elevenLabsApiKey,
      elevenLabsVoiceId: env.elevenLabsVoiceId,
      elevenLabsTtsModel: env.elevenLabsTtsModel,
    });
    if (speech.fallbackReason) {
      runtimeLog("voice_tts_fallback", { provider: speech.provider, reason: speech.fallbackReason });
    }
    const session = new voice.AgentSession({
      stt: new deepgram.STT({
        apiKey: env.deepgramApiKey,
        model: env.deepgramModel,
        language: "en-GB",
        interimResults: true,
        // Smart formatting rewrites spoken dates as US "10/15/2026", which the
        // model then misreads as day/month. Punctuation and numerals keep
        // "the 15th of October at 11:30" unambiguous.
        smartFormat: false,
        punctuate: true,
        numerals: true,
        endpointing: env.deepgramEndpointingMs,
        fillerWords: true,
        keyterm: voiceKeyterms(config.client),
        redact: ["pci"],
      }),
      llm: env.llmProvider === "groq"
        ? new openai.LLM({
          apiKey: env.groqApiKey,
          baseURL: "https://api.groq.com/openai/v1",
          model: env.groqModel,
          temperature: env.llmTemperature,
          toolChoice: "auto",
          parallelToolCalls: false,
          maxCompletionTokens: env.llmMaxCompletionTokens,
          reasoningEffort: "low",
        })
        : new google.LLM({
          apiKey: env.googleApiKey!,
          model: env.geminiModel,
          toolChoice: "auto",
        }),
      tts: createSpeechEngine(env, speech.provider),
      maxToolSteps: 8,
      turnHandling: {
        turnDetection: "stt",
        endpointing: {
          mode: "fixed",
          minDelay: env.endpointingMinDelayMs,
          maxDelay: env.endpointingMaxDelayMs,
        },
        interruption: {
          enabled: true,
          mode: "vad",
          minDuration: env.interruptionMinDurationMs,
          minWords: env.interruptionMinWords,
          resumeFalseInterruption: true,
        },
        preemptiveGeneration: {
          enabled: env.preemptiveGenerationEnabled,
          preemptiveTts: false,
          maxRetries: 1,
        },
      },
    });
    session.on(AgentSessionEventTypes.MetricsCollected, (event) => {
      collectLatency(latency, event.metrics);
      const currentLatency = summarizeLatency(latency);
      runtimeLog("voice_runtime_metric", {
        metricType: event.metrics.type,
        llmTtftP95Ms: currentLatency.llmTtft?.p95Ms,
        sttP95Ms: currentLatency.stt?.p95Ms,
        ttsTtfbP95Ms: currentLatency.ttsTtfb?.p95Ms,
        endToEndP95Ms: currentLatency.endToEnd?.p95Ms,
      });
    });
    session.on(AgentSessionEventTypes.Error, (event) => {
      const errorType = classifySessionError(event.error);
      runtimeLog("voice_runtime_provider_error", {
        errorType,
        reason: sanitizeProviderError(event.error),
      });
      if (errorType === "tts") return;
      if (
        (errorType === "rate_limit" || errorType === "llm") &&
        recoveryCount < 2 &&
        Date.now() - lastRecoveryAt > 8_000
      ) {
        lastRecoveryAt = Date.now();
        recoveryCount += 1;
        session.say("Sorry, I had trouble checking that. Please say that once more.");
      }
    });

    ctx.addShutdownCallback(async () => {
      const endedAt = new Date();
      const durationSeconds = Math.max(0, (endedAt.getTime() - startedAt.getTime()) / 1000);
      const payload: PostCallPayload = {
        version: 1,
        provider: "livekit-cascade",
        callId,
        tenantId: metadata.tenantId,
        providerJobId,
        direction: metadata.direction,
        objective: metadata.objective,
        promptVersionId: config.promptVersionId,
        startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
        durationSeconds,
        transcript: transcriptFromSession(session),
        toolHistory,
        latency: summarizeLatency(latency),
        usage: normalizedUsage(session.usage.modelUsage, durationSeconds, env.llmProvider, speech.provider),
      };
      try {
        await api.sendPostCall(payload);
        runtimeLog("voice_runtime_post_call_sent", { callId, tenantId: metadata.tenantId });
      } catch (error) {
        runtimeLog("voice_runtime_post_call_failed", { callId, error: String(error) });
      }
    });

    await ctx.connect();
    await session.start({
      room: ctx.room,
      record: { audio: false, traces: false, logs: false, transcript: false, redaction: true },
      agent: new BoundedVoiceAgent({
        instructions: runtimeInstructions(config, metadata.direction, metadata.objective),
        tools: createToolBridge({
          apiBaseUrl: env.apiBaseUrl,
          tenantId: metadata.tenantId,
          toolSecret: config.toolSecret,
          callId,
          history: toolHistory,
        }),
      }),
    });
    session.say(
      config.client.greeting || `Hello, you've reached ${config.client.businessName}. How can I help?`,
      { allowInterruptions: true },
    );
    runtimeLog("voice_runtime_session_started", { callId, tenantId: metadata.tenantId });
  },
});

export function runtimeInstructions(
  config: RuntimeConfig,
  direction: "inbound" | "outbound",
  objective: string,
  now = new Date(),
): string {
  const published = config.compiledPrompt?.trim();
  const prompt = published || compilePrompt({
    client: config.client,
    direction,
    objective,
  });
  const timeZone = config.client.callingWindow?.tz || "Europe/London";
  const localDateTime = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZoneName: "short",
  }).format(now);
  return `${prompt}

Live conversation requirements:
- Current local date and time: ${localDateTime} (${timeZone}). Resolve "today", weekdays, and relative dates from this value.
- The opening greeting is delivered separately. Do not greet again unless the caller asks you to repeat it.
- Use the supplied tool schemas. Do not narrate tool names, internal work, analysis, or reasoning.
- Treat conversation history and successful tool results as the current booking draft. Preserve confirmed details until the caller changes them.
- Ask for exactly one missing detail per turn, then stop and listen. Never simulate the caller's reply.
- Before checking availability, ensure the requested calendar date really exists. Never invent or silently repair an impossible date.
- If a tool returns invalid_date_range with clarify_date, briefly explain the date problem and ask one precise clarification. Do not say the diary is unavailable or offer a callback.
- Keep ordinary replies under 35 spoken words. A final booking summary may be longer.
- Say times naturally in words, such as "eleven thirty" or "half four"; never say "a 11:30 slot".
- Output only the exact customer-facing words to be spoken.`;
}

class BoundedVoiceAgent extends voice.Agent {
  override async onUserTurnCompleted(
    chatCtx: llm.ChatContext,
    _newMessage: llm.ChatMessage,
  ): Promise<void> {
    // Keep enough dialogue and tool results for long booking/correction flows.
    // Tool inputs are also retained by the tenant-bound bridge, so compaction
    // cannot silently overwrite a corrected slot or phone number.
    if (chatCtx.items.length <= 64) return;
    await this.updateChatCtx(chatCtx.copy().truncate(56));
  }
}

function createSpeechEngine(
  env: ReturnType<typeof loadVoiceRuntimeEnv>,
  provider: SpeechProvider,
) {
  if (provider === "deepgram") {
    return new deepgram.TTS({
      apiKey: env.deepgramApiKey,
      model: env.deepgramTtsModel,
    });
  }
  return new elevenlabs.TTS({
    apiKey: env.elevenLabsApiKey,
    model: env.elevenLabsTtsModel,
    voiceId: env.elevenLabsVoiceId,
    language: "en",
    enableLogging: false,
  });
}

export function classifySessionError(error: unknown): "rate_limit" | "llm" | "stt" | "tts" | "provider" {
  const value = providerErrorText(error);
  if (/429|rate.limit|tokens per minute/i.test(value)) return "rate_limit";
  if (/payment_issue|payment_required|incomplete payment/i.test(value)) return "tts";
  if (/text.to.speech|\btts\b|speech synthesis|could not synthesize/i.test(value)) return "tts";
  if (/llm|completion|model/i.test(value)) return "llm";
  if (/speech.to.text|transcri|\bstt\b/i.test(value)) return "stt";
  return "provider";
}

export function sanitizeProviderError(error: unknown): string {
  const value = providerErrorText(error);
  if (/payment_issue|payment_required|incomplete payment/i.test(value)) return "payment_issue";
  const cleaned = value
    .replace(/sk_[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/\{[\s\S]*\}/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, 120) || "provider_error";
}

function providerErrorText(error: unknown): string {
  if (!error || typeof error !== "object") return String(error || "");
  const record = error as { name?: unknown; message?: unknown };
  return `${String(record.name || "")} ${String(record.message || "")}`;
}

export function voiceKeyterms(client: {
  businessName: string;
  location: string;
  services: Array<{ title: string; slug: string }>;
  staff: string[];
}): string[] {
  return [...new Set([
    client.businessName,
    client.location,
    ...client.services.flatMap((service) => [service.title, service.slug]),
    ...client.staff,
  ].map((value) => value.trim()).filter((value) => value.length >= 2))].slice(0, 100);
}

function transcriptFromSession(session: voice.AgentSession): TranscriptItem[] {
  return session.history.items.flatMap((item) => {
    if (item.type !== "message") return [];
    const text = item.textContent?.trim();
    if (!text) return [];
    const role = item.role === "assistant" ? "agent" : item.role === "user" ? "caller" : "system";
    return [{
      role,
      text: redactSensitiveText(text),
      at: new Date(item.createdAt).toISOString(),
    }];
  });
}
