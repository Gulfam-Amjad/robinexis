import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { BLADES_HAIR_ID, MemoryStore, seedStore } from "@robinexis/database";
import { ingestElevenLabsWebhook, verifyElevenLabsWebhook } from "./elevenLabsWebhook.js";

const secret = "test_webhook_secret";
const timestamp = Math.floor(Date.now() / 1000);

function signed(body: object) {
  const raw = Buffer.from(JSON.stringify(body));
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${raw.toString("utf8")}`)
    .digest("hex");
  return { raw, header: `t=${timestamp},v0=${signature}` };
}

describe("ElevenLabs post-call webhook", () => {
  it("rejects invalid or stale signatures", () => {
    const raw = Buffer.from("{}");
    expect(verifyElevenLabsWebhook(raw, "t=1800000000,v0=bad", secret, timestamp)).toBe(false);
    const valid = signed({});
    expect(verifyElevenLabsWebhook(valid.raw, valid.header, secret, timestamp)).toBe(true);
    expect(verifyElevenLabsWebhook(valid.raw, valid.header, secret, timestamp + 1_801)).toBe(false);
  });

  it("maps the provider agent to one tenant and persists a real call record", async () => {
    const store = new MemoryStore();
    await seedStore(store);
    await store.saveToolAction({
      id: "tool_booking",
      callId: "conv_live_1",
      clientId: BLADES_HAIR_ID,
      name: "create_booking",
      input: { attendeeName: "Alex" },
      result: { uid: "booking_123" },
      at: new Date(timestamp * 1000).toISOString(),
    });
    const event = signed({
      type: "post_call_transcription",
      event_timestamp: timestamp,
      data: {
        agent_id: "agent_6101m1c3n4wnfsgskgzr13w2gt9s",
        conversation_id: "conv_live_1",
        status: "done",
        transcript: [
          { role: "agent", message: "How can I help?", time_in_call_secs: 0 },
          { role: "user", message: "Book Alex in.", time_in_call_secs: 2 },
        ],
        metadata: { start_time_unix_secs: timestamp - 10, call_duration_secs: 10 },
        analysis: { call_successful: "success", transcript_summary: "Appointment booked." },
      },
    });

    const result = await ingestElevenLabsWebhook(store, event.raw, event.header, secret);
    expect(result).toMatchObject({ status: 200, body: { callId: "conv_live_1" } });
    expect(await store.getCall("conv_live_1")).toMatchObject({
      clientId: BLADES_HAIR_ID,
      status: "completed",
      outcome: "answered-completed",
      appointmentId: "booking_123",
      durationSeconds: 10,
    });
    expect((await store.getCall("conv_live_1"))?.transcript).toHaveLength(2);
    const month = new Date().toISOString().slice(0, 7);
    expect((await store.getUsage(BLADES_HAIR_ID, month))?.inboundMinutes).toBeCloseTo(10 / 60);
    expect(await store.getCreditBalance(BLADES_HAIR_ID)).toBeCloseTo(-(10 / 60));

    const replay = await ingestElevenLabsWebhook(store, event.raw, event.header, secret);
    expect(replay.status).toBe(200);
    expect((await store.getUsage(BLADES_HAIR_ID, month))?.inboundMinutes).toBeCloseTo(10 / 60);
    expect(await store.getCreditBalance(BLADES_HAIR_ID)).toBeCloseTo(-(10 / 60));
  });
});
