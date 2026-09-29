import { describe, expect, it } from "vitest";
import { BLADES_HAIR_ID, DEMO_CLIENT_ID } from "./ids.js";
import { MemoryStore } from "./memory.js";
import { seedStore } from "./seed.js";
import { canTransitionOnboarding } from "./lifecycle.js";
import type {
  BookingRecord,
  CallSession,
  CreditLedgerEntry,
  Location,
  MessageEvent,
  MessageSession,
  MessageUsagePeriod,
  OnboardingJob,
  OveragePurchaseRecord,
  ProviderAccountSnapshot,
  ProviderAlertRule,
  ProviderDeployment,
  ProviderRollbackSnapshot,
  ProviderSwitchOperation,
  ProviderUsageCostEvent,
  ProvisioningRun,
  ScheduledFollowup,
  StripeEvent,
  UserProfile,
} from "./types.js";

const now = "2026-09-04T09:00:00.000Z";

describe("MemoryStore SaaS foundation", () => {
  it("keeps auth profiles and locations tenant scoped", async () => {
    const store = new MemoryStore();
    const profile = (clientId: string): UserProfile => ({
      id: `profile-${clientId}`,
      clientId,
      authUserId: "auth-user-1",
      email: "OWNER@EXAMPLE.COM",
      platformRole: "client",
      workspaceRole: "owner",
      createdAt: now,
      updatedAt: now,
    });
    await store.upsertUserProfile(profile("client-a"));
    await store.upsertUserProfile({ ...profile("client-b"), authUserId: "auth-user-2", email: "other@example.com" });
    await store.upsertUserProfile({
      id: "profile-admin",
      authUserId: "auth-admin",
      email: "admin@example.com",
      platformRole: "admin",
      createdAt: now,
      updatedAt: now,
    });

    const location: Location = {
      id: "loc-1",
      clientId: "client-a",
      slug: "main",
      name: "Main salon",
      timezone: "Europe/London",
      isPrimary: true,
      createdAt: now,
      updatedAt: now,
    };
    await store.upsertLocation(location);

    expect((await store.getUserProfile("client-a", "auth-user-1"))?.email).toBe("owner@example.com");
    expect((await store.getUserProfileByAuthUserId("auth-admin"))?.clientId).toBeUndefined();
    expect(await store.listUserProfiles("client-b")).toHaveLength(1);
    expect(await store.getLocation("client-b", "loc-1")).toBeUndefined();
  });

  it("claims webhook events and booking keys idempotently", async () => {
    const store = new MemoryStore();
    const event: StripeEvent = {
      id: "evt_1",
      clientId: "client-a",
      eventType: "customer.subscription.updated",
      livemode: true,
      payload: {},
      status: "processing",
      receivedAt: now,
    };
    expect(await store.claimStripeEvent(event)).toBe(true);
    expect(await store.claimStripeEvent(event)).toBe(false);

    const booking: BookingRecord = {
      id: "booking-1",
      clientId: "client-a",
      provider: "calcom",
      idempotencyKey: "conversation:slot",
      status: "confirmed",
      startsAt: now,
      endsAt: "2026-09-04T09:30:00.000Z",
      metadata: {},
      createdAt: now,
      updatedAt: now,
    };
    await store.saveBookingRecord(booking);
    expect((await store.findBookingByIdempotency("client-a", "conversation:slot"))?.id).toBe("booking-1");
    expect(await store.findBookingByIdempotency("client-b", "conversation:slot")).toBeUndefined();
  });

  it("rejects a provider call id reused by another tenant", async () => {
    const store = new MemoryStore();
    const call: CallSession = {
      id: "provider-call-1",
      clientId: "client-a",
      direction: "inbound",
      objective: "test",
      promptVersionId: "prompt-1",
      transcript: [],
      collected: {},
      toolHistory: [],
      state: "started",
      status: "active",
      createdAt: now,
      updatedAt: now,
    };
    await store.saveCall(call);
    await expect(store.saveCall({ ...call, clientId: "client-b" })).rejects.toThrow(
      "call_session_tenant_conflict",
    );
  });

  it("maintains an append-only credit balance and resumable provisioning run", async () => {
    const store = new MemoryStore();
    const grant: CreditLedgerEntry = {
      id: "credit-1",
      clientId: "client-a",
      minutes: 1_000,
      kind: "grant",
      createdAt: now,
    };
    expect(await store.appendCreditLedgerEntry(grant)).toBe(true);
    expect(await store.appendCreditLedgerEntry(grant)).toBe(false);
    await store.appendCreditLedgerEntry({ ...grant, id: "credit-2", minutes: -125, kind: "usage" });
    expect(await store.getCreditBalance("client-a")).toBe(875);

    const run: ProvisioningRun = {
      id: "run-1",
      clientId: "client-a",
      idempotencyKey: "signup-1",
      status: "running",
      input: { plan: "starter" },
      createdAt: now,
      updatedAt: now,
    };
    expect(await store.claimProvisioningRun(run)).toBe(true);
    expect(await store.claimProvisioningRun({ ...run, id: "run-duplicate" })).toBe(false);
    await store.saveProvisioningRun({ ...run, status: "succeeded", output: { agentId: "agent-1" } });
    expect((await store.getProvisioningRunByIdempotency("client-a", "signup-1"))?.status).toBe("succeeded");
  });

  it("stores provider control state with idempotent operations and events", async () => {
    const store = new MemoryStore();
    const deployment: ProviderDeployment = {
      id: "deployment-livekit", clientId: "client-a", provider: "livekit-cascade",
      status: "active", config: {}, createdAt: now, updatedAt: now,
    };
    await store.upsertProviderDeployment(deployment);
    expect((await store.getActiveProviderDeployment("client-a"))?.provider).toBe("livekit-cascade");
    await expect(store.upsertProviderDeployment({
      ...deployment, id: "retired-active", provider: "groq-gateway",
    })).rejects.toThrow("provider_retired");

    const operation: ProviderSwitchOperation = {
      id: "switch-1", clientId: "client-a", idempotencyKey: "switch-to-livekit",
      toDeploymentId: deployment.id, status: "pending", requestedBy: "operator",
      createdAt: now, updatedAt: now,
    };
    expect(await store.claimProviderSwitchOperation(operation)).toBe(true);
    expect(await store.claimProviderSwitchOperation({ ...operation, id: "switch-2" })).toBe(false);

    const rollback: ProviderRollbackSnapshot = {
      id: "rollback-1", clientId: "client-a", switchOperationId: operation.id,
      provider: "elevenlabs-convai", snapshot: { deploymentId: "old" }, createdAt: now,
    };
    expect(await store.saveProviderRollbackSnapshot(rollback)).toBe(true);
    expect(await store.saveProviderRollbackSnapshot({ ...rollback, id: "rollback-2" })).toBe(false);

    const usage: ProviderUsageCostEvent = {
      id: "usage-1", clientId: "client-a", provider: "livekit-cascade",
      providerEventId: "provider-event-1", occurredAt: now, usageQuantity: 30,
      usageUnit: "seconds", costMinor: 2, currency: "GBP", metadata: {}, createdAt: now,
    };
    expect(await store.appendProviderUsageCostEvent(usage)).toBe(true);
    expect(await store.appendProviderUsageCostEvent({ ...usage, id: "usage-2" })).toBe(false);
    expect(await store.listProviderUsageCostEvents("client-b")).toEqual([]);

    const account: ProviderAccountSnapshot = {
      id: "account-1", provider: "livekit-cascade", scope: "account", status: "healthy",
      usage: {}, limits: {}, cost: {}, capturedAt: now, createdAt: now,
    };
    await store.saveProviderAccountSnapshot(account);
    expect((await store.getLatestProviderAccountSnapshot("livekit-cascade"))?.id)
      .toBe(account.id);

    const rule: ProviderAlertRule = {
      id: "rule-1", clientId: "client-a", provider: "livekit-cascade",
      metric: "cost_minor", operator: "gte", threshold: 1_000, windowMinutes: 60,
      enabled: true, createdAt: now, updatedAt: now,
    };
    await store.upsertProviderAlertRule(rule);
    expect(await store.listProviderAlertRules("client-a")).toEqual([rule]);
  });

  it("isolates message allowance, provider deduplication, and overage claims", async () => {
    const store = new MemoryStore();
    const period: MessageUsagePeriod = {
      id: "messages-1", clientId: "client-a", channel: "whatsapp",
      periodStart: now, periodEnd: "2026-10-04T09:00:00.000Z",
      includedMessages: 2, usedMessages: 0, createdAt: now, updatedAt: now,
    };
    await store.upsertMessageUsagePeriod(period);
    expect((await store.consumeMessageAllowance(
      "client-a", "whatsapp", now, 2, now,
    ))?.usedMessages).toBe(2);
    expect(await store.consumeMessageAllowance("client-a", "whatsapp", now, 1, now))
      .toBeUndefined();
    expect(await store.getCreditBalance("client-a")).toBe(0);

    const session: MessageSession = {
      id: "session-1", clientId: "client-a", channel: "whatsapp",
      contactAddress: "whatsapp:+15550000001", senderAddress: "whatsapp:+15550000002",
      status: "active", state: {}, createdAt: now, updatedAt: now,
    };
    await store.saveMessageSession(session);
    const event: MessageEvent = {
      id: "message-1", clientId: "client-a", sessionId: session.id,
      channel: "whatsapp", direction: "inbound", provider: "twilio",
      providerMessageId: "SM123", idempotencyKey: "twilio:SM123", status: "received",
      billableUnits: 1, metadata: {}, occurredAt: now, createdAt: now,
    };
    expect(await store.appendMessageEvent(event)).toBe(true);
    expect(await store.appendMessageEvent({ ...event, id: "message-2" })).toBe(false);
    expect(await store.findMessageEventByProviderId("client-b", "twilio", "SM123"))
      .toBeUndefined();
    expect(await store.listMessageEvents("client-b", session.id)).toEqual([]);

    const followup: ScheduledFollowup = {
      id: "followup-1", clientId: "client-a", sessionId: session.id,
      channel: "whatsapp", recipient: session.contactAddress, template: "booking_reminder",
      idempotencyKey: "booking:1:reminder", payload: {}, status: "pending",
      scheduledAt: now, attemptCount: 0, maxAttempts: 2, createdAt: now, updatedAt: now,
    };
    expect(await store.enqueueScheduledFollowup(followup)).toBe(true);
    expect(await store.enqueueScheduledFollowup({ ...followup, id: "followup-2" })).toBe(false);
    expect((await store.claimScheduledFollowups("worker-a", now, 60, 1))[0])
      .toMatchObject({ id: followup.id, status: "leased", attemptCount: 1 });

    const purchase: OveragePurchaseRecord = {
      id: "overage-1", clientId: "client-a", idempotencyKey: "period:boundary:100",
      boundaryMinutes: 100, grantedMinutes: 100, amountMinor: 1500, currency: "USD",
      status: "pending", createdAt: now, updatedAt: now,
    };
    expect(await store.claimOveragePurchase(purchase)).toBe(true);
    expect(await store.claimOveragePurchase({ ...purchase, id: "overage-2" })).toBe(false);
    expect(await store.listCreditLedger("client-a")).toEqual([]);
  });

  it("reclaims only stale provisioning runs and guards writes by claim token", async () => {
    const store = new MemoryStore();
    const started = "2026-09-15T10:00:00.000Z";
    const run: ProvisioningRun = {
      id: "run-stale", clientId: "client-a", idempotencyKey: "stale-operation",
      status: "running", input: {}, claimToken: "first-owner",
      createdAt: started, updatedAt: started,
    };
    expect(await store.claimProvisioningRun(run, "first-owner", 300)).toBe(true);
    expect(await store.claimProvisioningRun({
      ...run, id: "run-healthy-attempt", updatedAt: "2026-09-15T10:04:59.000Z",
    }, "second-owner", 300)).toBe(false);
    const staleAttempt: ProvisioningRun = {
      ...run, id: "run-stale-attempt", updatedAt: "2026-09-15T10:05:01.000Z",
    };
    expect(await store.claimProvisioningRun(staleAttempt, "second-owner", 300)).toBe(true);
    expect(await store.saveProvisioningRun(
      { ...staleAttempt, status: "failed", claimToken: "first-owner" },
      "first-owner",
    )).toBe(false);
    expect((await store.getProvisioningRunByIdempotency("client-a", "stale-operation"))?.claimToken)
      .toBe("second-owner");
  });

  it("validates canonical and legacy onboarding transitions", () => {
    expect(canTransitionOnboarding("details_required", "integrations_required")).toBe(true);
    expect(canTransitionOnboarding("integrations_required", "provisioning")).toBe(false);
    expect(canTransitionOnboarding("setup_queued", "provisioning")).toBe(true);
    expect(canTransitionOnboarding("failed", "ready_to_provision")).toBe(true);
  });

  it("leases, retries and dead-letters onboarding jobs idempotently", async () => {
    const store = new MemoryStore();
    const job: OnboardingJob = {
      id: "job-1", clientId: "client-a", kind: "provision_client",
      idempotencyKey: "signup-1", status: "pending", payload: { operationKey: "signup-1" },
      attemptCount: 0, maxAttempts: 2, availableAt: now, createdAt: now, updatedAt: now,
    };
    expect(await store.enqueueOnboardingJob(job)).toBe(true);
    expect(await store.enqueueOnboardingJob({ ...job, id: "job-2" })).toBe(false);
    const [leased] = await store.claimOnboardingJobs("worker-a", now, 60, 1);
    expect(leased).toMatchObject({ status: "leased", attemptCount: 1, leaseOwner: "worker-a" });
    const heartbeatAt = new Date(Date.parse(now) + 30_000).toISOString();
    expect(await store.extendOnboardingJobLease("client-a", job.id, "worker-a", heartbeatAt, 600))
      .toBe(true);
    expect((await store.getOnboardingJob("client-a", job.id))?.leaseExpiresAt)
      .toBe(new Date(Date.parse(heartbeatAt) + 600_000).toISOString());
    expect(await store.completeOnboardingJob("client-a", job.id, "worker-b", now)).toBe(false);
    expect(await store.retryOnboardingJob("client-a", job.id, "worker-a", "temporary", now)).toBe(true);
    const [second] = await store.claimOnboardingJobs("worker-b", now, 60, 1);
    expect(second.attemptCount).toBe(2);
    expect(await store.retryOnboardingJob("client-a", job.id, "worker-b", "again", now)).toBe(false);
    expect(await store.deadLetterOnboardingJob("client-a", job.id, "worker-b", "exhausted", now)).toBe(true);
    expect((await store.getOnboardingJob("client-a", job.id))?.status).toBe("dead_letter");
  });

  it("deletes a client and the rows that do not cascade", async () => {
    const store = new MemoryStore();
    await seedStore(store);
    store.calls.set("call_blades", {
      id: "call_blades",
      clientId: BLADES_HAIR_ID,
      direction: "inbound",
      objective: "book",
      promptVersionId: "pv_test",
      transcript: [],
      collected: {},
      toolHistory: [],
      state: "done",
      status: "completed",
      createdAt: now,
      updatedAt: now,
    });
    store.calls.set("call_demo", {
      id: "call_demo",
      clientId: DEMO_CLIENT_ID,
      direction: "inbound",
      objective: "book",
      promptVersionId: "pv_demo",
      transcript: [],
      collected: {},
      toolHistory: [],
      state: "done",
      status: "completed",
      createdAt: now,
      updatedAt: now,
    });
    store.tools.push({
      id: "tool_blades",
      callId: "call_blades",
      clientId: BLADES_HAIR_ID,
      name: "create_booking",
      input: {},
      result: {},
      at: now,
    });
    store.suppressions.push(
      { clientId: BLADES_HAIR_ID, phone: "+447700900111", reason: "opt-out", createdAt: now },
      { clientId: DEMO_CLIENT_ID, phone: "+447700900222", reason: "opt-out", createdAt: now },
    );
    store.usage.set(`${BLADES_HAIR_ID}:2026-09`, {
      clientId: BLADES_HAIR_ID, month: "2026-09", inboundMinutes: 3, outboundMinutes: 1,
    });
    store.usage.set(`${DEMO_CLIENT_ID}:2026-09`, {
      clientId: DEMO_CLIENT_ID, month: "2026-09", inboundMinutes: 2, outboundMinutes: 0,
    });
    await store.appendOperatorAudit({
      id: "audit_delete",
      clientId: BLADES_HAIR_ID,
      actorId: "user_operator",
      action: "workspace.deleted",
      detail: { clientId: BLADES_HAIR_ID, businessName: "Blades Hair" },
      createdAt: now,
    });

    expect(await store.deleteClient("missing_client")).toBe(false);
    expect(await store.deleteClient(BLADES_HAIR_ID)).toBe(true);
    expect(await store.getClient(BLADES_HAIR_ID)).toBeUndefined();
    expect((await store.listClients()).some((client) => client.id === BLADES_HAIR_ID)).toBe(false);
    expect(await store.getClient(DEMO_CLIENT_ID)).toBeTruthy();
    expect(store.prompts.some((prompt) => prompt.clientId === BLADES_HAIR_ID)).toBe(false);
    expect(store.prompts.some((prompt) => prompt.clientId === DEMO_CLIENT_ID)).toBe(true);
    expect(store.calls.has("call_blades")).toBe(false);
    expect(store.calls.has("call_demo")).toBe(true);
    expect(store.tools.some((tool) => tool.clientId === BLADES_HAIR_ID)).toBe(false);
    expect(store.suppressions.map((item) => item.clientId)).toEqual([DEMO_CLIENT_ID]);
    expect(store.usage.has(`${BLADES_HAIR_ID}:2026-09`)).toBe(false);
    expect(store.usage.has(`${DEMO_CLIENT_ID}:2026-09`)).toBe(true);
    expect((await store.listOperatorAudit())[0]).toMatchObject({
      action: "workspace.deleted",
      clientId: undefined,
      detail: { businessName: "Blades Hair" },
    });
  });
});
