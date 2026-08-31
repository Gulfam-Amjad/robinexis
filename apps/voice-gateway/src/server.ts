import http from "node:http";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { WebSocketServer } from "ws";
import { MediaStreamConnection } from "./mediaStream.js";
import { createCallSession, type LiveCallSession } from "./callSession.js";
import { warnOnMissingConfig, config, FRONT_DESK_PLACEHOLDER } from "./config.js";
import { getRedis, getStore, isAiServiceEnabled, isGroqGatewayPipeline, seedStore, structuredLog } from "@robinexis/database";
import { validateTwilioWebhook } from "@robinexis/integrations";

warnOnMissingConfig();

const MEDIA_STREAM_PATH = "/media-stream";
const BUILD_VERSION = process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 12) || process.env.BUILD_VERSION || "local";
// Redis gives call-slot reservations a shared home across replicas. A single-replica
// sandbox can run on the in-process fallback in RedisSessionCache, so REQUIRE_REDIS=false
// is the explicit opt-out. Never set it on a multi-replica deployment.
const REDIS_REQUIRED = process.env.REQUIRE_REDIS !== "false";

function xmlEscape(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

function streamToken(clientId: string, reservationId: string, expires: string) {
  const secret = process.env.TWILIO_AUTH_TOKEN || "local-development-only";
  return createHmac("sha256", secret)
    .update(`${clientId}:${reservationId}:${expires}`)
    .digest("hex");
}

function validStreamToken(params: Record<string, string>) {
  const expires = Number(params.streamExpires);
  if (!params.clientId || !params.reservationId || !Number.isFinite(expires) || expires < Date.now()) {
    return false;
  }
  const expected = streamToken(params.clientId, params.reservationId, params.streamExpires);
  const supplied = params.streamToken || "";
  if (supplied.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

function fallbackTwiml(number: string, say?: string) {
  const line = say ?? "Please hold while we connect you to the team.";
  const target =
    number && number !== "+15555550100"
      ? `<Dial>${xmlEscape(number)}</Dial>`
      : config.fallbackVoicemailUrl
        ? `<Redirect method="POST">${xmlEscape(config.fallbackVoicemailUrl)}</Redirect>`
        : `<Say>Sorry, the team is unavailable. Please call back shortly.</Say><Hangup/>`;
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Response><Say>${xmlEscape(line)}</Say>${target}</Response>`
  );
}

async function readForm(req: http.IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return new URLSearchParams(Buffer.concat(chunks).toString());
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

  if (url.pathname === "/" || url.pathname === "/health") {
    const redisHealthy = await (await getRedis()).ping();
    const productionDependenciesOk =
      !process.env.RAILWAY_ENVIRONMENT ||
      (Boolean(process.env.DATABASE_URL) && (redisHealthy || !REDIS_REQUIRED));
    res.writeHead(productionDependenciesOk ? 200 : 503, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: productionDependenciesOk ? "ok" : "degraded",
        service: "voice-gateway",
        buildVersion: BUILD_VERSION,
        architecture: "twilio-groq-whisper-groq-stream-elevenlabs-persistent-tts",
        dependencies: {
          postgres: Boolean(process.env.DATABASE_URL),
          redis: redisHealthy,
        },
        liveNumberCutover: false,
      }),
    );
    return;
  }

  if (url.pathname === "/twiml" && req.method === "POST") {
    try {
      const store = await getStore();
      if ((await store.listClients()).length === 0) await seedStore(store);

      const form = await readForm(req);
      const signature = String(req.headers["x-twilio-signature"] ?? "");
      const signedUrl = `${process.env.PUBLIC_BASE_URL || `https://${req.headers.host}`}${url.pathname}${url.search}`;
      if (!validateTwilioWebhook(signature, signedUrl, Object.fromEntries(form.entries()))) {
        res.writeHead(403, { "Content-Type": "text/plain" });
        res.end("Invalid Twilio signature");
        return;
      }
      const to = form.get("To") || form.get("Called") || "";
      const from = form.get("From") || "";
      const answeredBy = form.get("AnsweredBy") || "";
      const direction = (url.searchParams.get("direction") as "inbound" | "outbound") || "inbound";
      const clientIdParam = url.searchParams.get("clientId");
      const jobId = url.searchParams.get("jobId") ?? undefined;

      let client = clientIdParam
        ? await store.getPublishedClient(clientIdParam)
        : await store.getClientByInboundNumber(to);
      if (!client) client = await store.getClientBySlug(config.defaultClientSlug);

      const dialTo = client?.transferNumber || config.frontDeskPhoneNumber;

      if (!client) {
        res.writeHead(200, { "Content-Type": "text/xml" });
        res.end(fallbackTwiml(dialTo, "Connecting you to the team."));
        return;
      }

      if (!isGroqGatewayPipeline(client)) {
        structuredLog("pipeline_not_gateway", { clientId: client.id, pipeline: client.voicePipeline });
        res.writeHead(200, { "Content-Type": "text/xml" });
        res.end(fallbackTwiml(dialTo, "Connecting you to the team."));
        return;
      }

      if (direction === "outbound" && answeredBy.startsWith("machine")) {
        if (jobId) {
          const job = await store.getJob(jobId);
          if (job) {
            job.status = "completed";
            job.disposition = "voicemail";
            await store.saveJob(job);
          }
        }
        res.writeHead(200, { "Content-Type": "text/xml" });
        res.end(
          `<?xml version="1.0" encoding="UTF-8"?>` +
            `<Response><Say>This is the booking assistant from ${xmlEscape(client.businessName)}. ` +
            `Please call ${xmlEscape(client.phone)} when convenient.</Say><Hangup/></Response>`,
        );
        return;
      }

      const access = isAiServiceEnabled(client);
      const directionFeature = direction === "outbound" ? "outbound" : "inbound";
      const featureOk =
        (direction === "outbound" ? access.outbound : access.inbound) &&
        client.enabledFeatures.includes(directionFeature);
      const month = new Date().toISOString().slice(0, 7);
      const usage = await store.getUsage(client.id, month);
      const usedMinutes = (usage?.inboundMinutes ?? 0) + (usage?.outboundMinutes ?? 0);
      const overLimit =
        client.monthlyMinuteLimit !== undefined && usedMinutes >= client.monthlyMinuteLimit;
      if (!featureOk || !config.groqApiKey || overLimit) {
        structuredLog("inbound_fallback", {
          clientId: client.id,
          reason: !featureOk
            ? access.reason
            : !config.groqApiKey
              ? "groq_not_configured"
              : "usage_limit_reached",
        });
        res.writeHead(200, { "Content-Type": "text/xml" });
        res.end(fallbackTwiml(dialTo));
        return;
      }

      const reservationId = randomUUID();
      const redis = await getRedis();
      const reserved = await redis.reserveCallSlot(client.id, reservationId, client.maxConcurrentCalls);
      if (!reserved) {
        res.writeHead(200, { "Content-Type": "text/xml" });
        res.end(fallbackTwiml(dialTo, "All lines are busy. Connecting you to the team."));
        return;
      }

      // A tunnel that rewrites the Host header would otherwise hand Twilio a private
      // stream address, so trust the configured public URL ahead of the request host.
      const publicHost = (process.env.PUBLIC_BASE_URL || "").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
      const host = publicHost || req.headers.host;
      const streamUrl = `wss://${host}${MEDIA_STREAM_PATH}`;
      const objective =
        direction === "outbound" ? "Complete the outbound campaign objective. Record disposition." : "Book or help the caller.";
      const streamExpires = String(Date.now() + 5 * 60 * 1000);
      const signedStreamToken = streamToken(client.id, reservationId, streamExpires);
      res.writeHead(200, { "Content-Type": "text/xml" });
      res.end(
        `<?xml version="1.0" encoding="UTF-8"?>` +
          `<Response><Connect><Stream url="${xmlEscape(streamUrl)}">` +
          `<Parameter name="clientId" value="${xmlEscape(client.id)}" />` +
          `<Parameter name="direction" value="${direction}" />` +
          `<Parameter name="objective" value="${xmlEscape(objective)}" />` +
          `<Parameter name="fromPhone" value="${xmlEscape(from)}" />` +
          `<Parameter name="reservationId" value="${xmlEscape(reservationId)}" />` +
          `<Parameter name="streamExpires" value="${streamExpires}" />` +
          `<Parameter name="streamToken" value="${signedStreamToken}" />` +
          (jobId ? `<Parameter name="jobId" value="${xmlEscape(jobId)}" />` : "") +
          `</Stream></Connect></Response>`,
      );
    } catch (err) {
      structuredLog("twiml_error", { err: String(err) });
      res.writeHead(200, { "Content-Type": "text/xml" });
      res.end(fallbackTwiml(config.frontDeskPhoneNumber, "Connecting you to the team."));
    }
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
});

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const { pathname } = new URL(req.url ?? "/", `http://${req.headers.host}`);
  if (pathname !== MEDIA_STREAM_PATH) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});

wss.on("connection", (ws) => {
  let session: LiveCallSession | null = null;

  const connection = new MediaStreamConnection(ws, {
    onStart: (info) => {
      const params = info.customParameters ?? {};
      void (async () => {
        if (!validStreamToken(params)) {
          structuredLog("stream_auth_failed", { clientId: params.clientId });
          if (params.reservationId && params.clientId) {
            const redis = await getRedis();
            await redis.releaseCallSlot(params.clientId, params.reservationId);
          }
          ws.close();
          return;
        }
        const store = await getStore();
        const client = await store.getPublishedClient(params.clientId);
        if (!client || !isGroqGatewayPipeline(client)) {
          structuredLog("stream_no_client", { params, pipeline: client?.voicePipeline });
          if (params.reservationId && params.clientId) {
            const redis = await getRedis();
            await redis.releaseCallSlot(params.clientId, params.reservationId);
          }
          ws.close();
          return;
        }
        session = createCallSession(connection, {
          callSid: info.callSid,
          streamSid: info.streamSid,
          client,
          direction: (params.direction as "inbound" | "outbound") || "inbound",
          objective: params.objective || "Book or help the caller.",
          outboundJobId: params.jobId,
          fromPhone: params.fromPhone,
          reservationId: params.reservationId || randomUUID(),
        });
      })();
    },
    onAudioChunk: (chunk) => {
      session?.feedAudio(chunk);
    },
    onStop: () => session?.close(),
    onClose: () => session?.close(),
  });
});

async function start() {
  const store = await getStore();
  if ((await store.listClients()).length === 0) await seedStore(store);
  if (process.env.RAILWAY_ENVIRONMENT && !(await (await getRedis()).ping())) {
    if (REDIS_REQUIRED) throw new Error("Redis is required in production");
    structuredLog("redis_unavailable_single_replica", {
      note: "REQUIRE_REDIS=false — call slots are reserved in-process only",
    });
  }
  server.listen(config.port, () => {
    console.log(`[server] voice-gateway listening on :${config.port} (sandbox only — do not cut over +447446868067)`);
    structuredLog("gateway_ready", {
      port: config.port,
      publicBaseUrl: process.env.PUBLIC_BASE_URL || "(unset)",
      frontDeskConfigured: config.frontDeskPhoneNumber !== FRONT_DESK_PLACEHOLDER,
      llmModel: config.groqLlmModel,
      sttModel: config.groqSttModel,
      voiceId: config.elevenLabsVoiceId,
    });
  });
}

start().catch((err) => {
  structuredLog("gateway_start_failed", { err: String(err) });
  process.exit(1);
});
