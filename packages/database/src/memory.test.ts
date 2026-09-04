import { describe, expect, it } from "vitest";
import { MemoryStore } from "./memory.js";
import type {
  BookingRecord,
  CreditLedgerEntry,
  Location,
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
});
