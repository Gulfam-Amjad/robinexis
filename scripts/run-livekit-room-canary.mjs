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
import pg from "pg";

const environment = process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_ENVIRONMENT || "";
if (environment !== "staging" || process.env.LIVE_STAGING_CANARY !== "true") {
  throw new Error("confirmed staging canary required");
}
const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const clientId = "client_staging_launch_canary";
const pool = new pg.Pool({
  connectionString: required("DATABASE_URL"),
  ssl: { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === "true" },
});
const deploymentResult = await pool.query(
  "SELECT id FROM provider_deployments WHERE client_id=$1 AND provider='livekit-cascade' AND status='active' LIMIT 1",
  [clientId],
);
const deploymentId = deploymentResult.rows[0]?.id;
if (!deploymentId) throw new Error("active_livekit_deployment_required");
const url = required("LIVEKIT_URL");
const apiKey = required("LIVEKIT_API_KEY");
const apiSecret = required("LIVEKIT_API_SECRET");
const httpUrl = url.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
const roomName = `robinexis-canary-${Date.now()}`;
const rooms = new RoomServiceClient(httpUrl, apiKey, apiSecret);
const dispatches = new AgentDispatchClient(httpUrl, apiKey, apiSecret);
await rooms.createRoom({ name: roomName, emptyTimeout: 120, departureTimeout: 20 });
const dispatch = await dispatches.createDispatch(
  roomName,
  "robinexis-alternate-runtime",
  {
    metadata: JSON.stringify({
      tenantId: clientId,
      deploymentId,
      direction: "inbound",
      objective: "LiveKit staging runtime canary",
    }),
  },
);
const tokenBuilder = new AccessToken(apiKey, apiSecret, {
  identity: "staging-canary-caller",
  name: "Staging Canary",
});
tokenBuilder.addGrant({
  roomJoin: true,
  room: roomName,
  canPublish: true,
  canSubscribe: true,
});
const token = await tokenBuilder.toJwt();
const room = new Room();
let agentConnected = false;
let remoteAudioFrames = 0;
let audioReader;
room.on(RoomEvent.ParticipantConnected, (participant) => {
  if (participant.identity !== "staging-canary-caller") agentConnected = true;
});
room.on(RoomEvent.TrackSubscribed, (track) => {
  if (track.kind !== TrackKind.KIND_AUDIO) return;
  const stream = new AudioStream(track, { sampleRate: 24000, numChannels: 1 });
  audioReader = stream.getReader();
  void (async () => {
    while (remoteAudioFrames < 25) {
      const frame = await audioReader.read();
      if (frame.done) break;
      remoteAudioFrames += 1;
    }
  })();
});
await room.connect(url, token, { autoSubscribe: true, dynacast: false });
agentConnected = agentConnected || room.remoteParticipants.size > 0;
const source = new AudioSource(24000, 1);
const localTrack = LocalAudioTrack.createAudioTrack("canary-microphone", source);
await room.localParticipant.publishTrack(localTrack, { source: TrackSource.SOURCE_MICROPHONE });
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
if (audioReader) await audioReader.cancel();
await dispatches.deleteDispatch(dispatch.id, roomName).catch(() => undefined);
await rooms.deleteRoom(roomName).catch(() => undefined);
await pool.end();
await dispose();
const ok = agentConnected && remoteAudioFrames >= 10;
console.log(JSON.stringify({
  ok,
  roomName,
  agentConnected,
  remoteAudioFrames,
  dispatchCreated: Boolean(dispatch.id),
}));
if (!ok) process.exitCode = 1;
