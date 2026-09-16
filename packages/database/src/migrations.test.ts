import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");

describe("database migrations", () => {
  it("ships 007 to revoke browser grants on schema_migrations", () => {
    const files = readdirSync(dir).filter((name) => name.endsWith(".sql")).sort();
    expect(files).toContain("007_lock_schema_migrations.sql");
    const sql = readFileSync(path.join(dir, "007_lock_schema_migrations.sql"), "utf8");
    expect(sql).toMatch(/schema_migrations/);
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/i);
    expect(sql).toMatch(/REVOKE ALL ON public\.schema_migrations FROM anon/i);
    expect(sql).toMatch(/REVOKE ALL ON public\.schema_migrations FROM authenticated/i);
  });

  it("ships tenant-scoped calendar mappings and phone acquisition metadata", () => {
    const sql = readFileSync(path.join(dir, "008_automatic_saas_provisioning.sql"), "utf8");
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS calendar_event_types/i);
    expect(sql).toMatch(/UNIQUE \(provider_slug\)/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS metadata JSONB/i);
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/i);
  });

  it("allows provider calendar slugs per tenant and locks call ownership", () => {
    const sql = readFileSync(path.join(dir, "011_tenant_isolation_hardening.sql"), "utf8");
    expect(sql).toMatch(/DROP CONSTRAINT IF EXISTS calendar_event_types_provider_slug_key/i);
    expect(sql).toMatch(/calendar_event_types\s*\(client_id, provider_slug\)/i);
    expect(sql).toMatch(/call_session tenant is immutable/i);
  });

  it("keeps the operator audit trail append-only and outside browser reach", () => {
    const sql = readFileSync(path.join(dir, "010_operator_audit_log.sql"), "utf8");
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS operator_audit_log/i);
    expect(sql).toMatch(/BEFORE UPDATE OR DELETE ON operator_audit_log/i);
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/i);
    expect(sql).toMatch(/REVOKE ALL ON public\.operator_audit_log FROM anon/i);
    expect(sql).toMatch(/REVOKE ALL ON public\.operator_audit_log FROM authenticated/i);
  });

  it("stores customer Twilio OAuth and API-key credentials outside browser-readable config", () => {
    const sql = readFileSync(path.join(dir, "009_twilio_oauth_connections.sql"), "utf8");
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS twilio_connections/i);
    expect(sql).toMatch(/encrypted_access_token/i);
    expect(sql).toMatch(/encrypted_api_key_secret/i);
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/i);
    expect(sql).toMatch(/REVOKE ALL ON public\.twilio_connections FROM authenticated/i);
  });

  it("ships durable lifecycle jobs, extraction records and provider resources", () => {
    const sql = readFileSync(path.join(dir, "013_onboarding_lifecycle_data.sql"), "utf8");
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS onboarding_jobs/i);
    expect(sql).toMatch(/UNIQUE \(client_id, idempotency_key\)/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS onboarding_outbox/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS website_extraction_runs/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS extracted_facts/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS onboarding_gaps/i);
    expect(sql).toMatch(/encrypted_credential/i);
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/i);
  });

  it("stores resumable onboarding wizard state outside browser access", () => {
    const sql = readFileSync(path.join(dir, "015_onboarding_wizard.sql"), "utf8");
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS onboarding_wizard_states/i);
    expect(sql).toMatch(/client_id TEXT PRIMARY KEY/i);
    expect(sql).toMatch(/completed_steps JSONB/i);
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/i);
    expect(sql).toMatch(/REVOKE ALL ON public\.onboarding_wizard_states FROM authenticated/i);
  });

  it("adds Twilio regulatory fields and one active number constraints", () => {
    const sql = readFileSync(path.join(dir, "016_twilio_hybrid_provisioning.sql"), "utf8");
    expect(sql).toMatch(/regulatory_bundle_sid/i);
    expect(sql).toMatch(/monthly_spend_cap_pence/i);
    expect(sql).toMatch(/phone_endpoints_one_active_twilio_per_tenant/i);
    expect(sql).toMatch(/provider_resources_one_active_twilio_number_per_tenant/i);
  });

  it("supports paused durable provisioning without weakening approval evidence", () => {
    const sql = readFileSync(path.join(dir, "018_provisioning_approval_gate.sql"), "utf8");
    expect(sql).toMatch(/provisioning_runs_status_check/i);
    expect(sql).toMatch(/'paused'/i);
    expect(sql).toMatch(/activation remains a separate/i);
  });

  it("stores leased idempotent notification delivery outside browser access", () => {
    const sql = readFileSync(path.join(dir, "019_notification_observability.sql"), "utf8");
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS notification_deliveries/i);
    expect(sql).toMatch(/UNIQUE \(client_id, idempotency_key\)/i);
    expect(sql).toMatch(/provider_id/i);
    expect(sql).toMatch(/dead_lettered_at/i);
    expect(sql).toMatch(/REVOKE ALL ON public\.notification_deliveries FROM authenticated/i);
  });

  it("ships additive staging corrections and marks schema.sql non-executable", () => {
    const lifecycle = readFileSync(path.join(dir, "013_onboarding_lifecycle_data.sql"), "utf8");
    expect(lifecycle).toMatch(/client_id <> 'client_blades_hair'/i);
    const hardening = readFileSync(
      path.join(dir, "020_adversarial_provisioning_hardening.sql"),
      "utf8",
    );
    expect(hardening).toMatch(/DELETE FROM onboarding_jobs WHERE client_id = 'client_blades_hair'/i);
    expect(hardening).toMatch(/metadata = metadata - 'markdown'/i);
    expect(hardening).toMatch(/provider_resources_tenant_provider_resource_idx/i);
    expect(hardening).toMatch(/client_id, provider, provider_resource_id/i);
    const activation = readFileSync(
      path.join(dir, "021_two_phase_activation.sql"),
      "utf8",
    );
    expect(activation).toMatch(/claim_token/i);
    expect(activation).toMatch(/activation_pending/i);
    expect(activation).toMatch(/readiness_only/i);
    const signatureCredentials = readFileSync(
      path.join(dir, "022_twilio_signature_credentials.sql"),
      "utf8",
    );
    expect(signatureCredentials).toMatch(/encrypted_account_auth_token/i);
    const postgresStore = readFileSync(path.join(dir, "..", "postgres.ts"), "utf8");
    expect(postgresStore).toMatch(/FOR UPDATE OF c,p/i);
    expect(postgresStore).toMatch(/WHERE client_id=\$1 AND id=\$5/i);
    const schema = readFileSync(path.join(dir, "..", "schema.sql"), "utf8");
    expect(schema).toMatch(/REFERENCE SNAPSHOT ONLY/i);
    expect(schema).toMatch(/sole executable schema source/i);
  });

  it("ships the fail-closed dual-provider control plane separately from credits", () => {
    const sql = readFileSync(path.join(dir, "024_dual_provider_control.sql"), "utf8");
    expect(sql).toMatch(/'elevenlabs-convai', 'livekit-cascade'/i);
    expect(sql).toMatch(/provider <> 'groq-gateway' OR status = 'retired'/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS provider_deployments/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS provider_switch_operations/i);
    expect(sql).toMatch(/UNIQUE \(client_id, idempotency_key\)/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS provider_rollback_snapshots/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS provider_usage_cost_events/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS provider_account_snapshots/i);
    expect(sql).toMatch(/scope TEXT NOT NULL DEFAULT 'account'/i);
    expect(sql.match(/CREATE TABLE IF NOT EXISTS provider_account_snapshots[\s\S]*?\);/i)?.[0])
      .not.toMatch(/client_id/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS provider_alert_rules/i);
    expect(sql).not.toMatch(/ALTER TABLE credit_ledger/i);
    expect(sql).toMatch(/REVOKE ALL ON public\.provider_deployments FROM anon, authenticated/i);
  });
});
