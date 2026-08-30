import {
  DEMO_CLIENT_ID,
  isAiServiceEnabled,
  isGroqGatewayPipeline,
  type CallSession,
  type ClientConfig,
  type ToolHistoryEntry,
  type TranscriptTurn,
} from "@robinexis/database";
import { placeOutboundCall, twilioClient } from "./twilioOutbound.js";

export const LIVE_SALON_NUMBER = "+447446868067";
export const E164_PATTERN = /^\+[1-9]\d{7,14}$/;

const rateBuckets = new Map<string, { count: number; resetAt: number }>();

export function normalizeE164(phone: string): string {
  return phone.replace(/[\s()-]/g, "");
}

export function isValidE164(phone: string): boolean {
  return E164_PATTERN.test(normalizeE164(phone));
}

export function demoCallRateLimited(key: string, limit = 5, windowMs = 10 * 60 * 1000): boolean {
  const now = Date.now();
  const existing = rateBuckets.get(key);
  if (!existing || existing.resetAt < now) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  existing.count += 1;
  return existing.count > limit;
}

export function assertDemoTenant(client: ClientConfig | undefined): client is ClientConfig {
  if (!client) return false;
  if (client.id !== DEMO_CLIENT_ID && client.slug !== DEMO_CLIENT_ID) return false;
  if (!isGroqGatewayPipeline(client)) return false;
  if (!client.published) return false;
  return true;
}

export type PublicDemoCallView = {
  id: string;
  twilioCallSid?: string;
  direction: string;
  status: string;
  outcome?: string;
  contactPhone?: string;
  transcript: TranscriptTurn[];
  toolHistory: ToolHistoryEntry[];
  createdAt: string;
  updatedAt: string;
};

export function sandboxFromIsLiveSalon(from = process.env.TWILIO_SANDBOX_PHONE_NUMBER || ""): boolean {
  return Boolean(from) && normalizeE164(from) === LIVE_SALON_NUMBER;
}

/** Agent Test Lab From: sandbox, else TWILIO_PHONE_NUMBER, else the existing UK number. */
export function demoOutboundFrom(): string {
  const sandbox = normalizeE164(process.env.TWILIO_SANDBOX_PHONE_NUMBER || "");
  if (sandbox) return sandbox;
  const phone = normalizeE164(process.env.TWILIO_PHONE_NUMBER || "");
  if (phone) return phone;
  return LIVE_SALON_NUMBER;
}

export function publicBaseUrlConfigured(base = process.env.PUBLIC_BASE_URL || ""): boolean {
  if (!base.startsWith("https://")) return false;
  const host = base.slice("https://".length).split("/")[0]?.toLowerCase() ?? "";
  if (!host.includes(".")) return false;
  if (host.startsWith("localhost") || host.startsWith("127.")) return false;
  // Placeholders reach Twilio as an unresolvable host, which the caller only hears as
  // "an application error has occurred" — reject them before a call is ever placed.
  return !/example\.ngrok|your-|subdomain|changeme|<|>/.test(host);
}

export function constructedDemoTwimlUrl(base = process.env.PUBLIC_BASE_URL || ""): string {
  return `${base.replace(/\/$/, "")}/twiml?direction=outbound&clientId=${encodeURIComponent(DEMO_CLIENT_ID)}`;
}

export function publicDemoCallView(call: CallSession): PublicDemoCallView {
  return {
    id: call.id,
    twilioCallSid: call.twilioCallSid,
    direction: call.direction,
    status: call.status,
    outcome: call.outcome,
    contactPhone: call.contactPhone,
    transcript: call.transcript,
    toolHistory: call.toolHistory,
    createdAt: call.createdAt,
    updatedAt: call.updatedAt,
  };
}

let pakistanPermissionCache:
  | { at: number; lowRiskNumbersEnabled?: boolean; error?: string }
  | undefined;

export async function fetchPakistanDialingPermission(): Promise<{
  checked: boolean;
  lowRiskNumbersEnabled?: boolean;
  error?: string;
}> {
  const sid = process.env.TWILIO_ACCOUNT_SID || "";
  const token = process.env.TWILIO_AUTH_TOKEN || "";
  if (!sid || !token) return { checked: false, error: "twilio_not_configured" };
  if (pakistanPermissionCache && Date.now() - pakistanPermissionCache.at < 60_000) {
    return {
      checked: true,
      lowRiskNumbersEnabled: pakistanPermissionCache.lowRiskNumbersEnabled,
      error: pakistanPermissionCache.error,
    };
  }
  try {
    const res = await fetch("https://voice.twilio.com/v1/DialingPermissions/Countries/PK", {
      headers: { Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64") },
      signal: AbortSignal.timeout(4000),
    });
    const json = (await res.json()) as {
      low_risk_numbers_enabled?: boolean;
      message?: string;
    };
    if (!res.ok) {
      pakistanPermissionCache = { at: Date.now(), error: json.message || `http_${res.status}` };
      return { checked: true, error: pakistanPermissionCache.error };
    }
    pakistanPermissionCache = {
      at: Date.now(),
      lowRiskNumbersEnabled: Boolean(json.low_risk_numbers_enabled),
    };
    return { checked: true, lowRiskNumbersEnabled: pakistanPermissionCache.lowRiskNumbersEnabled };
  } catch (err) {
    const error = err instanceof Error ? err.message.slice(0, 120) : "unreachable";
    pakistanPermissionCache = { at: Date.now(), error };
    return { checked: false, error };
  }
}

export async function fetchGatewayHealth(baseUrl = process.env.PUBLIC_BASE_URL || ""): Promise<{
  reachable: boolean;
  status?: string;
  service?: string;
  architecture?: string;
  error?: string;
}> {
  const base = baseUrl.replace(/\/$/, "");
  if (!base || base.includes("example.ngrok")) {
    return { reachable: false, error: "public_base_url_not_configured" };
  }
  try {
    const res = await fetch(`${base}/health`, {
      headers: { "ngrok-skip-browser-warning": "1" },
      signal: AbortSignal.timeout(8000),
    });
    const body = (await res.json()) as {
      status?: string;
      service?: string;
      architecture?: string;
    };
    return {
      reachable: res.ok,
      status: body.status,
      service: body.service,
      architecture: body.architecture,
    };
  } catch (err) {
    return { reachable: false, error: err instanceof Error ? err.message.slice(0, 120) : "unreachable" };
  }
}

export async function buildDemoLabStatus(opts: {
  client: ClientConfig | undefined;
}): Promise<Record<string, unknown>> {
  const sandbox = process.env.TWILIO_SANDBOX_PHONE_NUMBER || "";
  const publicBase = process.env.PUBLIC_BASE_URL || "";
  const access = opts.client ? isAiServiceEnabled(opts.client) : undefined;
  const gateway = await fetchGatewayHealth(publicBase);
  const pakistan = await fetchPakistanDialingPermission();
  const geoNote =
    pakistan.lowRiskNumbersEnabled === false
      ? "Twilio Voice Geographic Permissions for Pakistan are currently OFF. Enable PK in the Twilio Console before dialing +92."
      : pakistan.lowRiskNumbersEnabled === true
        ? "Twilio reports Pakistan low-risk numbers enabled. App code accepts +92 E.164."
        : "Twilio Voice Geographic Permissions for Pakistan must be enabled on the account. App code does not block +92.";
  return {
    ok: true,
    service: "api",
    tenant: DEMO_CLIENT_ID,
    demoTenantReady: assertDemoTenant(opts.client),
    outboundEnabled: Boolean(access?.outbound && opts.client?.enabledFeatures.includes("outbound")),
    twilioConfigured: Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN),
    labFrom: demoOutboundFrom(),
    labFromIsLiveSalon: normalizeE164(demoOutboundFrom()) === LIVE_SALON_NUMBER,
    sandboxConfigured: Boolean(sandbox),
    sandboxIsLiveSalon: sandboxFromIsLiveSalon(sandbox),
    publicBaseUrlConfigured: Boolean(publicBase) && !publicBase.includes("example.ngrok"),
    groqConfigured: Boolean(process.env.GROQ_API_KEY),
    elevenLabsConfigured: Boolean(process.env.ELEVENLABS_API_KEY),
    stripeConfigured: Boolean(process.env.STRIPE_SECRET_KEY),
    calcomConfigured: Boolean(process.env.CALCOM_API_KEY && (opts.client?.calendar.username || process.env.CALCOM_USERNAME)),
    pakistanE164Accepted: isValidE164("+923001234567"),
    pakistanDialingEnabled: pakistan.lowRiskNumbersEnabled === true,
    pakistanDialing: pakistan,
    geoNote,
    gateway,
  };
}

export async function startSandboxDemoCall(opts: {
  phone: string;
  client: ClientConfig;
}): Promise<{ ok: true; callSid: string } | { ok: false; error: string; status: number }> {
  const to = normalizeE164(opts.phone);
  if (!isValidE164(to)) return { ok: false, error: "invalid_phone", status: 400 };
  if (!assertDemoTenant(opts.client)) return { ok: false, error: "demo_tenant_not_ready", status: 503 };
  const access = isAiServiceEnabled(opts.client);
  if (!access.outbound || !opts.client.enabledFeatures.includes("outbound")) {
    return { ok: false, error: "demo_outbound_disabled", status: 403 };
  }

  const from = demoOutboundFrom();

  const base = process.env.PUBLIC_BASE_URL || "";
  if (!publicBaseUrlConfigured(base)) return { ok: false, error: "public_base_url_not_configured", status: 503 };

  const twimlUrl = constructedDemoTwimlUrl(base);
  try {
    const call = await placeOutboundCall({ to, from, twimlUrl });
    return { ok: true, callSid: call.sid };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("twilio_not_configured")) {
      return { ok: false, error: "twilio_not_configured", status: 503 };
    }
    return { ok: false, error: message.slice(0, 200), status: 502 };
  }
}

function sliceErr(err: unknown): string {
  return err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200);
}

/** Probe Twilio + constructed Calls.create fields. Never calls.create. Never a Pakistan destination. */
export async function verifyTwilioLab(): Promise<Record<string, unknown>> {
  const from = demoOutboundFrom();
  const sid = process.env.TWILIO_ACCOUNT_SID || "";
  const publicBase = process.env.PUBLIC_BASE_URL || "";
  const twimlUrl = constructedDemoTwimlUrl(publicBase);
  const constructedCall = {
    from,
    url: twimlUrl,
    method: "POST",
    statusCallbackEvent: ["completed", "busy", "no-answer", "failed"],
    machineDetection: "Enable",
  };

  const reasons: Record<string, string> = {};
  const client = twilioClient();
  let authPass = false;
  let accountStatus: string | undefined;
  if (!client || !sid) {
    reasons.twilioAuth = "TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN missing";
  } else {
    try {
      const account = await client.api.accounts(sid).fetch();
      authPass = true;
      accountStatus = account.status;
    } catch (err) {
      reasons.twilioAuth = sliceErr(err);
    }
  }

  let fromPass = false;
  if (!authPass || !client) {
    reasons.fromNumber = reasons.twilioAuth || "twilio_not_configured";
  } else {
    try {
      const nums = await client.incomingPhoneNumbers.list({ phoneNumber: from, limit: 5 });
      fromPass = nums.some((n) => normalizeE164(n.phoneNumber) === from);
      if (!fromPass) {
        reasons.fromNumber = `IncomingPhoneNumbers has no ${from} on this Account SID`;
      }
    } catch (err) {
      reasons.fromNumber = sliceErr(err);
    }
  }

  const callShapeOk =
    Boolean(from) &&
    constructedCall.method === "POST" &&
    constructedCall.url.includes("/twiml") &&
    constructedCall.url.includes(`clientId=${encodeURIComponent(DEMO_CLIENT_ID)}`);
  const callApiPass = authPass && callShapeOk;
  if (!callApiPass) {
    reasons.callApi = !authPass
      ? reasons.twilioAuth || "Twilio account fetch failed"
      : "constructed Calls.create payload is incomplete";
  }

  const webhookConfigured = publicBaseUrlConfigured(publicBase);
  let webhookPass = false;
  if (!webhookConfigured) {
    reasons.webhook =
      "PUBLIC_BASE_URL must be a public HTTPS URL of the voice-gateway (ngrok :8080), not example.ngrok";
  } else {
    const remote = await fetchGatewayHealth(publicBase);
    webhookPass = remote.reachable;
    if (!webhookPass) {
      reasons.webhook = remote.error || "PUBLIC_BASE_URL /health unreachable";
    }
  }

  const gwPort = Number(process.env.PORT) || 8080;
  let voiceGatewayPass = false;
  try {
    const res = await fetch(`http://127.0.0.1:${gwPort}/health`, { signal: AbortSignal.timeout(2000) });
    const body = (await res.json()) as { service?: string };
    voiceGatewayPass = res.ok && body.service === "voice-gateway";
    if (!voiceGatewayPass) {
      reasons.voiceGateway = `local :${gwPort}/health did not return voice-gateway`;
    }
  } catch (err) {
    reasons.voiceGateway = `local :${gwPort} ${sliceErr(err)} — start npm run dev:gateway`;
  }

  reasons.actualPhoneCall =
    "Not tested: Twilio calls.create always rings a destination. You asked not to place a real call.";

  return {
    ok: true,
    report: {
      twilioAuth: authPass ? "PASS" : "FAIL",
      fromNumber: fromPass ? "PASS" : "FAIL",
      callApi: callApiPass ? "PASS" : "FAIL",
      webhook: webhookPass ? "PASS" : "FAIL",
      voiceGateway: voiceGatewayPass ? "PASS" : "FAIL",
      actualPhoneCall: "NOT TESTED",
    },
    reasons,
    from,
    constructedCall,
    accountStatus,
    note: "Inbound routing on the live salon number is not changed by using it as outbound From.",
  };
}
