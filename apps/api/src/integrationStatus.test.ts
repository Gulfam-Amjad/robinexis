import { describe, expect, it } from "vitest";
import { bladesHairSeed, robinexisDemoSeed } from "@robinexis/database";
import { integrationList } from "./productRoutes.js";

const connectedCalendar = { ok: true, slotCount: 149 };

function statusById(client: Parameters<typeof integrationList>[0]) {
  return new Map(integrationList(client, connectedCalendar).map((item) => [item.id, item]));
}

describe("workspace integration status", () => {
  it("reports the Blades receptionist as connected once its agent is assigned", () => {
    const status = statusById(bladesHairSeed());
    expect(status.get("elevenlabs")).toMatchObject({ connected: true });
    expect(status.get("twilio")).toMatchObject({ connected: true });
    expect(status.get("calcom")).toMatchObject({ connected: true, detail: "149 slots available" });
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
