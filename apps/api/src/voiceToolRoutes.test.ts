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
  process.env.WHATSAPP_BOOKING_REMINDER_CONTENT_SID = "HXreminder";
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

async function offerSlot(
  store: MemoryStore,
  calendar: FakeCalendar,
  conversationId: string,
  start: string,
  eventTypeSlug = "30min",
) {
  const instant = Date.parse(start);
  const result = await runVoiceTool(store, "check-availability", {
    eventTypeSlug,
    start: new Date(instant - 60 * 60_000).toISOString(),
    end: new Date(instant + 60 * 60_000).toISOString(),
    conversationId,
  }, { store, calendar });
  expect(result.status).toBe(200);
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
    expect(await store.getCall("conv_availability")).toMatchObject({
      clientId: BLADES_HAIR_ID,
      objective: "Voice receptionist booking",
      promptVersionId: "provider-managed-voice",
      collected: {
        eventTypeSlug: "30min",
        start: "2026-09-02T00:00:00.000Z",
      },
      toolHistory: [expect.objectContaining({ name: "check_availability" })],
    });
  });

  it.each([
    ["September 31", "2026-09-31T10:00:00+01:00", "2026-09-31T19:00:00+01:00"],
    ["a non-leap February 29", "2025-02-29T10:00:00Z", "2025-02-29T11:00:00Z"],
    ["a reversed range", "2026-10-02T11:00:00Z", "2026-10-02T10:00:00Z"],
    ["a window over fourteen days", "2026-10-01T10:00:00Z", "2026-10-15T10:00:01Z"],
  ])("clarifies %s without calling the calendar", async (_label, start, end) => {
    const store = new MemoryStore();
    await seedStore(store);
    const calendar = new FakeCalendar();
    let checks = 0;
    calendar.check = () => {
      checks += 1;
      return { slots: [] };
    };

    const result = await runVoiceTool(store, "check-availability", {
      eventTypeSlug: "30min",
      start,
      end,
      conversationId: `conv_invalid_${start}`,
    }, { store, calendar });

    expect(result).toEqual({
      status: 400,
      body: {
        ok: false,
        error: "invalid_date_range",
        recoveryAction: "clarify_date",
      },
    });
    expect(checks).toBe(0);
  });

  it("accepts a real leap day with a timezone offset", async () => {
    const store = new MemoryStore();
    await seedStore(store);
    const calendar = new FakeCalendar(["2028-02-29T10:30:00.000Z"]);
    const result = await runVoiceTool(store, "check-availability", {
      eventTypeSlug: "30min",
      start: "2028-02-29T09:00:00+01:00",
      end: "2028-02-29T18:00:00+01:00",
      conversationId: "conv_valid_leap_day",
    }, { store, calendar });

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true });
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
    await offerSlot(store, calendar, input.conversationId, input.start);
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
    expect(await store.getCall("conv_test")).toMatchObject({
      contactPhone: "+923424432411",
      appointmentId: "bk_1",
      collected: {
        eventTypeSlug: "30min",
        start: "2026-09-02T10:00:00.000Z",
        attendeeName: "Gultham",
        attendeePhone: "+923424432411",
        callerConfirmed: true,
        bookingUid: "bk_1",
      },
    });
  });

  it("merges later tool state without erasing the existing conversation", async () => {
    const store = new MemoryStore();
    await seedStore(store);
    const now = new Date().toISOString();
    await store.saveCall({
      id: "call_livekit_memory",
      clientId: BLADES_HAIR_ID,
      direction: "inbound",
      objective: "Browser provider comparison",
      promptVersionId: "prompt_livekit",
      transcript: [{ role: "caller", text: "Monday please", at: now }],
      collected: { preferredDay: "Monday" },
      toolHistory: [],
      state: "tool",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    const result = await runVoiceContractTool(
      store,
      "get_business_info",
      { conversationId: "call_livekit_memory", topic: "hours" },
      { store, clientId: BLADES_HAIR_ID },
    );
    expect(result.status).toBe(200);
    expect(await store.getCall("call_livekit_memory")).toMatchObject({
      objective: "Browser provider comparison",
      promptVersionId: "prompt_livekit",
      transcript: [{ role: "caller", text: "Monday please", at: now }],
      collected: { preferredDay: "Monday" },
      toolHistory: [expect.objectContaining({ name: "get_business_info" })],
    });
  });

  it("does not book an unavailable or unconfirmed slot", async () => {
    const store = new MemoryStore();
    await seedStore(store);
    const calendar = new FakeCalendar(["2026-09-02T10:00:00.000Z"]);
    const base = {
      clientId: BLADES_HAIR_ID,
      eventTypeSlug: "30min",
      start: "2026-09-02T10:00:00.000Z",
      attendeeName: "Gultham",
      attendeePhone: "+923424432411",
      conversationId: "conv_test",
    };
    await offerSlot(store, calendar, base.conversationId, base.start);
    expect(
      (await runVoiceTool(store, "create-booking", { ...base, callerConfirmed: false }, { store, calendar })).body.error,
    ).toBe("caller_confirmation_required");
    calendar.slots = [];
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
      throw new Error("Cal.com HTTP 400: attendeeEmail=jason@example.com");
    };
    await offerSlot(store, calendar, "conv_uk_mobile", "2026-09-02T10:00:00.000Z");
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
    expect(result).toMatchObject({
      status: 503,
      body: { ok: false, error: "booking_temporarily_unavailable" },
    });
    expect(result.body.recoveryAction).toBe("retry_once_then_offer_callback");
    const savedCall = await store.getCall("conv_uk_mobile");
    expect(savedCall?.toolHistory.at(-1)?.result)
      .toEqual({ error: "booking_temporarily_unavailable" });
    expect(JSON.stringify(savedCall)).not.toContain("jason@example.com");
  });

  it("carries an accepted counter-offer, rejects guessed phone digits, and books once", async () => {
    const store = new MemoryStore();
    await seedStore(store);
    const offeredStart = "2026-09-21T14:00:00.000Z"; // 3pm Europe/London (BST)
    const calendar = new FakeCalendar([offeredStart]);
    const conversationId = "conv_jason_counter_offer";
    await offerSlot(store, calendar, conversationId, offeredStart);

    const base = {
      eventTypeSlug: "30min",
      attendeeName: "Jason",
      callerConfirmed: true,
      conversationId,
    };
    const wrongOriginalTime = await runVoiceTool(store, "create-booking", {
      ...base,
      start: "2026-09-21T15:00:00.000Z",
      attendeePhone: "07443 245443",
    }, { store, calendar });
    expect(wrongOriginalTime).toMatchObject({
      status: 409,
      body: { error: "slot_not_offered", recoveryAction: "check_availability_and_offer_returned_slot" },
    });

    const guessedPhone = await runVoiceTool(store, "create-booking", {
      ...base,
      start: "2026-09-21T15:00:00+01:00",
      attendeePhone: "4443245443",
    }, { store, calendar });
    expect(guessedPhone).toMatchObject({
      status: 400,
      body: {
        error: "attendee_phone_invalid_ask_for_complete_number_from_beginning",
        recoveryAction: "ask_for_complete_phone_from_beginning",
      },
    });

    const corrected = {
      ...base,
      start: "2026-09-21T15:00:00+01:00",
      attendeePhone: "07443 245443",
    };
    const first = await runVoiceTool(store, "create-booking", corrected, { store, calendar });
    const replay = await runVoiceTool(store, "create-booking", corrected, { store, calendar });
    expect(first).toMatchObject({ status: 200, body: { bookingUid: "bk_1" } });
    expect(replay).toMatchObject({ status: 200, body: { bookingUid: "bk_1" } });
    expect(calendar.bookings.size).toBe(1);
    expect(calendar.bookings.get("bk_1")?.start).toBe(offeredStart);
    expect((await store.getCall(conversationId))?.toolHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ result: { error: "slot_not_offered" } }),
        expect.objectContaining({
          result: { error: "attendee_phone_invalid_ask_for_complete_number_from_beginning" },
        }),
        expect.objectContaining({ result: expect.objectContaining({ bookingUid: "bk_1" }) }),
      ]),
    );
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
    await offerSlot(store, calendar, "conv_wa_fail", "2026-09-02T10:00:00.000Z");
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
    await offerSlot(store, calendar, input.conversationId, input.start);
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

  it("queues a WhatsApp reminder for a future voice booking", async () => {
    const store = new MemoryStore();
    await seedStore(store);
    await enableWhatsApp(store);
    const startDate = new Date(Date.now() + 48 * 60 * 60 * 1_000);
    const start = startDate.toISOString();
    const reminderAt = new Date(startDate.getTime() - 60 * 60 * 1_000).toISOString();
    const calendar = new FakeCalendar([start]);
    await offerSlot(store, calendar, "conv_wa_reminder", start);
    const result = await runVoiceTool(
      store,
      "create-booking",
      {
        eventTypeSlug: "30min",
        start,
        attendeeName: "Gultham",
        attendeePhone: "07446 860 675",
        callerConfirmed: true,
        conversationId: "conv_wa_reminder",
        idempotencyKey: "conv_wa_reminder:booking",
      },
      { store, calendar },
    );
    expect(result.status).toBe(200);
    expect(await store.listScheduledFollowups(BLADES_HAIR_ID)).toMatchObject([{
      idempotencyKey: "whatsapp:reminder:bk_1",
      status: "pending",
      scheduledAt: reminderAt,
      payload: expect.objectContaining({
        contentSid: "HXreminder",
        kind: "booking_reminder",
        contentVariables: expect.objectContaining({ "2": "bk_1" }),
      }),
    }]);
  });
});
