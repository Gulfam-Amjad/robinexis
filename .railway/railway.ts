import {
  defineRailway,
  github,
  preserve,
  project,
  redis,
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
  const cache = redis("Redis");

  const secrets = {
    DATABASE_URL: preserve(),
    GROQ_API_KEY: preserve(),
    GEMINI_API_KEY: preserve(),
    ELEVENLABS_API_KEY: preserve(),
    TWILIO_ACCOUNT_SID: preserve(),
    TWILIO_AUTH_TOKEN: preserve(),
    TWILIO_SANDBOX_PHONE_NUMBER: preserve(),
    CALCOM_API_KEY: preserve(),
    CALCOM_USERNAME: preserve(),
  };

  const data = {
    NODE_ENV: "production",
    DATABASE_SSL: "true",
    REQUIRE_DATABASE: "true",
    REDIS_URL: cache.env.REDIS_URL,
    GROQ_STT_MODEL: "whisper-large-v3-turbo",
    GROQ_LLM_MODEL: "openai/gpt-oss-120b",
    GROQ_REASONING_EFFORT: "low",
    GEMINI_EMBEDDING_MODEL: "gemini-embedding-001",
    ELEVENLABS_VOICE_ID: "L4so9SudEsIYzE9j4qlR",
    ELEVENLABS_MODEL_ID: "eleven_flash_v2_5",
    ELEVENLABS_CHUNK_SCHEDULE: "50,90,120,150",
    ...secrets,
  };

  const api = service("@robinexis/api", {
    source,
    build: "node scripts/railway.mjs api",
    start: "node scripts/railway.mjs migrate && npm run start -w @robinexis/api",
    healthcheck: "/health",
    healthcheckTimeout: 30,
    env: {
      ...data,
      RAILWAY_BUILD_TARGET: "api",
      API_PUBLIC_BASE_URL: "https://${{RAILWAY_PUBLIC_DOMAIN}}",
      ADMIN_EMAILS: "gulfamamjad633@gmail.com",
      RAG_TOP_K: "5",
      RAG_MIN_SIMILARITY: "0.55",
      RAG_EMBEDDING_DIMENSIONS: "768",
      WEB_ORIGIN: preserve(),
      SUPABASE_URL: preserve(),
      SUPABASE_JWT_SECRET: preserve(),
    },
  });

  const gateway = service("@robinexis/voice-gateway", {
    source,
    build: "node scripts/railway.mjs gateway",
    start: "npm run start -w @robinexis/voice-gateway",
    healthcheck: "/health",
    healthcheckTimeout: 30,
    env: {
      ...data,
      RAILWAY_BUILD_TARGET: "gateway",
      PUBLIC_BASE_URL: "https://${{RAILWAY_PUBLIC_DOMAIN}}",
      STT_PROVIDER: "groq",
      VAD_ENERGY_THRESHOLD: "500",
      VAD_SILENCE_MS: "500",
      FRONT_DESK_PHONE_NUMBER: preserve(),
      FALLBACK_VOICEMAIL_URL: preserve(),
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
      PUBLIC_BASE_URL: preserve(),
      API_PUBLIC_BASE_URL: preserve(),
      TWILIO_SMS_NUMBER: preserve(),
    },
  });

  return project("robinexis", {
    resources: [cache, api, gateway, worker],
  });
});
