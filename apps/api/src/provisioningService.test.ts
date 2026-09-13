import { describe, expect, it, vi } from "vitest";
import {
  BLADES_HAIR_ID,
  DEMO_CLIENT_ID,
  MemoryStore,
  seedStore,
} from "@robinexis/database";
import {
  encryptTwilioCredential,
} from "@robinexis/integrations";
import {
  hashVoiceToolCredential,
  provisionClientAgent,
} from "./provisioningService.js";

const now = new Date("2026-09-04T09:00:00.000Z");

async function preparedStore() {
  const store = new MemoryStore();
  await seedStore(store);
  for (const clientId of [BLADES_HAIR_ID, DEMO_CLIENT_ID]) {
    const client = await store.getClient(clientId);
    await store.upsertLocation({
      id: `loc_${clientId}`,
      clientId,
      slug: "primary",
      name: client!.businessName,
      timezone: "Europe/London",
      isPrimary: true,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
    await store.upsertCalendarConnection({
      id: `calendar_${clientId}`,
      clientId,
      locationId: `loc_${clientId}`,
      provider: "calcom",
      credentialRef: `CALCOM_${clientId.toUpperCase().replaceAll("-", "_")}`,
      status: "active",
      metadata: {},
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
    client!.elevenlabsAgentId = undefined;
    client!.published = true;
    client!.transferNumber = "+447700900123";
    client!.greeting ||= `Hello, you've reached ${client!.businessName}.`;
    client!.calendar.username = "robinexis";
    await store.upsertClient(client!);
    await store.upsertSubscription({
      id: `subscription_${clientId}`,
      clientId,
      provider: "stripe",
      planTier: "starter",
      status: "active",
      cancelAtPeriodEnd: false,
      metadata: {},
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
  }
  return store;
}

function fakeManagement() {
  let agent = 0;
  let tool = 0;
  let secret = 0;
  return {
    createWorkspaceSecret: vi.fn(async () => ({
      type: "stored" as const,
      secret_id: `secret_${++secret}`,
      name: "tenant-secret",
    })),
    createTool: vi.fn(async () => ({ tool_id: `tool_${++tool}` })),
    createAgent: vi.fn(async () => ({ agent_id: `agent_${++agent}` })),
    updateAgent: vi.fn(async (agentId: string) => ({ agent_id: agentId })),
    importTwilioNumber: vi.fn(async () => ({ phone_number_id: "phone_1" })),
    assignAgentToPhoneNumber: vi.fn(async () => ({ phone_number_id: "phone_1" })),
  };
}

describe("tenant agent provisioning", () => {
  it("creates isolated resources and returns the same result for a completed operation", async () => {
    const store = await preparedStore();
    const elevenLabs = fakeManagement();
    const first = await provisionClientAgent(
      {
        clientId: BLADES_HAIR_ID,
        operationKey: "tenant-one-v1",
        apiBaseUrl: "https://api.example.test",
      },
      { store, elevenLabs, now: () => now, randomSecret: () => "secret-one" },
    );
    const replay = await provisionClientAgent(
      {
        clientId: BLADES_HAIR_ID,
        operationKey: "tenant-one-v1",
        apiBaseUrl: "https://api.example.test",
      },
      { store, elevenLabs, now: () => now, randomSecret: () => "ignored" },
    );
    const second = await provisionClientAgent(
      {
        clientId: DEMO_CLIENT_ID,
        operationKey: "tenant-two-v1",
        apiBaseUrl: "https://api.example.test",
      },
      { store, elevenLabs, now: () => now, randomSecret: () => "secret-two" },
    );

    expect(replay).toEqual(first);
    expect(first.elevenlabsAgentId).not.toBe(second.elevenlabsAgentId);
    expect(first.providerSecretId).not.toBe(second.providerSecretId);
    expect(elevenLabs.createAgent).toHaveBeenCalledTimes(2);
    expect(elevenLabs.createWorkspaceSecret).toHaveBeenCalledTimes(2);
    const firstAgent = await store.getAgentInstance(
      BLADES_HAIR_ID,
      first.agentInstanceId,
    );
    const secondAgent = await store.getAgentInstance(
      DEMO_CLIENT_ID,
      second.agentInstanceId,
    );
    expect(firstAgent?.voiceCredentialHash).toBe(hashVoiceToolCredential("secret-one"));
    expect(secondAgent?.voiceCredentialHash).toBe(hashVoiceToolCredential("secret-two"));
    expect((await store.getClient(BLADES_HAIR_ID))?.elevenlabsAgentId).toBe(
      first.elevenlabsAgentId,
    );
  });

  it("persists completed steps and resumes a failed operation without recreating its secret", async () => {
    const store = await preparedStore();
    const elevenLabs = fakeManagement();
    elevenLabs.createTool
      .mockResolvedValueOnce({ tool_id: "availability_tool" })
      .mockRejectedValueOnce(new Error("temporary_tool_failure"))
      .mockResolvedValueOnce({ tool_id: "booking_tool" });

    await expect(
      provisionClientAgent(
        {
          clientId: DEMO_CLIENT_ID,
          operationKey: "resume-v1",
          apiBaseUrl: "https://api.example.test",
        },
        { store, elevenLabs, now: () => now, randomSecret: () => "secret-resume" },
      ),
    ).rejects.toThrow("temporary_tool_failure");
    expect(
      (await store.getProvisioningRunByIdempotency(DEMO_CLIENT_ID, "resume-v1"))
        ?.status,
    ).toBe("failed");

    const result = await provisionClientAgent(
      {
        clientId: DEMO_CLIENT_ID,
        operationKey: "resume-v1",
        apiBaseUrl: "https://api.example.test",
      },
      { store, elevenLabs, now: () => now, randomSecret: () => "new-unused-secret" },
    );
    expect(result.toolIds).toEqual(["availability_tool", "booking_tool"]);
    expect(elevenLabs.createWorkspaceSecret).toHaveBeenCalledTimes(1);
    expect(elevenLabs.createTool).toHaveBeenCalledTimes(3);
  });

  it("creates isolated Cal.com mappings and verifies a customer-purchased Robinexis number", async () => {
    const store = await preparedStore();
    const elevenLabs = fakeManagement();
    const client = await store.getClient(BLADES_HAIR_ID);
    process.env[client!.calendar.credentialRef || "CALCOM_API_KEY"] = "test-key";
    const calendar = {
      listEventTypes: vi.fn(async () => []),
      createEventType: vi.fn(async (_tenant, input) => ({
        id: 101,
        slug: input.slug,
        title: input.title,
        lengthInMinutes: input.durationMinutes,
      })),
      updateEventType: vi.fn(),
    };
    const phone = {
      findOwned: vi.fn(async (phoneNumber: string) => ({ phoneNumber, sid: "PN_twilio_1" })),
    };
    const result = await provisionClientAgent({
      clientId: BLADES_HAIR_ID,
      operationKey: "manual-phone-v1",
      apiBaseUrl: "https://api.example.test",
      phoneMode: "robinexis_account",
      twilioNumber: "+441134960001",
      twilioAccountSid: "AC_test",
      twilioAuthToken: "test-token",
    }, { store, elevenLabs, calendar, phone, now: () => now });

    expect(result.phoneNumber).toBe("+441134960001");
    expect(phone.findOwned).toHaveBeenCalledTimes(1);
    expect((await store.listCalendarEventTypes(BLADES_HAIR_ID))[0]?.providerSlug)
      .toContain("blades");
    const endpoint = (await store.listPhoneEndpoints(BLADES_HAIR_ID))[0];
    expect(endpoint.metadata).toMatchObject({
      acquisitionMode: "robinexis_account",
      twilioSid: "PN_twilio_1",
    });
    expect((await store.getClient(BLADES_HAIR_ID))?.onboardingStatus).toBe("active");
  });

  it("uses encrypted customer Twilio API credentials after OAuth connection", async () => {
    const store = await preparedStore();
    const elevenLabs = fakeManagement();
    const client = await store.getClient(DEMO_CLIENT_ID);
    process.env[client!.calendar.credentialRef || "CALCOM_API_KEY"] = "test-key";
    process.env.TWILIO_OAUTH_ENCRYPTION_KEY = "test-encryption-key";
    await store.upsertTwilioConnection({
      id: "twilio_connection_test",
      clientId: DEMO_CLIENT_ID,
      mode: "customer_oauth",
      accountSid: "AC11111111111111111111111111111111",
      apiKeySid: "SK22222222222222222222222222222222",
      encryptedApiKeySecret: encryptTwilioCredential("customer-api-secret"),
      status: "active",
      metadata: {},
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
    const findOwned = vi.fn(async () => ({
      phoneNumber: "+441134960002",
      sid: "PN_customer_1",
    }));
    await provisionClientAgent({
      clientId: DEMO_CLIENT_ID,
      operationKey: "customer-oauth-v1",
      apiBaseUrl: "https://api.example.test",
      phoneMode: "customer_oauth",
      twilioNumber: "+441134960002",
    }, {
      store,
      elevenLabs,
      phone: { findOwned },
      now: () => now,
    });
    expect(findOwned).toHaveBeenCalledWith("+441134960002", {
      accountSid: "AC11111111111111111111111111111111",
      apiKeySid: "SK22222222222222222222222222222222",
      apiKeySecret: "customer-api-secret",
    });
    expect(elevenLabs.importTwilioNumber).toHaveBeenCalledWith(
      expect.objectContaining({
        accountSid: "SK22222222222222222222222222222222",
        authToken: "customer-api-secret",
      }),
      expect.any(String),
    );
  });
});
