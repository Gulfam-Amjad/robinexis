import { createHmac, timingSafeEqual } from "node:crypto";
import {
  redactSecrets,
  type CallSession,
  type PlatformStore,
} from "@robinexis/database";

type WebhookResult = { status: number; body: Record<string, unknown> };

type PostCallData = {
  agent_id?: string;
  conversation_id?: string;
  status?: string;
  transcript?: Array<{ role?: string; message?: string; time_in_call_secs?: number }>;
  metadata?: {
    start_time_unix_secs?: number;
    call_duration_secs?: number;
  };
  analysis?: {
    call_successful?: string;
    transcript_summary?: string;
  };
  conversation_initiation_client_data?: unknown;
};

function safeHexEqual(left: string, right: string): boolean {
  if (!/^[a-f0-9]+$/i.test(left) || !/^[a-f0-9]+$/i.test(right)) return false;
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function verifyElevenLabsWebhook(
  rawBody: Buffer,
  signatureHeader: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  if (!rawBody.length || !signatureHeader || !secret) return false;
  const parts = signatureHeader.split(",").map((part) => part.trim());
  const timestamp = parts.find((part) => part.startsWith("t="))?.slice(2);
  const signatures = parts
    .filter((part) => part.startsWith("v0="))
    .map((part) => part.slice(3));
  const timestampNumber = Number(timestamp);
  if (
    !timestamp ||
    !Number.isInteger(timestampNumber) ||
    Math.abs(nowSeconds - timestampNumber) > 30 * 60 ||
    !signatures.length
  ) {
    return false;
  }
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody.toString("utf8")}`)
    .digest("hex");
  return signatures.some((signature) => safeHexEqual(signature, expected));
}

function findStringByKey(value: unknown, keys: Set<string>): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (keys.has(key) && typeof nested === "string" && nested.trim()) return nested.trim();
    const found = findStringByKey(nested, keys);
    if (found) return found;
  }
  return undefined;
}

export async function ingestElevenLabsWebhook(
  store: PlatformStore,
  rawBody: Buffer,
  signatureHeader: string,
  secret = process.env.ELEVENLABS_WEBHOOK_SECRET || "",
): Promise<WebhookResult> {
  if (!verifyElevenLabsWebhook(rawBody, signatureHeader, secret)) {
    return { status: 401, body: { error: "invalid_signature" } };
  }

  let event: { type?: string; event_timestamp?: number; data?: PostCallData };
  try {
    event = JSON.parse(rawBody.toString("utf8")) as typeof event;
  } catch {
    return { status: 400, body: { error: "invalid_json" } };
  }
  if (event.type !== "post_call_transcription") {
    return { status: 200, body: { received: true, ignored: true } };
  }

  const data = event.data || {};
  const agentId = String(data.agent_id || "");
  const conversationId = String(data.conversation_id || "");
  if (!agentId || !conversationId) {
    return { status: 400, body: { error: "missing_conversation_identity" } };
  }
  const client = await store.getClientByElevenLabsAgentId(agentId);
  if (!client) {
    return { status: 202, body: { received: true, ignored: true, reason: "unknown_agent" } };
  }

  const durationSeconds = Math.max(0, Number(data.metadata?.call_duration_secs || 0));
  const eventSeconds = Number(event.event_timestamp || Math.floor(Date.now() / 1000));
  const startSeconds = Number(data.metadata?.start_time_unix_secs || eventSeconds - durationSeconds);
  const toolActions = await store.listToolActionsForCall(client.id, conversationId);
  const successfulBooking = toolActions.find(
    (tool) => tool.name === "create_booking" && !tool.error,
  );
  const bookingResult = successfulBooking?.result as { uid?: string; bookingUid?: string } | undefined;
  const transferred = toolActions.some((tool) => tool.name === "transfer_to_human" && !tool.error);
  const completed = data.status === "done";
  const call: CallSession = {
    id: conversationId,
    clientId: client.id,
    direction:
      findStringByKey(data.conversation_initiation_client_data, new Set(["system__call_direction"])) === "outbound"
        ? "outbound"
        : "inbound",
    objective: String(data.analysis?.transcript_summary || "ElevenLabs receptionist conversation"),
    contactPhone: findStringByKey(
      data.conversation_initiation_client_data,
      new Set(["system__caller_id", "caller_id", "from_number"]),
    ),
    appointmentId: bookingResult?.uid || bookingResult?.bookingUid,
    promptVersionId: "elevenlabs-convai",
    transcript: (data.transcript || [])
      .filter((turn) => typeof turn.message === "string" && turn.message.trim())
      .map((turn) => ({
        role: turn.role === "agent" ? "agent" as const : "caller" as const,
        text: String(redactSecrets(turn.message)),
        at: new Date((startSeconds + Number(turn.time_in_call_secs || 0)) * 1000).toISOString(),
      })),
    collected: {
      durationMinutes: durationSeconds / 60,
      providerAgentId: agentId,
      providerStatus: data.status || "unknown",
      callSuccessful: data.analysis?.call_successful,
    },
    toolHistory: toolActions.map((tool) => ({
      name: tool.name,
      input: redactSecrets(tool.input),
      result: redactSecrets(tool.result),
      error: tool.error,
      idempotencyKey: tool.idempotencyKey,
      at: tool.at,
    })),
    state: "complete",
    status: transferred ? "transferred" : completed ? "completed" : "failed",
    outcome: transferred ? "transferred" : completed ? "answered-completed" : "failed",
    durationSeconds,
    createdAt: new Date(startSeconds * 1000).toISOString(),
    updatedAt: new Date(eventSeconds * 1000).toISOString(),
  };
  await store.saveCall(call);
  if (durationSeconds > 0) {
    await store.addUsage(
      client.id,
      call.direction === "inbound" ? durationSeconds / 60 : 0,
      call.direction === "outbound" ? durationSeconds / 60 : 0,
    );
  }
  return { status: 200, body: { received: true, callId: call.id } };
}
