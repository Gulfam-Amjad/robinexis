import http from "node:http";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import {
  getStore,
  seedStore,
  structuredLog,
} from "@robinexis/database";
import {
  applyOutboundStatus,
  handleStripeWebhook,
  validateTwilioWebhook,
} from "@robinexis/integrations";
import { applyCors, authenticateRequest, describeAuthMode } from "./auth.js";
import { ingestElevenLabsWebhook } from "./elevenLabsWebhook.js";
import { handleProductRoute } from "./productRoutes.js";
import { checkRateLimit, limitForPath, requestIp } from "./rateLimit.js";
import { runVoiceTool, voiceToolClientIdForRequest } from "./voiceToolRoutes.js";

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
  let total = 0;
  for await (const c of req) {
    const chunk = Buffer.isBuffer(c) ? c : Buffer.from(c);
    total += chunk.byteLength;
    if (total > 6 * 1024 * 1024) throw new Error("payload_too_large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

const server = http.createServer(async (req, res) => {
  const requestId = String(req.headers["x-request-id"] || randomUUID()).slice(0, 128);
  const requestStartedAt = Date.now();
  res.setHeader("X-Request-Id", requestId);
  res.on("finish", () => {
    structuredLog("http_request", {
      requestId,
      method: req.method || "UNKNOWN",
      path: (req.url || "/").split("?")[0],
      status: res.statusCode,
      durationMs: Date.now() - requestStartedAt,
    });
  });
  applyCors(req, res);
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const requestLimit = limitForPath(url.pathname);
  if (requestLimit) {
    const rate = checkRateLimit(`${requestIp(req)}:${url.pathname}`, requestLimit);
    res.setHeader("X-RateLimit-Limit", String(rate.limit));
    res.setHeader("X-RateLimit-Remaining", String(rate.remaining));
    if (!rate.allowed) {
      res.setHeader("Retry-After", String(rate.retryAfterSeconds));
      send(res, 429, { error: "rate_limited" });
      return;
    }
  }

  try {
    const store = await getStore();
    if (url.pathname === "/health") {
      await store.listClients();
      send(res, 200, {
        status: "ok",
        service: "api",
        buildVersion: BUILD_VERSION,
        checks: { database: "ok" },
      });
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
    if (url.pathname === "/webhooks/elevenlabs/post-call" && req.method === "POST") {
      const raw = await readRaw(req);
      const signature = String(req.headers["elevenlabs-signature"] || "");
      const result = await ingestElevenLabsWebhook(store, raw, signature);
      send(res, result.status, result.body);
      return;
    }
    const voiceToolMatch = url.pathname.match(
      /^\/api\/v1\/voice-tools\/(check-availability|create-booking)$/,
    );
    if (voiceToolMatch && req.method === "POST") {
      const authorizedClientId = await voiceToolClientIdForRequest(
        store,
        req.headers["x-voice-tool-secret"],
      );
      if (!authorizedClientId) {
        send(res, 401, { ok: false, error: "unauthorized" });
        return;
      }
      const input = JSON.parse((await readRaw(req)).toString() || "{}") as Record<string, unknown>;
      const result = await runVoiceTool(
        store,
        voiceToolMatch[1] as "check-availability" | "create-booking",
        input,
        { store, clientId: authorizedClientId },
      );
      send(res, result.status, result.body);
      return;
    }
    if (url.pathname === "/api/v1" || url.pathname.startsWith("/api/v1/")) {
      const actor = await authenticateRequest(req, store);
      if (!actor) {
        send(res, 401, { error: "unauthorized" });
        return;
      }
      const handled = await handleProductRoute({ req, res, url, store, actor, send, readRaw });
      if (!handled) send(res, 404, { error: "not_found" });
      return;
    }
    send(res, 404, { error: "not_found" });
  } catch (err) {
    structuredLog("api_error", { err: String(err) });
    send(
      res,
      err instanceof Error && err.message === "payload_too_large" ? 413 : 500,
      { error: err instanceof Error && err.message === "payload_too_large" ? "payload_too_large" : "internal" },
    );
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
