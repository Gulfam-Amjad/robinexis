import { afterEach, describe, expect, it } from "vitest";
import { createHash, createHmac } from "node:crypto";
import {
  BLADES_HAIR_ID,
  MemoryStore,
  seedStore,
  type NotificationDelivery,
} from "@robinexis/database";
import { FakeCalendar } from "@robinexis/integrations";
import {
  runVoiceTool,
  runVoiceContractTool,
  voiceToolAuthorized,
  voiceToolClientId,
  voiceToolClientIdForRequest,
} from "./voiceToolRoutes.js";

const oldRuntimeSecret = process.env.VOICE_RUNTIME_INTERNAL_SECRET;
afterEach(() => {
  if (oldRuntimeSecret === undefined) delete process.env.VOICE_RUNTIME_INTERNAL_SECRET;
  else process.env.VOICE_RUNTIME_INTERNAL_SECRET = oldRuntimeSecret;
  delete process.env.WHATSAPP_ENABLED;
  delete process.env.WHATSAPP_BOOKING_CONFIRMATION_CONTENT_SID;
  delete process.env.WHATSAPP_MANAGED_SENDERS_JSON;
});

const NOW = "2026-09-17T12:00:00.000Z";

async function enableWhatsApp(store: MemoryStore) {
  process.env.WHATSAPP_ENABLED = "true";
  process.env.WHATSAPP_BOOKING_CONFIRMATION_CONTENT_SID = "HXbooking";
  process.env.WHATSAPP_MANAGED_SENDERS_JSON = JSON.stringify({
    "whatsapp:+14155238886": BLADES_HAIR_ID,
  });
  const client = await store.getClient(BLADES_HAIR_ID);
  await store.upsertClient({ ...client!, phoneAcquisitionMode: "robinexis_account" });
  await store.upsertTenantFeatureEntitlements({
    clientId: BLADES_HAIR_ID,
    whatsappEnabled: true,
    autoMinuteBlocksEnabled: false,
    createdAt: NOW,
    updatedAt: NOW,
  });
  await store.upsertProviderResource({
    id: "resource_blades_wa",
    clientId: BLADES_HAIR_ID,
    provider: "twilio",
    resourceType: "whatsapp_sender",
    providerResourceId: "+14155238886",
    lifecycleStatus: "active",
    metadata: { address: "whatsapp:+14155238886" },
    createdAt: NOW,
    updatedAt: NOW,
  });
}

describe("ElevenLabs voice tool routes", () => {
  it("requires a non-empty shared secret", () => {
    expect(voiceToolAuthorized("correct", "correct")).toBe(true);
    expect(voiceToolAuthorized("wrong", "correct")).toBe(false);
    expect(voiceToolAuthorized("", "")).toBe(false);
  });

  it("executes the full provider-neutral tool contract through tenant-bound context", async () => {
    const store = new MemoryStore();
    await seedStore(store);
    const result = await runVoiceContractTool(
      store,
      "get_business_info",
      { conversationId: "call_provider_neutral", topic: "hours" },
      { store, clientId: BLADES_HAIR_ID },
    );
    expect(result.status).toBe(200);
    expect(result.body.ok).toBe(true);
    expect((await store.getCall("call_provider_neutral"))?.clientId).toBe(BLADES_HAIR_ID);
  });

  it("maps each webhook secret to one server-authorized tenant", () => {
    expect(voiceToolClientId("legacy", "legacy", "")).toBe(BLADES_HAIR_ID);
    expect(
      voiceToolClientId(
        "tenant-secret",
        "legacy",
        JSON.stringify({ client_second: "tenant-secret" }),
      ),
    ).toBe("client_second");
    expect(voiceToolClientId("wrong", "legacy", JSON.stringify({ client_second: "tenant-secret" }))).toBeUndefined();
  });

  it("resolves a hashed per-agent credential without storing its raw value", async () => {
    const store = new MemoryStore();
    await seedStore(store);
    const secret = "tenant-db-secret";
    await store.upsertAgentInstance({
      id: "agent-instance-second",
      clientId: "client_second",
      provider: "elevenlabs",
      providerAgentId: "agent_second",
      voiceCredentialHash: createHash("sha256").update(secret).digest("hex"),
      name: "Second receptionist",
      status: "active",
      config: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await expect(voiceToolClientIdForRequest(store, secret)).resolves.toBe("client_second");
    await expect(voiceToolClientIdForRequest(store, "wrong")).resolves.toBeUndefined();
  });

  it("accepts a runtime-derived credential only with its bound published tenant", async () => {
    process.env.VOICE_RUNTIME_INTERNAL_SECRET = "runtime-internal";
    const store = new MemoryStore();
    await seedStore(store);
    const credential = createHmac("sha256", "runtime-internal")
      .update(`voice-tool:${BLADES_HAIR_ID}`)
      .digest("base64url");
    await expect(
      voiceToolClientIdForRequest(store, credential, BLADES_HAIR_ID),
    ).resolves.toBe(BLADES_HAIR_ID);
    await expect(
      voiceToolClientIdForRequest(store, credential, "client_second"),
    ).resolves.toBeUndefined();
  });

  it("returns only calendar slots for a supported Blades service", async () => {
    const store = new MemoryStore();
    await seedStore(store);
    const calendar = new FakeCalendar(["2026-09-02T10:00:00.000Z"]);
    const result = await runVoiceTool(
      store,
      "check-availability",
      {
        clientId: BLADES_HAIR_ID,
        eventTypeSlug: "30min",
        start: "2026-09-02T00:00:00.000Z",
        end: "2026-09-03T00:00:00.000Z",
        conversationId: "conv_availability",
      },
      { store, calendar },
    );
    expect(result).toEqual({
      status: 200,
      body: { ok: true, slots: ["2026-09-02T10:00:00.000Z"] },
    });
    expect(await store.getCall("conv_availability")).toBeUndefined();
  });

  it("supports a second published tenant selected by its server-bound secret", async () => {
    const store = new MemoryStore();
    await seedStore(store);
    const blades = await store.getClient(BLADES_HAIR_ID);
    await store.upsertClient({
      ...blades!,
      id: "client_second",
      slug: "second-salon",
      businessName: "Second Salon",
      elevenlabsAgentId: "agent_second",
    });
    const calendar = new FakeCalendar(["2026-09-02T11:00:00.000Z"]);
    const result = await runVoiceTool(
      store,
      "check-availability",
      {
        clientId: BLADES_HAIR_ID,
        eventTypeSlug: "30min",
        start: "2026-09-02T00:00:00.000Z",
        end: "2026-09-03T00:00:00.000Z",
        conversationId: "conv_second",
      },
      { store, calendar, clientId: "client_second" },
    );
    expect(result).toEqual({
      status: 200,
      body: { ok: true, slots: ["2026-09-02T11:00:00.000Z"] },
    });
  });

  it("blocks booking tools when tenant service access is inactive", async () => {
    const store = new MemoryStore();
    await seedStore(store);
    const client = await store.getClient(BLADES_HAIR_ID);
    await store.upsertClient({ ...client!, serviceStatus: "canceled" });
    const result = await runVoiceTool(
      store,
      "check-availability",
      {
        eventTypeSlug: "30min",
        start: "2026-09-02T00:00:00.000Z",
        end: "2026-09-03T00:00:00.000Z",
        conversationId: "conv_inactive",
      },
      { store, calendar: new FakeCalendar() },
    );
    expect(result).toEqual({
      status: 403,
      body: { ok: false, error: "service_unavailable", reason: "canceled" },
    });
  });

  it("blocks an app-managed trial after its explicit expiry", async () => {
    const store = new MemoryStore();
    await seedStore(store);
    await store.upsertSubscription({
      id: "trial-expired",
      clientId: BLADES_HAIR_ID,
      provider: "internal",
      planTier: "starter",
      status: "trialing",
      trialEndsAt: "2020-01-01T00:00:00.000Z",
      cancelAtPeriodEnd: false,
      metadata: {},
      createdAt: "2019-12-29T00:00:00.000Z",
      updatedAt: "2019-12-29T00:00:00.000Z",
    });
    const result = await runVoiceTool(
      store,
      "check-availability",
      {
        eventTypeSlug: "30min",
        start: "2026-09-02T00:00:00.000Z",
        end: "2026-09-03T00:00:00.000Z",
        conversationId: "conv_expired",
      },
      { store, calendar: new FakeCalendar() },
    );
    expect(result).toMatchObject({
      status: 403,
      body: { reason: "trial_expired" },
    });
  });

  it("books once with name and mobile but no email", async () => {
    const store = new MemoryStore();
    await seedStore(store);
    const calendar = new FakeCalendar(["2026-09-02T10:00:00.000Z"]);
    const input = {
      clientId: BLADES_HAIR_ID,
      eventTypeSlug: "30min",
      start: "2026-09-02T10:00:00.000Z",
      attendeeName: "Gultham",
      attendeePhone: "0342 443 2411",
      callerConfirmed: true,
      conversationId: "conv_test",
      idempotencyKey: "conv_test:booking",
    };
    const first = await runVoiceTool(store, "create-booking", input, { store, calendar });
    const second = await runVoiceTool(store, "create-booking", input, { store, calendar });
    expect(first.status).toBe(200);
    expect(first.body.bookingUid).toBe("bk_1");
    expect(second.body.bookingUid).toBe("bk_1");
    expect(calendar.bookings.size).toBe(1);
    expect(await store.listBookingRecords(BLADES_HAIR_ID)).toMatchObject([
      {
        providerBookingId: "bk_1",
        callId: "conv_test",
        status: "confirmed",
        attendeeName: "Gultham",
      },
    ]);
  });

  it("does not book an unavailable or unconfirmed slot", async () => {
    const store = new MemoryStore();
    await seedStore(store);
    const calendar = new FakeCalendar([]);
    const base = {
      clientId: BLADES_HAIR_ID,
      eventTypeSlug: "30min",
      start: "2026-09-02T10:00:00.000Z",
      attendeeName: "Gultham",
      attendeePhone: "+923424432411",
      conversationId: "conv_test",
    };
    expect(
      (await runVoiceTool(store, "create-booking", { ...base, callerConfirmed: false }, { store, calendar })).body.error,
    ).toBe("caller_confirmation_required");
    expect(
      (await runVoiceTool(store, "create-booking", { ...base, callerConfirmed: true }, { store, calendar })).body.error,
    ).toBe("slot_no_longer_free");
    expect(calendar.bookings.size).toBe(0);
  });

  it("returns a speech-friendly error when the calendar fails", async () => {
    const store = new MemoryStore();
    await seedStore(store);
    const calendar = new FakeCalendar();
    calendar.check = () => {
      throw new Error("calendar timeout");
    };
    const result = await runVoiceTool(
      store,
      "check-availability",
      {
        clientId: BLADES_HAIR_ID,
        eventTypeSlug: "30min",
        start: "2026-09-02T00:00:00.000Z",
        end: "2026-09-03T00:00:00.000Z",
        conversationId: "conv_calendar_failure",
      },
      { store, calendar },
    );
    expect(result).toEqual({
      status: 503,
      body: { ok: false, error: "calendar_temporarily_unavailable" },
    });
  });

  it("rejects tool calls without a stable ElevenLabs conversation ID", async () => {
    const store = new MemoryStore();
    await seedStore(store);
    const result = await runVoiceTool(
      store,
      "check-availability",
      {
        clientId: BLADES_HAIR_ID,
        eventTypeSlug: "30min",
        start: "2026-09-02T00:00:00.000Z",
        end: "2026-09-03T00:00:00.000Z",
      },
      { store, calendar: new FakeCalendar() },
    );
    expect(result).toEqual({
      status: 400,
      body: { ok: false, error: "missing_conversation_id" },
    });
  });

  it("accepts a UK national mobile and reports booking failures safely", async () => {
    const store = new MemoryStore();
    await seedStore(store);
    const calendar = new FakeCalendar(["2026-09-02T10:00:00.000Z"]);
    calendar.create = () => {
      throw new Error("Cal.com timeout");
    };
    const result = await runVoiceTool(
      store,
      "create-booking",
      {
        clientId: BLADES_HAIR_ID,
        eventTypeSlug: "30min",
        start: "2026-09-02T10:00:00.000Z",
        attendeeName: "Will Robinson",
        attendeePhone: "07446 860 675",
        callerConfirmed: true,
        conversationId: "conv_uk_mobile",
        notes: "Men's cut with any stylist",
      },
      { store, calendar },
    );
    expect(result).toEqual({
      status: 503,
      body: { ok: false, error: "booking_temporarily_unavailable" },
    });
  });

  it("keeps a successful booking when WhatsApp confirmation enqueue fails", async () => {
    class FailWhatsAppStore extends MemoryStore {
      override async enqueueNotification(delivery: NotificationDelivery) {
        if (delivery.idempotencyKey.startsWith("whatsapp:booking:")) {
          throw new Error("notification_outbox_unavailable");
        }
        return super.enqueueNotification(delivery);
      }
    }
    const store = new FailWhatsAppStore();
    await seedStore(store);
    await enableWhatsApp(store);
    const calendar = new FakeCalendar(["2026-09-02T10:00:00.000Z"]);
    const result = await runVoiceTool(
      store,
      "create-booking",
      {
        eventTypeSlug: "30min",
        start: "2026-09-02T10:00:00.000Z",
        attendeeName: "Gultham",
        attendeePhone: "07446 860 675",
        callerConfirmed: true,
        conversationId: "conv_wa_fail",
        idempotencyKey: "conv_wa_fail:booking",
      },
      { store, calendar },
    );
    expect(result.status).toBe(200);
    expect(result.body.bookingUid).toBe("bk_1");
    expect(calendar.bookings.size).toBe(1);
    expect(await store.listNotifications(BLADES_HAIR_ID)).toEqual([]);
  });

  it("does not enqueue a second WhatsApp confirmation for a duplicate booking", async () => {
    const store = new MemoryStore();
    await seedStore(store);
    await enableWhatsApp(store);
    const calendar = new FakeCalendar(["2026-09-02T10:00:00.000Z"]);
    const input = {
      eventTypeSlug: "30min",
      start: "2026-09-02T10:00:00.000Z",
      attendeeName: "Gultham",
      attendeePhone: "07446 860 675",
      callerConfirmed: true,
      conversationId: "conv_wa_dup",
      idempotencyKey: "conv_wa_dup:booking",
    };
    const first = await runVoiceTool(store, "create-booking", input, { store, calendar });
    const second = await runVoiceTool(store, "create-booking", input, { store, calendar });
    expect(first.body.bookingUid).toBe("bk_1");
    expect(second.body.bookingUid).toBe("bk_1");
    expect(calendar.bookings.size).toBe(1);
    const confirmations = (await store.listNotifications(BLADES_HAIR_ID))
      .filter((item) => item.idempotencyKey === "whatsapp:booking:bk_1");
    expect(confirmations).toHaveLength(1);
    expect(confirmations[0]?.payload?.contentSid).toBe("HXbooking");
  });
});
