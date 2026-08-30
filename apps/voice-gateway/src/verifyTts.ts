/**
 * Verifies the live persistent ElevenLabs multi-context path without placing a
 * phone call. Generates two short turns over one WebSocket.
 *
 *   npm run check:tts
 */
import { createElevenLabsTtsSession } from "./elevenlabsTts.js";

async function main() {
  let activeTurn = 0;
  const bytes = [0, 0];
  const firstAudioMs = [0, 0];
  let startedAt = 0;
  const session = createElevenLabsTtsSession((chunk) => {
    bytes[activeTurn] = (bytes[activeTurn] ?? 0) + chunk.length;
    if (!firstAudioMs[activeTurn]) firstAudioMs[activeTurn] = Date.now() - startedAt;
  });

  try {
    for (activeTurn = 0; activeTurn < 2; activeTurn++) {
      startedAt = Date.now();
      const turn = session.startTurn();
      turn.write(
        activeTurn === 0
          ? "Hello, this is the Robinexis persistent voice check."
          : "This second response is using the same WebSocket connection.",
      );
      await turn.finish();
      console.log(
        `[PASS] turn ${activeTurn + 1}: firstAudio=${firstAudioMs[activeTurn]}ms bytes=${bytes[activeTurn]}`,
      );
    }
  } finally {
    session.close();
  }
}

main().catch((error) => {
  console.error(`[FAIL] ${String(error)}`);
  process.exitCode = 1;
});
