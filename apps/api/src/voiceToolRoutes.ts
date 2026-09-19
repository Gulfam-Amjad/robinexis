import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
  BLADES_HAIR_ID,
  isAiServiceEnabled,
  newId,
  structuredLog,
  type CallSession,
  type PlatformStore,
} from "@robinexis/database";
import {
  createToolExecutor,
  enqueueWhatsAppBookingConfirmation,
  enqueueWhatsAppCancellationFollowup,
  isPlausibleCustomerPhone,
  normalizeSpokenPhone,
  resolveMinuteAccess,
} from "@robinexis/integrations";
import type { ToolName } from "@robinexis/tool-contracts";

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
  tenantHeader?: string | string[],
): Promise<string | undefined> {
  const legacy = voiceToolClientId(header);
  if (legacy) return legacy;
  const value = Array.isArray(header) ? header[0] || "" : header || "";
  if (!value) return undefined;
  const tenantId = Array.isArray(tenantHeader) ? tenantHeader[0] || "" : tenantHeader || "";
  const runtimeSecret = process.env.VOICE_RUNTIME_INTERNAL_SECRET || "";
  if (tenantId && runtimeSecret) {
    const expected = createHmac("sha256", runtimeSecret)
      .update(`voice-tool:${tenantId}`)
      .digest("base64url");
    if (safeEqual(value, expected) && await store.getPublishedClient(tenantId)) return tenantId;
  }
  const hash = createHash("sha256").update(value).digest("hex");
  const agent = await store.getAgentInstanceByVoiceCredentialHash(hash);
  return agent?.status === "active" ? agent.clientId : undefined;
}

async function callFor(
  store: PlatformStore,
  clientId: string,
  conversationId: string,
): Promise<CallSession> {
  const existing = await store.getCallForClient(clientId, conversationId);
  if (existing) return existing;
  const now = new Date().toISOString();
  return {
    id: conversationId || newId("voice_call_"),
    clientId,
    direction: "inbound",
    objective: "Voice receptionist booking",
    promptVersionId: "provider-managed-voice",
    transcript: [],
    collected: {},
    toolHistory: [],
    state: "tool",
    status: "active",
    createdAt: now,
    updatedAt: now,
  };
}

function rememberTool(
  call: CallSession,
  name: ToolName,
  input: Record<string, unknown>,
  result: unknown,
): void {
  const at = new Date().toISOString();
  call.toolHistory.push({
    name,
    input,
    result,
    idempotencyKey: typeof input.idempotencyKey === "string" ? input.idempotencyKey : undefined,
    at,
  });
  if (input.eventTypeSlug) call.collected.eventTypeSlug = String(input.eventTypeSlug);
  if (input.start) call.collected.start = String(input.start);
  if (input.attendeeName) call.collected.attendeeName = String(input.attendeeName);
  if (input.attendeePhone) {
    const phone = normalizeSpokenPhone(String(input.attendeePhone));
    call.collected.attendeePhone = phone;
    call.contactPhone = phone;
  }
  if (input.attendeeEmail) call.collected.attendeeEmail = String(input.attendeeEmail);
  if (input.callerConfirmed === true) call.collected.callerConfirmed = true;
  const bookingUid = result && typeof result === "object"
    ? String((result as { bookingUid?: unknown; uid?: unknown }).bookingUid ||
      (result as { uid?: unknown }).uid || "")
    : "";
  if (bookingUid) {
    call.appointmentId = bookingUid;
    call.collected.bookingUid = bookingUid;
  }
  call.updatedAt = at;
}

function validRange(start: string, end: string): boolean {
  const from = Date.parse(start);
  const to = Date.parse(end);
  return Number.isFinite(from) && Number.isFinite(to) && to > from && to - from <= 14 * 86_400_000;
}

function phoneDiagnostics(phone: string): Record<string, unknown> {
  const normalized = normalizeSpokenPhone(phone);
  return {
    phoneDigitCount: normalized.replace(/\D/g, "").length,
    phoneCountry: normalized.startsWith("+44")
      ? "GB"
      : normalized.startsWith("+92")
        ? "PK"
        : "unknown",
    phonePlausible: isPlausibleCustomerPhone(normalized),
  };
}

function canonicalBookingKey(
  conversationId: string,
  eventTypeSlug: string,
  start: string,
  attendeeName: string,
  attendeePhone: string,
): string {
  const fingerprint = JSON.stringify({
    conversationId,
    eventTypeSlug,
    start: new Date(start).toISOString(),
    attendeeName: attendeeName.trim().toLowerCase(),
    attendeePhone,
  });
  return `voice-booking:${createHash("sha256").update(fingerprint).digest("hex")}`;
}

function bookingFailure(error: string): ToolResponse {
  if (error === "attendee_phone_invalid_ask_for_complete_number_from_beginning") {
    return {
      status: 400,
      body: {
        ok: false,
        error,
        recoveryAction: "ask_for_complete_phone_from_beginning",
        retryable: true,
      },
    };
  }
  if (error === "caller_confirmation_required") {
    return {
      status: 409,
      body: { ok: false, error, recoveryAction: "repeat_summary_and_confirm", retryable: true },
    };
  }
  if (error === "idempotent_action_in_progress") {
    return {
      status: 409,
      body: { ok: false, error, recoveryAction: "wait_then_retry_same_details", retryable: true },
    };
  }
  if (error === "calendar_not_configured" || error.startsWith("tenant_calendar_")) {
    return {
      status: 503,
      body: { ok: false, error: "calendar_not_configured", recoveryAction: "offer_callback", retryable: false },
    };
  }
  return {
    status: 503,
    body: {
      ok: false,
      error: "booking_temporarily_unavailable",
      recoveryAction: "retry_once_then_offer_callback",
      retryable: true,
    },
  };
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
  const minuteAccess = await resolveMinuteAccess(store, client, { mode: "access" });
  if (!minuteAccess.allowed) {
    return {
      status: 403,
      body: { ok: false, error: "service_unavailable", reason: minuteAccess.reason },
    };
  }
  if (!client.enabledFeatures.includes("booking")) {
    return { status: 403, body: { ok: false, error: "booking_not_enabled" } };
  }

  const eventTypeSlug = String(input.eventTypeSlug || "");
  const service = client.services.find((item) => item.slug === eventTypeSlug);
  if (!service) {
    return { status: 400, body: { ok: false, error: "unsupported_service" } };
  }
  const eventTypeMapping = (await store.listCalendarEventTypes(client.id))
    .find((item) => item.serviceSlug === eventTypeSlug && item.status === "active");
  const providerEventTypeSlug = eventTypeMapping?.providerSlug || eventTypeSlug;
  const providerEventTypeId = eventTypeMapping?.providerEventTypeId;

  const exec = createToolExecutor({ ...options, store });
  const conversationId = String(input.conversationId || "").trim();
  if (!conversationId) {
    return { status: 400, body: { ok: false, error: "missing_conversation_id" } };
  }
  const call = await callFor(store, client.id, conversationId);

  if (tool === "check-availability") {
    const start = String(input.start || "");
    const end = String(input.end || "");
    if (!validRange(start, end)) {
      return { status: 400, body: { ok: false, error: "invalid_date_range" } };
    }
    const result = await exec({
      name: "check_availability",
      input: { eventTypeSlug: providerEventTypeSlug, eventTypeId: providerEventTypeId, start, end },
      call,
      client,
    });
    if (!result.ok) {
      const safeError = "calendar_temporarily_unavailable";
      rememberTool(call, "check_availability", { eventTypeSlug, start, end }, { error: safeError });
      await store.saveCall(call);
      structuredLog("voice_booking_tool_completed", {
        clientId,
        conversationId,
        tool: "check_availability",
        status: "rejected",
        errorClass: safeError,
      });
      return { status: 503, body: { ok: false, error: safeError } };
    }
    rememberTool(call, "check_availability", {
      eventTypeSlug,
      start,
      end,
    }, result.data);
    const returnedSlots = (result.data as { slots?: unknown }).slots;
    call.collected.offeredSlots = Array.isArray(returnedSlots)
      ? returnedSlots.filter((slot): slot is string => typeof slot === "string")
      : [];
    call.collected.offeredEventTypeSlug = eventTypeSlug;
    await store.saveCall(call);
    structuredLog("voice_booking_tool_completed", {
      clientId,
      conversationId,
      tool: "check_availability",
      status: "ok",
      slotCount: (call.collected.offeredSlots as string[]).length,
    });
    return { status: 200, body: { ok: true, ...result.data as object } };
  }

  const requestedStart = String(input.start || "");
  const attendeeName = String(input.attendeeName || "").trim();
  const attendeePhone = normalizeSpokenPhone(String(input.attendeePhone || ""));
  if (!Number.isFinite(Date.parse(requestedStart)) || !attendeeName || !attendeePhone) {
    rememberTool(call, "create_booking", {
      eventTypeSlug,
      start: requestedStart,
      attendeeName,
      callerConfirmed: input.callerConfirmed === true,
    }, { error: "missing_booking_details" });
    await store.saveCall(call);
    return { status: 400, body: { ok: false, error: "missing_booking_details" } };
  }
  if (input.callerConfirmed !== true) {
    rememberTool(call, "create_booking", {
      eventTypeSlug,
      start: requestedStart,
      attendeeName,
      attendeePhone,
      callerConfirmed: false,
    }, { error: "caller_confirmation_required" });
    await store.saveCall(call);
    return { status: 409, body: { ok: false, error: "caller_confirmation_required" } };
  }

  if (!isPlausibleCustomerPhone(attendeePhone)) {
    const failure = bookingFailure("attendee_phone_invalid_ask_for_complete_number_from_beginning");
    rememberTool(call, "create_booking", {
      eventTypeSlug,
      start: requestedStart,
      attendeeName,
      attendeePhone,
      callerConfirmed: true,
    }, { error: failure.body.error });
    await store.saveCall(call);
    structuredLog("voice_booking_tool_completed", {
      clientId,
      conversationId,
      tool: "create_booking",
      status: "rejected",
      errorClass: failure.body.error,
      ...phoneDiagnostics(attendeePhone),
    });
    return failure;
  }

  const offeredSlots = Array.isArray(call.collected.offeredSlots)
    ? call.collected.offeredSlots.filter((slot): slot is string => typeof slot === "string")
    : [];
  const offeredService = String(call.collected.offeredEventTypeSlug || "");
  const canonicalStart = offeredSlots.find(
    (slot) => Date.parse(slot) === Date.parse(requestedStart),
  );
  if (!canonicalStart || offeredService !== eventTypeSlug) {
    const error = offeredSlots.length ? "slot_not_offered" : "availability_check_required";
    rememberTool(call, "create_booking", {
      eventTypeSlug,
      start: requestedStart,
      attendeeName,
      callerConfirmed: true,
    }, { error });
    await store.saveCall(call);
    structuredLog("voice_booking_tool_completed", {
      clientId,
      conversationId,
      tool: "create_booking",
      status: "rejected",
      errorClass: error,
      requestedStart,
      offeredSlotCount: offeredSlots.length,
    });
    return {
      status: 409,
      body: {
        ok: false,
        error,
        recoveryAction: "check_availability_and_offer_returned_slot",
        retryable: true,
      },
    };
  }

  const duration = service.durationMinutes || 30;
  const availability = await exec({
    name: "check_availability",
    input: {
      eventTypeSlug: providerEventTypeSlug,
      eventTypeId: providerEventTypeId,
      start: canonicalStart,
      end: new Date(Date.parse(canonicalStart) + duration * 60_000).toISOString(),
    },
    call,
    client,
  });
  if (!availability.ok) {
    const safeError = "calendar_temporarily_unavailable";
    rememberTool(call, "create_booking", {
      eventTypeSlug,
      start: canonicalStart,
      attendeeName,
      callerConfirmed: true,
    }, { error: safeError });
    await store.saveCall(call);
    structuredLog("voice_booking_tool_completed", {
      clientId,
      conversationId,
      tool: "create_booking",
      status: "rejected",
      errorClass: safeError,
      selectedStart: canonicalStart,
    });
    return { status: 503, body: { ok: false, error: safeError } };
  }
  const slots = (availability.data as { slots?: string[] }).slots || [];
  if (!slots.some((slot) => Date.parse(slot) === Date.parse(canonicalStart))) {
    rememberTool(call, "create_booking", {
      eventTypeSlug,
      start: canonicalStart,
      attendeeName,
      callerConfirmed: true,
    }, { error: "slot_no_longer_free" });
    await store.saveCall(call);
    structuredLog("voice_booking_tool_completed", {
      clientId,
      conversationId,
      tool: "create_booking",
      status: "rejected",
      errorClass: "slot_no_longer_free",
      selectedStart: canonicalStart,
    });
    return { status: 409, body: { ok: false, error: "slot_no_longer_free" } };
  }

  // Booking projections reference the source call. Availability checks remain
  // read-only and do not create dashboard call rows.
  await store.saveCall(call);
  const idempotencyKey = canonicalBookingKey(
    conversationId,
    eventTypeSlug,
    canonicalStart,
    attendeeName,
    attendeePhone,
  );
  const result = await exec({
    name: "create_booking",
    input: {
      eventTypeSlug: providerEventTypeSlug,
      eventTypeId: providerEventTypeId,
      start: canonicalStart,
      attendeeName,
      attendeePhone,
      attendeeEmail: String(input.attendeeEmail || "").trim() || undefined,
      attendeeTimeZone: String(input.attendeeTimeZone || "Europe/London"),
      notes: String(input.notes || ""),
      callerConfirmed: true,
      idempotencyKey,
    },
    call,
    client,
  });
  if (!result.ok) {
    const failure = bookingFailure(result.error || "booking_temporarily_unavailable");
    const safeError = String(failure.body.error || "booking_temporarily_unavailable");
    rememberTool(call, "create_booking", {
      eventTypeSlug,
      start: canonicalStart,
      attendeeName,
      attendeePhone,
      callerConfirmed: true,
      idempotencyKey,
    }, { error: safeError });
    await store.saveCall(call);
    structuredLog("voice_booking_tool_completed", {
      clientId,
      conversationId,
      tool: "create_booking",
      status: "rejected",
      errorClass: safeError,
      selectedStart: canonicalStart,
      ...phoneDiagnostics(attendeePhone),
    });
    return failure;
  }
  const booking = result.data as { uid?: string; status?: string };
  if (!booking.uid) {
    rememberTool(call, "create_booking", {
      eventTypeSlug,
      start: canonicalStart,
      attendeeName,
      attendeePhone,
      callerConfirmed: true,
      idempotencyKey,
    }, { error: "booking_not_confirmed" });
    await store.saveCall(call);
    structuredLog("voice_booking_tool_completed", {
      clientId,
      conversationId,
      tool: "create_booking",
      status: "rejected",
      errorClass: "booking_not_confirmed",
      selectedStart: canonicalStart,
    });
    return { status: 502, body: { ok: false, error: "booking_not_confirmed" } };
  }
  rememberTool(call, "create_booking", {
    eventTypeSlug,
    start: canonicalStart,
    attendeeName,
    attendeePhone,
    attendeeEmail: String(input.attendeeEmail || "").trim() || undefined,
    callerConfirmed: true,
    idempotencyKey,
  }, { bookingUid: booking.uid, bookingStatus: booking.status || "accepted" });
  await store.saveCall(call);
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
    idempotencyKey,
    status: "confirmed",
    startsAt: new Date(canonicalStart).toISOString(),
    endsAt: new Date(Date.parse(canonicalStart) + duration * 60_000).toISOString(),
    attendeeName,
    attendeePhone,
    attendeeEmail: String(input.attendeeEmail || "").trim() || undefined,
    serviceSlug: eventTypeSlug,
    metadata: { source: "provider_neutral_voice_tool" },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  try {
    await enqueueWhatsAppBookingConfirmation({
      store,
      clientId: client.id,
      attendeePhone,
      bookingUid: booking.uid,
      startsAt: new Date(canonicalStart).toISOString(),
    });
  } catch {
    // Booking is already durable. A WhatsApp outbox failure must not change the response.
  }
  structuredLog("voice_booking_tool_completed", {
    clientId,
    conversationId,
    tool: "create_booking",
    status: "ok",
    selectedStart: canonicalStart,
    bookingUid: booking.uid,
    ...phoneDiagnostics(attendeePhone),
  });
  return {
    status: 200,
    body: { ok: true, bookingUid: booking.uid, bookingStatus: booking.status || "accepted" },
  };
}

export async function runVoiceContractTool(
  store: PlatformStore,
  tool: ToolName,
  input: Record<string, unknown>,
  options: Parameters<typeof createToolExecutor>[0] & { clientId: string },
): Promise<ToolResponse> {
  if (tool === "check_availability" || tool === "create_booking") {
    return runVoiceTool(
      store,
      tool === "check_availability" ? "check-availability" : "create-booking",
      input,
      options,
    );
  }
  const client = await store.getPublishedClient(options.clientId);
  if (!client) return { status: 404, body: { ok: false, error: "client_not_found" } };
  const access = isAiServiceEnabled(client);
  if (!access.inbound) {
    return { status: 403, body: { ok: false, error: "service_unavailable", reason: access.reason } };
  }
  const minuteAccess = await resolveMinuteAccess(store, client, { mode: "access" });
  if (!minuteAccess.allowed) {
    return {
      status: 403,
      body: { ok: false, error: "service_unavailable", reason: minuteAccess.reason },
    };
  }
  const conversationId = String(input.conversationId || "").trim();
  if (!conversationId) return { status: 400, body: { ok: false, error: "missing_conversation_id" } };

  const call = await callFor(store, client.id, conversationId);
  await store.saveCall(call);
  const result = await createToolExecutor({ ...options, store })({
    name: tool,
    input,
    call,
    client,
  });
  if (result.ok && tool === "cancel_booking") {
    const bookingUid = String(input.bookingUid || "");
    const booking = (await store.listBookingRecords(client.id))
      .find((item) => item.providerBookingId === bookingUid);
    if (booking) {
      booking.status = "cancelled";
      booking.updatedAt = new Date().toISOString();
      await store.saveBookingRecord(booking);
      if (booking.attendeePhone) {
        try {
          await enqueueWhatsAppCancellationFollowup({
            store,
            clientId: client.id,
            attendeePhone: booking.attendeePhone,
            bookingUid,
          });
        } catch {
          // The provider cancellation succeeded; messaging must not change the tool result.
        }
      }
    }
  }
  rememberTool(call, tool, input, result.ok ? result.data : { error: result.error });
  await store.saveCall(call);
  return result.ok
    ? { status: 200, body: { ok: true, ...result.data as object } }
    : { status: 503, body: { ok: false, error: result.error || "voice_tool_failed" } };
}
