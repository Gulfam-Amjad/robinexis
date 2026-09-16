import type { AgentMetrics, ModelUsage } from "@livekit/agents";
import type { NormalizedUsage, PostCallPayload } from "./contracts.js";

export function normalizedUsage(modelUsage: Array<Partial<ModelUsage>>, durationSeconds: number): NormalizedUsage {
  const stt = modelUsage.filter((item) => item.type === "stt_usage");
  const llm = modelUsage.filter((item) => item.type === "llm_usage");
  const tts = modelUsage.filter((item) => item.type === "tts_usage");
  return {
    livekit: { roomSeconds: finite(durationSeconds) },
    stt: {
      provider: "deepgram",
      audioSeconds: sum(stt, "audioDurationMs") / 1000,
    },
    llm: {
      provider: "google",
      inputTokens: sum(llm, "inputTokens"),
      outputTokens: sum(llm, "outputTokens"),
    },
    tts: {
      provider: "cartesia",
      characters: sum(tts, "charactersCount"),
      audioSeconds: sum(tts, "audioDurationMs") / 1000,
    },
  };
}

export function collectLatency(
  current: PostCallPayload["latency"],
  metrics: AgentMetrics,
): PostCallPayload["latency"] {
  if (metrics.type === "llm_metrics") current.llmTtftMs = minimum(current.llmTtftMs, metrics.ttftMs);
  if (metrics.type === "tts_metrics") current.ttsTtfbMs = minimum(current.ttsTtfbMs, metrics.ttfbMs);
  if (metrics.type === "eou_metrics") {
    current.sttMs = minimum(current.sttMs, metrics.transcriptionDelayMs);
    current.endToEndMs = minimum(
      current.endToEndMs,
      metrics.endOfUtteranceDelayMs + metrics.transcriptionDelayMs,
    );
  }
  return current;
}

function sum(items: Array<Partial<ModelUsage>>, key: string): number {
  return items.reduce((total, item) => total + finite((item as Record<string, unknown>)[key]), 0);
}

function finite(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function minimum(current: number | undefined, next: number): number {
  const value = finite(next);
  return current === undefined ? value : Math.min(current, value);
}
