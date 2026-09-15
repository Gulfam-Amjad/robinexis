import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BLADES_HAIR_ID,
  DEMO_CLIENT_ID,
  SMITH_ENGLAND_ID,
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

beforeEach(() => {
  vi.stubEnv("CALCOM_READINESS_EVENT_TYPE_SLUG", "robinexis-readiness-test");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function preparedStore() {
  const store = new MemoryStore();
  await seedStore(store);
  for (const clientId of [SMITH_ENGLAND_ID, DEMO_CLIENT_ID]) {
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
    await store.saveWebsiteSource({
      id: `source_${clientId}`, clientId, url: "https://example.test",
      status: "active", metadata: { approvedRunId: `extraction_${clientId}` },
      createdAt: now.toISOString(), updatedAt: now.toISOString(),
    });
    await store.saveWebsiteExtractionRun({
      id: `extraction_${clientId}`, clientId, sourceId: `source_${clientId}`,
      status: "succeeded", extractorVersion: "test", createdAt: now.toISOString(),
      updatedAt: now.toISOString(), finishedAt: now.toISOString(),
    });
    await store.replaceExtractedFacts(clientId, `extraction_${clientId}`, [{
      id: `fact_${clientId}`, clientId, extractionRunId: `extraction_${clientId}`,
      key: "businessName", value: client!.businessName, reviewStatus: "confirmed",
      reviewedBy: "owner", reviewedAt: now.toISOString(), createdAt: now.toISOString(),
    }]);
    await store.saveOnboardingWizard({
      clientId, currentStep: "review",
      completedSteps: ["website", "facts", "behavior", "operations", "phone", "calendar", "review"],
      data: { websiteRunId: `extraction_${clientId}`, websiteUrl: "https://example.test" },
      version: 1, submittedAt: now.toISOString(), createdAt: now.toISOString(), updatedAt: now.toISOString(),
    });
  }
  return store;
}

function fakeReadiness() {
  return {
    authenticate: vi.fn(async () => true),
    checkAvailability: vi.fn(async () => ({ slots: ["2026-09-06T10:00:00.000Z"] })),
    createBooking: vi.fn(async () => ({ uid: "synthetic_booking", status: "accepted" })),
    cancelBooking: vi.fn(async () => ({ status: "cancelled" })),
    testCallLink: vi.fn(() => "https://example.test/safe-test-call"),
  };
}

function fakeCalendar() {
  let id = 100;
  return {
    listEventTypes: vi.fn(async () => []),
    createEventType: vi.fn(async (_tenant, input) => ({
      id: ++id,
      slug: input.slug,
      title: input.title,
      lengthInMinutes: input.durationMinutes,
    })),
    updateEventType: vi.fn(async (_tenant, eventTypeId, input) => ({
      id: Number(eventTypeId),
      slug: input.slug,
      title: input.title,
      lengthInMinutes: input.durationMinutes,
    })),
  };
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
  it("creates and uses a hidden dedicated readiness event type", async () => {
    vi.stubEnv("CALCOM_READINESS_EVENT_TYPE_SLUG", "");
    const store = await preparedStore();
    const readiness = fakeReadiness();
    const calendar = fakeCalendar();
    await expect(provisionClientAgent({
      clientId: DEMO_CLIENT_ID,
      operationKey: "missing-readiness-event",
      apiBaseUrl: "https://api.example.test",
    }, {
      store,
      elevenLabs: fakeManagement(),
      calendar,
      readiness,
      now: () => now,
    })).resolves.toMatchObject({ readinessReport: { passed: true } });
    const dedicated = (await store.listCalendarEventTypes(DEMO_CLIENT_ID))
      .filter((eventType) => eventType.readinessOnly);
    expect(dedicated).toHaveLength(1);
    expect(dedicated[0]?.providerSlug).toContain("robinexis-readiness-test");
    expect(calendar.createEventType).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ title: expect.stringContaining("readiness test") }),
    );
    expect(readiness.createBooking).toHaveBeenCalledWith(expect.objectContaining({
      providerEventTypeSlug: dedicated[0]?.providerSlug,
    }));
  });

  it("creates isolated resources and returns the same result for a completed operation", async () => {
    const store = await preparedStore();
    const elevenLabs = fakeManagement();
    const first = await provisionClientAgent(
      {
        clientId: SMITH_ENGLAND_ID,
        operationKey: "tenant-one-v1",
        apiBaseUrl: "https://api.example.test",
      },
      { store, elevenLabs, calendar: fakeCalendar(), readiness: fakeReadiness(), now: () => now, randomSecret: () => "secret-one" },
    );
    const replay = await provisionClientAgent(
      {
        clientId: SMITH_ENGLAND_ID,
        operationKey: "tenant-one-v1",
        apiBaseUrl: "https://api.example.test",
      },
      { store, elevenLabs, calendar: fakeCalendar(), readiness: fakeReadiness(), now: () => now, randomSecret: () => "ignored" },
    );
    const second = await provisionClientAgent(
      {
        clientId: DEMO_CLIENT_ID,
        operationKey: "tenant-two-v1",
        apiBaseUrl: "https://api.example.test",
      },
      { store, elevenLabs, calendar: fakeCalendar(), readiness: fakeReadiness(), now: () => now, randomSecret: () => "secret-two" },
    );

    expect(replay).toEqual(first);
    expect(first.elevenlabsAgentId).not.toBe(second.elevenlabsAgentId);
    expect(first.providerSecretId).not.toBe(second.providerSecretId);
    expect(elevenLabs.createAgent).toHaveBeenCalledTimes(2);
    expect(elevenLabs.createWorkspaceSecret).toHaveBeenCalledTimes(2);
    const firstAgent = await store.getAgentInstance(
      SMITH_ENGLAND_ID,
      first.agentInstanceId,
    );
    const secondAgent = await store.getAgentInstance(
      DEMO_CLIENT_ID,
      second.agentInstanceId,
    );
    expect(firstAgent?.voiceCredentialHash).toBe(hashVoiceToolCredential("secret-one"));
    expect(secondAgent?.voiceCredentialHash).toBe(hashVoiceToolCredential("secret-two"));
    expect((await store.getClient(SMITH_ENGLAND_ID))?.elevenlabsAgentId).toBe(
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
        { store, elevenLabs, calendar: fakeCalendar(), readiness: fakeReadiness(), now: () => now, randomSecret: () => "secret-resume" },
      ),
    ).rejects.toThrow("temporary_tool_failure");
    expect(
      (await store.getProvisioningRunByIdempotency(DEMO_CLIENT_ID, "resume-v1"))
        ?.status,
    ).toBe("failed");

    const resumedReadiness = fakeReadiness();
    const result = await provisionClientAgent(
      {
        clientId: DEMO_CLIENT_ID,
        operationKey: "resume-v1",
        apiBaseUrl: "https://api.example.test",
      },
      { store, elevenLabs, calendar: fakeCalendar(), readiness: resumedReadiness, now: () => now, randomSecret: () => "new-unused-secret" },
    );
    expect(result.toolIds).toEqual(["availability_tool", "booking_tool"]);
    expect(elevenLabs.createWorkspaceSecret).toHaveBeenCalledTimes(1);
    expect(elevenLabs.createTool).toHaveBeenCalledTimes(3);
    expect(resumedReadiness.authenticate).toHaveBeenCalledWith(DEMO_CLIENT_ID, {
      providerSecretId: "secret_1",
      expectedCredentialHash: hashVoiceToolCredential("secret-resume"),
    });
  });

  it("creates isolated Cal.com mappings and verifies a customer-purchased Robinexis number", async () => {
    const store = await preparedStore();
    const elevenLabs = fakeManagement();
    const client = await store.getClient(SMITH_ENGLAND_ID);
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
      clientId: SMITH_ENGLAND_ID,
      operationKey: "manual-phone-v1",
      apiBaseUrl: "https://api.example.test",
      phoneMode: "robinexis_account",
      twilioNumber: "+441134960001",
      twilioAccountSid: "AC_test",
      twilioAuthToken: "test-token",
    }, { store, elevenLabs, calendar, phone, readiness: fakeReadiness(), now: () => now });

    expect(result.phoneNumber).toBe("+441134960001");
    expect(phone.findOwned).toHaveBeenCalledTimes(1);
    expect((await store.listCalendarEventTypes(SMITH_ENGLAND_ID))[0]?.providerSlug)
      .toContain("smith");
    const endpoint = (await store.listPhoneEndpoints(SMITH_ENGLAND_ID))[0];
    expect(endpoint.metadata).toMatchObject({
      acquisitionMode: "robinexis_account",
      twilioSid: "PN_twilio_1",
      assignmentStatus: "awaiting_owner_approval",
    });
    expect(elevenLabs.importTwilioNumber).not.toHaveBeenCalled();
    expect(elevenLabs.assignAgentToPhoneNumber).not.toHaveBeenCalled();
    expect((await store.getClient(SMITH_ENGLAND_ID))?.onboardingStatus).toBe("awaiting_approval");
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
      calendar: fakeCalendar(),
      phone: { findOwned },
      readiness: fakeReadiness(),
      now: () => now,
    });
    expect(findOwned).toHaveBeenCalledWith("+441134960002", {
      accountSid: "AC11111111111111111111111111111111",
      apiKeySid: "SK22222222222222222222222222222222",
      apiKeySecret: "customer-api-secret",
    });
    expect(elevenLabs.importTwilioNumber).not.toHaveBeenCalled();
  });

  it("rejects all automation targeting the protected Blades tenant", async () => {
    const store = await preparedStore();
    const elevenLabs = fakeManagement();
    await expect(provisionClientAgent({
      clientId: BLADES_HAIR_ID,
      operationKey: "must-not-run",
      apiBaseUrl: "https://api.example.test",
    }, { store, elevenLabs, readiness: fakeReadiness(), now: () => now }))
      .rejects.toThrow("protected_blades_automation_target");
    expect(elevenLabs.createAgent).not.toHaveBeenCalled();
    expect(await store.listProvisioningRuns(BLADES_HAIR_ID)).toEqual([]);
  });

  it("runs booking tests through adapters and always cancels the synthetic booking", async () => {
    const store = await preparedStore();
    const elevenLabs = fakeManagement();
    const readiness = fakeReadiness();
    const result = await provisionClientAgent({
      clientId: SMITH_ENGLAND_ID,
      operationKey: "synthetic-cleanup-v1",
      apiBaseUrl: "https://api.example.test",
      phoneMode: "robinexis_account",
      twilioNumber: "+441134960009",
      twilioAccountSid: "AC_test",
      twilioAuthToken: "test-token",
    }, {
      store,
      elevenLabs,
      calendar: fakeCalendar(),
      phone: { findOwned: vi.fn(async () => ({ phoneNumber: "+441134960009", sid: "PN_test" })) },
      readiness,
      now: () => now,
    });
    expect(readiness.authenticate).toHaveBeenCalledWith(SMITH_ENGLAND_ID, {
      providerSecretId: expect.stringMatching(/^secret_/),
      expectedCredentialHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(readiness.checkAvailability).toHaveBeenCalledWith(expect.objectContaining({
      providerEventTypeSlug: expect.stringContaining("robinexis-readiness-test"),
    }));
    expect(readiness.createBooking).toHaveBeenCalledTimes(1);
    expect(readiness.cancelBooking).toHaveBeenCalledWith(expect.objectContaining({
      bookingUid: "synthetic_booking",
    }));
    expect(result.readinessReport.syntheticBooking).toMatchObject({
      created: true,
      cancelled: true,
    });
    expect((await store.getAgentInstance(SMITH_ENGLAND_ID, result.agentInstanceId))?.status).toBe("pending");
    expect((await store.listPhoneEndpoints(SMITH_ENGLAND_ID))[0]?.status).toBe("pending");
  });

  it("allows only one concurrent caller to own a provisioning run", async () => {
    const store = await preparedStore();
    const elevenLabs = fakeManagement();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    elevenLabs.createWorkspaceSecret.mockImplementationOnce(async () => {
      await gate;
      return { type: "stored" as const, secret_id: "secret_concurrent", name: "tenant-secret" };
    });
    const input = {
      clientId: DEMO_CLIENT_ID,
      operationKey: "concurrent-v1",
      apiBaseUrl: "https://api.example.test",
    };
    const first = provisionClientAgent(input, {
      store, elevenLabs, calendar: fakeCalendar(), readiness: fakeReadiness(), now: () => now,
    });
    await Promise.resolve();
    const second = provisionClientAgent(input, {
      store, elevenLabs, calendar: fakeCalendar(), readiness: fakeReadiness(), now: () => now,
    });
    await expect(second).rejects.toThrow("provisioning_already_running");
    release();
    await expect(first).resolves.toMatchObject({ clientId: DEMO_CLIENT_ID });
    expect((await store.getProvisioningRunByIdempotency(DEMO_CLIENT_ID, "concurrent-v1"))?.status)
      .toBe("succeeded");
  });

  it("stops before the next provider call when the run claim fence is lost", async () => {
    const store = await preparedStore();
    vi.spyOn(store, "renewProvisioningRunClaim").mockResolvedValue(false);
    const calendar = fakeCalendar();
    const elevenLabs = fakeManagement();
    await expect(provisionClientAgent({
      clientId: DEMO_CLIENT_ID,
      operationKey: "lost-fence-v1",
      apiBaseUrl: "https://api.example.test",
    }, {
      store,
      elevenLabs,
      calendar,
      readiness: fakeReadiness(),
      now: () => now,
    })).rejects.toThrow("provisioning_claim_lost");
    expect(calendar.listEventTypes).not.toHaveBeenCalled();
    expect(elevenLabs.createWorkspaceSecret).not.toHaveBeenCalled();
  });

  it("persists the synthetic UID and never recreates a booking during cleanup retry", async () => {
    const store = await preparedStore();
    const elevenLabs = fakeManagement();
    const readiness = fakeReadiness();
    readiness.cancelBooking.mockRejectedValue(new Error("provider_cancel_down"));
    const input = {
      clientId: SMITH_ENGLAND_ID,
      operationKey: "cleanup-resume-v1",
      apiBaseUrl: "https://api.example.test",
    };
    await expect(provisionClientAgent(input, {
      store, elevenLabs, calendar: fakeCalendar(), readiness, now: () => now,
    })).rejects.toThrow("synthetic_booking_cleanup_failed");
    const paused = (await store.getProvisioningRunByIdempotency(
      SMITH_ENGLAND_ID,
      "cleanup-resume-v1",
    ))!;
    expect(paused).toMatchObject({
      status: "paused",
      output: { syntheticBookingUid: "synthetic_booking", syntheticBookingCancelled: false },
    });
    paused.status = "failed";
    await store.saveProvisioningRun(paused);
    readiness.cancelBooking.mockResolvedValue({ status: "cancelled" });
    await provisionClientAgent(input, {
      store, elevenLabs, calendar: fakeCalendar(), readiness, now: () => now,
    });
    expect(readiness.createBooking).toHaveBeenCalledTimes(1);
    expect(readiness.cancelBooking).toHaveBeenCalledTimes(4);
  });
});
