import { describe, expect, it, vi } from "vitest";
import { MemoryStore, robinexisDemoSeed, type ClientConfig } from "@robinexis/database";
import { reconcileBillingAccess } from "./billingAccess.js";

describe("billing access reconciliation", () => {
  it("unassigns without deleting and restores the same phone assignment", async () => {
    const store = new MemoryStore();
    const client: ClientConfig = {
      ...robinexisDemoSeed(),
      id: "client_billing_test",
      slug: "billing-test",
      published: true,
      onboardingStatus: "active" as const,
      serviceStatus: "canceled" as const,
    };
    await store.upsertClient(client);
    await store.upsertSubscription({
      id: "sub_billing_test",
      clientId: client.id,
      provider: "stripe",
      providerCustomerId: "cus_test",
      providerSubscriptionId: "sub_test",
      planTier: "starter",
      status: "canceled",
      cancelAtPeriodEnd: false,
      metadata: {},
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    });
    await store.upsertProviderResource({
      id: "resource_phone",
      clientId: client.id,
      provider: "elevenlabs",
      resourceType: "phone_number",
      providerResourceId: "phone_provider_1",
      lifecycleStatus: "active",
      metadata: { agentId: "agent_provider_1", assignmentState: "assigned" },
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    });
    const management = {
      assignAgentToPhoneNumber: vi.fn(async () => ({ phone_number_id: "phone_provider_1" })),
      unassignAgentFromPhoneNumber: vi.fn(async () => ({ phone_number_id: "phone_provider_1" })),
    };

    await expect(reconcileBillingAccess(store, { management })).resolves.toMatchObject({
      suspended: 1,
      restored: 0,
    });
    expect(management.unassignAgentFromPhoneNumber).toHaveBeenCalledWith(
      "phone_provider_1",
      expect.stringContaining("billing-suspend"),
    );
    expect((await store.listProviderResources(client.id))[0]?.metadata.assignmentState).toBe("suspended");

    client.serviceStatus = "active";
    await store.upsertClient(client);
    const subscription = await store.getCurrentSubscription(client.id);
    subscription!.status = "active";
    subscription!.updatedAt = "2026-09-02T00:00:00.000Z";
    await store.upsertSubscription(subscription!);
    await store.appendCreditLedgerEntry({
      id: "credit_billing_test",
      clientId: client.id,
      minutes: 300,
      kind: "grant",
      referenceType: "test",
      referenceId: "restore",
      description: "test credit",
      createdAt: "2026-09-02T00:00:00.000Z",
    });

    await expect(reconcileBillingAccess(store, { management })).resolves.toMatchObject({
      suspended: 0,
      restored: 1,
    });
    expect(management.assignAgentToPhoneNumber).toHaveBeenCalledWith(
      "phone_provider_1",
      "agent_provider_1",
      expect.stringContaining("billing-restore"),
    );
  });
});
