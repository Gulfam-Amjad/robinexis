import Groq, { toFile } from "groq-sdk";
import { config } from "./config.js";
import type { SttSession, SttSessionHandlers } from "./stt.js";

// Groq transcription is utterance-based rather than a realtime word socket.
// Local VAD provides immediate barge-in while completed utterances are sent
// to Whisper as PCM WAV.
const ENERGY_THRESHOLD = Number(process.env.VAD_ENERGY_THRESHOLD) || 500;
const SILENCE_HANGOVER_MS = Number(process.env.VAD_SILENCE_MS) || 500;
const SPEECH_START_CHUNKS = 2;
const PRE_ROLL_CHUNKS = 5;
const MIN_UTTERANCE_BYTES = 800;

export interface GroqWhisperSttOptions {
  silenceMs?: number;
  energyThreshold?: number;
  transcribe?: (wav: Buffer, signal: AbortSignal) => Promise<string>;
}

function mulawToPcm16(muByte: number): number {
  const u = ~muByte & 0xff;
  const sign = u & 0x80;
  const exponent = (u >> 4) & 0x07;
  const mantissa = u & 0x0f;
  const magnitude = (((mantissa << 3) + 0x84) << exponent) - 0x84;
  return sign ? -magnitude : magnitude;
}

function rmsOf(chunk: Buffer): number {
  if (!chunk.length) return 0;
  let sumSquares = 0;
  for (const byte of chunk) {
    const sample = mulawToPcm16(byte);
    sumSquares += sample * sample;
  }
  return Math.sqrt(sumSquares / chunk.length);
}

function toPcmWav(mulaw: Buffer): Buffer {
  const pcm = Buffer.alloc(mulaw.length * 2);
  for (let i = 0; i < mulaw.length; i++) {
    pcm.writeInt16LE(mulawToPcm16(mulaw[i]), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(8000, 24);
  header.writeUInt32LE(16000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export function createGroqWhisperSttSession(
  handlers: SttSessionHandlers,
  opts: GroqWhisperSttOptions = {},
): SttSession {
  const groq = opts.transcribe ? null : new Groq({ apiKey: config.groqApiKey });
  const silenceMs = opts.silenceMs ?? SILENCE_HANGOVER_MS;
  const energyThreshold = opts.energyThreshold ?? ENERGY_THRESHOLD;
  let closed = false;
  let speaking = false;
  let aboveCount = 0;
  let utteranceChunks: Buffer[] = [];
  const preRoll: Buffer[] = [];
  let silenceTimer: NodeJS.Timeout | null = null;
  const transcriptions = new Set<AbortController>();

  async function transcribe(mulaw: Buffer, controller: AbortController) {
    const startedAt = performance.now();
    try {
      const text = opts.transcribe
        ? await opts.transcribe(toPcmWav(mulaw), controller.signal)
        : (
            await groq!.audio.transcriptions.create(
              {
                file: await toFile(toPcmWav(mulaw), "utterance.wav", { type: "audio/wav" }),
                model: config.groqSttModel,
                language: "en",
                response_format: "json",
              },
              { signal: controller.signal },
            )
          ).text;
      if (!closed) {
        const normalized = text?.trim();
        handlers.onTranscriptionComplete?.({
          durationMs: Math.round(performance.now() - startedAt),
          textLength: normalized?.length ?? 0,
        });
        if (normalized) handlers.onUtterance(normalized);
      }
    } catch (err) {
      if (!closed && !controller.signal.aborted) handlers.onError?.(err);
    } finally {
      transcriptions.delete(controller);
    }
  }

  function finalizeUtterance() {
    const audio = Buffer.concat(utteranceChunks);
    utteranceChunks = [];
    speaking = false;
    aboveCount = 0;
    silenceTimer = null;
    if (audio.length < MIN_UTTERANCE_BYTES) return;
    handlers.onSpeechEnded?.({ audioMs: Math.round(audio.length / 8) });
    const controller = new AbortController();
    transcriptions.add(controller);
    void transcribe(audio, controller);
  }

  return {
    sendAudio(chunk) {
      if (closed) return;
      preRoll.push(chunk);
      if (preRoll.length > PRE_ROLL_CHUNKS) preRoll.shift();
      const above = rmsOf(chunk) > energyThreshold;
      if (above) {
        if (silenceTimer) clearTimeout(silenceTimer);
        silenceTimer = null;
        aboveCount++;
        if (!speaking && aboveCount >= SPEECH_START_CHUNKS) {
          // A new utterance supersedes an older transcription that has not
          // reached the brain yet. Abort it to prevent delayed ghost turns.
          for (const controller of transcriptions) controller.abort();
          transcriptions.clear();
          speaking = true;
          utteranceChunks = [...preRoll];
          handlers.onSpeechStarted?.();
        } else if (speaking) {
          utteranceChunks.push(chunk);
        }
      } else {
        aboveCount = 0;
        if (speaking) {
          utteranceChunks.push(chunk);
          silenceTimer ??= setTimeout(finalizeUtterance, silenceMs);
        }
      }
    },
    close() {
      closed = true;
      if (silenceTimer) clearTimeout(silenceTimer);
      for (const controller of transcriptions) controller.abort();
      transcriptions.clear();
    },
  };
}
