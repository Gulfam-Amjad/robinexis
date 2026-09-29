export interface VoiceRuntimeEnv {
  livekitUrl: string;
  livekitApiKey: string;
  livekitApiSecret: string;
  deepgramApiKey: string;
  deepgramModel: string;
  deepgramEndpointingMs: number;
  llmProvider: "groq" | "google";
  groqApiKey?: string;
  googleApiKey?: string;
  groqModel: string;
  geminiModel: string;
  llmMaxCompletionTokens: number;
  elevenLabsApiKey: string;
  elevenLabsVoiceId: string;
  elevenLabsTtsModel: string;
  endpointingMinDelayMs: number;
  endpointingMaxDelayMs: number;
  interruptionMinDurationMs: number;
  interruptionMinWords: number;
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
    geminiModel: env.GEMINI_LLM_MODEL?.trim() || "gemini-3.6-flash",
    llmMaxCompletionTokens: boundedInteger(
      env.VOICE_LLM_MAX_COMPLETION_TOKENS,
      320,
      120,
      1_000,
    ),
    elevenLabsTtsModel: env.ELEVENLABS_TTS_MODEL?.trim() || "eleven_flash_v2_5",
    deepgramModel: env.DEEPGRAM_STT_MODEL?.trim() || "nova-3",
    deepgramEndpointingMs: boundedInteger(env.DEEPGRAM_ENDPOINTING_MS, 300, 100, 2_000),
    endpointingMinDelayMs: boundedInteger(env.VOICE_ENDPOINTING_MIN_DELAY_MS, 650, 300, 3_000),
    endpointingMaxDelayMs: boundedInteger(env.VOICE_ENDPOINTING_MAX_DELAY_MS, 2_800, 1_000, 8_000),
    interruptionMinDurationMs: boundedInteger(env.VOICE_INTERRUPTION_MIN_DURATION_MS, 400, 150, 3_000),
    interruptionMinWords: boundedInteger(env.VOICE_INTERRUPTION_MIN_WORDS, 1, 0, 10),
  };
}

function boundedInteger(
  raw: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.round(parsed)));
}
