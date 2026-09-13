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

  it("stores customer Twilio OAuth and API-key credentials outside browser-readable config", () => {
    const sql = readFileSync(path.join(dir, "009_twilio_oauth_connections.sql"), "utf8");
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS twilio_connections/i);
    expect(sql).toMatch(/encrypted_access_token/i);
    expect(sql).toMatch(/encrypted_api_key_secret/i);
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/i);
    expect(sql).toMatch(/REVOKE ALL ON public\.twilio_connections FROM authenticated/i);
  });
});
