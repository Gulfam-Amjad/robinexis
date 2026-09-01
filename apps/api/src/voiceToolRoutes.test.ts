import { describe, expect, it } from "vitest";
import { BLADES_HAIR_ID, MemoryStore, seedStore } from "@robinexis/database";
import { FakeCalendar } from "@robinexis/integrations";
import { runVoiceTool, voiceToolAuthorized } from "./voiceToolRoutes.js";

describe("ElevenLabs voice tool routes", () => {
  it("requires a non-empty shared secret", () => {
    expect(voiceToolAuthorized("correct", "correct")).toBe(true);
    expect(voiceToolAuthorized("wrong", "correct")).toBe(false);
    expect(voiceToolAuthorized("", "")).toBe(false);
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
});
