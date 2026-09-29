import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresStore } from "./postgres.js";
import { robinexisDemoSeed } from "./seed.js";
import type { CallSession, OnboardingJob } from "./types.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
const suffix = Math.random().toString(36).slice(2, 10);
const clientA = `client_stage_a_${suffix}`;
const clientB = `client_stage_b_${suffix}`;
const clientDelete = `client_stage_delete_${suffix}`;
const pool = databaseUrl ? new pg.Pool({ connectionString: databaseUrl, ssl: false }) : undefined;
const store = pool ? new PostgresStore(pool) : undefined;

integration("Postgres tenant isolation", () => {
  beforeAll(async () => {
    const template = robinexisDemoSeed();
    const configA = { ...template, id: clientA, slug: `${clientA}-slug`, businessName: "Stage tenant A", inboundNumbers: [] };
    const configB = { ...template, id: clientB, slug: `${clientB}-slug`, businessName: "Stage tenant B", inboundNumbers: [] };
    const configDelete = { ...template, id: clientDelete, slug: `${clientDelete}-slug`, businessName: "Delete tenant", inboundNumbers: [] };
    await pool!.query(
      `INSERT INTO clients (id, slug, config) VALUES
       ($1, $2, $3::jsonb), ($4, $5, $6::jsonb), ($7, $8, $9::jsonb)`,
      [
        clientA, configA.slug, JSON.stringify(configA),
        clientB, configB.slug, JSON.stringify(configB),
        clientDelete, configDelete.slug, JSON.stringify(configDelete),
      ],
    );
  });

  afterAll(async () => {
    await pool!.query("DELETE FROM call_sessions WHERE client_id = ANY($1)", [[clientA, clientB]]);
    await pool!.query("DELETE FROM clients WHERE id = ANY($1)", [[clientA, clientB, clientDelete]]);
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

  it("claims one onboarding job only once across concurrent workers", async () => {
    const now = new Date().toISOString();
    const job: OnboardingJob = {
      id: `job_${suffix}`, clientId: clientA, kind: "provision_client",
      idempotencyKey: `provision_${suffix}`, status: "pending", payload: { operationKey: suffix },
      attemptCount: 0, maxAttempts: 3, availableAt: now, createdAt: now, updatedAt: now,
    };
    expect(await store!.enqueueOnboardingJob(job)).toBe(true);
    expect(await store!.enqueueOnboardingJob({ ...job, id: `${job.id}_duplicate` })).toBe(false);
    const claims = await Promise.all([
      store!.claimOnboardingJobs("worker-a", now, 60, 1),
      store!.claimOnboardingJobs("worker-b", now, 60, 1),
    ]);
    expect(claims.flat()).toHaveLength(1);
    expect(claims.flat()[0]).toMatchObject({ id: job.id, attemptCount: 1, status: "leased" });
  });

  it("deletes legacy and cascading tenant records transactionally", async () => {
    const now = new Date().toISOString();
    const callId = `call_delete_${suffix}`;
    await pool!.query(
      "INSERT INTO call_sessions (id, client_id, payload) VALUES ($1, $2, $3::jsonb)",
      [callId, clientDelete, JSON.stringify({ id: callId, clientId: clientDelete })],
    );
    await pool!.query(
      `INSERT INTO tool_actions (id, call_id, client_id, name, input, at)
       VALUES ($1, $2, $3, 'test', '{}'::jsonb, $4)`,
      [`tool_delete_${suffix}`, callId, clientDelete, now],
    );
    await pool!.query(
      "INSERT INTO suppressions (client_id, phone, reason) VALUES ($1, '+447700900999', 'test')",
      [clientDelete],
    );
    await pool!.query(
      `INSERT INTO usage_counters (client_id, month, inbound_minutes, outbound_minutes)
       VALUES ($1, '2026-09', 1, 0)`,
      [clientDelete],
    );
    const payload = JSON.stringify({ clientId: clientDelete });
    await pool!.query(
      "INSERT INTO outbound_jobs (id, payload) VALUES ($1, $2::jsonb)",
      [`job_delete_${suffix}`, payload],
    );
    await pool!.query(
      "INSERT INTO call_notes (id, payload) VALUES ($1, $2::jsonb)",
      [`note_delete_${suffix}`, payload],
    );
    const agentId = `agent_delete_${suffix}`;
    const deploymentId = `deployment_delete_${suffix}`;
    const operationId = `switch_delete_${suffix}`;
    const snapshotId = `snapshot_delete_${suffix}`;
    await pool!.query(
      `INSERT INTO agent_instances
       (id, client_id, provider, name, status, config, created_at, updated_at)
       VALUES ($1, $2, 'livekit', 'Delete agent', 'active', '{}'::jsonb, $3, $3)`,
      [agentId, clientDelete, now],
    );
    await pool!.query(
      `INSERT INTO phone_endpoints
       (id, client_id, agent_instance_id, provider, e164, direction, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'twilio', $4, 'inbound', 'active', $5, $5)`,
      [`phone_delete_${suffix}`, clientDelete, agentId, `+44770${suffix.replace(/\D/g, "").padEnd(7, "0").slice(0, 7)}`, now],
    );
    await pool!.query(
      `INSERT INTO provider_deployments
       (id, client_id, agent_instance_id, provider, provider_deployment_id, status, config, created_at, updated_at)
       VALUES ($1, $2, $3, 'livekit-cascade', $4, 'staged', '{}'::jsonb, $5, $5)`,
      [deploymentId, clientDelete, agentId, `dispatch_delete_${suffix}`, now],
    );
    await pool!.query(
      `INSERT INTO provider_switch_operations
       (id, client_id, idempotency_key, to_deployment_id, status, requested_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'running', 'integration-test', $5, $5)`,
      [operationId, clientDelete, `idem_delete_${suffix}`, deploymentId, now],
    );
    await pool!.query(
      `INSERT INTO provider_rollback_snapshots
       (id, client_id, switch_operation_id, provider, deployment_id, snapshot, created_at)
       VALUES ($1, $2, $3, 'livekit-cascade', $4, '{}'::jsonb, $5)`,
      [snapshotId, clientDelete, operationId, deploymentId, now],
    );
    await pool!.query(
      "UPDATE provider_switch_operations SET rollback_snapshot_id = $1 WHERE id = $2",
      [snapshotId, operationId],
    );

    await expect(store!.deleteClient(clientDelete)).resolves.toBe(true);
    for (const table of [
      "call_sessions",
      "tool_actions",
      "suppressions",
      "usage_counters",
    ]) {
      const result = await pool!.query(
        `SELECT COUNT(*)::int AS count FROM ${table} WHERE client_id = $1`,
        [clientDelete],
      );
      expect(result.rows[0].count).toBe(0);
    }
    for (const table of ["outbound_jobs", "call_notes"]) {
      const result = await pool!.query(
        `SELECT COUNT(*)::int AS count FROM ${table} WHERE payload->>'clientId' = $1`,
        [clientDelete],
      );
      expect(result.rows[0].count).toBe(0);
    }
  });
});
