import { describe, expect, it } from "vitest";
import {
  BLADES_HAIR_ID,
  DEMO_CLIENT_ID,
  MemoryStore,
  seedStore,
  type CallSession,
} from "@robinexis/database";
import type http from "node:http";
import type { AuthenticatedActor } from "./auth.js";
import { handleProductRoute } from "./productRoutes.js";

const salonActor: AuthenticatedActor = {
  subject: "user_salon",
  email: "owner@blades.test",
  role: "salon",
  clientRoles: { [BLADES_HAIR_ID]: "owner" },
};

const operatorActor: AuthenticatedActor = {
  subject: "user_operator",
  email: "operator@robinexis.test",
  role: "operator",
  clientRoles: {},
};

const pendingActor: AuthenticatedActor = {
  subject: "user_pending",
  email: "new@business.test",
  role: "pending",
  clientRoles: {},
};

async function request(
  store: MemoryStore,
  actor: AuthenticatedActor,
  path: string,
  method = "GET",
  requestBody?: unknown,
) {
  let status = 0;
  let body: any;
  const url = new URL(path, "http://localhost");
  const handled = await handleProductRoute({
    req: { method } as http.IncomingMessage,
    res: {} as http.ServerResponse,
    url,
    store,
    actor,
    readRaw: async () => Buffer.from(requestBody === undefined ? "" : JSON.stringify(requestBody)),
    send: (_res, responseStatus, responseBody) => {
      status = responseStatus;
      body = responseBody;
    },
  });
  return { handled, status, body };
}

describe("product route tenant authorization", () => {
  it("lets pending signups inspect only their empty onboarding state", async () => {
    const store = new MemoryStore();
    await seedStore(store);

    const session = await request(store, pendingActor, "/api/v1/session");
    expect(session).toMatchObject({
      status: 200,
      body: { role: "pending", capabilities: { administerPlatform: false } },
    });
    const clients = await request(store, pendingActor, "/api/v1/clients");
    expect(clients).toMatchObject({ status: 200, body: { items: [] } });
    const admin = await request(store, pendingActor, "/api/v1/admin/summary");
    expect(admin).toMatchObject({ status: 403, body: { error: "platform_admin_required" } });
  });

  it("does not create an orphan workspace when Stripe checkout is not configured", async () => {
    const store = new MemoryStore();
    await seedStore(store);
    const existing = (await store.listClients()).map((client) => client.id);
    const previousSecret = process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_SECRET_KEY;

    const checkout = await request(store, pendingActor, "/api/v1/billing/checkout", "POST", {
      plan: "starter",
    });
    if (previousSecret === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = previousSecret;

    expect(checkout).toMatchObject({ status: 503, body: { error: "stripe_not_configured" } });
    const created = (await store.listClients()).find((client) => !existing.includes(client.id));
    expect(created).toBeUndefined();
    await expect(store.getUserProfileByAuthUserId(pendingActor.subject)).resolves.toBeUndefined();
  });

  it("limits salon users to assigned workspaces while operators see every tenant", async () => {
    const store = new MemoryStore();
    await seedStore(store);

    const salon = await request(store, salonActor, "/api/v1/clients");
    expect(salon.status).toBe(200);
    expect(salon.body.items.map((client: { id: string }) => client.id)).toEqual([BLADES_HAIR_ID]);

    const operator = await request(store, operatorActor, "/api/v1/clients");
    expect(operator.status).toBe(200);
    expect(operator.body.items.length).toBeGreaterThan(1);
  });

  it("reports admin notification health without exposing tenant recipients", async () => {
    const store = new MemoryStore();
    await seedStore(store);
    const now = new Date().toISOString();
    await store.enqueueNotification({
      id: "notification_health", clientId: BLADES_HAIR_ID, operationId: "op_health",
      idempotencyKey: "health:1", channel: "email", recipient: "owner@blades.test",
      template: "Status update", status: "pending", attemptCount: 0, maxAttempts: 5,
      nextAttemptAt: now, createdAt: now, updatedAt: now,
    });
    const response = await request(store, operatorActor, "/api/v1/admin/control-plane");
    expect(response).toMatchObject({
      status: 200,
      body: { health: { notificationQueue: { pending: 1, providerFailures24h: 0 } } },
    });
    expect(JSON.stringify(response.body)).not.toContain("owner@blades.test");
    const forbidden = await request(
      store, salonActor, `/api/v1/clients/${DEMO_CLIENT_ID}/notifications/status`,
    );
    expect(forbidden.status).toBe(404);
  });

  it("lets only operators triage customer requests and records the change", async () => {
    const store = new MemoryStore();
    await seedStore(store);
    const now = new Date().toISOString();
    await store.saveTenantRequest({
      id: "request_triage_test",
      clientId: BLADES_HAIR_ID,
      type: "support",
      status: "pending",
      requestedBy: "owner@blades.test",
      payload: { subject: "Opening hours" },
      createdAt: now,
      updatedAt: now,
    });

    const forbidden = await request(
      store,
      salonActor,
      "/api/v1/admin/requests/request_triage_test/status",
      "POST",
      { status: "in_progress" },
    );
    expect(forbidden.status).toBe(403);

    const updated = await request(
      store,
      operatorActor,
      "/api/v1/admin/requests/request_triage_test/status",
      "POST",
      { status: "completed" },
    );
    expect(updated).toMatchObject({
      status: 200,
      body: { request: { id: "request_triage_test", status: "completed" } },
    });
    expect((await store.listOperatorAudit(BLADES_HAIR_ID))[0]).toMatchObject({
      action: "support.status_changed",
      detail: { requestId: "request_triage_test", status: "completed" },
    });
  });

  it("authorizes self-serve finalize only for the owning salon", async () => {
    const store = new MemoryStore();
    await seedStore(store);
    const previous = process.env.SAAS_PROVISIONING_ENABLED;
    process.env.SAAS_PROVISIONING_ENABLED = "false";
    try {
      const now = new Date().toISOString();
      await store.upsertSubscription({
        id: "subscription_onboarding_test",
        clientId: BLADES_HAIR_ID,
        provider: "stripe",
        planTier: "starter",
        status: "trialing",
        cancelAtPeriodEnd: false,
        metadata: {},
        createdAt: now,
        updatedAt: now,
      });
      const own = await request(
        store,
        salonActor,
        `/api/v1/clients/${BLADES_HAIR_ID}/onboarding/finalize`,
        "POST",
        {
          businessName: "Isolated Test Salon",
          transferNumber: "+447700900123",
          services: [{ title: "Cut", slug: "cut", durationMinutes: 30 }],
          phoneMode: "robinexis_account",
        },
      );
      expect(own).toMatchObject({ status: 202, body: { onboardingStatus: "setup_queued" } });
      expect((await store.getClient(BLADES_HAIR_ID))?.onboardingStatus).toBe("setup_queued");
      expect(await store.listProvisioningRuns(BLADES_HAIR_ID)).toEqual([]);
      expect((await store.listOperatorAudit(BLADES_HAIR_ID))[0]?.action).toBe("onboarding.setup_queued");
      const other = await request(
        store,
        salonActor,
        `/api/v1/clients/${DEMO_CLIENT_ID}/onboarding/finalize`,
        "POST",
        {},
      );
      expect(other).toMatchObject({ status: 404, body: { error: "client_not_found" } });
    } finally {
      if (previous === undefined) delete process.env.SAAS_PROVISIONING_ENABLED;
      else process.env.SAAS_PROVISIONING_ENABLED = previous;
    }
  });

  it("authorizes the Stripe portal only for the owning workspace", async () => {
    const store = new MemoryStore();
    await seedStore(store);
    const own = await request(store, salonActor, "/api/v1/billing/portal", "POST", {
      clientId: BLADES_HAIR_ID,
    });
    expect(own).toMatchObject({ status: 409, body: { error: "billing_profile_pending" } });
    const other = await request(store, salonActor, "/api/v1/billing/portal", "POST", {
      clientId: DEMO_CLIENT_ID,
    });
    expect(other).toMatchObject({ status: 404, body: { error: "client_not_found" } });
  });

  it("reports tenant usage for the current billing period without shared provider data", async () => {
    const store = new MemoryStore();
    await seedStore(store);
    const now = new Date();
    const start = new Date(now.getTime() - 86_400_000).toISOString();
    const end = new Date(now.getTime() + 29 * 86_400_000).toISOString();
    await store.upsertSubscription({
      id: "subscription_period_usage",
      clientId: BLADES_HAIR_ID,
      provider: "stripe",
      planTier: "starter",
      status: "active",
      currentPeriodStart: start,
      currentPeriodEnd: end,
      cancelAtPeriodEnd: false,
      metadata: {},
      createdAt: start,
      updatedAt: now.toISOString(),
    });
    await store.appendCreditLedgerEntry({
      id: "period_grant",
      clientId: BLADES_HAIR_ID,
      kind: "grant",
      minutes: 300,
      referenceType: "stripe_subscription_period",
      referenceId: "period_current",
      createdAt: now.toISOString(),
    });
    await store.appendCreditLedgerEntry({
      id: "period_usage",
      clientId: BLADES_HAIR_ID,
      kind: "usage",
      minutes: -24,
      referenceType: "call",
      referenceId: "call_period",
      createdAt: now.toISOString(),
    });
    await store.upsertMessageUsagePeriod({
      id: "message_usage_period",
      clientId: BLADES_HAIR_ID,
      channel: "whatsapp",
      periodStart: start,
      periodEnd: end,
      includedMessages: 3_000,
      usedMessages: 125,
      createdAt: start,
      updatedAt: now.toISOString(),
    });
    await store.upsertTenantFeatureEntitlements({
      clientId: BLADES_HAIR_ID,
      whatsappEnabled: true,
      autoMinuteBlocksEnabled: true,
      createdAt: start,
      updatedAt: now.toISOString(),
    });
    await store.claimOveragePurchase({
      id: "overage_receipt",
      clientId: BLADES_HAIR_ID,
      idempotencyKey: "minute-overage:test",
      boundaryMinutes: 300,
      grantedMinutes: 100,
      amountMinor: 1_500,
      currency: "USD",
      status: "succeeded",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      completedAt: now.toISOString(),
    });

    const response = await request(store, salonActor, `/api/v1/usage?clientId=${BLADES_HAIR_ID}`);
    expect(response).toMatchObject({
      status: 200,
      body: {
        plan: "starter",
        billingPeriodStart: start,
        billingPeriodEnd: end,
        periodAllocatedMinutes: 300,
        periodUsedMinutes: 24,
        messaging: {
          whatsapp: {
            includedMessages: 3_000,
            usedMessages: 125,
            remainingMessages: 2_875,
            limitReached: false,
          },
        },
        overage: {
          autoPurchaseEnabled: true,
          blockMinutes: 100,
          purchases: [{ id: "overage_receipt", status: "succeeded" }],
        },
      },
    });
    expect(response.body).not.toHaveProperty("accountSnapshots");
    expect(response.body).not.toHaveProperty("providerCost");
  });

  it("keeps feature controls operator-only and requires auto-charge confirmation", async () => {
    const store = new MemoryStore();
    await seedStore(store);

    const forbidden = await request(
      store,
      salonActor,
      `/api/v1/admin/clients/${BLADES_HAIR_ID}/feature-entitlements`,
    );
    expect(forbidden).toMatchObject({ status: 403, body: { error: "platform_admin_required" } });

    const defaults = await request(
      store,
      operatorActor,
      `/api/v1/admin/clients/${BLADES_HAIR_ID}/feature-entitlements`,
    );
    expect(defaults).toMatchObject({
      status: 200,
      body: {
        clientId: BLADES_HAIR_ID,
        whatsappEnabled: false,
        autoMinuteBlocksEnabled: false,
      },
    });

    const unconfirmed = await request(
      store,
      operatorActor,
      `/api/v1/admin/clients/${BLADES_HAIR_ID}/feature-entitlements`,
      "PATCH",
      { autoMinuteBlocksEnabled: true },
    );
    expect(unconfirmed).toMatchObject({
      status: 409,
      body: { error: "auto_minute_blocks_confirmation_required" },
    });

    const updated = await request(
      store,
      operatorActor,
      `/api/v1/admin/clients/${BLADES_HAIR_ID}/feature-entitlements`,
      "PATCH",
      {
        whatsappEnabled: true,
        autoMinuteBlocksEnabled: true,
        confirmation: "ENABLE_AUTO_MINUTE_BLOCKS",
      },
    );
    expect(updated).toMatchObject({
      status: 200,
      body: { whatsappEnabled: true, autoMinuteBlocksEnabled: true },
    });
  });

  it("returns sanitized managed WhatsApp readiness without sender secrets", async () => {
    const store = new MemoryStore();
    await seedStore(store);
    const now = new Date().toISOString();
    await store.upsertProviderResource({
      id: "managed_whatsapp_sender",
      clientId: BLADES_HAIR_ID,
      provider: "twilio",
      resourceType: "whatsapp_sender",
      providerResourceId: "whatsapp:+14155238886",
      lifecycleStatus: "active",
      credentialRef: "secret://twilio/token",
      encryptedCredential: "encrypted-token",
      metadata: { address: "whatsapp:+14155238886", authToken: "private-token" },
      createdAt: now,
      updatedAt: now,
    });
    const previousEnabled = process.env.WHATSAPP_ENABLED;
    process.env.WHATSAPP_ENABLED = "true";
    try {
      const response = await request(
        store,
        operatorActor,
        `/api/v1/admin/clients/${BLADES_HAIR_ID}/managed-whatsapp-status`,
      );
      expect(response).toMatchObject({
        status: 200,
        body: { sender: { status: "active", configured: true } },
      });
      expect(JSON.stringify(response.body)).not.toMatch(
        /14155238886|private-token|encrypted-token|credentialRef|providerResourceId/,
      );
      const forbidden = await request(
        store,
        salonActor,
        `/api/v1/admin/clients/${BLADES_HAIR_ID}/managed-whatsapp-status`,
      );
      expect(forbidden.status).toBe(403);
    } finally {
      if (previousEnabled === undefined) delete process.env.WHATSAPP_ENABLED;
      else process.env.WHATSAPP_ENABLED = previousEnabled;
    }
  });

  it("configures one approved managed WhatsApp sender for an active Pro tenant", async () => {
    const store = new MemoryStore();
    await seedStore(store);
    const now = new Date().toISOString();
    await store.upsertSubscription({
      id: "subscription_whatsapp_pro",
      clientId: BLADES_HAIR_ID,
      provider: "internal",
      planTier: "pro",
      status: "active",
      currentPeriodStart: "2026-09-01T00:00:00.000Z",
      currentPeriodEnd: "2026-10-01T00:00:00.000Z",
      cancelAtPeriodEnd: false,
      metadata: {},
      createdAt: now,
      updatedAt: now,
    });
    const unconfirmed = await request(
      store,
      operatorActor,
      `/api/v1/admin/clients/${BLADES_HAIR_ID}/managed-whatsapp-status`,
      "PUT",
      { sender: "+14155238886" },
    );
    expect(unconfirmed).toMatchObject({
      status: 409,
      body: { error: "managed_whatsapp_confirmation_required" },
    });
    const configured = await request(
      store,
      operatorActor,
      `/api/v1/admin/clients/${BLADES_HAIR_ID}/managed-whatsapp-status`,
      "PUT",
      { sender: "+14155238886", confirmation: "ENABLE_MANAGED_WHATSAPP" },
    );
    expect(configured).toMatchObject({
      status: 200,
      body: {
        sender: { status: "active", configured: true },
        runtime: { tenantEnabled: true },
      },
    });
    expect(JSON.stringify(configured.body)).not.toContain("14155238886");
    expect(await store.getTenantFeatureEntitlements(BLADES_HAIR_ID))
      .toMatchObject({ whatsappEnabled: true });
    expect(await store.getClient(BLADES_HAIR_ID))
      .toMatchObject({ phoneAcquisitionMode: "robinexis_account" });
    expect(await store.listProviderResources(BLADES_HAIR_ID)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: "twilio",
          resourceType: "whatsapp_sender",
          lifecycleStatus: "active",
          metadata: { address: "whatsapp:+14155238886" },
        }),
      ]),
    );
  });

  it("returns not found instead of exposing another tenant or its calls", async () => {
    const store = new MemoryStore();
    await seedStore(store);
    const forbiddenClient = await request(store, salonActor, `/api/v1/clients/${DEMO_CLIENT_ID}`);
    expect(forbiddenClient).toMatchObject({ status: 404, body: { error: "client_not_found" } });

    const call: CallSession = {
      id: "call_other_tenant",
      clientId: DEMO_CLIENT_ID,
      direction: "inbound",
      objective: "test",
      promptVersionId: "prompt_test",
      transcript: [],
      collected: {},
      toolHistory: [],
      state: "complete",
      status: "completed",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await store.saveCall(call);

    const forbiddenCall = await request(store, salonActor, `/api/v1/calls/${call.id}`);
    expect(forbiddenCall).toMatchObject({ status: 404, body: { error: "call_not_found" } });
  });

  it("keeps edits in a draft until config and prompt publish atomically", async () => {
    const store = new MemoryStore();
    await seedStore(store);
    const liveBefore = await store.getClient(BLADES_HAIR_ID);
    const draftGreeting = "Draft greeting that must not affect live calls.";

    const patched = await request(
      store,
      operatorActor,
      `/api/v1/clients/${BLADES_HAIR_ID}`,
      "PATCH",
      { greeting: draftGreeting },
    );
    expect(patched).toMatchObject({ status: 200, body: { hasUnpublishedChanges: true } });
    expect((await store.getClient(BLADES_HAIR_ID))?.greeting).toBe(liveBefore?.greeting);

    const published = await request(
      store,
      operatorActor,
      `/api/v1/clients/${BLADES_HAIR_ID}/publish`,
      "POST",
    );
    expect(published.status).toBe(200);
    expect((await store.getClient(BLADES_HAIR_ID))?.greeting).toBe(draftGreeting);
    expect(await store.getDraftClient(BLADES_HAIR_ID)).toBeUndefined();
    expect((await store.latestPrompt(BLADES_HAIR_ID))?.id).toBe(
      (await store.getClient(BLADES_HAIR_ID))?.promptVersionId,
    );
  });

  it("keeps automatic SaaS publish as draft-only until activation", async () => {
    const store = new MemoryStore();
    await seedStore(store);
    const client = (await store.getClient(DEMO_CLIENT_ID))!;
    client.onboardingStatus = "awaiting_approval";
    client.published = false;
    await store.upsertClient(client);
    await request(
      store,
      operatorActor,
      `/api/v1/clients/${DEMO_CLIENT_ID}`,
      "PATCH",
      { greeting: "Approved only after activation" },
    );
    const previous = process.env.SAAS_PROVISIONING_ENABLED;
    process.env.SAAS_PROVISIONING_ENABLED = "true";
    try {
      const response = await request(
        store,
        operatorActor,
        `/api/v1/clients/${DEMO_CLIENT_ID}/publish`,
        "POST",
      );
      expect(response).toMatchObject({
        status: 202,
        body: { draftPublished: true, activationRequired: true },
      });
      expect((await store.getClient(DEMO_CLIENT_ID))?.published).toBe(false);
      expect((await store.getClient(DEMO_CLIENT_ID))?.greeting)
        .not.toBe("Approved only after activation");
      expect((await store.getDraftClient(DEMO_CLIENT_ID))?.config.greeting)
        .toBe("Approved only after activation");
    } finally {
      if (previous === undefined) delete process.env.SAAS_PROVISIONING_ENABLED;
      else process.env.SAAS_PROVISIONING_ENABLED = previous;
    }
  });
});
