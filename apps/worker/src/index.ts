import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { loadDatabaseEnv } from "@robinexis/database";
import {
  getStore,
  seedStore,
  structuredLog,
} from "@robinexis/database";
import {
  checkAvailability,
  enqueueLifecycleEmail,
  processNotificationDeliveries,
  reconcileStripe,
  resolveCalcomTenantConnection,
} from "@robinexis/integrations";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(__dirname, "../../../.env") });
loadDatabaseEnv();

const POLL = Number(process.env.WORKER_POLL_MS) || 15_000;
const RETENTION_DAYS = Math.max(1, Number(process.env.DATA_RETENTION_DAYS) || 90);
const HEALTH_PORT = Number(process.env.WORKER_HEALTH_PORT || process.env.PORT) || 8082;
const WORKER_ID = `${os.hostname()}:${process.pid}`;
const PROVISIONING_LEASE_SECONDS = 30 * 60;
const PROVISIONING_HEARTBEAT_MS = 60_000;
const HEALTH_STALE_MS = Math.max(
  POLL * 4,
  Number(process.env.WORKER_HEALTH_STALE_MS) || 120_000,
);
const CALENDAR_HEALTH_INTERVAL_MS = Math.max(
  5 * 60_000,
  Number(process.env.CALENDAR_HEALTH_INTERVAL_MS) || 30 * 60_000,
);
let lastReconcile = 0;
let lastCalendarHealthRun = 0;
const calendarHealth = new Map<string, "ok" | "failed">();
let lastTickSucceededAt = 0;
let lastTickFailedAt = 0;
let tickRunning = false;

const healthServer = http.createServer((req, res) => {
  if (req.url !== "/health") {
    res.writeHead(404, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ error: "not_found" }));
    return;
  }
  const now = Date.now();
  const healthy = lastTickSucceededAt > 0 && now - lastTickSucceededAt <= HEALTH_STALE_MS;
  res.writeHead(healthy ? 200 : 503, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify({
    status: healthy ? "ok" : "degraded",
    service: "worker",
    checks: {
      loop: healthy ? "ok" : lastTickSucceededAt ? "stale" : "starting",
      running: tickRunning,
    },
    lastSuccessAgeMs: lastTickSucceededAt ? now - lastTickSucceededAt : null,
    lastFailureAgeMs: lastTickFailedAt ? now - lastTickFailedAt : null,
  }));
});

async function retryProvisioningRuns(store: Awaited<ReturnType<typeof getStore>>) {
  if (process.env.SAAS_PROVISIONING_ENABLED !== "true") return;
  const apiBaseUrl = (process.env.API_PUBLIC_BASE_URL || "").replace(/\/$/, "");
  const workerSecret = process.env.WORKER_API_SECRET || "";
  if (!apiBaseUrl || !workerSecret) {
    structuredLog("provisioning_retry_skipped", { reason: "api_base_or_worker_secret_missing" });
    return;
  }
  const now = new Date();
  const jobs = await store.claimOnboardingJobs(
    WORKER_ID,
    now.toISOString(),
    PROVISIONING_LEASE_SECONDS,
    10,
  );
  for (const job of jobs) {
    if (job.kind !== "provision_client") {
      await store.deadLetterOnboardingJob(job.clientId, job.id, WORKER_ID, "unsupported_job_kind", now.toISOString());
      continue;
    }
    const client = await store.getClient(job.clientId);
    const operationKey = String(job.payload.operationKey || "");
    if (!client || !operationKey) {
      await store.deadLetterOnboardingJob(job.clientId, job.id, WORKER_ID, "invalid_provisioning_job", now.toISOString());
      continue;
    }
    const heartbeat = setInterval(() => {
      void store.extendOnboardingJobLease(
        job.clientId,
        job.id,
        WORKER_ID,
        new Date().toISOString(),
        PROVISIONING_LEASE_SECONDS,
      ).catch((error) => structuredLog("provisioning_lease_heartbeat_failed", {
        clientId: job.clientId,
        jobId: job.id,
        error: String(error),
      }));
    }, PROVISIONING_HEARTBEAT_MS);
    try {
      const response = await fetch(
        `${apiBaseUrl}/internal/provisioning/retry`,
        {
          method: "POST",
          headers: {
            "x-worker-secret": workerSecret,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            clientId: client.id,
            operationKey,
            phoneMode: client.phoneAcquisitionMode,
            twilioNumber: client.requestedPhoneNumber,
          }),
        },
      );
      structuredLog("provisioning_retry", {
        clientId: client.id,
        jobId: job.id,
        attempt: job.attemptCount,
        status: response.status,
      });
      if (response.ok) {
        await store.completeOnboardingJob(job.clientId, job.id, WORKER_ID, new Date().toISOString());
      } else {
        const body = await response.json().catch(() => ({})) as { error?: string };
        if (body.error === "provisioning_paused") {
          await store.completeOnboardingJob(job.clientId, job.id, WORKER_ID, new Date().toISOString());
          structuredLog("provisioning_job_paused", { clientId: client.id, jobId: job.id });
          continue;
        }
        if (body.error?.startsWith("synthetic_booking_cleanup_failed:")) {
          await store.deadLetterOnboardingJob(
            job.clientId,
            job.id,
            WORKER_ID,
            body.error,
            new Date().toISOString(),
          );
          structuredLog("provisioning_cleanup_dead_lettered", {
            clientId: client.id,
            jobId: job.id,
          });
          continue;
        }
        const error = `provisioning_api_${response.status}`;
        const retryAt = new Date(Date.now() + Math.min(60, 2 ** job.attemptCount) * 60_000).toISOString();
        const retried = await store.retryOnboardingJob(job.clientId, job.id, WORKER_ID, error, retryAt);
        if (!retried) await store.deadLetterOnboardingJob(job.clientId, job.id, WORKER_ID, error, new Date().toISOString());
      }
    } catch (error) {
      structuredLog("provisioning_retry_error", {
        clientId: client.id,
        jobId: job.id,
        error: String(error),
      });
      const retryAt = new Date(Date.now() + Math.min(60, 2 ** job.attemptCount) * 60_000).toISOString();
      const retried = await store.retryOnboardingJob(job.clientId, job.id, WORKER_ID, String(error), retryAt);
      if (!retried) {
        await store.deadLetterOnboardingJob(job.clientId, job.id, WORKER_ID, String(error), new Date().toISOString());
      }
    } finally {
      clearInterval(heartbeat);
    }
  }
}

/**
 * Blades' event types were deleted out from under the platform and nothing
 * noticed until a customer reported it, so every bookable tenant is probed on
 * the event type its agent books against. Zero slots only warns — a fully booked
 * salon is normal; a provider error means the calendar is genuinely unreachable.
 */
async function monitorCalendarHealth(store: Awaited<ReturnType<typeof getStore>>) {
  if (Date.now() - lastCalendarHealthRun < CALENDAR_HEALTH_INTERVAL_MS) return;
  lastCalendarHealthRun = Date.now();
  const start = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const end = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000).toISOString();

  for (const client of await store.listClients()) {
    if (!client.enabledFeatures.includes("booking")) continue;
    // Only a tenant with a live inbound number can lose real bookings; empty
    // workspaces would otherwise alert forever before they ever take a call.
    const live = (await store.listPhoneEndpoints(client.id))
      .some((item) => item.status === "active" && item.direction !== "outbound");
    if (!live) continue;
    const connected = (await store.listCalendarConnections(client.id))
      .some((item) => item.provider === "calcom" && item.status === "active");
    if (!connected) continue;

    const mapping = (await store.listCalendarEventTypes(client.id))
      .find((item) => item.status === "active" && !item.readinessOnly);
    let failure: string | undefined;
    let slotCount = 0;
    if (!mapping) {
      failure = "no_booking_types_configured";
    } else {
      try {
        const { tenant } = await resolveCalcomTenantConnection(store, client);
        const availability = await checkAvailability(tenant, {
          eventTypeSlug: mapping.providerSlug,
          eventTypeId: mapping.providerEventTypeId,
          start,
          end,
        });
        slotCount = availability.slots.length;
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
      }
    }

    const previous = calendarHealth.get(client.id);
    calendarHealth.set(client.id, failure ? "failed" : "ok");
    if (failure) {
      structuredLog("calendar_health_failed", {
        tenantId: client.id,
        eventType: mapping?.providerSlug,
        error: failure.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").slice(0, 200),
      });
      if (previous !== "failed") {
        await enqueueLifecycleEmail({
          store,
          clientId: client.id,
          operationId: `calendar_health_${client.id}`,
          idempotencyKey: `calendar_health:${client.id}:${new Date().toISOString().slice(0, 13)}`,
          to: process.env.SUPPORT_EMAIL,
          template: [
            `${client.businessName}: the booking calendar is not reachable`,
            "",
            `Workspace: ${client.businessName} (${client.id})`,
            `Booking type: ${mapping?.providerSlug || "none configured"}`,
            `Error: ${failure.slice(0, 200)}`,
            "",
            "The voice agent cannot take bookings until this is repaired.",
          ].join("\n"),
        });
      }
    } else {
      if (!slotCount) {
        structuredLog("calendar_health_no_slots", { tenantId: client.id, eventType: mapping?.providerSlug });
      }
      if (previous === "failed") {
        structuredLog("calendar_health_recovered", { tenantId: client.id, eventType: mapping?.providerSlug });
      }
    }
  }
}

async function tick() {
  const store = await getStore();
  const now = new Date();

  if (Date.now() - lastReconcile > 24 * 60 * 60 * 1000) {
    lastReconcile = Date.now();
    if (!process.env.STRIPE_SECRET_KEY) {
      structuredLog("stripe_reconcile_skipped", { reason: "stripe_not_configured" });
    } else {
      try {
        const r = await reconcileStripe(store);
        structuredLog("stripe_reconcile", r);
      } catch (err) {
        structuredLog("stripe_reconcile_error", { err: String(err) });
      }
    }
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400000).toISOString();
    const n = await store.deleteCallsOlderThan(cutoff);
    if (n) structuredLog("retention_deleted_calls", { n, cutoff });
    const lifecycle = await store.deleteLifecycleDataOlderThan(cutoff);
    if (Object.values(lifecycle).some(Boolean)) {
      structuredLog("retention_deleted_lifecycle_data", { ...lifecycle, cutoff });
    }
  }

  for (const job of await store.dueJobs(now.toISOString(), 20)) {
    job.status = "failed";
    job.disposition = "failed";
    job.lastError = "outbound_voice_gateway_retired";
    await store.saveJob(job);
    structuredLog("outbound_retired", { jobId: job.id, clientId: job.clientId });
  }
  const notifications = await processNotificationDeliveries({ store, workerId: WORKER_ID, now });
  if (notifications.delivered || notifications.retried || notifications.deadLettered) {
    structuredLog("notification_outbox_processed", { ...notifications, workerId: WORKER_ID });
  }
  await retryProvisioningRuns(store);
  await monitorCalendarHealth(store);
}

async function runTick() {
  if (tickRunning) return;
  tickRunning = true;
  try {
    await tick();
    lastTickSucceededAt = Date.now();
  } catch (error) {
    lastTickFailedAt = Date.now();
    throw error;
  } finally {
    tickRunning = false;
  }
}

async function main() {
  healthServer.listen(HEALTH_PORT, () => {
    structuredLog("worker_health_listening", { port: HEALTH_PORT, path: "/health" });
  });
  const store = await getStore();
  if ((await store.listClients()).length === 0) await seedStore(store);
  structuredLog("worker_start", {
    pollMs: POLL,
    healthPort: HEALTH_PORT,
    healthStaleMs: HEALTH_STALE_MS,
    retentionDays: RETENTION_DAYS,
    stripeConfigured: Boolean(process.env.STRIPE_SECRET_KEY),
  });
  if (!process.env.STRIPE_SECRET_KEY) {
    structuredLog("worker_misconfigured", { missing: ["STRIPE_SECRET_KEY"] });
  }
  // A failing first tick used to kill the process, so a worker that booted
  // before the API applied migrations crash-looped instead of recovering on the
  // next poll. /health still reports degraded until a tick succeeds.
  await runTick().catch((err) => structuredLog("worker_tick_error", { err: String(err) }));
  setInterval(
    () => void runTick().catch((err) => structuredLog("worker_tick_error", { err: String(err) })),
    POLL,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
