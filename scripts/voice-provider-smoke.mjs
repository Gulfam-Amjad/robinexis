import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnv({ path: path.join(root, ".env"), quiet: true });

const required = [
  "GROQ_API_KEY",
  "DEEPGRAM_API_KEY",
  "ELEVENLABS_API_KEY",
  "ELEVENLABS_VOICE_ID",
];
const missing = required.filter((name) => !process.env[name]?.trim());
if (missing.length) throw new Error(`missing_provider_smoke_env:${missing.join(",")}`);

const groq = await fetch("https://api.groq.com/openai/v1/chat/completions", {
  method: "POST",
  headers: {
    authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    model: process.env.GROQ_LLM_MODEL || "openai/gpt-oss-120b",
    messages: [{ role: "user", content: "Reply with exactly: ready" }],
    max_tokens: 8,
    temperature: 0,
  }),
  signal: AbortSignal.timeout(30_000),
});
if (!groq.ok) throw new Error(`groq_smoke_failed:${groq.status}:${await groq.text()}`);
const groqBody = await groq.json();
const groqMessage = groqBody.choices?.[0]?.message;
if (!String(groqMessage?.content || groqMessage?.reasoning || "").trim()) {
  throw new Error("groq_smoke_unexpected_response");
}

const tts = await fetch(
  `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(process.env.ELEVENLABS_VOICE_ID)}?output_format=mp3_22050_32`,
  {
    method: "POST",
    headers: {
      "xi-api-key": process.env.ELEVENLABS_API_KEY,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      text: "Robinexis provider test ready.",
      model_id: process.env.ELEVENLABS_TTS_MODEL || "eleven_flash_v2_5",
    }),
    signal: AbortSignal.timeout(30_000),
  },
);
if (!tts.ok) throw new Error(`elevenlabs_smoke_failed:${tts.status}:${await tts.text()}`);
const audio = Buffer.from(await tts.arrayBuffer());
if (audio.length < 100) throw new Error("elevenlabs_smoke_empty_audio");

const stt = await fetch(
  "https://api.deepgram.com/v1/listen?model=nova-3&language=en-GB&smart_format=true",
  {
    method: "POST",
    headers: {
      authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
      "content-type": "audio/mpeg",
    },
    body: audio,
    signal: AbortSignal.timeout(30_000),
  },
);
if (!stt.ok) throw new Error(`deepgram_smoke_failed:${stt.status}:${await stt.text()}`);
const sttBody = await stt.json();
const transcript = String(
  sttBody.results?.channels?.[0]?.alternatives?.[0]?.transcript || "",
);
if (!transcript.toLowerCase().replace(/[^a-z0-9]/g, "").includes("robinexis")) {
  throw new Error(`deepgram_smoke_unexpected_transcript:${transcript}`);
}

console.log(JSON.stringify({
  groq: "ok",
  elevenLabsTts: "ok",
  deepgram: "ok",
  synthesizedBytes: audio.length,
  transcript,
}));
