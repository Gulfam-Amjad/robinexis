import { describe, expect, it } from "vitest";
import { bladesHairSeed, MemoryStore, robinexisDemoSeed } from "@robinexis/database";
import {
  calendarDetail,
  integrationList,
  probeLiveVoiceProviders,
} from "./productRoutes.js";

const connectedCalendar = { ok: true, slotCount: 149 };
const connectedVoice = {
  twilio: { connected: true, detail: "Number verified" },
  elevenlabs: { connected: true, detail: "Agent verified" },
  livekit: { connected: false, detail: "This workspace uses ElevenLabs" },
};

function statusById(client: Parameters<typeof integrationList>[0]) {
  return new Map(integrationList(client, connectedCalendar, connectedVoice).map((item) => [item.id, item]));
}

describe("workspace integration status", () => {
  it("reports the Blades receptionist as connected once its agent is assigned", () => {
    const status = statusById(bladesHairSeed());
    expect(status.get("elevenlabs")).toMatchObject({ connected: true });
    expect(status.get("twilio")).toMatchObject({ connected: true });
    expect(status.get("calcom")).toMatchObject({
      connected: true,
      detail: "149 slots available in the next 7 days",
    });
  });

  it("reports a probe failure instead of a connected calendar", () => {
    const broken = integrationList(bladesHairSeed(), {
      ok: false,
      error: "Cal.com GET /slots -> HTTP 404: Event Type not found",
    });
    expect(broken.find((item) => item.id === "calcom")).toMatchObject({
      connected: false,
      detail: "Booking types are missing in Cal.com — repair the calendar",
    });
  });

  it("translates each calendar failure into an actionable message", () => {
    expect(calendarDetail({ error: "calcom_not_configured" })).toBe("Not connected");
    expect(calendarDetail({ error: "no_booking_types_configured" }))
      .toBe("Connected, but no booking types exist yet — repair the calendar");
    expect(calendarDetail({ error: "tenant_calendar_credential_required" }))
      .toBe("Cal.com needs reconnecting");
  });

  it("stays disconnected while a tenant is still on the retired gateway", () => {
    const stale = { ...bladesHairSeed(), voicePipeline: "groq-gateway" as const };
    const statuses = integrationList(stale, connectedCalendar, {
      twilio: { connected: false, detail: "Wrong route" },
      elevenlabs: { connected: false, detail: "Wrong provider" },
      livekit: { connected: false, detail: "Wrong provider" },
    });
    expect(statuses.find((item) => item.id === "elevenlabs")).toMatchObject({ connected: false });
  });

  it("marks a tenant with no number or agent as needing setup", () => {
    const status = new Map(integrationList(robinexisDemoSeed(), connectedCalendar, {
      twilio: { connected: false, detail: "No inbound number assigned" },
      elevenlabs: { connected: false, detail: "Assign this workspace's ElevenLabs agent ID" },
      livekit: { connected: false, detail: "This workspace uses ElevenLabs" },
    }).map((item) => [item.id, item]));
    expect(status.get("twilio")).toMatchObject({ connected: false, detail: "No inbound number assigned" });
    expect(status.get("elevenlabs")).toMatchObject({
      connected: false,
      detail: "Assign this workspace's ElevenLabs agent ID",
    });
  });

  it("requires the live Twilio route and ElevenLabs booking tools", async () => {
    const store = new MemoryStore();
    const client = bladesHairSeed();
    await store.upsertClient(client);
    process.env.ELEVENLABS_TWILIO_VOICE_URL = "https://api.elevenlabs.io/v1/convai/twilio/register-call";
    const wrong = await probeLiveVoiceProviders(store, client, {
      findNumber: async () => ({
        phoneNumber: client.inboundNumbers[0],
        voiceUrl: "https://wrong.example.test/voice",
      }),
      fetchAgent: async () => ({ conversation_config: { agent: { prompt: { tool_ids: [] } } } }),
    });
    expect(wrong.twilio.connected).toBe(false);
    expect(wrong.elevenlabs).toMatchObject({
      connected: false,
      detail: "Agent exists, but required booking tools are missing",
    });

    const ready = await probeLiveVoiceProviders(store, client, {
      findNumber: async () => ({
        phoneNumber: client.inboundNumbers[0],
        voiceUrl: process.env.ELEVENLABS_TWILIO_VOICE_URL,
      }),
      fetchAgent: async () => ({
        conversation_config: { agent: { prompt: { tool_ids: ["availability", "booking"] } } },
      }),
    });
    expect(ready.twilio.connected).toBe(true);
    expect(ready.elevenlabs.connected).toBe(true);
    delete process.env.ELEVENLABS_TWILIO_VOICE_URL;
  });
});
