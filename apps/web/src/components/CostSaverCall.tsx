import {
  Room,
  RoomEvent,
  Track,
  type Participant,
  type RemoteTrack,
  type TranscriptionSegment,
} from "livekit-client";
import {
  Clock3,
  Gauge,
  Headphones,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  RotateCcw,
  ShieldCheck,
  Volume2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import {
  costSaverStartError,
  deriveReceptionistStatus,
  formatCallDuration,
  receptionistStatusCopy,
  type LocalCallPhase,
  type ReceptionistDemoConfig,
} from "../lib/receptionistDemo";
import { Badge, Button, Card, SectionHeading } from "./ui";

type TranscriptEntry = {
  id: string;
  role: "agent" | "user";
  message: string;
  final: boolean;
};

export function CostSaverCall({
  config,
  available,
  unavailableReason,
  disabled = false,
  requestStart,
  onActiveChange,
}: {
  config: ReceptionistDemoConfig;
  available: boolean;
  unavailableReason?: string;
  disabled?: boolean;
  requestStart?: () => boolean;
  onActiveChange?: (active: boolean) => void;
}) {
  const [phase, setPhase] = useState<LocalCallPhase>("idle");
  const [connected, setConnected] = useState(false);
  const [muted, setMuted] = useState(false);
  const [agentSpeaking, setAgentSpeaking] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const roomRef = useRef<Room | undefined>(undefined);
  const connectedAt = useRef(0);
  const audioRef = useRef<HTMLAudioElement>(null);
  const transcriptEnd = useRef<HTMLDivElement>(null);
  const activeChangeRef = useRef(onActiveChange);
  const requestStartRef = useRef(requestStart);
  const startAttempt = useRef(0);
  activeChangeRef.current = onActiveChange;
  requestStartRef.current = requestStart;

  const stop = useCallback(async (ended = true) => {
    startAttempt.current += 1;
    const room = roomRef.current;
    roomRef.current = undefined;
    if (room) {
      await room.localParticipant.setMicrophoneEnabled(false).catch(() => undefined);
      if (audioRef.current) {
        room.remoteParticipants.forEach((participant) => {
          participant.trackPublications.forEach((publication) => {
            publication.track?.detach(audioRef.current!);
          });
        });
        audioRef.current.pause();
        audioRef.current.srcObject = null;
      }
      room.disconnect();
      room.removeAllListeners();
    }
    setConnected(false);
    setMuted(false);
    setAgentSpeaking(false);
    if (ended) setPhase("ended");
    activeChangeRef.current?.(false);
  }, []);

  useEffect(() => () => {
    startAttempt.current += 1;
    const room = roomRef.current;
    roomRef.current = undefined;
    if (room) {
      room.disconnect();
      room.removeAllListeners();
    }
    activeChangeRef.current?.(false);
  }, []);

  useEffect(() => {
    if (disabled && (roomRef.current || phase === "permission" || phase === "starting")) {
      void stop();
    }
  }, [disabled, phase, stop]);

  useEffect(() => {
    if (!connected) return;
    const timer = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - connectedAt.current) / 1_000));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [connected]);

  useEffect(() => {
    transcriptEnd.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [transcript]);

  const receiveTranscript = useCallback((
    segments: TranscriptionSegment[],
    participant?: Participant,
  ) => {
    const role: TranscriptEntry["role"] = participant?.isLocal ? "user" : "agent";
    setTranscript((current) => {
      const next = [...current];
      for (const segment of segments) {
        const message = segment.text.trim();
        if (!message) continue;
        const existing = next.findIndex((item) => item.id === segment.id);
        const entry = { id: segment.id, role, message, final: segment.final };
        if (existing >= 0) next[existing] = entry;
        else next.push(entry);
      }
      return next;
    });
  }, []);

  const start = useCallback(async () => {
    if (!available || disabled) return;
    if (requestStartRef.current && !requestStartRef.current()) {
      setError("End the Premium call before starting Cost Saver.");
      return;
    }
    const attempt = ++startAttempt.current;
    setError("");
    setTranscript([]);
    setElapsed(0);
    setPhase("permission");
    activeChangeRef.current?.(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("This browser does not support microphone conversations.");
      }
      const permission = await navigator.mediaDevices.getUserMedia({ audio: true });
      permission.getTracks().forEach((track) => track.stop());
      if (attempt !== startAttempt.current) return;
      setPhase("starting");
      const session = await api.createProviderComparisonSession();
      if (attempt !== startAttempt.current) return;
      const room = new Room({ adaptiveStream: true, dynacast: true });
      roomRef.current = room;
      room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
        if (track.kind === Track.Kind.Audio && audioRef.current) track.attach(audioRef.current);
      });
      room.on(RoomEvent.TranscriptionReceived, receiveTranscript);
      room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
        setAgentSpeaking(speakers.some((speaker) => !speaker.isLocal));
      });
      room.on(RoomEvent.Disconnected, () => {
        setConnected(false);
        setAgentSpeaking(false);
        setPhase("ended");
        activeChangeRef.current?.(false);
      });
      await room.connect(session.url, session.token, { autoSubscribe: true });
      if (attempt !== startAttempt.current) {
        room.disconnect();
        return;
      }
      await room.localParticipant.setMicrophoneEnabled(true, {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      });
      connectedAt.current = Date.now();
      setConnected(true);
      setMuted(false);
      setPhase("idle");
    } catch (cause) {
      if (attempt !== startAttempt.current) return;
      await stop(false);
      setError(costSaverStartError(cause));
      setPhase("idle");
    }
  }, [available, disabled, receiveTranscript, stop]);

  const toggleMute = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    const next = !muted;
    await room.localParticipant.setMicrophoneEnabled(!next);
    setMuted(next);
  }, [muted]);

  const status = deriveReceptionistStatus({
    connection: connected ? "connected" : phase === "starting" ? "connecting" : "disconnected",
    phase,
    isMuted: muted,
    isSpeaking: agentSpeaking,
    hasError: Boolean(error),
  });
  const statusCopy = receptionistStatusCopy(status, config.agentName, config.businessName);

  return (
    <section className="comparison-call">
      <audio ref={audioRef} autoPlay />
      <div className="comparison-call-stage">
        <div className="comparison-call-brand">
          <span><Gauge /></span>
          <div><strong>{config.businessName}</strong><small>Cost Saver receptionist</small></div>
          <Badge tone={connected ? "success" : available ? "neutral" : "warning"}>
            {connected ? "Live" : available ? "Ready" : "Setup needed"}
          </Badge>
        </div>
        <div className={`comparison-voice-orb voice-orb-${status}`}><Gauge /></div>
        <div className="voice-status" aria-live="polite">
          <span className={`voice-status-dot voice-status-${status}`} />
          <h2>{available ? statusCopy.label : "Cost Saver needs setup"}</h2>
          <p>{error || unavailableReason || statusCopy.detail}</p>
        </div>
        <div className="voice-controls">
          {!connected ? (
            <Button className="voice-start" disabled={!available || disabled} onClick={start}>
              {status === "ended" || status === "error" ? <RotateCcw /> : <Phone />}
              {disabled ? "End the Premium call first" : status === "ended" ? "Start another call" : `Talk to ${config.agentName}`}
            </Button>
          ) : <>
            <button className={`round-call-control ${muted ? "control-active" : ""}`} onClick={toggleMute} type="button" aria-label={muted ? "Unmute microphone" : "Mute microphone"}>
              {muted ? <MicOff /> : <Mic />}
            </button>
            <button className="round-call-control control-end" onClick={() => stop()} type="button" aria-label="End conversation"><PhoneOff /></button>
            <span className="call-timer"><Clock3 /> {formatCallDuration(elapsed)}</span>
          </>}
        </div>
        <div className="receptionist-trust">
          <span><ShieldCheck /> Browser-only sandbox; phone routing is unchanged</span>
          <span><Volume2 /> Best with headphones</span>
        </div>
      </div>
      <Card className="comparison-transcript">
        <SectionHeading title="Live conversation" description={connected ? "Shared Blades brief, cheaper component pipeline." : "Your transcript will appear here."} />
        <div className="transcript-feed" aria-live="polite">
          {!transcript.length ? <div className="transcript-empty"><Headphones /><p>Start the call and compare the same salon questions.</p></div>
            : transcript.map((turn) => <div className={`transcript-bubble transcript-bubble-${turn.role}`} key={turn.id}>
              <span>{turn.role === "agent" ? config.agentName : "You"}</span><p>{turn.message}</p>
            </div>)}
          <div ref={transcriptEnd} />
        </div>
      </Card>
    </section>
  );
}
