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
    REDIS_URL: preserve(),
    GEMINI_API_KEY: preserve(),
    SENTRY_AUTH_TOKEN: preserve(),
    SENTRY_DSN: preserve(),
    STRIPE_SECRET_KEY: preserve(),
  };
  const apiSecrets = {
    TWILIO_ACCOUNT_SID: preserve(),
    TWILIO_AUTH_TOKEN: preserve(),
    CALCOM_API_KEY: preserve(),
    CALCOM_USERNAME: preserve(),
    CALCOM_OAUTH_CLIENT_ID: preserve(),
    CALCOM_OAUTH_CLIENT_SECRET: preserve(),
    CALCOM_OAUTH_REDIRECT_URI: preserve(),
    CALCOM_PLATFORM_CLIENT_ID: preserve(),
    CALCOM_PLATFORM_CLIENT_SECRET: preserve(),
    CALCOM_PLATFORM_ORGANIZATION_ID: preserve(),
    FIRECRAWL_API_KEY: preserve(),
    RESEND_API_KEY: preserve(),
    NOTIFICATION_FROM_EMAIL: preserve(),
    VOICE_TOOL_SECRET: preserve(),
    VOICE_TOOL_SECRETS_JSON: preserve(),
    ELEVENLABS_API_KEY: preserve(),
    ELEVENLABS_VOICE_ID: preserve(),
    ELEVENLABS_WEBHOOK_SECRET: preserve(),
    ELEVENLABS_TTS_COST_PER_MILLION_CHARACTERS_PENCE: preserve(),
    STRIPE_PUBLISHABLE_KEY: preserve(),
    STRIPE_WEBHOOK_SECRET: preserve(),
    STRIPE_PRICE_IDS_JSON: preserve(),
    TWILIO_OAUTH_CLIENT_ID: preserve(),
    TWILIO_OAUTH_CLIENT_SECRET: preserve(),
    TWILIO_OAUTH_REDIRECT_URI: preserve(),
    TWILIO_OAUTH_STATE_SECRET: preserve(),
    TWILIO_OAUTH_ENCRYPTION_KEY: preserve(),
    WORKER_API_SECRET: preserve(),
    VOICE_RUNTIME_INTERNAL_SECRET: preserve(),
    VOICE_RUNTIME_SIGNING_SECRET: preserve(),
    LIVEKIT_DEPLOYMENT_ID: preserve(),
    LIVEKIT_URL: preserve(),
    LIVEKIT_API_KEY: preserve(),
    LIVEKIT_API_SECRET: preserve(),
    LIVEKIT_PHONE_NUMBER_ID: preserve(),
    LIVEKIT_TWILIO_VOICE_URL: preserve(),
    LIVEKIT_SIP_URI: preserve(),
    LIVEKIT_SUSPEND_VOICE_URL: preserve(),
    LIVEKIT_COST_PER_MINUTE_PENCE: preserve(),
    DEEPGRAM_COST_PER_MINUTE_PENCE: preserve(),
    GROQ_INPUT_COST_PER_MILLION_TOKENS_PENCE: preserve(),
    GROQ_OUTPUT_COST_PER_MILLION_TOKENS_PENCE: preserve(),
    GEMINI_INPUT_COST_PER_MILLION_TOKENS_PENCE: preserve(),
    GEMINI_OUTPUT_COST_PER_MILLION_TOKENS_PENCE: preserve(),
  };

  const data = {
    NODE_ENV: "production",
    NODE_VERSION: "24",
    DATABASE_SSL: "true",
    REQUIRE_DATABASE: "true",
    SENTRY_ENVIRONMENT: "production",
    SENTRY_TRACES_SAMPLE_RATE: "0.1",
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
      RATE_LIMIT_REDIS_REQUIRED: "true",
      EMAIL_DELIVERY_MODE: "resend",
      FIRECRAWL_API_URL: "https://api.firecrawl.dev",
      PLAN_STARTER_INCLUDED_MINUTES: "300",
      PLAN_PRO_INCLUDED_MINUTES: "1500",
      PLAN_ENTERPRISE_INCLUDED_MINUTES: "5000",
      OUTBOUND_AUTOMATION_ENABLED: "false",
      SAAS_PROVISIONING_ENABLED: "false",
      PROVIDER_SWITCH_ENABLED: "true",
      PROVIDER_SWITCH_ROUTING_ENABLED: "false",
      PROVIDER_QUALITY_EVALUATION_ENABLED: "true",
      CHEAP_VOICE_DEFAULT_ENABLED: "false",
      WEB_ORIGIN: "https://app.robinexis.com,https://robinexis-pink.vercel.app",
      SUPABASE_URL: "https://cdbcbzvhzdiwwcrmxjgi.supabase.co",
      SUPABASE_JWT_SECRET: preserve(),
      SUPABASE_JWT_KEY_ID: "01130f21-cdc6-49c9-8739-a41e4beed5c2",
    },
  });

  const worker = service("@robinexis/worker", {
    source,
    build: "node scripts/railway.mjs worker",
    start: "node scripts/railway.mjs start",
    healthcheck: "/health",
    healthcheckTimeout: 30,
    env: {
      ...data,
      RAILWAY_BUILD_TARGET: "worker",
      WORKER_POLL_MS: "15000",
      WORKER_HEALTH_STALE_MS: "120000",
      DATA_RETENTION_DAYS: "90",
      STRIPE_SECRET_KEY: preserve(),
      WORKER_API_SECRET: preserve(),
      API_PUBLIC_BASE_URL: "https://api.robinexis.com",
      SAAS_PROVISIONING_ENABLED: "false",
      VOICE_RUNTIME_API_BASE_URL: "https://api.robinexis.com",
      VOICE_RUNTIME_INTERNAL_SECRET: preserve(),
      VOICE_RUNTIME_SIGNING_SECRET: preserve(),
      LIVEKIT_URL: preserve(),
      LIVEKIT_API_KEY: preserve(),
      LIVEKIT_API_SECRET: preserve(),
      DEEPGRAM_API_KEY: preserve(),
      VOICE_LLM_PROVIDER: "groq",
      GROQ_API_KEY: preserve(),
      GROQ_LLM_MODEL: "openai/gpt-oss-120b",
      GOOGLE_API_KEY: preserve(),
      GEMINI_LLM_MODEL: "gemini-2.5-flash",
      ELEVENLABS_API_KEY: preserve(),
      ELEVENLABS_VOICE_ID: preserve(),
      ELEVENLABS_TTS_MODEL: "eleven_flash_v2_5",
      VOICE_RUNTIME_ENABLED: "false",
    },
  });

  return project("robinexis", {
    resources: [api, worker],
  });
});
