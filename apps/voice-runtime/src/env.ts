export interface VoiceRuntimeEnv {
  livekitUrl: string;
  livekitApiKey: string;
  livekitApiSecret: string;
  deepgramApiKey: string;
  llmProvider: "groq" | "google";
  groqApiKey?: string;
  googleApiKey?: string;
  groqModel: string;
  geminiModel: string;
  elevenLabsApiKey: string;
  elevenLabsVoiceId: string;
  elevenLabsTtsModel: string;
  apiBaseUrl: string;
  internalSecret: string;
  signingSecret: string;
}

const REQUIRED = {
  LIVEKIT_URL: "livekitUrl",
  LIVEKIT_API_KEY: "livekitApiKey",
  LIVEKIT_API_SECRET: "livekitApiSecret",
  DEEPGRAM_API_KEY: "deepgramApiKey",
  ELEVENLABS_API_KEY: "elevenLabsApiKey",
  ELEVENLABS_VOICE_ID: "elevenLabsVoiceId",
  VOICE_RUNTIME_API_BASE_URL: "apiBaseUrl",
  VOICE_RUNTIME_INTERNAL_SECRET: "internalSecret",
  VOICE_RUNTIME_SIGNING_SECRET: "signingSecret",
} as const;

export function loadVoiceRuntimeEnv(env: NodeJS.ProcessEnv = process.env): VoiceRuntimeEnv {
  if (env.VOICE_RUNTIME_ENABLED !== "true") {
    throw new Error("voice_runtime_disabled");
  }
  const llmProvider = env.VOICE_LLM_PROVIDER?.trim().toLowerCase() || "groq";
  if (llmProvider !== "groq" && llmProvider !== "google") {
    throw new Error("invalid_voice_llm_provider");
  }
  const providerKey = llmProvider === "groq" ? "GROQ_API_KEY" : "GOOGLE_API_KEY";
  const missing = [
    ...Object.keys(REQUIRED).filter((name) => !env[name]?.trim()),
    ...(!env[providerKey]?.trim() ? [providerKey] : []),
  ];
  if (missing.length) throw new Error(`missing_voice_runtime_env:${missing.join(",")}`);

  const values = Object.fromEntries(
    Object.entries(REQUIRED).map(([name, key]) => [key, env[name]!.trim()]),
  ) as unknown as Pick<
    VoiceRuntimeEnv,
    | "livekitUrl"
    | "livekitApiKey"
    | "livekitApiSecret"
    | "deepgramApiKey"
    | "elevenLabsApiKey"
    | "elevenLabsVoiceId"
    | "apiBaseUrl"
    | "internalSecret"
    | "signingSecret"
  >;
  return {
    ...values,
    llmProvider,
    groqApiKey: env.GROQ_API_KEY?.trim() || undefined,
    googleApiKey: env.GOOGLE_API_KEY?.trim() || undefined,
    groqModel: env.GROQ_LLM_MODEL?.trim() || "openai/gpt-oss-120b",
    geminiModel: env.GEMINI_LLM_MODEL?.trim() || "gemini-2.5-flash",
    elevenLabsTtsModel: env.ELEVENLABS_TTS_MODEL?.trim() || "eleven_flash_v2_5",
  };
}
