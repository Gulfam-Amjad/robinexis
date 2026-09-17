import { describe, expect, it } from "vitest";
import { BLADES_HAIR_ID, MemoryStore, seedStore } from "@robinexis/database";
import { liveKitInboundTwiml } from "./liveKitTelephonyRoutes.js";

describe("LiveKit Twilio ingress", () => {
  it("returns SIP TwiML only for a matching staged deployment", async () => {
    const store = new MemoryStore();
    await seedStore(store);
    expect(await liveKitInboundTwiml(store, BLADES_HAIR_ID)).toMatchObject({
      status: 409,
    });
    await store.upsertProviderDeployment({
      id: "deployment_livekit_test",
      clientId: BLADES_HAIR_ID,
      provider: "livekit-cascade",
      providerDeploymentId: "dispatch_test",
      status: "staged",
      config: {
        ingress: {
          kind: "sip_uri",
          sipUri: "sip:+447700900123@project.sip.livekit.cloud;transport=tcp",
        },
      },
      createdAt: "2026-09-17T10:00:00.000Z",
      updatedAt: "2026-09-17T10:00:00.000Z",
    });
    const result = await liveKitInboundTwiml(store, BLADES_HAIR_ID);
    expect(result.status).toBe(200);
    expect(result.body).toContain("<Dial answerOnBridge=\"true\">");
    expect(result.body).toContain("sip:+447700900123@project.sip.livekit.cloud;transport=tcp");
  });

  it("rejects an invalid SIP destination without reflecting it into XML", async () => {
    const store = new MemoryStore();
    await seedStore(store);
    await store.upsertProviderDeployment({
      id: "deployment_livekit_invalid",
      clientId: BLADES_HAIR_ID,
      provider: "livekit-cascade",
      status: "staged",
      config: { ingress: { kind: "sip_uri", sipUri: "javascript:alert(1)" } },
      createdAt: "2026-09-17T10:00:00.000Z",
      updatedAt: "2026-09-17T10:00:00.000Z",
    });
    const result = await liveKitInboundTwiml(store, BLADES_HAIR_ID);
    expect(result.status).toBe(409);
    expect(result.body).not.toContain("javascript:");
  });
});
