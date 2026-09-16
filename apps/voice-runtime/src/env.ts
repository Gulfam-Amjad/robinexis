export interface VoiceRuntimeEnv {
  livekitUrl: string;
  livekitApiKey: string;
  livekitApiSecret: string;
  deepgramApiKey: string;
  googleApiKey: string;
  cartesiaApiKey: string;
  apiBaseUrl: string;
  internalSecret: string;
  signingSecret: string;
  cartesiaVoiceId: string;
  geminiModel: string;
}

const REQUIRED = {
  LIVEKIT_URL: "livekitUrl",
  LIVEKIT_API_KEY: "livekitApiKey",
  LIVEKIT_API_SECRET: "livekitApiSecret",
  DEEPGRAM_API_KEY: "deepgramApiKey",
  GOOGLE_API_KEY: "googleApiKey",
  CARTESIA_API_KEY: "cartesiaApiKey",
  VOICE_RUNTIME_API_BASE_URL: "apiBaseUrl",
  VOICE_RUNTIME_INTERNAL_SECRET: "internalSecret",
  VOICE_RUNTIME_SIGNING_SECRET: "signingSecret",
} as const;

export function loadVoiceRuntimeEnv(env: NodeJS.ProcessEnv = process.env): VoiceRuntimeEnv {
  if (env.VOICE_RUNTIME_ENABLED !== "true") {
    throw new Error("voice_runtime_disabled");
  }
  const missing = Object.keys(REQUIRED).filter((name) => !env[name]?.trim());
  if (missing.length) throw new Error(`missing_voice_runtime_env:${missing.join(",")}`);

  const values = Object.fromEntries(
    Object.entries(REQUIRED).map(([name, key]) => [key, env[name]!.trim()]),
  ) as unknown as Omit<VoiceRuntimeEnv, "cartesiaVoiceId" | "geminiModel">;
  return {
    ...values,
    cartesiaVoiceId: env.CARTESIA_VOICE_ID?.trim() || "9626c31c-bec5-4cca-baa8-f8ba9e84c8bc",
    geminiModel: env.GEMINI_LLM_MODEL?.trim() || "gemini-2.5-flash",
  };
}
