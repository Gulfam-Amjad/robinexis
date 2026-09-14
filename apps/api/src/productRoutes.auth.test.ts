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
});
