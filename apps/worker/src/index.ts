import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { loadDatabaseEnv } from "@robinexis/database";
import {
  getStore,
  seedStore,
  structuredLog,
} from "@robinexis/database";
import { reconcileStripe } from "@robinexis/integrations";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(__dirname, "../../../.env") });
loadDatabaseEnv();

const POLL = Number(process.env.WORKER_POLL_MS) || 15_000;
const RETENTION_DAYS = Math.max(1, Number(process.env.DATA_RETENTION_DAYS) || 90);
let lastReconcile = 0;

async function retryProvisioningRuns(store: Awaited<ReturnType<typeof getStore>>) {
  if (process.env.SAAS_PROVISIONING_ENABLED !== "true") return;
  const apiBaseUrl = (process.env.API_PUBLIC_BASE_URL || "").replace(/\/$/, "");
  const workerSecret = process.env.WORKER_API_SECRET || "";
  if (!apiBaseUrl || !workerSecret) {
    structuredLog("provisioning_retry_skipped", { reason: "api_base_or_worker_secret_missing" });
    return;
  }
  for (const client of await store.listClients()) {
    if (!["provisioning", "failed"].includes(client.onboardingStatus || "")) continue;
    const run = (await store.listProvisioningRuns(client.id))[0];
    if (!run || run.status === "succeeded" || run.status === "cancelled") continue;
    const age = Date.now() - Date.parse(run.updatedAt);
    if (run.status === "running" && age < 5 * 60_000) continue;
    const attempts = Number(run.input.workerAttempts || 0);
    if (attempts >= 5) continue;
    if (run.status === "running") {
      run.status = "failed";
      run.error = "stale_provisioning_run_recovered";
    }
    run.input.workerAttempts = attempts + 1;
    run.updatedAt = new Date().toISOString();
    await store.saveProvisioningRun(run);
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
            operationKey: run.idempotencyKey,
            phoneMode: client.phoneAcquisitionMode,
            twilioNumber: client.requestedPhoneNumber,
          }),
        },
      );
      structuredLog("provisioning_retry", {
        clientId: client.id,
        runId: run.id,
        attempt: attempts + 1,
        status: response.status,
      });
    } catch (error) {
      structuredLog("provisioning_retry_error", {
        clientId: client.id,
        runId: run.id,
        error: String(error),
      });
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
  }

  for (const job of await store.dueJobs(now.toISOString(), 20)) {
    job.status = "failed";
    job.disposition = "failed";
    job.lastError = "outbound_voice_gateway_retired";
    await store.saveJob(job);
    structuredLog("outbound_retired", { jobId: job.id, clientId: job.clientId });
  }
  await retryProvisioningRuns(store);
}

async function main() {
  const store = await getStore();
  if ((await store.listClients()).length === 0) await seedStore(store);
  structuredLog("worker_start", {
    pollMs: POLL,
    retentionDays: RETENTION_DAYS,
    stripeConfigured: Boolean(process.env.STRIPE_SECRET_KEY),
  });
  if (!process.env.STRIPE_SECRET_KEY) {
    structuredLog("worker_misconfigured", { missing: ["STRIPE_SECRET_KEY"] });
  }
  await tick();
  setInterval(() => void tick().catch((err) => structuredLog("worker_tick_error", { err: String(err) })), POLL);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
