import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
  BLADES_HAIR_ID,
  newId,
  redactSecrets,
  type CallSession,
  type ClientConfig,
  type PlatformStore,
  type ProviderUsageCostEvent,
} from "@robinexis/database";

type Result = { status: number; body: Record<string, unknown> };

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function voiceRuntimeAuthorized(
  header: string | string[] | undefined,
  secret = process.env.VOICE_RUNTIME_INTERNAL_SECRET || "",
): boolean {
  const value = Array.isArray(header) ? header[0] || "" : header || "";
  return Boolean(secret && value && safeEqual(value, secret));
}

export function verifyVoiceRuntimeSignature(
  rawBody: Buffer,
  timestampHeader: string,
  signatureHeader: string,
  secret = process.env.VOICE_RUNTIME_SIGNING_SECRET || "",
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  const timestamp = Number(timestampHeader);
  if (!secret || !rawBody.length || !Number.isInteger(timestamp) || Math.abs(nowSeconds - timestamp) > 300) {
    return false;
  }
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody.toString("utf8")}`)
    .digest("hex");
  return /^[a-f0-9]{64}$/i.test(signatureHeader) && safeEqual(signatureHeader, expected);
}

export async function runtimeConfigFor(
  store: PlatformStore,
  tenantId: string,
): Promise<Result> {
  const client = await store.getPublishedClient(tenantId);
  if (!client) return { status: 404, body: { error: "published_tenant_not_found" } };
  const deployment = await store.getActiveProviderDeployment(tenantId);
  if (!deployment || deployment.provider !== "livekit-cascade" || client.voicePipeline !== "livekit-cascade") {
    return { status: 403, body: { error: "livekit_not_active_for_tenant" } };
  }
  const toolSecret = toolSecretFor(client);
  if (!toolSecret) return { status: 409, body: { error: "tenant_voice_tool_secret_missing" } };
  return {
    status: 200,
    body: {
      client,
      deploymentId: deployment.id,
      promptVersionId: client.promptVersionId || "published-client-config",
      toolSecret,
    },
  };
}

function toolSecretFor(client: ClientConfig): string | undefined {
  if (process.env.VOICE_TOOL_SECRET && client.id === BLADES_HAIR_ID) return process.env.VOICE_TOOL_SECRET;
  try {
    const secrets = JSON.parse(process.env.VOICE_TOOL_SECRETS_JSON || "{}") as Record<string, string>;
    return secrets[client.id] || undefined;
  } catch {
    return undefined;
  }
}

export async function ingestVoiceRuntimePostCall(
  store: PlatformStore,
  rawBody: Buffer,
  timestamp: string,
  signature: string,
  secret = process.env.VOICE_RUNTIME_SIGNING_SECRET || "",
): Promise<Result> {
  if (!verifyVoiceRuntimeSignature(rawBody, timestamp, signature, secret)) {
    return { status: 401, body: { error: "invalid_signature" } };
  }
  let payload: RuntimePostCall;
  try {
    payload = JSON.parse(rawBody.toString("utf8")) as RuntimePostCall;
  } catch {
    return { status: 400, body: { error: "invalid_json" } };
  }
  const validationError = validatePayload(payload);
  if (validationError) return { status: 400, body: { error: validationError } };
  const client = await store.getPublishedClient(payload.tenantId);
  if (!client) return { status: 404, body: { error: "published_tenant_not_found" } };
  if (payload.callId !== expectedCallId(payload.tenantId, payload.providerJobId)) {
    return { status: 400, body: { error: "invalid_call_id" } };
  }
  const previous = await store.getCall(payload.callId);
  if (previous && previous.clientId !== client.id) {
    return { status: 409, body: { error: "call_tenant_conflict" } };
  }

  const call: CallSession = {
    id: payload.callId,
    clientId: client.id,
    direction: payload.direction,
    objective: payload.objective,
    promptVersionId: payload.promptVersionId,
    transcript: payload.transcript.map((turn) => ({
      role: turn.role,
      text: String(redactSecrets(turn.text)),
      at: turn.at,
    })),
    collected: {
      provider: payload.provider,
      providerJobId: payload.providerJobId,
      latency: payload.latency,
      usage: payload.usage,
    },
    toolHistory: payload.toolHistory.map((tool) => ({
      name: tool.name,
      input: redactSecrets(tool.input),
      result: redactSecrets(tool.result ?? null),
      error: tool.error,
      at: tool.at,
    })),
    state: "complete",
    status: "completed",
    outcome: "answered-completed",
    durationSeconds: payload.durationSeconds,
    createdAt: payload.startedAt,
    updatedAt: payload.endedAt,
  };
  await store.saveCall(call);

  const previousSeconds = Math.max(0, Number(previous?.durationSeconds || 0));
  const deltaSeconds = Math.max(0, payload.durationSeconds - previousSeconds);
  if (deltaSeconds > 0) {
    await store.addUsage(
      client.id,
      payload.direction === "inbound" ? deltaSeconds / 60 : 0,
      payload.direction === "outbound" ? deltaSeconds / 60 : 0,
    );
    await store.appendCreditLedgerEntry({
      id: newId("credit_usage_"),
      clientId: client.id,
      minutes: -(deltaSeconds / 60),
      kind: "usage",
      direction: payload.direction,
      referenceType: "call_duration",
      referenceId: `${payload.callId}:${payload.durationSeconds}`,
      description: `${payload.direction} call usage`,
      createdAt: payload.endedAt,
    });
  }
  for (const event of usageEvents(payload)) await store.appendProviderUsageCostEvent(event);
  return { status: 200, body: { received: true, callId: payload.callId } };
}

function usageEvents(payload: RuntimePostCall): ProviderUsageCostEvent[] {
  const values: Array<[string, number, ProviderUsageCostEvent["usageUnit"], Record<string, unknown>]> = [
    ["livekit", payload.usage.livekit.roomSeconds, "seconds", {}],
    ["stt", payload.usage.stt.audioSeconds, "seconds", { provider: payload.usage.stt.provider }],
    ["llm", payload.usage.llm.inputTokens + payload.usage.llm.outputTokens, "tokens", payload.usage.llm],
    ["tts", payload.usage.tts.characters, "characters", payload.usage.tts],
  ];
  return values.map(([component, quantity, unit, metadata]) => ({
    id: `usage_${createHash("sha256").update(`${payload.callId}:${component}`).digest("hex").slice(0, 24)}`,
    clientId: payload.tenantId,
    provider: "livekit-cascade",
    providerEventId: `${payload.callId}:${component}`,
    callId: payload.callId,
    occurredAt: payload.endedAt,
    usageQuantity: quantity,
    usageUnit: unit,
    costMinor: 0,
    currency: "GBP",
    metadata: { component, ...metadata },
    createdAt: payload.endedAt,
  }));
}

function expectedCallId(tenantId: string, providerJobId: string): string {
  return `call_${createHash("sha256")
    .update(`livekit-cascade\0${tenantId}\0${providerJobId}`)
    .digest("hex")
    .slice(0, 32)}`;
}

function validatePayload(value: RuntimePostCall): string | undefined {
  if (!value || value.version !== 1 || value.provider !== "livekit-cascade") return "invalid_payload";
  if (![value.callId, value.tenantId, value.providerJobId, value.objective, value.promptVersionId].every(
    (item) => typeof item === "string" && item.length > 0,
  )) return "missing_call_identity";
  if (value.direction !== "inbound" && value.direction !== "outbound") return "invalid_direction";
  if (!Array.isArray(value.transcript) || !Array.isArray(value.toolHistory)) return "invalid_history";
  if (!Number.isFinite(value.durationSeconds) || value.durationSeconds < 0) return "invalid_duration";
  if (!Number.isFinite(Date.parse(value.startedAt)) || !Number.isFinite(Date.parse(value.endedAt))) return "invalid_timestamps";
  if (!value.usage?.livekit || !value.usage?.stt || !value.usage?.llm || !value.usage?.tts) return "invalid_usage";
  return undefined;
}

type RuntimePostCall = {
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
  transcript: Array<{ role: "caller" | "agent" | "system"; text: string; at: string }>;
  toolHistory: Array<{ name: string; input: unknown; result?: unknown; error?: string; at: string }>;
  latency: Record<string, number | undefined>;
  usage: {
    livekit: { roomSeconds: number };
    stt: { provider: "deepgram"; audioSeconds: number };
    llm: { provider: "google"; inputTokens: number; outputTokens: number };
    tts: { provider: "cartesia"; characters: number; audioSeconds: number };
  };
};
