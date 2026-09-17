import type http from "node:http";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { compilePrompt } from "@robinexis/brain";
import { encryptTwilioCredential } from "@robinexis/integrations";
import {
  DEMO_CLIENT_ID,
  MemoryStore,
  SMITH_ENGLAND_ID,
  seedStore,
} from "@robinexis/database";
import type { AuthenticatedActor } from "./auth.js";
import { handleProductRoute } from "./productRoutes.js";

const now = "2026-09-15T10:00:00.000Z";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function preparedApprovalStore() {
  const store = new MemoryStore();
  await seedStore(store);
  const client = (await store.getClient(DEMO_CLIENT_ID))!;
  await store.upsertMembership({
    id: "membership_owner", clientId: client.id, email: "owner@example.test",
    role: "owner", createdAt: now,
  });
  client.onboardingStatus = "awaiting_approval";
  client.elevenlabsAgentId = "agent_staged";
  client.inboundNumbers = ["+441134960020"];
  client.published = false;
  await store.upsertClient(client);
  await store.saveDraftClient({
    id: "revision_ready", clientId: client.id, status: "draft",
    config: { ...client, businessName: "Approved Business", published: false },
    createdBy: "owner", createdAt: now, updatedAt: now,
  });
  await store.upsertSubscription({
    id: "subscription_ready", clientId: client.id, provider: "stripe",
    planTier: "starter", status: "trialing", cancelAtPeriodEnd: false,
    metadata: {}, createdAt: now, updatedAt: now,
  });
  await store.upsertLocation({
    id: "location_ready", clientId: client.id, slug: "primary", name: "Approved Business",
    timezone: "Europe/London", isPrimary: true, createdAt: now, updatedAt: now,
  });
  await store.upsertCalendarConnection({
    id: "calendar_ready", clientId: client.id, locationId: "location_ready",
    provider: "calcom", status: "active", metadata: {}, createdAt: now, updatedAt: now,
  });
  await store.upsertTwilioConnection({
    id: "twilio_ready", clientId: client.id, mode: "customer_oauth", status: "active",
    selectedPhoneNumber: "+441134960020", metadata: {}, createdAt: now, updatedAt: now,
  });
  await store.upsertAgentInstance({
    id: "agent_instance_ready", clientId: client.id, locationId: "location_ready",
    provider: "elevenlabs", providerAgentId: "agent_staged", name: "Staged agent",
    status: "pending", config: {}, createdAt: now, updatedAt: now,
  });
  await store.upsertPhoneEndpoint({
    id: "phone_ready", clientId: client.id, locationId: "location_ready",
    agentInstanceId: "agent_instance_ready", provider: "twilio", e164: "+441134960020",
    direction: "inbound", status: "pending",
    metadata: {}, createdAt: now, updatedAt: now,
  });
  await store.saveWebsiteSource({
    id: "source_ready", clientId: client.id, url: "https://example.test", status: "active",
    metadata: { approvedRunId: "extraction_ready" }, createdAt: now, updatedAt: now,
  });
  await store.saveWebsiteExtractionRun({
    id: "extraction_ready", clientId: client.id, sourceId: "source_ready",
    status: "succeeded", extractorVersion: "test", createdAt: now, updatedAt: now,
  });
  await store.replaceExtractedFacts(client.id, "extraction_ready", [{
    id: "fact_ready", clientId: client.id, extractionRunId: "extraction_ready",
    key: "businessName", value: "Approved Business", reviewStatus: "confirmed",
    reviewedBy: "owner", reviewedAt: now, createdAt: now,
  }]);
  await store.saveOnboardingWizard({
    clientId: client.id, currentStep: "review",
    completedSteps: ["website", "facts", "behavior", "operations", "phone", "calendar", "review"],
    data: { websiteRunId: "extraction_ready" }, version: 1, submittedAt: now,
    createdAt: now, updatedAt: now,
  });
  const effective = (await store.getDraftClient(client.id))!.config;
  const compiledPrompt = compilePrompt({
    client: effective,
    direction: "inbound",
    objective: "Answer, book, reschedule, cancel, capture a callback, or transfer safely.",
  });
  const {
    onboardingStatus: _onboardingStatus,
    onboardingNotes: _onboardingNotes,
    onboardingEta: _onboardingEta,
    elevenlabsAgentId: _elevenlabsAgentId,
    inboundNumbers: _inboundNumbers,
    published: _published,
    promptVersionId: _promptVersionId,
    ...profile
  } = effective;
  const profileChecksum = createHash("sha256")
    .update(JSON.stringify({ client: profile, compiledPrompt }))
    .digest("hex");
  await store.claimProvisioningRun({
    id: "provision_ready", clientId: client.id, idempotencyKey: "ready-v1",
    status: "succeeded", step: "awaiting_approval", input: {},
    output: {
      compiledPrompt,
      profileChecksum,
      elevenlabsAgentId: "agent_staged",
      readinessReport: { generatedAt: now, passed: true, hardGaps: [], checks: [] },
    },
    startedAt: now, finishedAt: now, createdAt: now, updatedAt: now,
  });
  return store;
}

async function request(
  store: MemoryStore,
  actor: AuthenticatedActor,
  path: string,
  method = "POST",
  requestBody?: unknown,
) {
  let status = 0;
  let body: any;
  await handleProductRoute({
    req: { method } as http.IncomingMessage,
    res: {} as http.ServerResponse,
    url: new URL(path, "http://localhost"),
    store,
    actor,
    readRaw: async () => Buffer.from(requestBody === undefined ? "" : JSON.stringify(requestBody)),
    send: (_res, code, value) => { status = code; body = value; },
  });
  return { status, body };
}

describe("customer provisioning approval", () => {
  it("atomically publishes and activates staged resources for the workspace owner", async () => {
    const store = await preparedApprovalStore();
    const owner: AuthenticatedActor = {
      subject: "owner", email: "owner@example.test", role: "salon",
      clientRoles: { [DEMO_CLIENT_ID]: "owner" },
    };
    const first = await request(store, owner,
      `/api/v1/clients/${DEMO_CLIENT_ID}/provisioning/provision_ready/approve`);
    expect(first).toMatchObject({ status: 200, body: { activated: true } });
    expect(await store.getClient(DEMO_CLIENT_ID)).toMatchObject({
      businessName: "Approved Business", published: true, onboardingStatus: "active",
      elevenlabsAgentId: "agent_staged",
    });
    expect((await store.listAgentInstances(DEMO_CLIENT_ID))[0]?.status).toBe("active");
    expect((await store.listPhoneEndpoints(DEMO_CLIENT_ID))[0]?.status).toBe("pending");

    const replay = await request(store, owner,
      `/api/v1/clients/${DEMO_CLIENT_ID}/provisioning/provision_ready/approve`);
    expect(replay.status).toBe(200);
    expect((await store.listOperatorAudit(DEMO_CLIENT_ID))
      .filter((item) => item.action === "provisioning.owner_activated")).toHaveLength(1);
  });

  it("rejects managers and cross-tenant approval attempts", async () => {
    const store = await preparedApprovalStore();
    const manager: AuthenticatedActor = {
      subject: "manager", email: "manager@example.test", role: "salon",
      clientRoles: { [DEMO_CLIENT_ID]: "manager" },
    };
    expect((await request(store, manager,
      `/api/v1/clients/${DEMO_CLIENT_ID}/provisioning/provision_ready/approve`)).status).toBe(403);
    const operator: AuthenticatedActor = {
      subject: "operator", email: "operator@robinexis.test", role: "operator", clientRoles: {},
    };
    expect((await request(store, operator,
      `/api/v1/clients/${DEMO_CLIENT_ID}/provisioning/provision_ready/approve`)).status).toBe(403);
    const otherOwner: AuthenticatedActor = {
      subject: "other", email: "other@example.test", role: "salon",
      clientRoles: { [SMITH_ENGLAND_ID]: "owner" },
    };
    expect((await request(store, otherOwner,
      `/api/v1/clients/${DEMO_CLIENT_ID}/provisioning/provision_ready/approve`)).status).toBe(404);
  });

  it("returns exact gate blockers without partially activating", async () => {
    const store = await preparedApprovalStore();
    const subscription = (await store.getCurrentSubscription(DEMO_CLIENT_ID))!;
    subscription.status = "past_due";
    await store.upsertSubscription(subscription);
    const owner: AuthenticatedActor = {
      subject: "owner", email: "owner@example.test", role: "salon",
      clientRoles: { [DEMO_CLIENT_ID]: "owner" },
    };
    const response = await request(store, owner,
      `/api/v1/clients/${DEMO_CLIENT_ID}/provisioning/provision_ready/approve`);
    expect(response).toMatchObject({
      status: 409,
      body: { error: "activation_requirements_not_met", blockers: ["billing_inactive"] },
    });
    expect(await store.getClient(DEMO_CLIENT_ID)).toMatchObject({
      published: false, onboardingStatus: "awaiting_approval",
    });
    expect((await store.listAgentInstances(DEMO_CLIENT_ID))[0]?.status).toBe("pending");
  });

  it("rejects activation when the tested draft checksum no longer matches", async () => {
    const store = await preparedApprovalStore();
    const draft = (await store.getDraftClient(DEMO_CLIENT_ID))!;
    draft.config.greeting = "Changed after readiness";
    draft.updatedAt = "2026-09-15T10:01:00.000Z";
    await store.saveDraftClient(draft);
    const owner: AuthenticatedActor = {
      subject: "owner", email: "owner@example.test", role: "salon",
      clientRoles: { [DEMO_CLIENT_ID]: "owner" },
    };
    const response = await request(store, owner,
      `/api/v1/clients/${DEMO_CLIENT_ID}/provisioning/provision_ready/approve`);
    expect(response).toMatchObject({
      status: 409,
      body: { blockers: ["provisioning_profile_changed"] },
    });
    expect((await store.listPhoneEndpoints(DEMO_CLIENT_ID))[0]?.status).toBe("pending");
  });

  it("redacts internal run state from all customer and admin run responses", async () => {
    const store = await preparedApprovalStore();
    const run = (await store.getProvisioningRun(DEMO_CLIENT_ID, "provision_ready"))!;
    run.claimToken = "secret-claim-token";
    run.output = {
      ...run.output,
      providerSecretId: "secret-provider-id",
      syntheticBookingUid: "secret-booking-uid",
      activationIntent: { operationKey: "secret-operation-key" },
    };
    await store.saveProvisioningRun(run);
    const owner: AuthenticatedActor = {
      subject: "owner", email: "owner@example.test", role: "salon",
      clientRoles: { [DEMO_CLIENT_ID]: "owner" },
    };
    const responses = await Promise.all([
      request(store, owner, `/api/v1/clients/${DEMO_CLIENT_ID}/provisioning`, "GET"),
      request(store, owner, `/api/v1/clients/${DEMO_CLIENT_ID}/onboarding`, "GET"),
      request(store, owner, `/api/v1/clients/${DEMO_CLIENT_ID}/onboarding/wizard`, "GET"),
    ]);
    const operator: AuthenticatedActor = {
      subject: "operator", email: "operator@example.test", role: "operator", clientRoles: {},
    };
    responses.push(await request(
      store,
      operator,
      `/api/v1/clients/${DEMO_CLIENT_ID}/provisioning/provision_ready/action`,
      "POST",
      { action: "review" },
    ));
    responses.push(await request(store, operator, "/api/v1/admin/control-plane", "GET"));
    for (const response of responses) {
      expect(response.status).toBe(200);
      const serialized = JSON.stringify(response.body);
      expect(serialized).not.toContain("compiledPrompt");
      expect(serialized).not.toContain("providerSecretId");
      expect(serialized).not.toContain("syntheticBookingUid");
      expect(serialized).not.toContain("activationIntent");
      expect(serialized).not.toContain("secret-claim-token");
    }
    expect(responses[0].body.items[0].output.readinessReport.passed).toBe(true);
  });

  it("assigns the staged phone only during owner activation", async () => {
    const store = await preparedApprovalStore();
    await store.upsertPhoneEndpoint({
      id: "unrelated_phone",
      clientId: DEMO_CLIENT_ID,
      provider: "twilio",
      e164: "+441134960099",
      direction: "inbound",
      status: "pending",
      metadata: { assignmentStatus: "awaiting_owner_approval" },
      createdAt: now,
      updatedAt: now,
    });
    const run = (await store.getProvisioningRun(DEMO_CLIENT_ID, "provision_ready"))!;
    run.output = {
      ...run.output,
      phoneNumber: "+441134960020",
    };
    await store.saveProvisioningRun(run);
    vi.stubEnv("ELEVENLABS_API_KEY", "management-key");
    vi.stubEnv("TWILIO_OAUTH_ENCRYPTION_KEY", "activation-encryption-key");
    const connection = (await store.getTwilioConnection(DEMO_CLIENT_ID))!;
    connection.apiKeySid = "SK_activation";
    connection.encryptedApiKeySecret = encryptTwilioCredential("activation-secret");
    connection.encryptedAccountAuthToken = encryptTwilioCredential("account-auth-token");
    await store.upsertTwilioConnection(connection);
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ phone_number_id: "phone_provider_ready" }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ phone_number_id: "phone_provider_ready" }), { status: 200 }),
      );
    const owner: AuthenticatedActor = {
      subject: "owner", email: "owner@example.test", role: "salon",
      clientRoles: { [DEMO_CLIENT_ID]: "owner" },
    };
    const response = await request(store, owner,
      `/api/v1/clients/${DEMO_CLIENT_ID}/provisioning/provision_ready/approve`);
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const importBody = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body));
    expect(importBody).toMatchObject({
      phone_number: "+441134960020",
      sid: "SK_activation",
      token: "activation-secret",
      account_auth_token: "account-auth-token",
    });
    const [, init] = fetchMock.mock.calls[1]!;
    expect(JSON.parse(String(init?.body))).toEqual({ agent_id: "agent_staged" });
    expect((await store.listPhoneEndpoints(DEMO_CLIENT_ID))[0]).toMatchObject({
      status: "active",
      metadata: { assignmentStatus: "active", activatedRunId: "provision_ready" },
    });
    expect((await store.listPhoneEndpoints(DEMO_CLIENT_ID))
      .find((endpoint) => endpoint.id === "unrelated_phone")?.status).toBe("pending");
  });

  it("blocks customer-owned inbound activation without the encrypted account auth token", async () => {
    const store = await preparedApprovalStore();
    const run = (await store.getProvisioningRun(DEMO_CLIENT_ID, "provision_ready"))!;
    run.output = { ...run.output, phoneNumber: "+441134960020" };
    await store.saveProvisioningRun(run);
    const connection = (await store.getTwilioConnection(DEMO_CLIENT_ID))!;
    connection.apiKeySid = "SK_activation";
    connection.encryptedApiKeySecret = "encrypted-api-key-secret";
    connection.encryptedAccountAuthToken = undefined;
    await store.upsertTwilioConnection(connection);
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const owner: AuthenticatedActor = {
      subject: "owner", email: "owner@example.test", role: "salon",
      clientRoles: { [DEMO_CLIENT_ID]: "owner" },
    };
    const response = await request(store, owner,
      `/api/v1/clients/${DEMO_CLIENT_ID}/provisioning/provision_ready/approve`);
    expect(response).toMatchObject({
      status: 409,
      body: { blockers: ["twilio_account_auth_token_missing"] },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("persists activation intent, compensates a finalize failure, and safely resumes", async () => {
    const store = await preparedApprovalStore();
    const run = (await store.getProvisioningRun(DEMO_CLIENT_ID, "provision_ready"))!;
    run.output = { ...run.output, phoneNumber: "+441134960020" };
    await store.saveProvisioningRun(run);
    vi.stubEnv("ELEVENLABS_API_KEY", "management-key");
    vi.stubEnv("TWILIO_OAUTH_ENCRYPTION_KEY", "activation-encryption-key");
    const connection = (await store.getTwilioConnection(DEMO_CLIENT_ID))!;
    connection.apiKeySid = "SK_activation";
    connection.encryptedApiKeySecret = encryptTwilioCredential("activation-secret");
    connection.encryptedAccountAuthToken = encryptTwilioCredential("account-auth-token");
    await store.upsertTwilioConnection(connection);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify({ phone_number_id: "phone_provider_ready" }), { status: 200 }));
    const originalFinalize = store.finalizeProvisionedClientActivation.bind(store);
    vi.spyOn(store, "finalizeProvisionedClientActivation")
      .mockRejectedValueOnce(new Error("simulated_db_commit_failure"))
      .mockImplementation(originalFinalize);
    const owner: AuthenticatedActor = {
      subject: "owner", email: "owner@example.test", role: "salon",
      clientRoles: { [DEMO_CLIENT_ID]: "owner" },
    };

    const failed = await request(store, owner,
      `/api/v1/clients/${DEMO_CLIENT_ID}/provisioning/provision_ready/approve`);
    expect(failed.status).toBe(502);
    expect(await store.getClient(DEMO_CLIENT_ID)).toMatchObject({
      published: false,
      onboardingStatus: "needs_attention",
    });
    expect(await store.getProvisioningRun(DEMO_CLIENT_ID, "provision_ready")).toMatchObject({
      status: "paused",
      step: "activation_needs_attention",
      output: {
        activationIntent: {
          providerPhoneNumberId: "phone_provider_ready",
          assignmentStatus: "needs_attention",
          rollbackStatus: "deleted",
        },
      },
    });

    const resumed = await request(store, owner,
      `/api/v1/clients/${DEMO_CLIENT_ID}/provisioning/provision_ready/approve`);
    expect(resumed).toMatchObject({ status: 200, body: { activated: true } });
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/v1/convai/phone-numbers")))
      .toHaveLength(2);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(true);
  });

  it("keeps activation blocked when imported-phone deletion compensation fails", async () => {
    const store = await preparedApprovalStore();
    const run = (await store.getProvisioningRun(DEMO_CLIENT_ID, "provision_ready"))!;
    run.output = { ...run.output, phoneNumber: "+441134960020" };
    await store.saveProvisioningRun(run);
    vi.stubEnv("ELEVENLABS_API_KEY", "management-key");
    vi.stubEnv("TWILIO_OAUTH_ENCRYPTION_KEY", "activation-encryption-key");
    const connection = (await store.getTwilioConnection(DEMO_CLIENT_ID))!;
    connection.apiKeySid = "SK_activation";
    connection.encryptedApiKeySecret = encryptTwilioCredential("activation-secret");
    connection.encryptedAccountAuthToken = encryptTwilioCredential("account-auth-token");
    await store.upsertTwilioConnection(connection);
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) =>
      init?.method === "DELETE"
        ? new Response(JSON.stringify({ detail: "cannot delete" }), { status: 500 })
        : new Response(JSON.stringify({ phone_number_id: "phone_provider_ready" }), { status: 200 }));
    vi.spyOn(store, "finalizeProvisionedClientActivation")
      .mockRejectedValueOnce(new Error("simulated_db_commit_failure"));
    const owner: AuthenticatedActor = {
      subject: "owner", email: "owner@example.test", role: "salon",
      clientRoles: { [DEMO_CLIENT_ID]: "owner" },
    };
    const failed = await request(store, owner,
      `/api/v1/clients/${DEMO_CLIENT_ID}/provisioning/provision_ready/approve`);
    expect(failed).toMatchObject({
      status: 502,
      body: { error: expect.stringContaining("activation_rollback_incomplete") },
    });
    expect(await store.getProvisioningRun(DEMO_CLIENT_ID, "provision_ready")).toMatchObject({
      status: "paused",
      output: { activationIntent: { rollbackStatus: "failed" } },
    });
    const retry = await request(store, owner,
      `/api/v1/clients/${DEMO_CLIENT_ID}/provisioning/provision_ready/approve`);
    expect(retry).toMatchObject({
      status: 409,
      body: { blockers: ["provider_rollback_incomplete"] },
    });
  });
});
