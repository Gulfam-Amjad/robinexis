import twilio from "twilio";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore, type ClientConfig } from "@robinexis/database";
import {
  enqueueWhatsAppNotification,
  processNotificationDeliveries,
} from "./notificationQueue.js";
import {
  applyManagedWhatsAppStatus,
  configureManagedWhatsAppSender,
  enqueueWhatsAppBookingConfirmation,
  enqueueWhatsAppCancellationFollowup,
  formatWhatsAppAppointmentTime,
  ingestManagedWhatsApp,
  validateManagedWhatsAppWebhook,
} from "./whatsapp.js";
import { ENABLE_MANAGED_WHATSAPP } from "./whatsappProvisioning.js";

const now = "2026-09-17T12:00:00.000Z";

function client(id: string): ClientConfig {
  return {
    id,
    slug: id,
    businessName: id,
    role: "receptionist",
    tone: "brief",
    location: "UK",
    phone: "+442000000001",
    email: `${id}@example.test`,
    transferNumber: "+442000000002",
    voiceId: "voice",
    voicePipeline: "elevenlabs-convai",
    services: [],
    staff: [],
    policies: [],
    publishedFacts: [],
    unknownTopics: [],
    calendar: { provider: "calcom" },
    calendarNoteMode: "summary",
    enabledFeatures: [],
    inboundNumbers: [],
    callingWindow: { tz: "UTC", startHour: 8, endHour: 20, skipSunday: false },
    maxConcurrentCalls: 1,
    outboundRatePerHour: 0,
    firstCampaignRequiresApproval: true,
    published: true,
    serviceStatus: "active",
    phoneAcquisitionMode: "robinexis_account",
    subscribedProduct: "pro",
  };
}

async function configuredStore() {
  const store = new MemoryStore();
  await store.upsertClient(client("tenant_a"));
  await store.upsertClient(client("tenant_b"));
  for (const [tenant, sender] of [["tenant_a", "+14155238886"], ["tenant_b", "+14155238887"]] as const) {
    await store.upsertProviderResource({
      id: `resource_${tenant}`,
      clientId: tenant,
      provider: "twilio",
      resourceType: "whatsapp_sender",
      providerResourceId: sender,
      lifecycleStatus: "active",
      metadata: { address: `whatsapp:${sender}` },
      createdAt: now,
      updatedAt: now,
    });
    await store.upsertTenantFeatureEntitlements({
      clientId: tenant,
      whatsappEnabled: true,
      autoMinuteBlocksEnabled: false,
      createdAt: now,
      updatedAt: now,
    });
    await store.upsertSubscription({
      id: `subscription_${tenant}`,
      clientId: tenant,
      provider: "internal",
      planTier: "pro",
      status: "active",
      currentPeriodStart: "2026-09-01T00:00:00.000Z",
      currentPeriodEnd: "2026-10-01T00:00:00.000Z",
      cancelAtPeriodEnd: false,
      metadata: {},
      createdAt: now,
      updatedAt: now,
    });
  }
  return store;
}

function inbound(to: string, sid: string, body: string, from = "whatsapp:+447700900123") {
  return new URLSearchParams({ To: to, From: from, MessageSid: sid, Body: body, NumMedia: "0" });
}

describe("managed Twilio WhatsApp transport", () => {
  it("formats reminder times in Europe/London wall clock", () => {
    expect(formatWhatsAppAppointmentTime("2026-09-20T12:00:00.000Z")).toMatch(/1:00 PM, Sun 20 Sep/);
    expect(formatWhatsAppAppointmentTime("not-a-date")).toBe("not-a-date");
  });
  beforeEach(() => {
    process.env.WHATSAPP_ENABLED = "true";
    process.env.PLAN_PRO_INCLUDED_MESSAGES = "3000";
  });
  afterEach(() => {
    delete process.env.WHATSAPP_ENABLED;
    delete process.env.PLAN_PRO_INCLUDED_MESSAGES;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.API_PUBLIC_BASE_URL;
    delete process.env.WHATSAPP_BOOKING_CONFIRMATION_CONTENT_SID;
    delete process.env.WHATSAPP_BOOKING_REMINDER_CONTENT_SID;
    delete process.env.WHATSAPP_BOOKING_REMINDER_LEAD_HOURS;
    delete process.env.WHATSAPP_CANCELLATION_FOLLOWUP_CONTENT_SID;
    delete process.env.WHATSAPP_CANCELLATION_FOLLOWUP_DELAY_HOURS;
    vi.restoreAllMocks();
  });

  it("validates the exact public URL and form parameters", () => {
    process.env.TWILIO_AUTH_TOKEN = "test_auth_token";
    process.env.API_PUBLIC_BASE_URL = "https://api.example.test";
    const url = "https://api.example.test/webhooks/twilio/whatsapp/inbound?source=twilio";
    const params = { To: "whatsapp:+14155238886", From: "whatsapp:+447700900123", Body: "HELP" };
    const signature = twilio.getExpectedTwilioSignature(process.env.TWILIO_AUTH_TOKEN, url, params);
    expect(validateManagedWhatsAppWebhook({
      signature,
      pathname: "/webhooks/twilio/whatsapp/inbound",
      search: "?source=twilio",
      params,
    }).ok).toBe(true);
    expect(validateManagedWhatsAppWebhook({
      signature,
      pathname: "/webhooks/twilio/whatsapp/inbound",
      search: "?source=changed",
      params,
    }).ok).toBe(false);
    expect(validateManagedWhatsAppWebhook({
      signature,
      pathname: "/webhooks/twilio/whatsapp/inbound",
      search: "?source=twilio",
      params: { ...params, Body: "STOP" },
    }).ok).toBe(false);
  });

  it("returns a retryable failure instead of silently dropping billing-unavailable messages", async () => {
    const store = await configuredStore();
    await store.upsertSubscription({
      id: "subscription_tenant_a",
      clientId: "tenant_a",
      provider: "internal",
      planTier: "pro",
      status: "canceled",
      currentPeriodStart: "2026-09-01T00:00:00.000Z",
      currentPeriodEnd: "2026-10-01T00:00:00.000Z",
      cancelAtPeriodEnd: true,
      metadata: {},
      createdAt: now,
      updatedAt: now,
    });
    const result = await ingestManagedWhatsApp({
      store,
      params: inbound("whatsapp:+14155238886", "SM_billing_down", "Hello"),
      now,
    });
    expect(result).toEqual({
      status: 503,
      body: { error: "message_billing_unavailable" },
    });
    expect(await store.findMessageEventByProviderId("tenant_a", "twilio", "SM_billing_down"))
      .toBeUndefined();
  });

  it("fails webhook validation closed when platform credentials or public URL are missing", () => {
    const request = {
      signature: "anything",
      pathname: "/webhooks/twilio/whatsapp/inbound",
      search: "",
      params: {},
    };
    expect(validateManagedWhatsAppWebhook(request).error).toBe("whatsapp_webhook_not_configured");
    process.env.TWILIO_AUTH_TOKEN = "token";
    expect(validateManagedWhatsAppWebhook(request).error).toBe("whatsapp_webhook_not_configured");
    delete process.env.TWILIO_AUTH_TOKEN;
    process.env.API_PUBLIC_BASE_URL = "https://api.example.test";
    expect(validateManagedWhatsAppWebhook(request).error).toBe("whatsapp_webhook_not_configured");
  });

  it("isolates tenants, handles STOP/START/HELP, and ignores MessageSid replays", async () => {
    const store = await configuredStore();
    const stopped = await ingestManagedWhatsApp({
      store,
      params: inbound("whatsapp:+14155238886", "SM_stop", "STOP"),
      now,
    });
    expect(stopped.status).toBe(200);
    const replay = await ingestManagedWhatsApp({
      store,
      params: inbound("whatsapp:+14155238886", "SM_stop", "STOP"),
      now,
    });
    expect(replay.body.replay).toBe(true);
    const session = await store.findMessageSession(
      "tenant_a", "whatsapp", "whatsapp:+447700900123", "whatsapp:+14155238886",
    );
    expect(session?.status).toBe("opted_out");
    expect(await store.listNotifications("tenant_a")).toHaveLength(1);
    expect(await store.listNotifications("tenant_b")).toHaveLength(0);

    await ingestManagedWhatsApp({
      store,
      params: inbound("whatsapp:+14155238886", "SM_start_again", "START"),
      now,
    });
    expect((await store.findMessageSession(
      "tenant_a", "whatsapp", "whatsapp:+447700900123", "whatsapp:+14155238886",
    ))?.status).toBe("active");
    expect(await store.listNotifications("tenant_a")).toHaveLength(2);

    await ingestManagedWhatsApp({
      store,
      params: inbound("whatsapp:+14155238887", "SM_help", "HELP"),
      now,
    });
    expect(await store.findMessageEventByProviderId("tenant_a", "twilio", "SM_help")).toBeUndefined();
    expect(await store.findMessageEventByProviderId("tenant_b", "twilio", "SM_help")).toBeDefined();
  });

  it("fails closed when the global gate is unset", async () => {
    delete process.env.WHATSAPP_ENABLED;
    const store = await configuredStore();
    expect((await ingestManagedWhatsApp({
      store,
      params: inbound("whatsapp:+14155238886", "SM_disabled", "hello"),
      now,
    })).status).toBe(503);
    expect(await store.findMessageEventByProviderId("tenant_a", "twilio", "SM_disabled")).toBeUndefined();
  });

  it("meters once across retries and enforces the isolated period cap", async () => {
    process.env.PLAN_PRO_INCLUDED_MESSAGES = "1";
    const store = await configuredStore();
    await ingestManagedWhatsApp({
      store,
      params: inbound("whatsapp:+14155238886", "SM_start", "START"),
      now,
    });
    const fail = vi.fn().mockRejectedValueOnce(new Error("temporary")).mockResolvedValue({ providerId: "SM_out" });
    expect(await processNotificationDeliveries({ store, workerId: "w", now: new Date(now), send: fail }))
      .toEqual({ delivered: 0, retried: 1, deadLettered: 0 });
    const retryAt = new Date(Date.parse(now) + 5 * 60_000);
    expect(await processNotificationDeliveries({ store, workerId: "w", now: retryAt, send: fail }))
      .toEqual({ delivered: 1, retried: 0, deadLettered: 0 });
    expect((await store.getMessageUsagePeriod("tenant_a", "whatsapp", "2026-09-01T00:00:00.000Z"))?.usedMessages)
      .toBe(1);

    const session = await store.findMessageSession(
      "tenant_a", "whatsapp", "whatsapp:+447700900123", "whatsapp:+14155238886",
    );
    await enqueueWhatsAppNotification({
      store,
      clientId: "tenant_a",
      operationId: "second",
      idempotencyKey: "second",
      to: session!.contactAddress,
      from: session!.senderAddress,
      template: "Second",
      sessionId: session!.id,
      now: retryAt.toISOString(),
      maxAttempts: 1,
    });
    expect(await processNotificationDeliveries({ store, workerId: "w", now: retryAt, send: fail }))
      .toEqual({ delivered: 0, retried: 0, deadLettered: 1 });
    expect(fail).toHaveBeenCalledTimes(2);
  });

  it("shares one total cap across inbound and outbound messages", async () => {
    process.env.PLAN_PRO_INCLUDED_MESSAGES = "2";
    const store = await configuredStore();
    await ingestManagedWhatsApp({
      store,
      params: inbound("whatsapp:+14155238886", "SM_in_1", "hello"),
      now,
    });
    const session = await store.findMessageSession(
      "tenant_a", "whatsapp", "whatsapp:+447700900123", "whatsapp:+14155238886",
    );
    await enqueueWhatsAppNotification({
      store,
      clientId: "tenant_a",
      operationId: "normal_reply",
      idempotencyKey: "normal_reply",
      to: session!.contactAddress,
      from: session!.senderAddress,
      template: "Hello back",
      sessionId: session!.id,
      now,
    });
    const send = vi.fn().mockResolvedValue({ providerId: "SM_out_1" });
    await processNotificationDeliveries({ store, workerId: "w", now: new Date(now), send });
    const exhausted = await ingestManagedWhatsApp({
      store,
      params: inbound("whatsapp:+14155238886", "SM_in_2", "one more"),
      now,
    });
    expect(exhausted.status).toBe(200);
    const rejected = await store.findMessageEventByProviderId("tenant_a", "twilio", "SM_in_2");
    expect(rejected).toMatchObject({ status: "suppressed", billableUnits: 0 });
    expect(rejected?.metadata.reason).toBe("whatsapp_message_allowance_exhausted");
    expect(await store.claimInboundMessageEvents("brain", now, 60, 10)).toHaveLength(1);
    expect((await store.getMessageUsagePeriod(
      "tenant_a", "whatsapp", "2026-09-01T00:00:00.000Z",
    ))?.usedMessages).toBe(2);
  });

  it("sends STOP acknowledgement at cap without extending its service window", async () => {
    process.env.PLAN_PRO_INCLUDED_MESSAGES = "0";
    const store = await configuredStore();
    const existingWindow = "2026-09-17T18:00:00.000Z";
    await store.getOrCreateMessageSession({
      id: "existing_stop_session",
      clientId: "tenant_a",
      channel: "whatsapp",
      contactAddress: "whatsapp:+447700900123",
      senderAddress: "whatsapp:+14155238886",
      status: "active",
      serviceWindowExpiresAt: existingWindow,
      state: {},
      createdAt: now,
      updatedAt: now,
    });
    const result = await ingestManagedWhatsApp({
      store,
      params: inbound("whatsapp:+14155238886", "SM_stop_at_cap", "STOP"),
      now,
    });
    expect(result.status).toBe(200);
    const session = await store.findMessageSession(
      "tenant_a", "whatsapp", "whatsapp:+447700900123", "whatsapp:+14155238886",
    );
    expect(session).toMatchObject({ status: "opted_out" });
    expect(session?.serviceWindowExpiresAt).toBe(existingWindow);
    expect(await store.claimInboundMessageEvents("brain", now, 60, 10)).toEqual([]);
    const send = vi.fn().mockResolvedValue({ providerId: "SM_stop_ack" });
    expect(await processNotificationDeliveries({ store, workerId: "w", now: new Date(now), send }))
      .toEqual({ delivered: 1, retried: 0, deadLettered: 0 });
    expect(send).toHaveBeenCalledOnce();
    expect((await store.getMessageUsagePeriod(
      "tenant_a", "whatsapp", "2026-09-01T00:00:00.000Z",
    ))?.usedMessages).toBe(0);
    await enqueueWhatsAppNotification({
      store,
      clientId: "tenant_a",
      operationId: "blocked_after_stop",
      idempotencyKey: "blocked_after_stop",
      to: session!.contactAddress,
      from: session!.senderAddress,
      template: "This must not send",
      sessionId: session!.id,
      maxAttempts: 1,
      now,
    });
    expect(await processNotificationDeliveries({ store, workerId: "w", now: new Date(now), send }))
      .toEqual({ delivered: 0, retried: 0, deadLettered: 1 });
    expect(send).toHaveBeenCalledOnce();
    const notificationCount = (await store.listNotifications("tenant_a")).length;
    await ingestManagedWhatsApp({
      store,
      params: inbound("whatsapp:+14155238886", "SM_stop_at_cap", "STOP"),
      now,
    });
    expect(await store.listNotifications("tenant_a")).toHaveLength(notificationCount);
  });

  it("converges concurrent first messages onto one session", async () => {
    const store = await configuredStore();
    await Promise.all([
      ingestManagedWhatsApp({
        store, params: inbound("whatsapp:+14155238886", "SM_race_1", "first"), now,
      }),
      ingestManagedWhatsApp({
        store, params: inbound("whatsapp:+14155238886", "SM_race_2", "second"), now,
      }),
    ]);
    const first = await store.findMessageEventByProviderId("tenant_a", "twilio", "SM_race_1");
    const second = await store.findMessageEventByProviderId("tenant_a", "twilio", "SM_race_2");
    expect(first?.sessionId).toBe(second?.sessionId);
  });

  it("keeps outbound provider status updates idempotent", async () => {
    const store = await configuredStore();
    await ingestManagedWhatsApp({
      store,
      params: inbound("whatsapp:+14155238886", "SM_help_status", "HELP"),
      now,
    });
    const send = vi.fn().mockResolvedValue({ providerId: "SM_status" });
    await processNotificationDeliveries({ store, workerId: "w", now: new Date(now), send });
    const session = await store.findMessageSession(
      "tenant_a", "whatsapp", "whatsapp:+447700900123", "whatsapp:+14155238886",
    );
    const [outbound] = (await store.listMessageEvents("tenant_a", session!.id))
      .filter((event) => event.direction === "outbound");
    expect(outbound?.status).toBe("sent");
    const [notification] = await store.listNotifications("tenant_a");
    vi.spyOn(store, "listNotifications").mockRejectedValue(new Error("broad lookup forbidden"));
    expect((await applyManagedWhatsAppStatus({
      store,
      clientId: "tenant_a",
      notificationId: notification.id,
      params: new URLSearchParams({ MessageSid: "SM_status", MessageStatus: "delivered" }),
      now,
    })).status).toBe(200);
    await applyManagedWhatsAppStatus({
      store,
      clientId: "tenant_a",
      notificationId: notification.id,
      params: new URLSearchParams({ MessageSid: "SM_status", MessageStatus: "sent" }),
      now,
    });
    expect((await store.listMessageEvents("tenant_a", session!.id))
      .find((event) => event.id === outbound.id)?.status).toBe("delivered");
    expect((await applyManagedWhatsAppStatus({
      store,
      clientId: "tenant_b",
      notificationId: notification.id,
      params: new URLSearchParams({ MessageSid: "SM_status", MessageStatus: "delivered" }),
      now,
    })).status).toBe(404);
  });

  it("schedules one approved booking reminder and replaces it with a cancellation follow-up", async () => {
    process.env.WHATSAPP_BOOKING_CONFIRMATION_CONTENT_SID = "HXconfirmation";
    process.env.WHATSAPP_BOOKING_REMINDER_CONTENT_SID = "HXreminder";
    process.env.WHATSAPP_BOOKING_REMINDER_LEAD_HOURS = "1";
    process.env.WHATSAPP_CANCELLATION_FOLLOWUP_CONTENT_SID = "HXcancel";
    process.env.WHATSAPP_CANCELLATION_FOLLOWUP_DELAY_HOURS = "2";
    const store = await configuredStore();

    const confirmation = await enqueueWhatsAppBookingConfirmation({
      store,
      clientId: "tenant_a",
      attendeePhone: "+447700900123",
      bookingUid: "booking_123",
      startsAt: "2026-09-20T12:00:00.000Z",
      now,
    });
    expect(confirmation.queued).toBe(true);
    expect(await store.listScheduledFollowups("tenant_a")).toMatchObject([{
      idempotencyKey: "whatsapp:reminder:booking_123",
      status: "pending",
      scheduledAt: "2026-09-20T11:00:00.000Z",
      payload: {
        contentSid: "HXreminder",
        kind: "booking_reminder",
        contentVariables: {
          "1": formatWhatsAppAppointmentTime("2026-09-20T12:00:00.000Z"),
          "2": "booking_123",
        },
      },
    }]);

    const cancellation = await enqueueWhatsAppCancellationFollowup({
      store,
      clientId: "tenant_a",
      attendeePhone: "+447700900123",
      bookingUid: "booking_123",
      now,
    });
    expect(cancellation.queued).toBe(true);
    expect(await store.listScheduledFollowups("tenant_a")).toEqual(expect.arrayContaining([
      expect.objectContaining({ idempotencyKey: "whatsapp:reminder:booking_123", status: "cancelled" }),
      expect.objectContaining({
        idempotencyKey: "whatsapp:cancellation:booking_123",
        status: "pending",
        scheduledAt: "2026-09-17T14:00:00.000Z",
        payload: expect.objectContaining({ contentSid: "HXcancel", kind: "cancellation_followup" }),
      }),
    ]));
  });

  it("assigns a unique sender only to an active Pro tenant", async () => {
    const store = new MemoryStore();
    await store.upsertClient({ ...client("tenant_c"), phoneAcquisitionMode: "customer_oauth" });
    expect(await configureManagedWhatsAppSender({
      store,
      clientId: "tenant_c",
      sender: "+14155238888",
      actorId: "operator",
      confirmation: ENABLE_MANAGED_WHATSAPP,
    })).toMatchObject({ ok: false, error: "whatsapp_pro_subscription_required" });
    await store.upsertSubscription({
      id: "subscription_tenant_c",
      clientId: "tenant_c",
      provider: "internal",
      planTier: "pro",
      status: "active",
      currentPeriodStart: "2026-09-01T00:00:00.000Z",
      currentPeriodEnd: "2026-10-01T00:00:00.000Z",
      cancelAtPeriodEnd: false,
      metadata: {},
      createdAt: now,
      updatedAt: now,
    });
    expect(await configureManagedWhatsAppSender({
      store,
      clientId: "tenant_c",
      sender: "+14155238888",
      actorId: "operator",
      confirmation: ENABLE_MANAGED_WHATSAPP,
    })).toEqual({ ok: true });
    expect((await store.getClient("tenant_c"))?.phoneAcquisitionMode).toBe("robinexis_account");
    expect((await store.getTenantFeatureEntitlements("tenant_c"))?.whatsappEnabled).toBe(true);
  });
});
