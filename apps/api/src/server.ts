import http from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import {
  getStore,
  getRedis,
  migrate,
  seedStore,
  structuredLog,
} from "@robinexis/database";
import {
  applyOutboundStatus,
  ElevenLabsManagementClient,
  handleStripeWebhook,
  validateTwilioWebhook,
} from "@robinexis/integrations";
import { TOOL_NAMES, type ToolName } from "@robinexis/tool-contracts";
import { applyCors, authenticateRequest, describeAuthMode } from "./auth.js";
import { ingestElevenLabsWebhook } from "./elevenLabsWebhook.js";
import {
  completeCalcomOAuthCallback,
  completeTwilioOAuthCallback,
  handleProductRoute,
  publicPlansResponse,
} from "./productRoutes.js";
import { checkDistributedRateLimit, checkRateLimit, limitForPath, requestIp } from "./rateLimit.js";
import { provisionClientAgent } from "./provisioningService.js";
import { runVoiceContractTool, voiceToolClientIdForRequest } from "./voiceToolRoutes.js";
import {
  ingestVoiceRuntimePostCall,
  runtimeConfigFor,
  voiceRuntimeAuthorized,
} from "./voiceRuntimeRoutes.js";
import { initializeBackendTelemetry } from "./telemetry.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(__dirname, "../../../.env") });
loadEnv({ path: path.join(process.cwd(), ".env") });
initializeBackendTelemetry();

const PORT = Number(process.env.API_PORT || process.env.PORT) || 8081;
const BUILD_VERSION = process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 12) || process.env.BUILD_VERSION || "local";

function workerAuthorized(value: string): boolean {
  const secret = process.env.WORKER_API_SECRET || "";
  const left = Buffer.from(value);
  const right = Buffer.from(secret);
  return Boolean(secret && left.length === right.length && timingSafeEqual(left, right));
}

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
    const rateKey = `${requestIp(req)}:${url.pathname}`;
    let rate;
    try {
      rate = await checkDistributedRateLimit(await getRedis(), rateKey, requestLimit);
    } catch (error) {
      structuredLog("rate_limit_redis_fallback", { reason: String(error) });
      rate = checkRateLimit(rateKey, requestLimit);
    }
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
    if (url.pathname === "/health" || url.pathname === "/health/database") {
      await store.listClients();
      if (url.pathname === "/health/database") {
        send(res, 200, { status: "ok", service: "database", buildVersion: BUILD_VERSION });
        return;
      }
      const redisConfigured = Boolean(process.env.REDIS_URL);
      const redisHealthy = redisConfigured ? await (await getRedis()).ping() : false;
      const redisRequired = process.env.RATE_LIMIT_REDIS_REQUIRED === "true";
      send(res, redisRequired && !redisHealthy ? 503 : 200, {
        status: redisRequired && !redisHealthy ? "degraded" : "ok",
        service: "api",
        buildVersion: BUILD_VERSION,
        checks: {
          database: "ok",
          sharedRateLimit: redisConfigured ? (redisHealthy ? "ok" : "degraded") : "not_configured",
        },
        constraints: {
          singleReplicaRequired: !redisHealthy,
          redisRequired,
        },
      });
      return;
    }
    if (url.pathname === "/internal/provisioning/retry" && req.method === "POST") {
      if (!workerAuthorized(String(req.headers["x-worker-secret"] || ""))) {
        send(res, 401, { error: "unauthorized" });
        return;
      }
      if (process.env.SAAS_PROVISIONING_ENABLED !== "true") {
        structuredLog("provisioning_retry_blocked", { reason: "saas_provisioning_disabled" });
        send(res, 503, { error: "saas_provisioning_disabled" });
        return;
      }
      const body = JSON.parse((await readRaw(req)).toString("utf8") || "{}") as {
        clientId?: string;
        operationKey?: string;
        phoneMode?: "robinexis_account" | "customer_oauth";
        twilioNumber?: string;
      };
      if (!body.clientId || !body.operationKey) {
        send(res, 400, { error: "client_and_operation_key_required" });
        return;
      }
      try {
        const client = await store.getClient(body.clientId);
        if (!client) throw new Error("client_not_found");
        const result = await provisionClientAgent({
          clientId: client.id,
          operationKey: body.operationKey,
          apiBaseUrl: process.env.API_PUBLIC_BASE_URL || `https://${req.headers.host}`,
          transferNumber: client.transferNumber,
          twilioNumber: body.twilioNumber || client.requestedPhoneNumber,
          phoneMode: body.phoneMode || client.phoneAcquisitionMode,
        }, {
          store,
          elevenLabs: new ElevenLabsManagementClient({
            apiKey: process.env.ELEVENLABS_API_KEY || "",
          }),
        });
        send(res, 200, result);
      } catch (error) {
        const message = error instanceof Error ? error.message : "provisioning_retry_failed";
        send(res, message === "provisioning_paused" ? 409 : 502, { error: message });
      }
      return;
    }
    const runtimeConfigMatch = url.pathname.match(/^\/internal\/voice-runtime\/config\/([^/]+)$/);
    if (runtimeConfigMatch && req.method === "GET") {
      if (!voiceRuntimeAuthorized(req.headers["x-voice-runtime-secret"])) {
        send(res, 401, { error: "unauthorized" });
        return;
      }
      const result = await runtimeConfigFor(store, decodeURIComponent(runtimeConfigMatch[1]));
      send(res, result.status, result.body);
      return;
    }
    if (url.pathname === "/internal/voice-runtime/post-call" && req.method === "POST") {
      const raw = await readRaw(req);
      const result = await ingestVoiceRuntimePostCall(
        store,
        raw,
        String(req.headers["x-voice-runtime-timestamp"] || ""),
        String(req.headers["x-voice-runtime-signature"] || ""),
      );
      send(res, result.status, result.body);
      return;
    }
    if (url.pathname === "/webhooks/twilio/number-status" && req.method === "POST") {
      const raw = await readRaw(req);
      const form = new URLSearchParams(raw.toString());
      const params = Object.fromEntries(form.entries());
      const signature = String(req.headers["x-twilio-signature"] ?? "");
      const signedUrl = `${process.env.API_PUBLIC_BASE_URL || `https://${req.headers.host}`}${url.pathname}${url.search}`;
      if (!validateTwilioWebhook(signature, signedUrl, params)) {
        send(res, 403, { error: "invalid_signature" });
        return;
      }
      const clientId = url.searchParams.get("clientId") || "";
      if (!clientId || !(await store.getClient(clientId))) {
        send(res, 404, { error: "client_not_found" });
        return;
      }
      structuredLog("twilio_managed_number_status", {
        clientId,
        phoneNumberSid: form.get("PhoneNumberSid"),
        status: form.get("Status") || form.get("PhoneNumberStatus") || "unknown",
      });
      send(res, 200, { ok: true });
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
    if (url.pathname === "/oauth/twilio/callback" && req.method === "GET") {
      try {
        const destination = await completeTwilioOAuthCallback(store, {
          code: url.searchParams.get("code") || "",
          state: url.searchParams.get("state") || "",
        });
        res.writeHead(302, { Location: destination, "Cache-Control": "no-store" });
        res.end();
      } catch (error) {
        structuredLog("twilio_oauth_callback_failed", { error: String(error) });
        const fallback = new URL(
          "/onboarding",
          (process.env.WEB_ORIGIN || "https://app.robinexis.com").split(",")[0].trim(),
        );
        fallback.searchParams.set("twilio", "failed");
        res.writeHead(302, { Location: fallback.toString(), "Cache-Control": "no-store" });
        res.end();
      }
      return;
    }
    if (url.pathname === "/oauth/calcom/callback" && req.method === "GET") {
      try {
        const destination = await completeCalcomOAuthCallback(store, {
          code: url.searchParams.get("code") || "",
          state: url.searchParams.get("state") || "",
        });
        res.writeHead(302, { Location: destination, "Cache-Control": "no-store" });
        res.end();
      } catch (error) {
        structuredLog("calcom_oauth_callback_failed", { error: String(error) });
        const fallback = new URL(
          "/app/integrations",
          (process.env.WEB_ORIGIN || "https://app.robinexis.com").split(",")[0].trim(),
        );
        fallback.searchParams.set("calcom", "failed");
        res.writeHead(302, { Location: fallback.toString(), "Cache-Control": "no-store" });
        res.end();
      }
      return;
    }
    const voiceToolMatch = url.pathname.match(/^\/api\/v1\/voice-tools\/([a-z-]+)$/);
    if (voiceToolMatch && req.method === "POST") {
      const toolName = voiceToolMatch[1].replaceAll("-", "_") as ToolName;
      if (!TOOL_NAMES.includes(toolName)) {
        send(res, 404, { ok: false, error: "unknown_voice_tool" });
        return;
      }
      const authorizedClientId = await voiceToolClientIdForRequest(
        store,
        req.headers["x-voice-tool-secret"],
      );
      if (!authorizedClientId) {
        send(res, 401, { ok: false, error: "unauthorized" });
        return;
      }
      const input = JSON.parse((await readRaw(req)).toString() || "{}") as Record<string, unknown>;
      const result = await runVoiceContractTool(
        store,
        toolName,
        input,
        { store, clientId: authorizedClientId },
      );
      send(res, result.status, result.body);
      return;
    }
    if (url.pathname === "/api/v1/plans" && req.method === "GET") {
      send(res, 200, publicPlansResponse());
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
  if (process.env.DATABASE_URL && process.env.RUN_MIGRATIONS_ON_START !== "false") {
    await migrate(process.env.DATABASE_URL);
  }
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
