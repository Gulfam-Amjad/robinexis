import { createHash } from "node:crypto";

const apiBase = (process.env.API_PUBLIC_BASE_URL ||
  "https://robinexisapi-production-3836.up.railway.app").replace(/\/$/, "");

async function request(path, init) {
  const response = await fetch(`${apiBase}${path}`, {
    signal: AbortSignal.timeout(10_000),
    ...init,
  });
  let body;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  return { status: response.status, body };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const health = await request("/health");
assert(health.status === 200, `health returned ${health.status}`);
assert(health.body?.status === "ok", "health status is not ok");
assert(health.body?.checks?.database === "ok", "database health is not ok");

const productAuth = await request("/api/v1/session");
assert(productAuth.status === 401, `unauthenticated product API returned ${productAuth.status}`);

const voiceAuth = await request("/api/v1/voice-tools/check-availability", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-voice-tool-secret": `invalid-${crypto.randomUUID()}`,
  },
  body: JSON.stringify({
    conversationId: "canary-auth-only",
    eventTypeSlug: "30min",
    start: new Date(Date.now() + 86_400_000).toISOString(),
    end: new Date(Date.now() + 90_000_000).toISOString(),
  }),
});
assert(voiceAuth.status === 401, `invalid voice-tool secret returned ${voiceAuth.status}`);

const buildVersion = String(health.body?.buildVersion || "unknown");
console.log(JSON.stringify({
  ok: true,
  apiHost: new URL(apiBase).host,
  buildVersion,
  buildFingerprint: createHash("sha256").update(buildVersion).digest("hex").slice(0, 12),
  checks: {
    health: "ok",
    database: "ok",
    productApiRejectsAnonymous: "ok",
    voiceToolsRejectInvalidSecret: "ok",
  },
}, null, 2));
