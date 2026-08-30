import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { loadDatabaseEnv } from "@robinexis/database";
import {
  getStore,
  isAiServiceEnabled,
  isGroqGatewayPipeline,
  seedStore,
  structuredLog,
  type OutboundJob,
} from "@robinexis/database";
import { inCallingWindow, placeOutboundCall, reconcileStripe } from "@robinexis/integrations";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(__dirname, "../../../.env") });
loadDatabaseEnv();

const POLL = Number(process.env.WORKER_POLL_MS) || 15_000;
const RETENTION_DAYS = Math.max(1, Number(process.env.DATA_RETENTION_DAYS) || 90);
let lastReconcile = 0;

async function tick() {
  const store = await getStore();
  const now = new Date();

  if (Date.now() - lastReconcile > 24 * 60 * 60 * 1000) {
    lastReconcile = Date.now();
    try {
      const r = await reconcileStripe(store);
      structuredLog("stripe_reconcile", r);
    } catch (err) {
      structuredLog("stripe_reconcile_error", { err: String(err) });
    }
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400000).toISOString();
    const n = await store.deleteCallsOlderThan(cutoff);
    if (n) structuredLog("retention_deleted_calls", { n, cutoff });
  }

  const jobs = await store.dueJobs(now.toISOString(), 20);

  for (const job of jobs) {
    await processJob(store, job, now);
  }
}

async function processJob(
  store: Awaited<ReturnType<typeof getStore>>,
  job: OutboundJob,
  now: Date,
) {
  const client = await store.getPublishedClient(job.clientId);
  if (!client) {
    job.status = "failed";
    job.lastError = "client_missing";
    await store.saveJob(job);
    return;
  }
  if (!isGroqGatewayPipeline(client)) {
    structuredLog("outbound_blocked_pipeline", { jobId: job.id, pipeline: client.voicePipeline });
    return;
  }
  const access = isAiServiceEnabled(client);
  if (!access.outbound || !client.enabledFeatures.includes("outbound")) {
    structuredLog("outbound_blocked_billing", { jobId: job.id, reason: access.reason });
    return;
  }
  const month = now.toISOString().slice(0, 7);
  const usage = await store.getUsage(client.id, month);
  const usedMinutes = (usage?.inboundMinutes ?? 0) + (usage?.outboundMinutes ?? 0);
  if (client.monthlyMinuteLimit !== undefined && usedMinutes >= client.monthlyMinuteLimit) {
    structuredLog("outbound_blocked_usage", { jobId: job.id, clientId: client.id });
    return;
  }
  const duplicateDial = (await store.listJobs(client.id)).find(
    (candidate) =>
      candidate.id !== job.id &&
      candidate.status === "dialing" &&
      candidate.campaign === job.campaign &&
      candidate.contactPhone === job.contactPhone,
  );
  if (duplicateDial) {
    job.status = "cancelled";
    job.lastError = `duplicate_of:${duplicateDial.id}`;
    await store.saveJob(job);
    return;
  }
  if (await store.isSuppressed(client.id, job.contactPhone)) {
    job.status = "suppressed";
    await store.saveJob(job);
    return;
  }
  if (client.firstCampaignRequiresApproval && !job.approved) {
    structuredLog("outbound_waiting_approval", { jobId: job.id, clientId: client.id });
    return;
  }
  if (!inCallingWindow(client, now)) {
    return;
  }
  if (job.attemptCount >= job.maxAttempts) {
    job.status = "failed";
    job.lastError = "max_attempts";
    await store.saveJob(job);
    return;
  }
  const hourAgo = now.getTime() - 60 * 60 * 1000;
  const recentDials = (await store.listJobs(client.id)).filter(
    (candidate) =>
      candidate.lastAttemptAt !== undefined && Date.parse(candidate.lastAttemptAt) >= hourAgo,
  ).length;
  if (recentDials >= client.outboundRatePerHour) {
    structuredLog("outbound_rate_limited", { clientId: client.id });
    return;
  }

  if (!(await store.claimJob(job.id, now.toISOString()))) {
    structuredLog("outbound_claim_lost", { jobId: job.id });
    return;
  }
  job.status = "dialing";
  job.attemptCount += 1;
  job.lastAttemptAt = now.toISOString();

  const base = process.env.PUBLIC_BASE_URL;
  const from = client.outboundCallerId || process.env.TWILIO_SANDBOX_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER;
  const apiBase = process.env.API_PUBLIC_BASE_URL;
  if (!base || !from || !apiBase) {
    structuredLog("outbound_simulated", { jobId: job.id, reason: "missing_public_url_or_caller_id" });
    job.status = "failed";
    job.lastError = "not_configured";
    job.disposition = "failed";
    await store.saveJob(job);
    return;
  }

  const twimlUrl = `${base}/twiml?direction=outbound&clientId=${encodeURIComponent(client.id)}&jobId=${encodeURIComponent(job.id)}`;
  const statusCallback = `${apiBase}/webhooks/twilio/status?jobId=${encodeURIComponent(job.id)}`;
  try {
    await placeOutboundCall({ to: job.contactPhone, from, twimlUrl, statusCallback });
    structuredLog("outbound_placed", { jobId: job.id, clientId: client.id });
  } catch (err) {
    job.status = job.attemptCount >= job.maxAttempts ? "failed" : "approved";
    job.lastError = String(err);
    await store.saveJob(job);
    structuredLog("outbound_error", { jobId: job.id, err: String(err) });
  }
}

async function main() {
  const store = await getStore();
  if ((await store.listClients()).length === 0) await seedStore(store);
  structuredLog("worker_start", { pollMs: POLL, retentionDays: RETENTION_DAYS });
  await tick();
  setInterval(() => void tick().catch((err) => structuredLog("worker_tick_error", { err: String(err) })), POLL);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
