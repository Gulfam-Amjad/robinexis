import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import {
  DEMO_CLIENT_ID,
  getStore,
  seedStore,
  structuredLog,
} from "@robinexis/database";
import {
  applyOutboundStatus,
  handleStripeWebhook,
  probeCalcomForClient,
  publicDemoCallView,
  validateTwilioWebhook,
} from "@robinexis/integrations";
import { applyCors, describeAuthMode, isAdmin } from "./auth.js";
import { handleProductRoute } from "./productRoutes.js";
import { runVoiceTool, voiceToolAuthorized } from "./voiceToolRoutes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(__dirname, "../../../.env") });
loadEnv({ path: path.join(process.cwd(), ".env") });

const PORT = Number(process.env.API_PORT || process.env.PORT) || 8081;
const BUILD_VERSION = process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 12) || process.env.BUILD_VERSION || "local";

function send(res: http.ServerResponse, status: number, body: unknown, type = "application/json") {
  const data = type === "application/json" ? JSON.stringify(body) : String(body);
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  });
  res.end(data);
}

async function readRaw(req: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks);
}

const server = http.createServer(async (req, res) => {
  applyCors(req, res);
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    const store = await getStore();
    if (url.pathname === "/health") {
      send(res, 200, { status: "ok", service: "api", buildVersion: BUILD_VERSION });
      return;
    }
    if (url.pathname === "/demo/calendar" && req.method === "GET") {
      if ((await store.listClients()).length === 0) await seedStore(store);
      const client =
        (await store.getPublishedClient(DEMO_CLIENT_ID)) ?? (await store.getClientBySlug(DEMO_CLIENT_ID));
      const slug = (url.searchParams.get("eventTypeSlug") || "").trim() || undefined;
      send(res, 200, await probeCalcomForClient({ client, eventTypeSlug: slug }));
      return;
    }
    if (url.pathname === "/demo/calls" && req.method === "GET") {
      if ((await store.listClients()).length === 0) await seedStore(store);
      const sid = (url.searchParams.get("sid") || "").trim();
      const tenant =
        (url.searchParams.get("clientId") || "").trim() || DEMO_CLIENT_ID;
      const limit = Math.min(20, Math.max(1, Number(url.searchParams.get("limit") || 8) || 8));
      if (sid) {
        const call = await store.getCallByTwilioSid(tenant, sid);
        if (!call) {
          send(res, 404, { ok: false, error: "not_found" });
          return;
        }
        send(res, 200, { ok: true, call: publicDemoCallView(call) });
        return;
      }
      const calls = (await store.listCallsForClient(tenant, limit)).map(publicDemoCallView);
      send(res, 200, { ok: true, calls });
      return;
    }
    if (url.pathname === "/webhooks/twilio/status" && req.method === "POST") {
      const raw = await readRaw(req);
      const form = new URLSearchParams(raw.toString());
      const params = Object.fromEntries(form.entries());
      const signature = String(req.headers["x-twilio-signature"] ?? "");
      const signedUrl = `${process.env.API_PUBLIC_BASE_URL || `https://${req.headers.host}`}${url.pathname}${url.search}`;
      if (!validateTwilioWebhook(signature, signedUrl, params)) {
        send(res, 403, { error: "invalid_signature" });
        return;
      }
      const jobId = url.searchParams.get("jobId");
      const job = jobId ? await store.getJob(jobId) : undefined;
      if (!job) {
        send(res, 404, { error: "job_not_found" });
        return;
      }
      const callStatus = form.get("CallStatus") ?? "failed";
      const answeredBy = form.get("AnsweredBy") ?? "";
      applyOutboundStatus(job, { callStatus, answeredBy });
      await store.saveJob(job);
      structuredLog("outbound_status", { jobId: job.id, callStatus, disposition: job.disposition });
      send(res, 200, { ok: true });
      return;
    }
    if (url.pathname === "/webhooks/stripe" && req.method === "POST") {
      const raw = await readRaw(req);
      const sig = String(req.headers["stripe-signature"] ?? "");
      const secret = process.env.STRIPE_WEBHOOK_SECRET ?? "";
      const result = await handleStripeWebhook({ store, rawBody: raw, signature: sig, webhookSecret: secret });
      send(res, result.ok ? 200 : 400, result);
      return;
    }
    const voiceToolMatch = url.pathname.match(
      /^\/api\/v1\/voice-tools\/(check-availability|create-booking)$/,
    );
    if (voiceToolMatch && req.method === "POST") {
      if (!voiceToolAuthorized(req.headers["x-voice-tool-secret"])) {
        send(res, 401, { ok: false, error: "unauthorized" });
        return;
      }
      const input = JSON.parse((await readRaw(req)).toString() || "{}") as Record<string, unknown>;
      const result = await runVoiceTool(
        store,
        voiceToolMatch[1] as "check-availability" | "create-booking",
        input,
      );
      send(res, result.status, result.body);
      return;
    }
    if (url.pathname === "/api/v1" || url.pathname.startsWith("/api/v1/")) {
      if (!(await isAdmin(req))) {
        send(res, 401, { error: "unauthorized" });
        return;
      }
      const handled = await handleProductRoute({ req, res, url, store, send, readRaw });
      if (!handled) send(res, 404, { error: "not_found" });
      return;
    }
    send(res, 404, { error: "not_found" });
  } catch (err) {
    structuredLog("api_error", { err: String(err) });
    send(res, 500, { error: "internal" });
  }
});

async function start() {
  const store = await getStore();
  const clients = await store.listClients();
  if (clients.length === 0) await seedStore(store);
  server.listen(PORT, () => {
    console.log(`[api] listening on :${PORT}`);
    console.log(`[api] auth: ${describeAuthMode()}`);
  });
}

start().catch((err) => {
  structuredLog("api_start_failed", { err: String(err) });
  process.exit(1);
});
