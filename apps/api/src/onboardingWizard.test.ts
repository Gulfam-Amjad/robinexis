import type http from "node:http";
import { describe, expect, it } from "vitest";
import { BLADES_HAIR_ID, DEMO_CLIENT_ID, MemoryStore, seedStore } from "@robinexis/database";
import type { AuthenticatedActor } from "./auth.js";
import { handleProductRoute } from "./productRoutes.js";

const owner: AuthenticatedActor = {
  subject: "wizard_owner",
  email: "owner@example.test",
  role: "salon",
  clientRoles: { [DEMO_CLIENT_ID]: "owner" },
};

async function request(store: MemoryStore, actor: AuthenticatedActor, path: string, method = "GET", input?: unknown) {
  let status = 0;
  let body: any;
  await handleProductRoute({
    req: { method } as http.IncomingMessage,
    res: {} as http.ServerResponse,
    url: new URL(path, "http://localhost"),
    store,
    actor,
    readRaw: async () => Buffer.from(input === undefined ? "" : JSON.stringify(input)),
    send: (_res, code, value) => { status = code; body = value; },
  });
  return { status, body };
}

async function readyWizardStore() {
  const store = new MemoryStore();
  await seedStore(store);
  const now = new Date().toISOString();
  await store.upsertSubscription({
    id: "subscription_wizard", clientId: DEMO_CLIENT_ID, provider: "stripe",
    planTier: "starter", status: "trialing", cancelAtPeriodEnd: false,
    metadata: {}, createdAt: now, updatedAt: now,
  });
  await store.saveWebsiteSource({
    id: "source_wizard", clientId: DEMO_CLIENT_ID, url: "https://example.test",
    status: "active", metadata: { approvedRunId: "run_wizard" }, createdAt: now, updatedAt: now,
  });
  await store.saveWebsiteExtractionRun({
    id: "run_wizard", clientId: DEMO_CLIENT_ID, sourceId: "source_wizard",
    status: "succeeded", extractorVersion: "test", createdAt: now, updatedAt: now,
  });
  await store.replaceExtractedFacts(DEMO_CLIENT_ID, "run_wizard", [{
    id: "fact_wizard", clientId: DEMO_CLIENT_ID, extractionRunId: "run_wizard",
    key: "businessName", value: "Ready Ltd", reviewStatus: "confirmed",
    reviewedBy: owner.subject, reviewedAt: now, createdAt: now,
  }]);
  await store.upsertLocation({
    id: "location_wizard", clientId: DEMO_CLIENT_ID, slug: "primary", name: "Ready Ltd",
    timezone: "Europe/London", isPrimary: true, createdAt: now, updatedAt: now,
  });
  await store.upsertCalendarConnection({
    id: "calendar_wizard", clientId: DEMO_CLIENT_ID, locationId: "location_wizard",
    provider: "calcom", status: "active", metadata: {}, createdAt: now, updatedAt: now,
  });
  await store.upsertTwilioConnection({
    id: "twilio_wizard", clientId: DEMO_CLIENT_ID, mode: "customer_oauth",
    selectedPhoneNumber: "+447700900124", status: "active",
    metadata: {}, createdAt: now, updatedAt: now,
  });
  await store.saveOnboardingWizard({
    clientId: DEMO_CLIENT_ID, currentStep: "review", completedSteps: [],
    data: {
      websiteUrl: "https://example.test", websiteRunId: "run_wizard",
      businessName: "Ready Ltd", greeting: "Hello, how can we help?",
      tone: "Warm", transferNumber: "+447700900123", recordingConsent: "not_recording",
      services: [{ title: "Consultation", slug: "consultation", durationMinutes: 30 }],
      hours: "Monday-Friday 9-5", timezone: "Europe/London", bookingRules: "24 hours notice",
      phoneMode: "customer_twilio", customerPhoneNumber: "+447700900124",
      calendarMode: "managed_calcom",
    },
    version: 3, createdAt: now, updatedAt: now,
  });
  return store;
}

describe("onboarding wizard API", () => {
  it("persists progress server-side and resumes at the saved step", async () => {
    const store = new MemoryStore();
    await seedStore(store);
    const first = await request(store, owner, `/api/v1/clients/${DEMO_CLIENT_ID}/onboarding/wizard`);
    expect(first).toMatchObject({ status: 200, body: { wizard: { currentStep: "website", version: 1 } } });

    const saved = await request(store, owner, `/api/v1/clients/${DEMO_CLIENT_ID}/onboarding/wizard`, "PATCH", {
      currentStep: "behavior",
      data: { businessName: "Across Devices Ltd", location: "Leeds" },
      expectedVersion: 1,
    });
    expect(saved).toMatchObject({ status: 200, body: { wizard: { currentStep: "behavior", version: 2 } } });

    const resumed = await request(store, owner, `/api/v1/clients/${DEMO_CLIENT_ID}/onboarding/wizard`);
    expect(resumed.body.wizard).toMatchObject({
      currentStep: "behavior",
      data: { businessName: "Across Devices Ltd", location: "Leeds" },
      version: 2,
    });
  });

  it("requires manager permissions and hides other tenant state", async () => {
    const store = new MemoryStore();
    await seedStore(store);
    const viewer: AuthenticatedActor = { ...owner, subject: "viewer", clientRoles: { [DEMO_CLIENT_ID]: "viewer" } };
    const forbidden = await request(store, viewer, `/api/v1/clients/${DEMO_CLIENT_ID}/onboarding/wizard`);
    expect(forbidden).toMatchObject({ status: 403, body: { error: "workspace_write_forbidden" } });
    const hidden = await request(store, owner, "/api/v1/clients/client_not_owned/onboarding/wizard");
    expect(hidden).toMatchObject({ status: 404, body: { error: "client_not_found" } });
  });

  it("validates completed steps and rejects stale device writes", async () => {
    const store = new MemoryStore();
    await seedStore(store);
    await request(store, owner, `/api/v1/clients/${DEMO_CLIENT_ID}/onboarding/wizard`);
    const incomplete = await request(store, owner, `/api/v1/clients/${DEMO_CLIENT_ID}/onboarding/wizard`, "PATCH", {
      currentStep: "phone",
      completedStep: "behavior",
      data: { greeting: "Hello there", tone: "Warm" },
      expectedVersion: 1,
    });
    expect(incomplete).toMatchObject({
      status: 400,
      body: { error: "onboarding_step_incomplete" },
    });
    expect(incomplete.body.blockers.map((item: { key: string }) => item.key)).toContain("recording_consent");

    const accepted = await request(store, owner, `/api/v1/clients/${DEMO_CLIENT_ID}/onboarding/wizard`, "PATCH", {
      currentStep: "phone",
      data: { phoneMode: "managed" },
      expectedVersion: 1,
    });
    expect(accepted.status).toBe(200);
    const stale = await request(store, owner, `/api/v1/clients/${DEMO_CLIENT_ID}/onboarding/wizard`, "PATCH", {
      currentStep: "calendar",
      expectedVersion: 1,
    });
    expect(stale).toMatchObject({ status: 409, body: { error: "onboarding_wizard_changed" } });
  });

  it("shows readiness without enqueueing provider work while automation is disabled", async () => {
    const store = await readyWizardStore();
    const previous = process.env.SAAS_PROVISIONING_ENABLED;
    process.env.SAAS_PROVISIONING_ENABLED = "false";
    try {
      const response = await request(store, owner,
        `/api/v1/clients/${DEMO_CLIENT_ID}/onboarding/wizard/submit`, "POST");
      expect(response).toMatchObject({
        status: 202,
        body: { onboardingStatus: "ready_to_provision", automationEnabled: false },
      });
      expect(store.onboardingJobs.size).toBe(0);
    } finally {
      if (previous === undefined) delete process.env.SAAS_PROVISIONING_ENABLED;
      else process.env.SAAS_PROVISIONING_ENABLED = previous;
    }
  });

  it("enqueues one durable idempotent job after completed onboarding when enabled", async () => {
    const store = await readyWizardStore();
    const previous = process.env.SAAS_PROVISIONING_ENABLED;
    process.env.SAAS_PROVISIONING_ENABLED = "true";
    try {
      const first = await request(store, owner,
        `/api/v1/clients/${DEMO_CLIENT_ID}/onboarding/wizard/submit`, "POST");
      expect(first).toMatchObject({
        status: 202,
        body: { onboardingStatus: "ready_to_provision", automationEnabled: true },
      });
      expect([...store.onboardingJobs.values()]).toHaveLength(1);
      expect([...store.onboardingJobs.values()][0]).toMatchObject({
        kind: "provision_client", status: "pending", idempotencyKey: "provision:onboarding-4",
      });
    } finally {
      if (previous === undefined) delete process.env.SAAS_PROVISIONING_ENABLED;
      else process.env.SAAS_PROVISIONING_ENABLED = previous;
    }
  });

  it("never submits the protected Blades tenant into automated provisioning", async () => {
    const store = new MemoryStore();
    await seedStore(store);
    const operator: AuthenticatedActor = {
      subject: "operator", email: "operator@example.test", role: "operator", clientRoles: {},
    };
    const response = await request(
      store,
      operator,
      `/api/v1/clients/${BLADES_HAIR_ID}/onboarding/wizard/submit`,
      "POST",
    );
    expect(response).toMatchObject({
      status: 409,
      body: { error: "protected_blades_automation_target" },
    });
    expect(await store.listProvisioningRuns(BLADES_HAIR_ID)).toEqual([]);
    expect([...store.onboardingJobs.values()].filter((job) => job.clientId === BLADES_HAIR_ID))
      .toEqual([]);
  });
});
