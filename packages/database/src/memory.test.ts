import { describe, expect, it } from "vitest";
import { MemoryStore } from "./memory.js";
import { canTransitionOnboarding } from "./lifecycle.js";
import type {
  BookingRecord,
  CallSession,
  CreditLedgerEntry,
  Location,
  OnboardingJob,
  ProvisioningRun,
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
});
