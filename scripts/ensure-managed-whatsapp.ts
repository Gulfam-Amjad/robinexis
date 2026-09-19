/**
 * Inspects Twilio for WhatsApp senders, points webhooks at the Robinexis API,
 * and creates the four utility Content Templates. Does not print secrets.
 *
 * Run: npm run whatsapp:ensure
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import twilio from "twilio";
import {
  ROBINEXIS_WHATSAPP_TEMPLATES,
  findExistingContentSid,
  managedWhatsAppWebhookUrls,
  upsertEnvAssignments,
  whatsappEnvUpdates,
  type WhatsAppContentTemplateSpec,
} from "@robinexis/integrations";

function loadDotEnv(path: string) {
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const index = line.indexOf("=");
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1);
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv(resolve(".env"));

const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim() || "";
const authToken = process.env.TWILIO_AUTH_TOKEN?.trim() || "";
if (!accountSid || !authToken) {
  console.error("TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN is missing");
  process.exit(1);
}

const basic = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
const webhooks = managedWhatsAppWebhookUrls(
  process.env.API_PUBLIC_BASE_URL || "https://api.robinexis.com",
);

async function twilioJson(url: string, init: RequestInit = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Basic ${basic}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const text = await response.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? JSON.parse(text) as Record<string, unknown> : {};
  } catch {
    body = { raw: text.slice(0, 200) };
  }
  return { ok: response.ok, status: response.status, body };
}

const client = twilio(accountSid, authToken);
const blockers: string[] = [];
const notes: string[] = [];

let accountStatus = "unknown";
try {
  const account = await client.api.v2010.accounts(accountSid).fetch();
  accountStatus = account.status;
} catch {
  blockers.push("twilio_account_unreachable");
}

let numberCount = 0;
try {
  const numbers = await client.incomingPhoneNumbers.list({ limit: 50 });
  numberCount = numbers.length;
  for (const number of numbers) {
    if (webhooks && number.smsUrl !== webhooks.inbound && process.env.WHATSAPP_UPDATE_SMS_URL === "true") {
      await number.update({
        smsUrl: webhooks.inbound,
        smsMethod: "POST",
        statusCallback: webhooks.status,
        statusCallbackMethod: "POST",
      });
      notes.push("updated_sms_url");
    }
  }
} catch {
  blockers.push("incoming_numbers_unreachable");
}

function senderListItems(body: Record<string, unknown>): Array<Record<string, string>> {
  const items = body.senders || body.contents || body.data;
  return Array.isArray(items) ? items as Array<Record<string, string>> : [];
}

function requestedWhatsAppSender(): string | undefined {
  const raw = (process.env.WHATSAPP_SENDER || process.env.TWILIO_PHONE_NUMBER || "").trim();
  if (!raw) return undefined;
  const digits = raw.replace(/^whatsapp:/i, "");
  return /^\+[1-9]\d{7,14}$/.test(digits) ? `whatsapp:${digits}` : undefined;
}

const senders: Array<{ sid?: string; status: string }> = [];
const senderList = await twilioJson("https://messaging.twilio.com/v2/Channels/Senders?Channel=whatsapp");
if (senderList.ok) {
  const list = senderListItems(senderList.body);
  for (const raw of list) {
    const item = raw as Record<string, string>;
    senders.push({
      sid: item.sid || item.sender_sid,
      status: item.status || item.offline_reason || "unknown",
    });
    const sid = item.sid || item.sender_sid;
    if (webhooks && sid) {
      const updated = await twilioJson(
        `https://messaging.twilio.com/v2/Channels/Senders/${encodeURIComponent(sid)}`,
        {
          method: "POST",
          body: JSON.stringify({
            configuration: {
              webhook: {
                callback_url: webhooks.inbound,
                callback_method: "POST",
                fallback_url: webhooks.inbound,
                fallback_method: "POST",
                status_callback_url: webhooks.status,
                status_callback_method: "POST",
              },
            },
          }),
        },
      );
      notes.push(updated.ok ? "sender_webhook_updated" : `sender_webhook_failed:${updated.status}`);
    }
  }
} else {
  notes.push(`whatsapp_senders_list:${senderList.status}`);
}

if (!senders.length) {
  const senderId = requestedWhatsAppSender();
  if (!senderId) {
    blockers.push("whatsapp_sender_not_approved");
  } else if (!webhooks) {
    blockers.push("whatsapp_sender_not_approved");
    notes.push("sender_create_skipped:webhook_urls_invalid");
  } else {
    const created = await twilioJson("https://messaging.twilio.com/v2/Channels/Senders", {
      method: "POST",
      body: JSON.stringify({
        sender_id: senderId,
        configuration: process.env.WHATSAPP_WABA_ID?.trim()
          ? {
            waba_id: process.env.WHATSAPP_WABA_ID.trim(),
            verification_method: "sms",
          }
          : undefined,
        webhook: {
          callback_url: webhooks.inbound,
          callback_method: "POST",
          fallback_url: webhooks.inbound,
          fallback_method: "POST",
          status_callback_url: webhooks.status,
          status_callback_method: "POST",
        },
        profile: {
          name: process.env.WHATSAPP_SENDER_NAME?.trim() || "Blades Hair",
        },
      }),
    });
    const createdSid = String(created.body.sid || created.body.sender_sid || "");
    const createdStatus = String(created.body.status || created.body.offline_reason || created.status);
    if (created.ok && createdSid) {
      senders.push({ sid: createdSid, status: createdStatus });
      notes.push("whatsapp_sender_create_started");
    } else {
      blockers.push("whatsapp_sender_not_approved");
      const code = created.body.code || created.body.error_code || created.status;
      const message = String(created.body.message || created.body.detail || "")
        .replace(/https?:\/\/\S+/g, "")
        .slice(0, 160);
      notes.push(`sender_create_failed:${code}${message ? `:${message}` : ""}`);
    }
  }
}

if (!senders.length && !blockers.includes("whatsapp_sender_not_approved")) {
  blockers.push("whatsapp_sender_not_approved");
}

let twilioSmsUsage: { count?: string; usage?: string; price?: string } | undefined;
let twilioWhatsAppUsage: { count?: string; usage?: string; price?: string } | undefined;
try {
  const [sms, whatsapp] = await Promise.all([
    client.usage.records.list({ category: "sms", limit: 1 }),
    client.usage.records.list({ category: "channels-whatsapp-outbound", limit: 1 }).catch(() => []),
  ]);
  twilioSmsUsage = sms[0] ? { count: sms[0].count, usage: sms[0].usage, price: sms[0].price } : undefined;
  twilioWhatsAppUsage = whatsapp[0]
    ? { count: whatsapp[0].count, usage: whatsapp[0].usage, price: whatsapp[0].price }
    : undefined;
} catch {
  notes.push("twilio_usage_records_unavailable");
}

const listedContents: Array<{ sid?: string; friendlyName?: string; friendly_name?: string }> = [];
try {
  const contents = await client.content.v1.contents.list({ limit: 100 });
  listedContents.push(...contents);
} catch (error) {
  notes.push(`content_list_failed:${error instanceof Error ? error.name : "error"}`);
}

const sids: Partial<Record<WhatsAppContentTemplateSpec["key"], string>> = {};
for (const spec of ROBINEXIS_WHATSAPP_TEMPLATES) {
  const existingEnv = process.env[spec.sidEnv]?.trim();
  const existing = existingEnv || findExistingContentSid(listedContents, spec);
  if (existing) {
    sids[spec.key] = existing;
    continue;
  }
  try {
    const created = await client.content.v1.contents.create({
      friendlyName: spec.friendlyName,
      language: "en",
      variables: spec.variables,
      types: { "twilio/text": { body: spec.body } },
    });
    if (created.sid) {
      sids[spec.key] = created.sid;
      notes.push(`created_template:${spec.friendlyName}`);
    }
  } catch (error) {
    blockers.push(`template_create_failed:${spec.key}`);
    notes.push(`template_error:${spec.key}:${error instanceof Error ? error.message.slice(0, 80) : "error"}`);
  }
}

if (ROBINEXIS_WHATSAPP_TEMPLATES.some((spec) => !sids[spec.key])) {
  blockers.push("content_templates_incomplete");
}

const envUpdates = whatsappEnvUpdates({
  sids,
  enabled: ROBINEXIS_WHATSAPP_TEMPLATES.every((spec) => Boolean(sids[spec.key])) && senders.length > 0,
});
const generatedPath = resolve(".env.whatsapp.generated");
writeFileSync(generatedPath, Object.entries(envUpdates).map(([key, value]) => `${key}=${value}`).join("\n") + "\n");
const envPath = resolve(".env");
if (existsSync(envPath)) {
  writeFileSync(envPath, upsertEnvAssignments(readFileSync(envPath, "utf8"), envUpdates));
}

const ready = blockers.length === 0 && Boolean(webhooks);
console.log(JSON.stringify({
  accountStatus,
  webhookUrls: webhooks || null,
  numberCount,
  whatsappSenderCount: senders.length,
  senders: senders.map((item) => ({ status: item.status, configured: Boolean(item.sid) })),
  templates: Object.fromEntries(ROBINEXIS_WHATSAPP_TEMPLATES.map((spec) => [spec.key, Boolean(sids[spec.key])])),
  twilioIncludedMessageQuota: null,
  twilioSmsUsage,
  twilioWhatsAppUsage,
  generatedEnv: generatedPath,
  notes,
  blockers,
  ready,
}, null, 2));
if (!ready) process.exitCode = 2;
