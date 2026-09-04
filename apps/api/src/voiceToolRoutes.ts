import { createHash, timingSafeEqual } from "node:crypto";
import {
  BLADES_HAIR_ID,
  isAiServiceEnabled,
  newId,
  type CallSession,
  type PlatformStore,
} from "@robinexis/database";
import {
  createToolExecutor,
  normalizeSpokenPhone,
} from "@robinexis/integrations";

type ToolResponse = { status: number; body: Record<string, unknown> };

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function voiceToolAuthorized(
  header: string | string[] | undefined,
  secret = process.env.VOICE_TOOL_SECRET || "",
): boolean {
  const value = Array.isArray(header) ? header[0] || "" : header || "";
  return Boolean(secret && value && safeEqual(value, secret));
}

export function voiceToolClientId(
  header: string | string[] | undefined,
  legacySecret = process.env.VOICE_TOOL_SECRET || "",
  tenantSecretsJson = process.env.VOICE_TOOL_SECRETS_JSON || "",
): string | undefined {
  const value = Array.isArray(header) ? header[0] || "" : header || "";
  if (!value) return undefined;
  if (legacySecret && safeEqual(value, legacySecret)) return BLADES_HAIR_ID;
  if (!tenantSecretsJson) return undefined;
  try {
    const secrets = JSON.parse(tenantSecretsJson) as Record<string, string>;
    return Object.entries(secrets).find(([, secret]) => secret && safeEqual(value, secret))?.[0];
  } catch {
    return undefined;
  }
}

export async function voiceToolClientIdForRequest(
  store: PlatformStore,
  header: string | string[] | undefined,
): Promise<string | undefined> {
  const legacy = voiceToolClientId(header);
  if (legacy) return legacy;
  const value = Array.isArray(header) ? header[0] || "" : header || "";
  if (!value) return undefined;
  const hash = createHash("sha256").update(value).digest("hex");
  const agent = await store.getAgentInstanceByVoiceCredentialHash(hash);
  return agent?.status === "active" ? agent.clientId : undefined;
}

function callFor(clientId: string, conversationId: string): CallSession {
  const now = new Date().toISOString();
  return {
    id: conversationId || newId("el_call_"),
    clientId,
    direction: "inbound",
    objective: "ElevenLabs receptionist booking",
    promptVersionId: "elevenlabs-convai",
    transcript: [],
    collected: {},
    toolHistory: [],
    state: "tool",
    status: "active",
    createdAt: now,
    updatedAt: now,
  };
}

function validRange(start: string, end: string): boolean {
  const from = Date.parse(start);
  const to = Date.parse(end);
  return Number.isFinite(from) && Number.isFinite(to) && to > from && to - from <= 14 * 86_400_000;
}

export async function runVoiceTool(
  store: PlatformStore,
  tool: "check-availability" | "create-booking",
  input: Record<string, unknown>,
  options: Parameters<typeof createToolExecutor>[0] & { clientId?: string } = { store },
): Promise<ToolResponse> {
  const clientId = options.clientId || BLADES_HAIR_ID;
  const client = await store.getPublishedClient(clientId);
  if (!client) {
    return { status: 404, body: { ok: false, error: "client_not_found" } };
  }
  const access = isAiServiceEnabled(client);
  if (!access.inbound) {
    return {
      status: 403,
      body: { ok: false, error: "service_unavailable", reason: access.reason },
    };
  }
  const subscription = await store.getCurrentSubscription(client.id);
  if (
    subscription?.status === "trialing" &&
    subscription.trialEndsAt &&
    Date.parse(subscription.trialEndsAt) <= Date.now()
  ) {
    return {
      status: 403,
      body: { ok: false, error: "service_unavailable", reason: "trial_expired" },
    };
  }
  if (!client.enabledFeatures.includes("booking")) {
    return { status: 403, body: { ok: false, error: "booking_not_enabled" } };
  }

  const eventTypeSlug = String(input.eventTypeSlug || "");
  if (!client.services.some((service) => service.slug === eventTypeSlug)) {
    return { status: 400, body: { ok: false, error: "unsupported_service" } };
  }

  const exec = createToolExecutor({ ...options, store });
      const conversationId = String(input.conversationId || "").trim();
      if (!conversationId) {
        return { status: 400, body: { ok: false, error: "missing_conversation_id" } };
      }
  const call = callFor(client.id, conversationId);

  if (tool === "check-availability") {
    const start = String(input.start || "");
    const end = String(input.end || "");
    if (!validRange(start, end)) {
      return { status: 400, body: { ok: false, error: "invalid_date_range" } };
    }
    const result = await exec({
      name: "check_availability",
      input: { eventTypeSlug, start, end },
      call,
      client,
    });
    if (!result.ok) {
      return { status: 503, body: { ok: false, error: "calendar_temporarily_unavailable" } };
    }
    return { status: 200, body: { ok: true, ...result.data as object } };
  }

  const start = String(input.start || "");
  const attendeeName = String(input.attendeeName || "").trim();
  const attendeePhone = normalizeSpokenPhone(String(input.attendeePhone || ""));
      if (!Number.isFinite(Date.parse(start)) || !attendeeName || !attendeePhone) {
    return { status: 400, body: { ok: false, error: "missing_booking_details" } };
  }
  if (input.callerConfirmed !== true) {
    return { status: 409, body: { ok: false, error: "caller_confirmation_required" } };
  }

  const duration = client.services.find((service) => service.slug === eventTypeSlug)?.durationMinutes || 30;
  const availability = await exec({
    name: "check_availability",
    input: {
      eventTypeSlug,
      start,
      end: new Date(Date.parse(start) + duration * 60_000).toISOString(),
    },
    call,
    client,
  });
  if (!availability.ok) {
    return { status: 503, body: { ok: false, error: "calendar_temporarily_unavailable" } };
  }
  const slots = (availability.data as { slots?: string[] }).slots || [];
  if (!slots.some((slot) => Date.parse(slot) === Date.parse(start))) {
    return { status: 409, body: { ok: false, error: "slot_no_longer_free" } };
  }

  // Booking projections reference the source call. Availability checks remain
  // read-only and do not create dashboard call rows.
  await store.saveCall(call);
  const result = await exec({
    name: "create_booking",
    input: {
      eventTypeSlug,
      start,
      attendeeName,
      attendeePhone,
      attendeeEmail: String(input.attendeeEmail || "").trim() || undefined,
      attendeeTimeZone: String(input.attendeeTimeZone || "Europe/London"),
      notes: String(input.notes || ""),
      callerConfirmed: true,
      idempotencyKey: String(input.idempotencyKey || `${conversationId}:${eventTypeSlug}:${start}`),
    },
    call,
    client,
  });
  if (!result.ok) {
    return { status: 503, body: { ok: false, error: "booking_temporarily_unavailable" } };
  }
  const booking = result.data as { uid?: string; status?: string };
  if (!booking.uid) {
    return { status: 502, body: { ok: false, error: "booking_not_confirmed" } };
  }
  const calendarConnection = (await store.listCalendarConnections(client.id))
    .find((connection) => connection.status !== "disabled");
  const bookingId = `booking_${createHash("sha256")
    .update(`${client.id}:${booking.uid}`)
    .digest("hex")
    .slice(0, 24)}`;
  await store.saveBookingRecord({
    id: bookingId,
    clientId: client.id,
    locationId: calendarConnection?.locationId,
    calendarConnectionId: calendarConnection?.id,
    callId: conversationId,
    provider: client.calendar.provider,
    providerBookingId: booking.uid,
    idempotencyKey: String(input.idempotencyKey || `${conversationId}:${eventTypeSlug}:${start}`),
    status: "confirmed",
    startsAt: new Date(start).toISOString(),
    endsAt: new Date(Date.parse(start) + duration * 60_000).toISOString(),
    attendeeName,
    attendeePhone,
    attendeeEmail: String(input.attendeeEmail || "").trim() || undefined,
    serviceSlug: eventTypeSlug,
    metadata: { source: "elevenlabs_voice_tool" },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return {
    status: 200,
    body: { ok: true, bookingUid: booking.uid, bookingStatus: booking.status || "accepted" },
  };
}
