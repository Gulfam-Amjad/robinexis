import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(__dirname, "../../../.env") });

function optional(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

function numberList(name: string, fallback: number[]): number[] {
  const parsed = (process.env[name] || "")
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value) && value >= 50 && value <= 500);
  return parsed.length ? parsed : fallback;
}

export const FRONT_DESK_PLACEHOLDER = "+15555550100";

export const config = {
  port: Number(process.env.PORT) || 8080,
  groqApiKey: process.env.GROQ_API_KEY ?? "",
  elevenLabsApiKey: process.env.ELEVENLABS_API_KEY ?? "",
  calcomApiKey: process.env.CALCOM_API_KEY ?? "",
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID ?? "",
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN ?? "",
  frontDeskPhoneNumber: optional("FRONT_DESK_PHONE_NUMBER", FRONT_DESK_PLACEHOLDER),
  groqSttModel: optional("GROQ_STT_MODEL", "whisper-large-v3-turbo"),
  groqLlmModel: optional("GROQ_LLM_MODEL", "openai/gpt-oss-120b"),
  elevenLabsVoiceId: optional("ELEVENLABS_VOICE_ID", "L4so9SudEsIYzE9j4qlR"),
  elevenLabsModelId: optional("ELEVENLABS_MODEL_ID", "eleven_flash_v2_5"),
  elevenLabsChunkSchedule: numberList("ELEVENLABS_CHUNK_SCHEDULE", [50, 90, 120, 150]),
  fallbackVoicemailUrl: process.env.FALLBACK_VOICEMAIL_URL ?? "",
  defaultClientSlug: optional("DEFAULT_CLIENT_SLUG", "robinexis-demo"),
};

export function warnOnMissingConfig() {
  const missing: string[] = [];
  if (!config.groqApiKey) missing.push("GROQ_API_KEY (STT and conversational brain)");
  if (!config.elevenLabsApiKey) missing.push("ELEVENLABS_API_KEY");
  if (!config.twilioAccountSid || !config.twilioAuthToken) missing.push("TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN");
  if (config.frontDeskPhoneNumber === FRONT_DESK_PLACEHOLDER) {
    missing.push("FRONT_DESK_PHONE_NUMBER (still the placeholder)");
  }
  if (missing.length) {
    console.warn(`[config] Missing env vars: ${missing.join(", ")}`);
  }
}
