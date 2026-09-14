import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresStore } from "./postgres.js";
import { robinexisDemoSeed } from "./seed.js";
import type { CallSession } from "./types.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const suffix = Math.random().toString(36).slice(2, 10);
const clientA = `client_stage_a_${suffix}`;
const clientB = `client_stage_b_${suffix}`;
const pool = databaseUrl ? new pg.Pool({ connectionString: databaseUrl, ssl: false }) : undefined;
const store = pool ? new PostgresStore(pool) : undefined;

integration("Postgres tenant isolation", () => {
  beforeAll(async () => {
    const template = robinexisDemoSeed();
    const configA = { ...template, id: clientA, slug: `${clientA}-slug`, businessName: "Stage tenant A", inboundNumbers: [] };
    const configB = { ...template, id: clientB, slug: `${clientB}-slug`, businessName: "Stage tenant B", inboundNumbers: [] };
    await pool!.query(
      `INSERT INTO clients (id, slug, config) VALUES
       ($1, $2, $3::jsonb), ($4, $5, $6::jsonb)`,
      [clientA, configA.slug, JSON.stringify(configA), clientB, configB.slug, JSON.stringify(configB)],
    );
  });

  afterAll(async () => {
    await pool!.query("DELETE FROM call_sessions WHERE client_id = ANY($1)", [[clientA, clientB]]);
    await pool!.query("DELETE FROM clients WHERE id = ANY($1)", [[clientA, clientB]]);
    await pool!.end();
  });

  it("rejects one call id crossing tenant boundaries", async () => {
    const call: CallSession = {
      id: `call_${suffix}`, clientId: clientA, direction: "inbound", objective: "isolation",
      promptVersionId: "prompt", transcript: [], collected: {}, toolHistory: [],
      state: "started", status: "active", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    await store!.saveCall(call);
    await expect(store!.saveCall({ ...call, clientId: clientB })).rejects.toThrow("call_session_tenant_conflict");
  });

  it("allows the same provider event slug for separate tenants", async () => {
    for (const clientId of [clientA, clientB]) {
      await store!.upsertLocation({
        id: `loc_${clientId}`, clientId, slug: "primary", name: "Stage", timezone: "Europe/London",
        address: {}, isPrimary: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      });
      await store!.upsertCalendarConnection({
        id: `calendar_${clientId}`, clientId, locationId: `loc_${clientId}`, provider: "calcom",
        credentialRef: "CONNECTION_REQUIRED", status: "pending", metadata: {},
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      });
      await store!.upsertCalendarEventType({
        id: `event_${clientId}`, clientId, calendarConnectionId: `calendar_${clientId}`,
        serviceSlug: "cut", providerEventTypeId: `provider_${clientId}`, providerSlug: "haircut",
        title: "Haircut", durationMinutes: 30, status: "pending",
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      });
    }
    await expect(store!.listCalendarEventTypes(clientA)).resolves.toHaveLength(1);
    await expect(store!.listCalendarEventTypes(clientB)).resolves.toHaveLength(1);
  });

  it("rolls back the whole billing transition when one write fails", async () => {
    const before = await store!.getClient(clientA);
    const changed = { ...before!, serviceStatus: "past_due" as const };
    const now = new Date().toISOString();
    await expect(store!.applyBillingTransition({
      client: changed,
      subscription: {
        id: `subscription_${suffix}`, clientId: clientA, provider: "stripe", planTier: "starter",
        status: "invalid_status" as never, cancelAtPeriodEnd: false, metadata: {}, createdAt: now, updatedAt: now,
      },
      audit: {
        id: `audit_${suffix}`, clientId: clientA, actorId: "stripe", action: "billing.test",
        detail: {}, createdAt: now,
      },
      event: {
        id: `evt_${suffix}`, clientId: clientA, eventType: "customer.subscription.updated",
        livemode: false, payload: {}, status: "processed", receivedAt: now, processedAt: now,
      },
    })).rejects.toThrow();
    await expect(store!.getClient(clientA)).resolves.toMatchObject({ serviceStatus: before!.serviceStatus });
    await expect(store!.listOperatorAudit(clientA)).resolves.toEqual([]);
  });
});
