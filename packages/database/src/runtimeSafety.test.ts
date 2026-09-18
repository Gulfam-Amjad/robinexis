import { describe, expect, it } from "vitest";
import {
  isHostedProduction,
  shouldRunMigrationsOnStart,
  shouldSeedDemoData,
} from "./runtimeSafety.js";

describe("runtime safety policy", () => {
  it("never auto-seeds demo tenants in production or Railway", () => {
    expect(shouldSeedDemoData({ NODE_ENV: "production" })).toBe(false);
    expect(shouldSeedDemoData({ NODE_ENV: "development", RAILWAY_ENVIRONMENT: "staging" })).toBe(false);
  });

  it("allows local demo seeds unless explicitly disabled", () => {
    expect(shouldSeedDemoData({ NODE_ENV: "development" })).toBe(true);
    expect(shouldSeedDemoData({ NODE_ENV: "test", ALLOW_DEMO_SEED: "false" })).toBe(false);
  });

  it("requires an explicit production opt-in for boot migrations", () => {
    const production = { NODE_ENV: "production", DATABASE_URL: "postgres://example" };
    expect(shouldRunMigrationsOnStart(production)).toBe(false);
    expect(shouldRunMigrationsOnStart({ ...production, RUN_MIGRATIONS_ON_START: "true" })).toBe(true);
    expect(shouldRunMigrationsOnStart({
      DATABASE_URL: "postgres://example",
      RAILWAY_ENVIRONMENT: "staging",
    })).toBe(false);
  });

  it("keeps local migration convenience and recognizes hosted production", () => {
    expect(shouldRunMigrationsOnStart({ DATABASE_URL: "postgres://local" })).toBe(true);
    expect(shouldRunMigrationsOnStart({
      DATABASE_URL: "postgres://local",
      RUN_MIGRATIONS_ON_START: "false",
    })).toBe(false);
    expect(isHostedProduction({ RAILWAY_ENVIRONMENT: "preview" })).toBe(true);
  });
});
