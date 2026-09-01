import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import WebSocket from "ws";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnv({ path: path.join(root, ".env"), quiet: true });

const agentId = process.argv[2];
if (!agentId) throw new Error("usage: node scripts/measure-elevenlabs-agent.mjs <agent_id>");
const mode = process.argv[3] === "ordinary" ? "ordinary" : "interrupt";

const signed = await fetch(
  `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${agentId}`,
  { headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY || "" } },
);
const signedBody = await signed.json();
if (!signed.ok) throw new Error(JSON.stringify(signedBody));

const started = performance.now();
const socket = new WebSocket(signedBody.signed_url);
let queryAt;
let interrupted = false;
let greetingAudioSeen = false;
let responseAudioMs;
let responseMessage = "";
let ordinaryAskTimer;
let greetingAudioStartedAt;
let greetingAudioBytes = 0;
let finished = false;

function sendQuery() {
  if (queryAt) return;
  queryAt = performance.now();
  socket.send(
    JSON.stringify({
      type: "user_message",
      text: mode === "interrupt"
        ? "Actually, what time do you close on Friday?"
        : "What time do you close on Friday?",
      source_medium: "text",
    }),
  );
}

function finishIfReady() {
  if (finished || !queryAt || responseAudioMs === undefined || !responseMessage) return;
  finished = true;
  console.log(
    JSON.stringify(
      {
        mode,
        connectedMs: Math.round(queryAt - started),
        responseStartMs: responseAudioMs,
        interrupted,
        response: responseMessage,
      },
      null,
      2,
    ),
  );
  const failed =
    !/seven|7/i.test(responseMessage) ||
    (mode === "interrupt" ? !interrupted : responseAudioMs > 1_500);
  if (failed) process.exitCode = 1;
  clearTimeout(timeout);
  socket.close();
}

const timeout = setTimeout(() => {
  console.error("Timed out waiting for response");
  socket.close();
  process.exitCode = 1;
}, 25_000);

socket.on("open", () => {
  socket.send(JSON.stringify({ type: "conversation_initiation_client_data" }));
});

socket.on("message", (buffer) => {
  const event = JSON.parse(String(buffer));
  if (event.type === "ping") {
    setTimeout(
      () => socket.send(JSON.stringify({ type: "pong", event_id: event.ping_event.event_id })),
      event.ping_event.ping_ms || 0,
    );
    return;
  }
  if (event.type === "interruption" && queryAt) interrupted = true;

  if (event.type === "audio" && !greetingAudioSeen) {
    greetingAudioSeen = true;
    greetingAudioStartedAt = performance.now();
    greetingAudioBytes += Buffer.from(event.audio_event.audio_base_64, "base64").length;
    if (mode === "interrupt") sendQuery();
    else ordinaryAskTimer = setTimeout(sendQuery, greetingAudioBytes / 32 + 1_800);
    return;
  }
  if (event.type === "audio" && mode === "ordinary" && !queryAt) {
    greetingAudioBytes += Buffer.from(event.audio_event.audio_base_64, "base64").length;
    clearTimeout(ordinaryAskTimer);
    const finishAt = greetingAudioStartedAt + greetingAudioBytes / 32 + 1_800;
    ordinaryAskTimer = setTimeout(sendQuery, Math.max(0, finishAt - performance.now()));
    return;
  }
  if (
    event.type === "audio" &&
    queryAt &&
    (mode === "ordinary" || interrupted) &&
    responseAudioMs === undefined
  ) {
    responseAudioMs = Math.round(performance.now() - queryAt);
    finishIfReady();
  }

  if (event.type === "agent_response") {
    const message = event.agent_response_event?.agent_response || "";
    if (
      queryAt &&
      !/thanks for calling blades|you've reached blades/i.test(message)
    ) {
      responseMessage = message;
      finishIfReady();
    }
  }
});

socket.on("error", (error) => {
  clearTimeout(timeout);
  console.error(error);
  process.exitCode = 1;
});
