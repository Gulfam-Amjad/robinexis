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
import { RoomServiceClient } from "livekit-server-sdk";
import { createPool, PostgresStore } from "@robinexis/database";
import { createProviderComparisonSession } from "../apps/api/src/providerComparisonRoutes.js";

const environment = process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_ENVIRONMENT || "";
if (environment !== "production" || process.env.CONFIRM_COST_SAVER_BROWSER_CANARY !== "true") {
  throw new Error("confirmed production Cost Saver browser canary required");
}
const pool = createPool(process.env.DATABASE_URL || "");
const store = new PostgresStore(pool);
const before = await store.listProviderUsageCostEvents("client_blades_hair");
const session = await createProviderComparisonSession(store, undefined, "delivery-gate");
const room = new Room();
let agentConnected = false;
let remoteAudioFrames = 0;
let reader: ReadableStreamDefaultReader | undefined;
room.on(RoomEvent.ParticipantConnected, () => {
  agentConnected = true;
});
room.on(RoomEvent.TrackSubscribed, (track) => {
  if (track.kind !== TrackKind.KIND_AUDIO) return;
  const stream = new AudioStream(track, { sampleRate: 24000, numChannels: 1 });
  reader = stream.getReader();
  void (async () => {
    while (remoteAudioFrames < 25) {
      const frame = await reader!.read();
      if (frame.done) break;
      remoteAudioFrames += 1;
    }
  })();
});
await room.connect(session.url, session.token, { autoSubscribe: true, dynacast: false });
agentConnected = agentConnected || room.remoteParticipants.size > 0;
const source = new AudioSource(24000, 1);
const localTrack = LocalAudioTrack.createAudioTrack("browser-canary-microphone", source);
await room.localParticipant!.publishTrack(localTrack, { source: TrackSource.SOURCE_MICROPHONE });
const silence = new AudioFrame(new Int16Array(480), 24000, 1, 480);
for (let frame = 0; frame < 250; frame += 1) {
  await source.captureFrame(silence);
  if (remoteAudioFrames >= 10) break;
}
for (let attempt = 0; attempt < 30 && (!agentConnected || remoteAudioFrames < 10); attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 1_000));
}
await source.close();
await room.disconnect();
if (reader) await reader.cancel();
const roomService = new RoomServiceClient(
  session.url.replace(/^wss:/, "https:").replace(/^ws:/, "http:"),
  process.env.LIVEKIT_API_KEY,
  process.env.LIVEKIT_API_SECRET,
);
await roomService.deleteRoom(session.roomName).catch(() => undefined);
let after = before;
for (let attempt = 0; attempt < 20; attempt += 1) {
  after = await store.listProviderUsageCostEvents("client_blades_hair");
  if (after.length > before.length) break;
  await new Promise((resolve) => setTimeout(resolve, 1_500));
}
await pool.end();
await dispose();
const newLiveKitEvents = after.filter((item) =>
  item.provider === "livekit-cascade" &&
  !before.some((previous) => previous.id === item.id)).length;
const ok = agentConnected && remoteAudioFrames >= 10 && newLiveKitEvents > 0;
console.log(JSON.stringify({
  ok,
  sessionCreated: Boolean(session.token),
  agentConnected,
  remoteAudioFrames,
  newLiveKitEvents,
  phoneRoutingChanged: false,
}));
if (!ok) process.exitCode = 1;
