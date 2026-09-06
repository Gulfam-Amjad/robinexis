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
});
