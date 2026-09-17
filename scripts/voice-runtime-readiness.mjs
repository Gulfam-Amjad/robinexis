/**
 * Reports whether the cheap LiveKit voice runtime can start.
 * Prints key NAMES only — never values.
 */
import { config } from "dotenv";

config({ path: ".env", quiet: true });

const required = [
  "LIVEKIT_URL",
  "LIVEKIT_API_KEY",
  "LIVEKIT_API_SECRET",
  "DEEPGRAM_API_KEY",
  "ELEVENLABS_API_KEY",
  "ELEVENLABS_VOICE_ID",
  "VOICE_RUNTIME_API_BASE_URL",
  "VOICE_RUNTIME_INTERNAL_SECRET",
  "VOICE_RUNTIME_SIGNING_SECRET",
];
const llmProvider = (process.env.VOICE_LLM_PROVIDER || "groq").toLowerCase();
const providerKey = llmProvider === "google" ? "GOOGLE_API_KEY" : "GROQ_API_KEY";
required.push(providerKey);

const present = required.filter((name) => Boolean(process.env[name]?.trim()));
const missing = required.filter((name) => !process.env[name]?.trim());

console.log(JSON.stringify({
  voiceRuntimeEnabled: process.env.VOICE_RUNTIME_ENABLED === "true",
  cheapVoiceDefaultEnabled: process.env.CHEAP_VOICE_DEFAULT_ENABLED === "true",
  providerSwitchEnabled: process.env.PROVIDER_SWITCH_ENABLED === "true",
  providerSwitchRoutingEnabled: process.env.PROVIDER_SWITCH_ROUTING_ENABLED === "true",
  llmProvider,
  saasProvisioningEnabled: process.env.SAAS_PROVISIONING_ENABLED === "true",
  present,
  missing,
  readyToStartRuntime: process.env.VOICE_RUNTIME_ENABLED === "true" && missing.length === 0,
  canChangeLivePhoneRouting: process.env.PROVIDER_SWITCH_ROUTING_ENABLED === "true",
}, null, 2));
