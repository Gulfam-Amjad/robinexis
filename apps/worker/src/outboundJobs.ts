import type { OutboundJob, PlatformStore } from "@robinexis/database";
import { inCallingWindow, placeOutboundCall } from "@robinexis/integrations";

type DialResult = { sid?: string };
type Dial = (opts: {
  to: string;
  from: string;
  twimlUrl: string;
  statusCallback?: string;
}) => Promise<DialResult>;

export type OutboundProcessResult = {
  examined: number;
  dialed: number;
  suppressed: number;
  deferred: number;
  failed: number;
};

function appendQuery(base: string, job: OutboundJob): string {
  const url = new URL(base);
  url.searchParams.set("direction", "outbound");
  url.searchParams.set("clientId", job.clientId);
  url.searchParams.set("jobId", job.id);
  return url.toString();
}

export async function processOutboundJobs(input: {
  store: PlatformStore;
  now?: Date;
  dial?: Dial;
  enabled?: boolean;
  twimlUrl?: string;
  statusCallbackBase?: string;
}): Promise<OutboundProcessResult> {
  const now = input.now ?? new Date();
  const enabled = input.enabled ?? process.env.OUTBOUND_AUTOMATION_ENABLED === "true";
  const result: OutboundProcessResult = {
    examined: 0,
    dialed: 0,
    suppressed: 0,
    deferred: 0,
    failed: 0,
  };
  if (!enabled) return result;

  const statusBase = input.statusCallbackBase ?? process.env.API_PUBLIC_BASE_URL ?? "";
  for (const job of await input.store.dueJobs(now.toISOString(), 20)) {
    if (!job.approved || job.status !== "approved") continue;
    result.examined += 1;
    const client = await input.store.getPublishedClient(job.clientId);
    const twimlUrl = input.twimlUrl ?? (
      client?.voicePipeline === "livekit-cascade"
        ? process.env.OUTBOUND_LIVEKIT_TWIML_URL
        : process.env.OUTBOUND_ELEVENLABS_TWIML_URL
    ) ?? process.env.OUTBOUND_TWIML_URL ?? "";
    if (!client || !client.outboundCallerId || !twimlUrl || !statusBase) {
      job.status = "failed";
      job.disposition = "failed";
      job.lastError = "outbound_not_configured";
      await input.store.saveJob(job);
      result.failed += 1;
      continue;
    }
    if (await input.store.isSuppressed(job.clientId, job.contactPhone)) {
      job.status = "suppressed";
      job.disposition = "opted-out";
      job.lastError = "contact_suppressed";
      await input.store.saveJob(job);
      result.suppressed += 1;
      continue;
    }
    if (!inCallingWindow(client, now)) {
      job.scheduledAt = new Date(now.getTime() + 15 * 60_000).toISOString();
      await input.store.saveJob(job);
      result.deferred += 1;
      continue;
    }
    if (!(await input.store.claimJob(job.id, now.toISOString()))) continue;
    const claimed = await input.store.getJob(job.id);
    if (!claimed) continue;
    try {
      const dial = input.dial ?? placeOutboundCall;
      const status = new URL("/webhooks/twilio/status", statusBase);
      status.searchParams.set("clientId", job.clientId);
      status.searchParams.set("jobId", job.id);
      await dial({
        to: job.contactPhone,
        from: client.outboundCallerId,
        twimlUrl: appendQuery(twimlUrl, job),
        statusCallback: status.toString(),
      });
      claimed.status = "dialing";
      claimed.lastError = undefined;
      await input.store.saveJob(claimed);
      result.dialed += 1;
    } catch (error) {
      claimed.lastError = error instanceof Error ? error.message.slice(0, 160) : "outbound_dial_failed";
      if (claimed.attemptCount >= claimed.maxAttempts) {
        claimed.status = "failed";
        claimed.disposition = "failed";
      } else {
        claimed.status = "approved";
        claimed.scheduledAt = new Date(now.getTime() + Math.min(60, 5 * 2 ** claimed.attemptCount) * 60_000)
          .toISOString();
      }
      await input.store.saveJob(claimed);
      result.failed += 1;
    }
  }
  return result;
}
