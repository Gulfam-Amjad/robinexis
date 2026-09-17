import type { ClientConfig } from "@robinexis/database";

export interface RuntimeConfig {
  client: ClientConfig;
  deploymentId: string;
  promptVersionId: string;
  toolSecret: string;
}

export interface TranscriptItem {
  role: "caller" | "agent" | "system";
  text: string;
  at: string;
}

export interface ToolHistoryItem {
  name: string;
  input: Record<string, unknown>;
  result?: unknown;
  error?: string;
  at: string;
}

export interface NormalizedUsage {
  livekit: { roomSeconds: number };
  stt: { provider: "deepgram"; audioSeconds: number };
  llm: { provider: "groq" | "google"; inputTokens: number; outputTokens: number };
  tts: { provider: "elevenlabs"; characters: number; audioSeconds: number };
}

export interface PostCallPayload {
  version: 1;
  provider: "livekit-cascade";
  callId: string;
  tenantId: string;
  providerJobId: string;
  direction: "inbound" | "outbound";
  objective: string;
  promptVersionId: string;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  transcript: TranscriptItem[];
  toolHistory: ToolHistoryItem[];
  latency: {
    sttMs?: number;
    llmTtftMs?: number;
    ttsTtfbMs?: number;
    endToEndMs?: number;
  };
  usage: NormalizedUsage;
}
