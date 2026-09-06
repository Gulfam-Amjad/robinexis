import {
  defineRailway,
  github,
  preserve,
  project,
  service,
} from "railway/iac";

/**
 * Railway no longer applies railway.toml to newly created services.
 * This file is the replacement (Infrastructure as Code). It is evaluated by
 * `railway config plan` / `railway config apply`, not by a git deploy on its own.
 *
 * Secrets stay on Railway as preserve() — paste them via Variables → Raw Editor.
 * Never put keys from .env into this file.
 */
export default defineRailway(() => {
  const source = github("Gulfam-Amjad/robinexis", { branch: "main" });

  const commonSecrets = {
    DATABASE_URL: preserve(),
    GEMINI_API_KEY: preserve(),
    STRIPE_SECRET_KEY: preserve(),
  };
  const apiSecrets = {
    TWILIO_ACCOUNT_SID: preserve(),
    TWILIO_AUTH_TOKEN: preserve(),
    CALCOM_API_KEY: preserve(),
    CALCOM_USERNAME: preserve(),
    VOICE_TOOL_SECRET: preserve(),
    VOICE_TOOL_SECRETS_JSON: preserve(),
    ELEVENLABS_WEBHOOK_SECRET: preserve(),
    STRIPE_PUBLISHABLE_KEY: preserve(),
    STRIPE_WEBHOOK_SECRET: preserve(),
    STRIPE_PRICE_IDS_JSON: preserve(),
  };

  const data = {
    NODE_ENV: "production",
    NODE_VERSION: "24",
    DATABASE_SSL: "true",
    REQUIRE_DATABASE: "true",
    GEMINI_EMBEDDING_MODEL: "gemini-embedding-001",
    ...commonSecrets,
  };

  const api = service("@robinexis/api", {
    source,
    build: "node scripts/railway.mjs api",
    start: "node scripts/railway.mjs migrate && node scripts/railway.mjs start",
    healthcheck: "/health",
    healthcheckTimeout: 30,
    env: {
      ...data,
      ...apiSecrets,
      RAILWAY_BUILD_TARGET: "api",
      API_PUBLIC_BASE_URL: "https://${{RAILWAY_PUBLIC_DOMAIN}}",
      ADMIN_EMAILS: preserve(),
      RAG_TOP_K: "5",
      RAG_MIN_SIMILARITY: "0.55",
      RAG_EMBEDDING_DIMENSIONS: "768",
      PLAN_STARTER_INCLUDED_MINUTES: "300",
      PLAN_PRO_INCLUDED_MINUTES: "1500",
      PLAN_ENTERPRISE_INCLUDED_MINUTES: "5000",
      OUTBOUND_AUTOMATION_ENABLED: "false",
      SAAS_PROVISIONING_ENABLED: "false",
      WEB_ORIGIN: "https://app.robinexis.com,https://robinexis-pink.vercel.app",
      SUPABASE_URL: "https://cdbcbzvhzdiwwcrmxjgi.supabase.co",
      SUPABASE_JWT_SECRET: preserve(),
      SUPABASE_JWT_KEY_ID: "01130f21-cdc6-49c9-8739-a41e4beed5c2",
    },
  });

  const worker = service("@robinexis/worker", {
    source,
    build: "node scripts/railway.mjs worker",
    start: "npm run start -w @robinexis/worker",
    env: {
      ...data,
      RAILWAY_BUILD_TARGET: "worker",
      WORKER_POLL_MS: "15000",
      DATA_RETENTION_DAYS: "90",
      STRIPE_SECRET_KEY: preserve(),
    },
  });

  return project("robinexis", {
    resources: [api, worker],
  });
});
