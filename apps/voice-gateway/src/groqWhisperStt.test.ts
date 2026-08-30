import { afterEach, describe, expect, it, vi } from "vitest";
import { createGroqWhisperSttSession } from "./groqWhisperStt.js";

const speech = Buffer.alloc(160, 0x00);
const silence = Buffer.alloc(160, 0xff);

afterEach(() => vi.useRealTimers());

describe("Groq Whisper endpointing", () => {
  it("finalizes after the configured silence and reports timings", async () => {
    vi.useFakeTimers();
    const utterances: string[] = [];
    const ended: number[] = [];
    const completed: number[] = [];
    const session = createGroqWhisperSttSession(
      {
        onUtterance: (text) => utterances.push(text),
        onSpeechEnded: ({ audioMs }) => ended.push(audioMs),
        onTranscriptionComplete: ({ textLength }) => completed.push(textLength),
      },
      {
        silenceMs: 500,
        transcribe: async () => "Book me tomorrow",
      },
    );

    for (let index = 0; index < 5; index++) session.sendAudio(speech);
    session.sendAudio(silence);
    await vi.advanceTimersByTimeAsync(499);
    expect(utterances).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);

    expect(utterances).toEqual(["Book me tomorrow"]);
    expect(ended[0]).toBeGreaterThanOrEqual(100);
    expect(completed).toEqual([16]);
    session.close();
  });

  it("aborts a stale transcription when new speech starts", async () => {
    vi.useFakeTimers();
    let firstSignal: AbortSignal | undefined;
    const session = createGroqWhisperSttSession(
      { onUtterance: () => undefined },
      {
        silenceMs: 20,
        transcribe: async (_wav, signal) => {
          firstSignal ??= signal;
          return new Promise<string>(() => undefined);
        },
      },
    );

    for (let index = 0; index < 5; index++) session.sendAudio(speech);
    session.sendAudio(silence);
    await vi.advanceTimersByTimeAsync(20);
    session.sendAudio(speech);
    session.sendAudio(speech);

    expect(firstSignal?.aborted).toBe(true);
    session.close();
  });
});
