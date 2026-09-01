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

  for (const job of await store.dueJobs(now.toISOString(), 20)) {
    job.status = "failed";
    job.disposition = "failed";
    job.lastError = "outbound_voice_gateway_retired";
    await store.saveJob(job);
    structuredLog("outbound_retired", { jobId: job.id, clientId: job.clientId });
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
