import {
  AccessToken,
  AgentDispatchClient,
  RoomServiceClient,
} from "livekit-server-sdk";
import {
  AudioFrame,
  AudioSource,
  AudioStream,
  dispose,
  LocalAudioTrack,
  Room,
  RoomEvent,
  TrackKind,
  TrackSource,
} from "@livekit/rtc-node";
import { createPool, PostgresStore } from "@robinexis/database";
import { createProviderComparisonSession } from "../apps/api/src/providerComparisonRoutes.js";

const environment = process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_ENVIRONMENT || "";
if (!["staging", "production"].includes(environment)) {
  throw new Error("Cost Saver conversation canary requires staging or production");
}
if (process.env.CONFIRM_COST_SAVER_CONVERSATION_CANARY !== "true") {
  throw new Error("confirmed Cost Saver conversation canary required");
}

const required = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const clientId = process.env.COST_SAVER_CANARY_CLIENT_ID?.trim() ||
  (environment === "production" ? "client_blades_hair" : "client_staging_launch_canary");
const livekitUrl = required("LIVEKIT_URL");
const apiKey = required("LIVEKIT_API_KEY");
const apiSecret = required("LIVEKIT_API_SECRET");
const httpUrl = livekitUrl.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
const pool = createPool(required("DATABASE_URL"));
const store = new PostgresStore(pool);
const beforeCalls = await store.listCallsForClient(clientId, 100);
const roomService = new RoomServiceClient(httpUrl, apiKey, apiSecret);
const dispatches = new AgentDispatchClient(httpUrl, apiKey, apiSecret);

let roomName = "";
let token = "";
let dispatchId = "";
if (environment === "production" && clientId === "client_blades_hair") {
  const session = await createProviderComparisonSession(store, undefined, "conversation-quality-canary");
  roomName = session.roomName;
  token = session.token;
} else {
  const deployment = (await pool.query(
    `SELECT id FROM provider_deployments
     WHERE client_id=$1 AND provider='livekit-cascade' AND status IN ('active', 'staged')
     ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, updated_at DESC LIMIT 1`,
    [clientId],
  )).rows[0]?.id;
  if (!deployment) throw new Error("active_livekit_deployment_required");
  roomName = `cost-saver-conversation-${Date.now()}`;
  await roomService.createRoom({ name: roomName, emptyTimeout: 120, departureTimeout: 20 });
  const dispatch = await dispatches.createDispatch(
    roomName,
    process.env.LIVEKIT_AGENT_NAME?.trim() || "robinexis-alternate-runtime",
    {
    metadata: JSON.stringify({
      tenantId: clientId,
      deploymentId: deployment,
      direction: "inbound",
      objective: "Cost Saver multi-turn conversation canary",
    }),
    },
  );
  dispatchId = dispatch.id;
  const tokenBuilder = new AccessToken(apiKey, apiSecret, {
    identity: `conversation-canary-${Date.now()}`,
    name: "Conversation Canary",
  });
  tokenBuilder.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
  });
  token = await tokenBuilder.toJwt();
}

const room = new Room();
const remoteFrameTimes: number[] = [];
const agentSpeechEvents: Array<{ at: number; speaking: boolean }> = [];
let agentConnected = false;
let reader: ReadableStreamDefaultReader | undefined;
room.on(RoomEvent.ParticipantConnected, () => {
  agentConnected = true;
});
room.on(RoomEvent.TrackSubscribed, (track) => {
  if (track.kind !== TrackKind.KIND_AUDIO) return;
  const stream = new AudioStream(track, { sampleRate: 24000, numChannels: 1 });
  reader = stream.getReader();
  void (async () => {
    while (true) {
      const frame = await reader!.read();
      if (frame.done) break;
      if (audioEnergy(frame.value.data) >= 120) remoteFrameTimes.push(Date.now());
    }
  })();
});
room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
  agentSpeechEvents.push({
    at: Date.now(),
    speaking: speakers.some((speaker) => speaker.identity !== room.localParticipant?.identity),
  });
});

await room.connect(livekitUrl, token, { autoSubscribe: true, dynacast: false });
agentConnected = agentConnected || room.remoteParticipants.size > 0;
const source = new AudioSource(24000, 1);
const localTrack = LocalAudioTrack.createAudioTrack("conversation-canary-microphone", source);
await room.localParticipant!.publishTrack(localTrack, { source: TrackSource.SOURCE_MICROPHONE });

for (let attempt = 0; attempt < 60 && remoteFrameTimes.length < 5; attempt += 1) {
  await sleep(100);
}
await sleep(450);
const interruptionStartedAt = Date.now();
const pcm = await synthesizePcm(
  "Please stop. I want to book a gentleman's haircut on Monday the twenty-first of September at eleven thirty. Is that available?",
);
await publishPcm(source, pcm);
await publishSilence(source, 1_000);
await sleep(8_000);

await source.close();
await room.disconnect();
if (reader) await reader.cancel().catch(() => undefined);
if (dispatchId) await dispatches.deleteDispatch(dispatchId, roomName).catch(() => undefined);
await roomService.deleteRoom(roomName).catch(() => undefined);

let newCall = undefined as Awaited<ReturnType<typeof store.getCall>> | undefined;
for (let attempt = 0; attempt < 30; attempt += 1) {
  const calls = await store.listCallsForClient(clientId, 100);
  newCall = calls.find((call) => !beforeCalls.some((previous) => previous.id === call.id));
  if (newCall?.transcript?.some((turn) => turn.role === "caller")) break;
  await sleep(1_000);
}

const callerText = newCall?.transcript
  .filter((turn) => turn.role === "caller")
  .map((turn) => turn.text)
  .join(" ") || "";
const agentTurns = newCall?.transcript.filter((turn) => turn.role === "agent") || [];
const responseText = agentTurns.at(-1)?.text || "";
const gaps = remoteFrameTimes
  .filter((time) => time >= interruptionStartedAt && time <= interruptionStartedAt + 3_000)
  .map((time, index, values) => index ? time - values[index - 1]! : 0);
const largestInterruptionGapMs = Math.max(0, ...gaps);
const interruptionStop = agentSpeechEvents.find((event) =>
  !event.speaking &&
  event.at >= interruptionStartedAt &&
  event.at <= interruptionStartedAt + 1_500);
const heardCompleteRequest = /gentleman/i.test(callerText) &&
  /monday/i.test(callerText) &&
  /(eleven|11).*(thirty|30)/i.test(callerText);
const oneQuestion = (responseText.match(/\?/g) || []).length <= 1;
const offeredTimes = responseText.match(/\b(?:1[0-2]|[1-9])(?::[0-5]\d)?\s*(?:am|pm)\b/gi) || [];
const conciseResponse = responseText.split(/\s+/).filter(Boolean).length <= 50 && offeredTimes.length <= 3;
const respondedAfterCaller = agentTurns.length >= 2;
const interruptionObserved = Boolean(interruptionStop) || largestInterruptionGapMs >= 200;
const interruptionStopMs = interruptionStop ? interruptionStop.at - interruptionStartedAt : undefined;
const ok = agentConnected &&
  heardCompleteRequest &&
  respondedAfterCaller &&
  oneQuestion &&
  conciseResponse &&
  interruptionObserved;

await pool.end();
await dispose();
console.log(JSON.stringify({
  ok,
  environment,
  clientId,
  roomName,
  agentConnected,
  heardCompleteRequest,
  respondedAfterCaller,
  oneQuestion,
  conciseResponse,
  offeredTimeCount: offeredTimes.length,
  interruptionObserved,
  interruptionStopMs,
  largestInterruptionGapMs,
  callerText,
  responseText,
  callId: newCall?.id,
}));
if (!ok) process.exitCode = 1;

async function synthesizePcm(text: string): Promise<Int16Array> {
  const voiceId = required("ELEVENLABS_VOICE_ID");
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=pcm_24000`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "xi-api-key": required("ELEVENLABS_API_KEY"),
      },
      body: JSON.stringify({
        text,
        model_id: process.env.ELEVENLABS_TTS_MODEL?.trim() || "eleven_flash_v2_5",
        voice_settings: { stability: 0.65, similarity_boost: 0.75 },
      }),
    },
  );
  if (!response.ok) throw new Error(`canary_tts_failed:${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const aligned = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new Int16Array(aligned);
}

async function publishPcm(source: AudioSource, samples: Int16Array): Promise<void> {
  const frameSamples = 480;
  for (let offset = 0; offset < samples.length; offset += frameSamples) {
    const chunk = new Int16Array(frameSamples);
    chunk.set(samples.subarray(offset, offset + frameSamples));
    await source.captureFrame(new AudioFrame(chunk, 24000, 1, frameSamples));
  }
}

async function publishSilence(source: AudioSource, durationMs: number): Promise<void> {
  const frameSamples = 480;
  const frames = Math.ceil(durationMs / 20);
  for (let index = 0; index < frames; index += 1) {
    await source.captureFrame(new AudioFrame(new Int16Array(frameSamples), 24000, 1, frameSamples));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function audioEnergy(samples: Int16Array): number {
  if (!samples.length) return 0;
  let total = 0;
  for (const sample of samples) total += Math.abs(sample);
  return total / samples.length;
}
