import type { AgentMetrics, ModelUsage } from "@livekit/agents";
import type { LatencySummary, NormalizedUsage, PostCallPayload } from "./contracts.js";

export interface LatencyTracker {
  stt: number[];
  llmTtft: number[];
  ttsTtfb: number[];
  endToEnd: number[];
}

export function createLatencyTracker(): LatencyTracker {
  return { stt: [], llmTtft: [], ttsTtfb: [], endToEnd: [] };
}

export function normalizedUsage(
  modelUsage: Array<Partial<ModelUsage>>,
  durationSeconds: number,
  llmProvider: "groq" | "google" = "groq",
  ttsProvider: "deepgram" | "elevenlabs" = "elevenlabs",
): NormalizedUsage {
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
      provider: llmProvider,
      inputTokens: sum(llm, "inputTokens"),
      outputTokens: sum(llm, "outputTokens"),
    },
    tts: {
      provider: ttsProvider,
      characters: sum(tts, "charactersCount"),
      audioSeconds: sum(tts, "audioDurationMs") / 1000,
    },
  };
}

export function collectLatency(
  current: LatencyTracker,
  metrics: AgentMetrics,
): LatencyTracker {
  if (metrics.type === "llm_metrics") append(current.llmTtft, metrics.ttftMs);
  if (metrics.type === "tts_metrics") append(current.ttsTtfb, metrics.ttfbMs);
  if (metrics.type === "eou_metrics") {
    append(current.stt, metrics.transcriptionDelayMs);
    append(
      current.endToEnd,
      metrics.endOfUtteranceDelayMs + metrics.transcriptionDelayMs,
    );
  }
  return current;
}

export function summarizeLatency(current: LatencyTracker): PostCallPayload["latency"] {
  return {
    stt: summary(current.stt),
    llmTtft: summary(current.llmTtft),
    ttsTtfb: summary(current.ttsTtfb),
    endToEnd: summary(current.endToEnd),
  };
}

function sum(items: Array<Partial<ModelUsage>>, key: string): number {
  return items.reduce((total, item) => total + finite((item as Record<string, unknown>)[key]), 0);
}

function finite(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function append(values: number[], next: number): void {
  const value = finite(next);
  if (value > 0) values.push(value);
}

function summary(values: number[]): LatencySummary | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    lastMs: values.at(-1)!,
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
  };
}

function percentile(sorted: number[], quantile: number): number {
  const index = Math.max(0, Math.ceil(sorted.length * quantile) - 1);
  return sorted[index]!;
}
