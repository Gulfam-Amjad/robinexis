type RuntimeEnv = Record<string, string | undefined>;

export function isHostedProduction(env: RuntimeEnv = process.env): boolean {
  return env.NODE_ENV === "production" || Boolean(env.RAILWAY_ENVIRONMENT);
}

export function shouldSeedDemoData(env: RuntimeEnv = process.env): boolean {
  if (isHostedProduction(env)) return false;
  return env.ALLOW_DEMO_SEED !== "false";
}

export function shouldRunMigrationsOnStart(env: RuntimeEnv = process.env): boolean {
  if (!env.DATABASE_URL || env.RUN_MIGRATIONS_ON_START === "false") return false;
  if (isHostedProduction(env)) return env.RUN_MIGRATIONS_ON_START === "true";
  return true;
}
