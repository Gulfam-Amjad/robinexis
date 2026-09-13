/**
 * Ensures the ElevenLabs ConvAI post-call webhook points at the Robinexis API.
 * Writes a new HMAC secret to gitignored `.env.elevenlabs-webhook.secret` when created.
 * Run: npx @railway/cli run --service "@robinexis/api" -- node scripts/ensure-elevenlabs-post-call-webhook.mjs
 */
import { writeFileSync } from "node:fs";

const apiKey = process.env.ELEVENLABS_API_KEY || "";
if (!apiKey) {
  console.error("ELEVENLABS_API_KEY is missing");
  process.exit(1);
}

const webhookUrl = `${(process.env.API_PUBLIC_BASE_URL || "https://api.robinexis.com").replace(/\/$/, "")}/webhooks/elevenlabs/post-call`;
const headers = {
  "xi-api-key": apiKey,
  "Content-Type": "application/json",
};

async function request(path, init = {}) {
  const response = await fetch(`https://api.elevenlabs.io${path}`, {
    ...init,
    headers: { ...headers, ...init.headers },
  });
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!response.ok) {
    const error = new Error(`ElevenLabs ${init.method || "GET"} ${path} -> ${response.status}`);
    error.body = json;
    throw error;
  }
  return json;
}

const listed = await request("/v1/workspace/webhooks?include_usages=true");
const webhooks = Array.isArray(listed.webhooks) ? listed.webhooks : [];
const matching = webhooks.filter((item) => item.webhook_url === webhookUrl);

if (process.env.FORCE_RECREATE_WEBHOOK === "true") {
  await request("/v1/convai/settings", {
    method: "PATCH",
    body: JSON.stringify({
      webhooks: {
        post_call_webhook_id: null,
        events: ["transcript"],
        transcript_format: "json",
      },
    }),
  });
  for (const item of matching) {
    const id = item.webhook_id;
    await request(`/v1/workspace/webhooks/${encodeURIComponent(id)}`, { method: "DELETE" });
  }
}

const remaining = process.env.FORCE_RECREATE_WEBHOOK === "true"
  ? []
  : matching;
let webhook = remaining[0];
let secretCreated = false;

if (!webhook) {
  const created = await request("/v1/workspace/webhooks", {
    method: "POST",
    body: JSON.stringify({
      settings: {
        auth_type: "hmac",
        name: "Robinexis post-call transcription",
        webhook_url: webhookUrl,
      },
    }),
  });
  webhook = created;
  secretCreated = Boolean(created.webhook_secret);
  if (created.webhook_secret) {
    writeFileSync(".env.elevenlabs-webhook.secret", created.webhook_secret, { encoding: "utf8", mode: 0o600 });
  }
}

const webhookId = webhook.webhook_id || webhook.webhookId;
if (webhookId) {
  await request("/v1/convai/settings", {
    method: "PATCH",
    body: JSON.stringify({
      webhooks: {
        post_call_webhook_id: webhookId,
        events: ["transcript"],
        transcript_format: "json",
      },
    }),
  });
}

const voiceId = process.env.ELEVENLABS_VOICE_ID || "L4so9SudEsIYzE9j4qlR";
let voiceName = "";
try {
  const voice = await request(`/v1/voices/${encodeURIComponent(voiceId)}`);
  voiceName = voice.name || "";
} catch {
  const voices = await request("/v1/voices");
  const match = (voices.voices || []).find((item) => item.voice_id === voiceId);
  voiceName = match?.name || "";
}

console.log(JSON.stringify({
  webhookUrl,
  webhookId,
  reusedExisting: remaining.length > 0,
  secretCreated,
  secretFile: secretCreated ? ".env.elevenlabs-webhook.secret" : null,
  isDisabled: webhook.is_disabled,
  isAutoDisabled: webhook.is_auto_disabled,
  voiceId,
  voiceName,
}, null, 2));
