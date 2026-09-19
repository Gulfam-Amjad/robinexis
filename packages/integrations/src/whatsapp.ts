import {
  newId,
  type MessageEvent,
  type MessageSession,
  type PlatformStore,
} from "@robinexis/database";
import { messageAllowancePeriod } from "./messageAllowance.js";
import { enqueueWhatsAppNotification } from "./notificationQueue.js";
import { planDefinition } from "./plans.js";
import { validateTwilioWebhook } from "./twilioOutbound.js";
import { ENABLE_MANAGED_WHATSAPP } from "./whatsappProvisioning.js";

const STOP_WORDS = new Set(["STOP", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]);
const START_WORDS = new Set(["START", "UNSTOP"]);
const HELP_WORDS = new Set(["HELP", "INFO"]);

export function formatWhatsAppAppointmentTime(startsAt: string): string {
  const ms = Date.parse(startsAt);
  if (!Number.isFinite(ms)) return startsAt;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(new Date(ms));
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value || "";
  const dayPeriod = value("dayPeriod").replace(/\./g, "").toUpperCase();
  return `${value("hour")}:${value("minute")} ${dayPeriod}, ${value("weekday")} ${value("day")} ${value("month")}`;
}

export function normalizeWhatsAppAddress(value: string): string | undefined {
  const raw = value.trim().toLowerCase().startsWith("whatsapp:")
    ? value.trim().slice("whatsapp:".length)
    : value.trim();
  const digits = raw.replace(/[^\d+]/g, "");
  if (!/^\+[1-9]\d{7,14}$/.test(digits)) return undefined;
  return `whatsapp:${digits}`;
}

function configuredSenders(): Record<string, string> {
  try {
    const parsed = JSON.parse(process.env.WHATSAPP_MANAGED_SENDERS_JSON || "{}") as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).flatMap(([address, clientId]) => {
      const normalized = normalizeWhatsAppAddress(address);
      return normalized && typeof clientId === "string" && clientId
        ? [[normalized, clientId]]
        : [];
    }));
  } catch {
    return {};
  }
}

export async function resolveManagedWhatsAppTenant(
  store: PlatformStore,
  sender: string,
): Promise<{ clientId: string; sender: string } | undefined> {
  const normalized = normalizeWhatsAppAddress(sender);
  if (!normalized) return undefined;
  const configuredClientId = configuredSenders()[normalized];
  const clients = configuredClientId
    ? [await store.getClient(configuredClientId)].filter(Boolean)
    : await store.listClients();
  const matches: string[] = [];
  for (const client of clients) {
    if (!client || client.phoneAcquisitionMode !== "robinexis_account") continue;
    const endpoints = await store.listPhoneEndpoints(client.id);
    const endpointMatch = endpoints.some((endpoint) =>
      endpoint.provider === "twilio" &&
      endpoint.status === "active" &&
      normalizeWhatsAppAddress(String(endpoint.metadata.whatsappSender || endpoint.e164)) === normalized &&
      (endpoint.metadata.whatsappEnabled === true || endpoint.metadata.channel === "whatsapp"));
    const resources = await store.listProviderResources(client.id);
    const resourceMatch = resources.some((resource) =>
      resource.provider === "twilio" &&
      resource.resourceType === "whatsapp_sender" &&
      resource.lifecycleStatus === "active" &&
      normalizeWhatsAppAddress(String(resource.metadata.address || resource.providerResourceId || "")) === normalized);
    if ((configuredClientId === client.id && (endpointMatch || resourceMatch)) || resourceMatch || endpointMatch) {
      matches.push(client.id);
    }
  }
  return matches.length === 1 ? { clientId: matches[0], sender: normalized } : undefined;
}

function commandFor(body: string): "stop" | "start" | "help" | "message" {
  const word = body.trim().split(/\s+/, 1)[0]?.toUpperCase() || "";
  if (STOP_WORDS.has(word)) return "stop";
  if (START_WORDS.has(word)) return "start";
  if (HELP_WORDS.has(word)) return "help";
  return "message";
}

export function validateManagedWhatsAppWebhook(input: {
  signature: string;
  pathname: string;
  search: string;
  params: Record<string, string>;
}): { ok: boolean; error?: "whatsapp_webhook_not_configured" | "invalid_signature"; signedUrl?: string } {
  const token = process.env.TWILIO_AUTH_TOKEN?.trim();
  const base = process.env.API_PUBLIC_BASE_URL?.trim().replace(/\/$/, "");
  if (process.env.WHATSAPP_ENABLED === "true" && (!token || !base)) {
    return { ok: false, error: "whatsapp_webhook_not_configured" };
  }
  if (!token || !base) return { ok: false, error: "whatsapp_webhook_not_configured" };
  let signedUrl: string;
  try {
    const publicBase = new URL(base);
    if (publicBase.protocol !== "https:" || publicBase.pathname !== "/") {
      return { ok: false, error: "whatsapp_webhook_not_configured" };
    }
    signedUrl = `${base}${input.pathname}${input.search}`;
  } catch {
    return { ok: false, error: "whatsapp_webhook_not_configured" };
  }
  return validateTwilioWebhook(input.signature, signedUrl, input.params)
    ? { ok: true, signedUrl }
    : { ok: false, error: "invalid_signature", signedUrl };
}

export async function ingestManagedWhatsApp(input: {
  store: PlatformStore;
  params: URLSearchParams;
  now?: string;
}): Promise<{
  status: number;
  body: { ok?: true; error?: string; replay?: boolean; eventId?: string };
}> {
  if (process.env.WHATSAPP_ENABLED !== "true") {
    return { status: 503, body: { error: "whatsapp_disabled" } };
  }
  const from = normalizeWhatsAppAddress(input.params.get("From") || "");
  const managed = await resolveManagedWhatsAppTenant(input.store, input.params.get("To") || "");
  const messageSid = input.params.get("MessageSid") || input.params.get("SmsMessageSid") || "";
  if (!from || !managed || !messageSid) {
    return { status: 404, body: { error: "managed_sender_not_found" } };
  }
  const entitlement = await input.store.getTenantFeatureEntitlements(managed.clientId);
  if (!entitlement?.whatsappEnabled) {
    return { status: 403, body: { error: "whatsapp_not_entitled" } };
  }
  const existing = await input.store.findMessageEventByProviderId(managed.clientId, "twilio", messageSid);
  if (existing) return { status: 200, body: { ok: true, replay: true, eventId: existing.id } };

  const now = input.now || new Date().toISOString();
  const body = input.params.get("Body") || "";
  const command = commandFor(body);
  let session = await input.store.findMessageSession(managed.clientId, "whatsapp", from, managed.sender);
  if (!session) {
    session = await input.store.getOrCreateMessageSession({
      id: newId("message_session_"),
      clientId: managed.clientId,
      channel: "whatsapp",
      contactAddress: from,
      senderAddress: managed.sender,
      status: "active",
      state: {},
      createdAt: now,
      updatedAt: now,
    });
  }
  session.status = command === "stop" ? "opted_out" : command === "start" ? "active" : session.status;
  if (command !== "stop") {
    session.serviceWindowExpiresAt = new Date(Date.parse(now) + 24 * 60 * 60 * 1000).toISOString();
  }
  session.state = { ...session.state, lastInboundMessageSid: messageSid, lastCommand: command };
  session.updatedAt = now;
  await input.store.saveMessageSession(session);

  const event: MessageEvent = {
    id: newId("message_event_"),
    clientId: managed.clientId,
    sessionId: session.id,
    channel: "whatsapp",
    direction: "inbound",
    provider: "twilio",
    providerMessageId: messageSid,
    idempotencyKey: `twilio:inbound:${messageSid}`,
    status: "received",
    body,
    billableUnits: 1,
    metadata: { command, numMedia: Number(input.params.get("NumMedia") || 0) },
    occurredAt: now,
    createdAt: now,
  };
  let reservation: "reserved" | "duplicate" | "exhausted" = "exhausted";
  let period;
  try {
    period = await messageAllowancePeriod(
      input.store, managed.clientId, "whatsapp", new Date(now),
    );
  } catch {
    return { status: 503, body: { error: "message_billing_unavailable" } };
  }
  if (period) reservation = await input.store.reserveMessageEventAllowance(event, period, true);
  if (reservation === "duplicate") {
    return { status: 200, body: { ok: true, replay: true } };
  }

  const complianceReply = command === "stop"
    ? "You are unsubscribed from Robinexis WhatsApp messages. Reply START to opt back in."
    : command === "start"
      ? "You are subscribed to Robinexis WhatsApp messages again. Reply HELP for help or STOP to opt out."
      : command === "help"
        ? "Robinexis sends service messages for this business. Reply STOP to opt out or START to opt back in."
        : undefined;
  if (complianceReply) {
    await enqueueWhatsAppNotification({
      store: input.store,
      clientId: managed.clientId,
      operationId: `whatsapp_compliance_${messageSid}`,
      idempotencyKey: `whatsapp:compliance:${messageSid}`,
      to: from,
      from: managed.sender,
      template: complianceReply,
      sessionId: session.id,
      complianceOverride: true,
      now,
    });
  }
  return { status: 200, body: { ok: true, eventId: event.id } };
}

export async function applyManagedWhatsAppStatus(input: {
  store: PlatformStore;
  clientId: string;
  notificationId: string;
  params: URLSearchParams;
  now?: string;
}): Promise<{ status: number; body: { ok?: true; error?: string } }> {
  const notification = await input.store.getNotification(input.clientId, input.notificationId);
  const messageSid = input.params.get("MessageSid") || "";
  if (!notification || notification.channel !== "whatsapp" || !messageSid ||
      (notification.providerId && notification.providerId !== messageSid)) {
    return { status: 404, body: { error: "message_not_found" } };
  }
  const providerStatus = (input.params.get("MessageStatus") || "failed").toLowerCase();
  const eventStatus = providerStatus === "delivered" || providerStatus === "read"
    ? "delivered"
    : providerStatus === "failed" || providerStatus === "undelivered"
      ? "failed"
      : "sent";
  const updated = await input.store.updateMessageEventProviderStatus(
    input.clientId,
    `notification:${notification.idempotencyKey}`,
    messageSid,
    eventStatus,
    {
      providerStatus,
      errorCode: input.params.get("ErrorCode") || undefined,
      errorMessage: input.params.get("ErrorMessage") || undefined,
    },
    input.now || new Date().toISOString(),
  );
  return updated
    ? { status: 200, body: { ok: true } }
    : { status: 404, body: { error: "message_not_found" } };
}

export type WhatsAppInboundProcessor = (
  event: MessageEvent,
  session: MessageSession,
) => Promise<void>;

export async function resolveUniqueManagedWhatsAppSender(
  store: PlatformStore,
  clientId: string,
): Promise<string | undefined> {
  const client = await store.getClient(clientId);
  if (!client || client.phoneAcquisitionMode !== "robinexis_account") return undefined;
  const candidates = new Set<string>();
  for (const [address, mapped] of Object.entries(configuredSenders())) {
    if (mapped === clientId) candidates.add(address);
  }
  for (const endpoint of await store.listPhoneEndpoints(clientId)) {
    if (endpoint.provider !== "twilio" || endpoint.status !== "active") continue;
    if (endpoint.metadata.whatsappEnabled !== true && endpoint.metadata.channel !== "whatsapp") continue;
    const address = normalizeWhatsAppAddress(String(endpoint.metadata.whatsappSender || endpoint.e164));
    if (address) candidates.add(address);
  }
  for (const resource of await store.listProviderResources(clientId)) {
    if (
      resource.provider !== "twilio" ||
      resource.resourceType !== "whatsapp_sender" ||
      resource.lifecycleStatus !== "active"
    ) continue;
    const address = normalizeWhatsAppAddress(
      String(resource.metadata.address || resource.providerResourceId || ""),
    );
    if (address) candidates.add(address);
  }
  const unique: string[] = [];
  for (const sender of candidates) {
    const resolved = await resolveManagedWhatsAppTenant(store, sender);
    if (resolved?.clientId === clientId) unique.push(resolved.sender);
  }
  return unique.length === 1 ? unique[0] : undefined;
}

export async function configureManagedWhatsAppSender(input: {
  store: PlatformStore;
  clientId: string;
  sender: string;
  actorId: string;
  confirmation?: string;
  now?: string;
}): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const sender = normalizeWhatsAppAddress(input.sender);
  if (!sender) return { ok: false, status: 400, error: "valid_whatsapp_sender_required" };
  if (input.confirmation !== ENABLE_MANAGED_WHATSAPP) {
    return { ok: false, status: 409, error: "managed_whatsapp_confirmation_required" };
  }
  const client = await input.store.getClient(input.clientId);
  if (!client) return { ok: false, status: 404, error: "client_not_found" };
  const subscription = await input.store.getCurrentSubscription(input.clientId);
  if (!subscription ||
      (subscription.status !== "active" && subscription.status !== "trialing") ||
      planDefinition(subscription.planTier).includedMessages <= 0) {
    return { ok: false, status: 409, error: "whatsapp_pro_subscription_required" };
  }
  for (const otherClient of await input.store.listClients()) {
    if (otherClient.id === input.clientId) continue;
    const collision = (await input.store.listProviderResources(otherClient.id)).some((item) =>
      item.provider === "twilio" &&
      item.resourceType === "whatsapp_sender" &&
      item.lifecycleStatus !== "deleted" &&
      normalizeWhatsAppAddress(String(item.metadata.address || item.providerResourceId || "")) === sender);
    if (collision) return { ok: false, status: 409, error: "whatsapp_sender_already_assigned" };
  }
  const now = input.now || new Date().toISOString();
  const existingResource = (await input.store.listProviderResources(input.clientId)).find((item) =>
    item.provider === "twilio" && item.resourceType === "whatsapp_sender");
  await input.store.upsertProviderResource({
    id: existingResource?.id || `provider_twilio_whatsapp_${input.clientId}`,
    clientId: input.clientId,
    provider: "twilio",
    resourceType: "whatsapp_sender",
    providerResourceId: sender,
    lifecycleStatus: "active",
    metadata: { ...existingResource?.metadata, address: sender },
    createdAt: existingResource?.createdAt || now,
    updatedAt: now,
  });
  await input.store.upsertClient({ ...client, phoneAcquisitionMode: "robinexis_account" });
  const existingFeatures = await input.store.getTenantFeatureEntitlements(input.clientId);
  await input.store.upsertTenantFeatureEntitlements({
    clientId: input.clientId,
    whatsappEnabled: true,
    autoMinuteBlocksEnabled: existingFeatures?.autoMinuteBlocksEnabled ?? false,
    createdAt: existingFeatures?.createdAt || now,
    updatedAt: now,
  });
  await input.store.appendOperatorAudit({
    id: newId("audit_"),
    clientId: input.clientId,
    actorId: input.actorId,
    action: "whatsapp.managed_sender_configured",
    detail: { senderConfigured: true },
    createdAt: now,
  });
  return { ok: true };
}

export async function managedWhatsAppReadiness(input: {
  store: PlatformStore;
  clientId: string;
}) {
  const [features, resources, endpoints] = await Promise.all([
    input.store.getTenantFeatureEntitlements(input.clientId),
    input.store.listProviderResources(input.clientId),
    input.store.listPhoneEndpoints(input.clientId),
  ]);
  const resource = resources.find((item) =>
    item.provider === "twilio" && item.resourceType === "whatsapp_sender");
  const endpoint = endpoints.find((item) =>
    item.provider === "twilio" &&
    (item.metadata.whatsappEnabled === true || item.metadata.channel === "whatsapp"));
  const configured = Boolean(resource || endpoint);
  const senderStatus = resource
    ? resource.lifecycleStatus === "active" ? "active"
      : resource.lifecycleStatus === "failed" ? "failed" : "pending"
    : endpoint
      ? endpoint.status === "active" ? "active"
        : endpoint.status === "failed" ? "failed" : "pending"
      : "not_configured";
  const bookingConfirmationConfigured =
    Boolean(process.env.WHATSAPP_BOOKING_CONFIRMATION_CONTENT_SID?.trim());
  const bookingReminderConfigured =
    Boolean(process.env.WHATSAPP_BOOKING_REMINDER_CONTENT_SID?.trim());
  const cancellationFollowupConfigured =
    Boolean(process.env.WHATSAPP_CANCELLATION_FOLLOWUP_CONTENT_SID?.trim());
  const outsideWindowConfigured =
    Boolean(process.env.WHATSAPP_OUTSIDE_WINDOW_CONTENT_SID?.trim());
  const configuredTemplateCount = [
    bookingConfirmationConfigured,
    bookingReminderConfigured,
    cancellationFollowupConfigured,
    outsideWindowConfigured,
  ].filter(Boolean).length;
  const globallyEnabled = process.env.WHATSAPP_ENABLED === "true";
  const tenantEnabled = features?.whatsappEnabled ?? false;
  return {
    clientId: input.clientId,
    sender: {
      status: senderStatus,
      configured,
      updatedAt: resource?.updatedAt || endpoint?.updatedAt,
    },
    templates: {
      status: configuredTemplateCount === 4
        ? "configured"
        : configuredTemplateCount > 0 ? "partial" : "not_configured",
      bookingConfirmationConfigured,
      bookingReminderConfigured,
      cancellationFollowupConfigured,
      outsideWindowConfigured,
    },
    runtime: {
      status: globallyEnabled && tenantEnabled && senderStatus === "active" ? "active" : "disabled",
      globallyEnabled,
      tenantEnabled,
    },
  };
}

export async function enqueueWhatsAppBookingConfirmation(input: {
  store: PlatformStore;
  clientId: string;
  attendeePhone: string;
  bookingUid: string;
  startsAt?: string;
  now?: string;
}): Promise<{ queued: boolean; skipped?: string }> {
  const contentSid = process.env.WHATSAPP_BOOKING_CONFIRMATION_CONTENT_SID?.trim();
  if (process.env.WHATSAPP_ENABLED !== "true") return { queued: false, skipped: "whatsapp_disabled" };
  if (!contentSid) return { queued: false, skipped: "booking_template_missing" };
  const entitlement = await input.store.getTenantFeatureEntitlements(input.clientId);
  if (!entitlement?.whatsappEnabled) return { queued: false, skipped: "whatsapp_not_entitled" };
  const contact = normalizeWhatsAppAddress(input.attendeePhone);
  if (!contact) return { queued: false, skipped: "attendee_phone_invalid" };
  const sender = await resolveUniqueManagedWhatsAppSender(input.store, input.clientId);
  if (!sender) return { queued: false, skipped: "managed_sender_not_unique" };

  const now = input.now || new Date().toISOString();
  let session = await input.store.findMessageSession(input.clientId, "whatsapp", contact, sender);
  if (!session) {
    session = {
      id: newId("message_session_"),
      clientId: input.clientId,
      channel: "whatsapp",
      contactAddress: contact,
      senderAddress: sender,
      status: "active",
      state: { source: "voice_booking" },
      createdAt: now,
      updatedAt: now,
    };
    await input.store.saveMessageSession(session);
  }
  if (session.status === "opted_out") return { queued: false, skipped: "recipient_opted_out" };

  const queued = await enqueueWhatsAppNotification({
    store: input.store,
    clientId: input.clientId,
    operationId: `whatsapp_booking_${input.bookingUid}`,
    idempotencyKey: `whatsapp:booking:${input.bookingUid}`,
    to: contact,
    from: sender,
    template: process.env.WHATSAPP_BOOKING_CONFIRMATION_TEMPLATE_TEXT || "Your booking is confirmed.",
    sessionId: session.id,
    contentSid,
    contentVariables: { "1": input.bookingUid },
    now,
  });
  if (input.startsAt) {
    await enqueueWhatsAppBookingReminder({
      store: input.store,
      clientId: input.clientId,
      attendeePhone: input.attendeePhone,
      bookingUid: input.bookingUid,
      startsAt: input.startsAt,
      now,
    });
  }
  return { queued: queued.queued };
}

function configuredDelayHours(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export async function enqueueWhatsAppBookingReminder(input: {
  store: PlatformStore;
  clientId: string;
  attendeePhone: string;
  bookingUid: string;
  startsAt: string;
  now?: string;
}): Promise<{ queued: boolean; skipped?: string }> {
  if (process.env.WHATSAPP_ENABLED !== "true") return { queued: false, skipped: "whatsapp_disabled" };
  const contentSid = process.env.WHATSAPP_BOOKING_REMINDER_CONTENT_SID?.trim();
  if (!contentSid) return { queued: false, skipped: "reminder_template_missing" };
  const entitlement = await input.store.getTenantFeatureEntitlements(input.clientId);
  if (!entitlement?.whatsappEnabled) return { queued: false, skipped: "whatsapp_not_entitled" };
  const contact = normalizeWhatsAppAddress(input.attendeePhone);
  if (!contact) return { queued: false, skipped: "attendee_phone_invalid" };
  const sender = await resolveUniqueManagedWhatsAppSender(input.store, input.clientId);
  if (!sender) return { queued: false, skipped: "managed_sender_not_unique" };
  const now = input.now || new Date().toISOString();
  const startsAtMs = Date.parse(input.startsAt);
  const reminderAtMs = startsAtMs -
    configuredDelayHours("WHATSAPP_BOOKING_REMINDER_LEAD_HOURS", 1) * 60 * 60 * 1000;
  if (!Number.isFinite(startsAtMs) || reminderAtMs <= Date.parse(now)) {
    return { queued: false, skipped: "reminder_time_elapsed" };
  }
  const session = await input.store.findMessageSession(input.clientId, "whatsapp", contact, sender);
  if (!session || session.status !== "active") {
    return { queued: false, skipped: "message_session_unavailable" };
  }
  const queued = await input.store.enqueueScheduledFollowup({
    id: newId("followup_"),
    clientId: input.clientId,
    sessionId: session.id,
    channel: "whatsapp",
    recipient: contact,
    template: process.env.WHATSAPP_BOOKING_REMINDER_TEMPLATE_TEXT || "Reminder: your appointment is coming up.",
    idempotencyKey: `whatsapp:reminder:${input.bookingUid}`,
    payload: {
      contentSid,
      contentVariables: { "1": formatWhatsAppAppointmentTime(input.startsAt), "2": input.bookingUid },
      bookingUid: input.bookingUid,
      kind: "booking_reminder",
    },
    status: "pending",
    scheduledAt: new Date(reminderAtMs).toISOString(),
    attemptCount: 0,
    maxAttempts: 5,
    createdAt: now,
    updatedAt: now,
  });
  return queued ? { queued: true } : { queued: false, skipped: "duplicate" };
}

export async function enqueueWhatsAppCancellationFollowup(input: {
  store: PlatformStore;
  clientId: string;
  attendeePhone: string;
  bookingUid: string;
  now?: string;
}): Promise<{ queued: boolean; skipped?: string }> {
  const now = input.now || new Date().toISOString();
  for (const followup of await input.store.listScheduledFollowups(input.clientId)) {
    if (followup.idempotencyKey === `whatsapp:reminder:${input.bookingUid}` &&
        followup.status === "pending") {
      followup.status = "cancelled";
      followup.updatedAt = now;
      await input.store.saveScheduledFollowup(followup);
    }
  }
  if (process.env.WHATSAPP_ENABLED !== "true") return { queued: false, skipped: "whatsapp_disabled" };
  const contentSid = process.env.WHATSAPP_CANCELLATION_FOLLOWUP_CONTENT_SID?.trim();
  if (!contentSid) return { queued: false, skipped: "cancellation_template_missing" };
  const entitlement = await input.store.getTenantFeatureEntitlements(input.clientId);
  if (!entitlement?.whatsappEnabled) return { queued: false, skipped: "whatsapp_not_entitled" };
  const contact = normalizeWhatsAppAddress(input.attendeePhone);
  if (!contact) return { queued: false, skipped: "attendee_phone_invalid" };
  const sender = await resolveUniqueManagedWhatsAppSender(input.store, input.clientId);
  if (!sender) return { queued: false, skipped: "managed_sender_not_unique" };
  const session = await input.store.findMessageSession(input.clientId, "whatsapp", contact, sender);
  if (!session || session.status !== "active") {
    return { queued: false, skipped: "message_session_unavailable" };
  }
  const scheduledAt = new Date(
    Date.parse(now) + configuredDelayHours("WHATSAPP_CANCELLATION_FOLLOWUP_DELAY_HOURS", 1) * 60 * 60 * 1000,
  ).toISOString();
  const queued = await input.store.enqueueScheduledFollowup({
    id: newId("followup_"),
    clientId: input.clientId,
    sessionId: session.id,
    channel: "whatsapp",
    recipient: contact,
    template: process.env.WHATSAPP_CANCELLATION_FOLLOWUP_TEMPLATE_TEXT ||
      "Your appointment was cancelled. Reply if you would like help rebooking.",
    idempotencyKey: `whatsapp:cancellation:${input.bookingUid}`,
    payload: {
      contentSid,
      contentVariables: { "1": input.bookingUid },
      bookingUid: input.bookingUid,
      kind: "cancellation_followup",
    },
    status: "pending",
    scheduledAt,
    attemptCount: 0,
    maxAttempts: 5,
    createdAt: now,
    updatedAt: now,
  });
  return queued ? { queued: true } : { queued: false, skipped: "duplicate" };
}
