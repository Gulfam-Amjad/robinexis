import { appendFileSync } from "node:fs";
import type { ClientConfig, ServiceStatus, VoicePipeline } from "./types.js";

export function voicePipelineOf(
  client: Pick<ClientConfig, "voicePipeline"> | { voicePipeline?: VoicePipeline },
): VoicePipeline {
  return client.voicePipeline === "elevenlabs-convai" ? "elevenlabs-convai" : "groq-gateway";
}

export function isGroqGatewayPipeline(client: Pick<ClientConfig, "voicePipeline">): boolean {
  return voicePipelineOf(client) === "groq-gateway";
}

const GRACE_DAYS = Number(process.env.STRIPE_GRACE_DAYS || 3);

export function isAiServiceEnabled(client: Pick<ClientConfig, "serviceStatus" | "pastDueAt" | "published" | "onboardingStatus">): {
  enabled: boolean;
  inbound: boolean;
  outbound: boolean;
  reason: string;
} {
  if (!client.published) {
    return { enabled: false, inbound: false, outbound: false, reason: "config_not_published" };
  }
  if (client.onboardingStatus && client.onboardingStatus !== "active") {
    return { enabled: false, inbound: false, outbound: false, reason: `onboarding_${client.onboardingStatus}` };
  }
  const s = client.serviceStatus;
  if (s === "trialing" || s === "active") {
    return { enabled: true, inbound: true, outbound: true, reason: s };
  }
  if (s === "past_due") {
    const since = client.pastDueAt ? Date.parse(client.pastDueAt) : Date.now();
    const graceMs = GRACE_DAYS * 24 * 60 * 60 * 1000;
    const inGrace = Date.now() - since < graceMs;
    return {
      enabled: inGrace,
      inbound: inGrace,
      outbound: false,
      reason: inGrace ? "past_due_grace" : "past_due_expired",
    };
  }
  if (s === "canceled" || s === "unpaid" || s === "paused" || s === "incomplete" || s === "incomplete_expired") {
    return { enabled: false, inbound: false, outbound: false, reason: s };
  }
  return { enabled: false, inbound: false, outbound: false, reason: "unknown_status" };
}

export function stripeStatusToLocal(stripeStatus: string): ServiceStatus {
  const allowed: ServiceStatus[] = [
    "trialing",
    "active",
    "past_due",
    "canceled",
    "unpaid",
    "incomplete",
    "incomplete_expired",
    "paused",
  ];
  return (allowed as string[]).includes(stripeStatus) ? (stripeStatus as ServiceStatus) : "incomplete";
}

export function redactSecrets(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === "string") {
    return value
      .replace(/sk_live_[a-zA-Z0-9]+/g, "[redacted]")
      .replace(/sk_test_[a-zA-Z0-9]+/g, "[redacted]")
      .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
      .replace(/cal_live_\S+/g, "[redacted]")
      .replace(/xi-[a-zA-Z0-9]+/g, "[redacted]");
  }
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (/key|token|secret|password|authorization/i.test(k)) out[k] = "[redacted]";
      else out[k] = redactSecrets(v);
    }
    return out;
  }
  return value;
}

export function structuredLog(event: string, fields: Record<string, unknown>) {
  const line = JSON.stringify({ ts: new Date().toISOString(), event, ...redactSecrets(fields) as object });
  console.log(line);
  // Dev servers run under a watcher whose stdout is often not where you are looking;
  // STRUCTURED_LOG_FILE gives live-call diagnostics a stable place to land.
  const sink = process.env.STRUCTURED_LOG_FILE;
  if (sink) {
    try {
      appendFileSync(sink, `${line}\n`);
    } catch {
      /* logging must never break a call */
    }
  }
}
