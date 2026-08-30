import { createGroqWhisperSttSession } from "./groqWhisperStt.js";
import type { SttFactory } from "./stt.js";

export type SttProvider = "groq";

/**
 * Provider boundary for inbound transcription. Groq remains the default while
 * the call orchestration is now ready for a realtime WebSocket adapter later.
 */
export function sttFactory(
  provider = (process.env.STT_PROVIDER || "groq").toLowerCase(),
): SttFactory {
  if (provider === "groq") return createGroqWhisperSttSession;
  throw new Error(`Unsupported STT_PROVIDER: ${provider}`);
}
