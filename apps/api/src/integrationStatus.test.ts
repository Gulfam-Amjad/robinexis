import { describe, expect, it } from "vitest";
import { bladesHairSeed, robinexisDemoSeed } from "@robinexis/database";
import { calendarDetail, integrationList } from "./productRoutes.js";

const connectedCalendar = { ok: true, slotCount: 149 };

function statusById(client: Parameters<typeof integrationList>[0]) {
  return new Map(integrationList(client, connectedCalendar).map((item) => [item.id, item]));
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
    expect(statusById(stale).get("elevenlabs")).toMatchObject({ connected: false });
  });

  it("marks a tenant with no number or agent as needing setup", () => {
    const status = statusById(robinexisDemoSeed());
    expect(status.get("twilio")).toMatchObject({ connected: false, detail: "No inbound number assigned" });
    expect(status.get("elevenlabs")).toMatchObject({
      connected: false,
      detail: "Assign this workspace's ElevenLabs agent ID",
    });
  });
});
