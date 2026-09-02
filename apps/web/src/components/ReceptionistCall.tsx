import { ConversationProvider, useConversation } from "@elevenlabs/react";
import {
  Check,
  Clock3,
  Copy,
  Headphones,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  RotateCcw,
  Share2,
  ShieldCheck,
  Sparkles,
  Volume2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  BLADES_RECEPTIONIST_DEMO,
  deriveReceptionistStatus,
  formatCallDuration,
  RECEPTIONIST_STATUS_COPY,
  type LocalCallPhase,
  type ReceptionistDemoConfig,
} from "../lib/receptionistDemo";
import { Badge, Button, Card, SectionHeading } from "./ui";

type TranscriptEntry = {
  id: string;
  role: "agent" | "user";
  message: string;
};

export function ReceptionistCall({
  config = BLADES_RECEPTIONIST_DEMO,
  compact = false,
  showShare = false,
}: {
  config?: ReceptionistDemoConfig;
  compact?: boolean;
  showShare?: boolean;
}) {
  return (
    <ConversationProvider agentId={config.agentId}>
      <ReceptionistCallExperience config={config} compact={compact} showShare={showShare} />
    </ConversationProvider>
  );
}

function ReceptionistCallExperience({
  config,
  compact,
  showShare,
}: {
  config: ReceptionistDemoConfig;
  compact: boolean;
  showShare: boolean;
}) {
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [phase, setPhase] = useState<LocalCallPhase>("idle");
  const [localError, setLocalError] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [copied, setCopied] = useState("");
  const [levels, setLevels] = useState({ input: 0, output: 0 });
  const connectedAt = useRef(0);
  const hadConnected = useRef(false);
  const lastLevelUpdate = useRef(0);
  const transcriptEnd = useRef<HTMLDivElement>(null);

  const conversation = useConversation({
    onConnect: () => {
      hadConnected.current = true;
      connectedAt.current = Date.now();
      setElapsed(0);
      setPhase("idle");
      setLocalError("");
    },
    onDisconnect: () => {
      if (hadConnected.current) setPhase("ended");
    },
    onError: (message) => {
      setLocalError(message || "The voice connection could not be started.");
      setPhase("idle");
    },
    onMessage: ({ message, role, source, event_id }) => {
      const clean = message.trim();
      if (!clean) return;
      const speaker: TranscriptEntry["role"] =
        role === "agent" || source === "ai" ? "agent" : "user";
      setTranscript((current) => {
        const previous = current.at(-1);
        if (previous?.role === speaker && previous.message === clean) return current;
        return [
          ...current,
          {
            id: `${event_id ?? Date.now()}-${current.length}`,
            role: speaker,
            message: clean,
          },
        ];
      });
    },
  });

  const connected = conversation.status === "connected";
  const uiStatus = deriveReceptionistStatus({
    connection: conversation.status,
    phase,
    isMuted: conversation.isMuted,
    isSpeaking: conversation.isSpeaking,
    hasError: Boolean(localError),
  });
  const statusCopy = RECEPTIONIST_STATUS_COPY[uiStatus];

  useEffect(() => {
    if (!connected) return;
    const timer = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - connectedAt.current) / 1000));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [connected]);

  useEffect(() => {
    transcriptEnd.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [transcript]);

  useEffect(() => {
    if (!connected) {
      setLevels({ input: 0, output: 0 });
      return;
    }
    let frame = 0;
    const sample = (now: number) => {
      if (now - lastLevelUpdate.current > 80) {
        lastLevelUpdate.current = now;
        setLevels({
          input: conversation.getInputVolume(),
          output: conversation.getOutputVolume(),
        });
      }
      frame = requestAnimationFrame(sample);
    };
    frame = requestAnimationFrame(sample);
    return () => cancelAnimationFrame(frame);
  }, [connected, conversation]);

  const startCall = useCallback(async () => {
    setLocalError("");
    setTranscript([]);
    setElapsed(0);
    setPhase("permission");
    hadConnected.current = false;
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("This browser does not support microphone conversations.");
      }
      const permission = await navigator.mediaDevices.getUserMedia({ audio: true });
      permission.getTracks().forEach((track) => track.stop());
      setPhase("starting");
      conversation.startSession({
        agentId: config.agentId,
        connectionType: "webrtc",
      });
    } catch (error) {
      const denied = error instanceof DOMException && error.name === "NotAllowedError";
      setLocalError(
        denied
          ? "Microphone access was blocked. Allow it in your browser settings, then try again."
          : error instanceof Error
            ? error.message
            : "We couldn't access your microphone.",
      );
      setPhase("idle");
    }
  }, [config.agentId, conversation]);

  const endCall = useCallback(() => {
    conversation.endSession();
    setPhase("ended");
  }, [conversation]);

  const copyText = useCallback(async (text: string, label: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    window.setTimeout(() => setCopied(""), 1_800);
  }, []);

  const shareDemo = useCallback(async () => {
    if (!config.sharePath) return;
    const url = `${window.location.origin}${config.sharePath}`;
    if (navigator.share) {
      await navigator.share({
        title: `Meet ${config.agentName} — ${config.businessName} AI receptionist`,
        text: `Try the ${config.businessName} AI receptionist, powered by Robinexis.`,
        url,
      });
      return;
    }
    await copyText(url, "share");
  }, [config.agentName, config.businessName, config.sharePath, copyText]);

  const activeLevel = Math.min(
    1,
    Math.max(
      uiStatus === "speaking" ? levels.output : levels.input,
      uiStatus === "speaking" || uiStatus === "listening" ? 0.12 : 0,
    ),
  );

  return (
    <section className={`receptionist-experience ${compact ? "receptionist-compact" : ""}`}>
      <div className="receptionist-stage">
        <div className="receptionist-brandline">
          <span className="blades-monogram">{config.businessName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</span>
          <div>
            <strong>{config.businessName}</strong>
            <small>AI receptionist</small>
          </div>
          <Badge tone={connected ? "success" : "neutral"}>
            {connected ? "Live conversation" : "Ready"}
          </Badge>
        </div>

        <div className={`voice-orb-shell voice-orb-${uiStatus}`}>
          <span className="voice-orb-ring voice-orb-ring-one" />
          <span className="voice-orb-ring voice-orb-ring-two" />
          <div
            className="voice-orb"
            style={{ transform: `scale(${1 + activeLevel * 0.08})` }}
            aria-hidden="true"
          >
            <Sparkles />
          </div>
        </div>

        <div className="voice-status" aria-live="polite">
          <span className={`voice-status-dot voice-status-${uiStatus}`} />
          <h2>{statusCopy.label.replaceAll("Sophie", config.agentName)}</h2>
          <p>{localError || conversation.message || statusCopy.detail.replaceAll("Sophie", config.agentName).replaceAll("Blades Hair", config.businessName)}</p>
        </div>

        <div className="voice-waveform" aria-hidden="true">
          {Array.from({ length: 17 }, (_, index) => {
            const curve = 0.35 + (1 - Math.abs(index - 8) / 9) * 0.65;
            const height = 7 + activeLevel * curve * 42;
            return <i key={index} style={{ height: `${height}px` }} />;
          })}
        </div>

        <div className="voice-controls">
          {!connected && conversation.status !== "connecting" ? (
            <Button className="voice-start" onClick={startCall}>
              {uiStatus === "ended" || uiStatus === "error" ? <RotateCcw /> : <Phone />}
              {uiStatus === "ended" || uiStatus === "error" ? "Start another call" : `Talk to ${config.agentName}`}
            </Button>
          ) : (
            <>
              <button
                className={`round-call-control ${conversation.isMuted ? "control-active" : ""}`}
                onClick={() => conversation.setMuted(!conversation.isMuted)}
                type="button"
                aria-label={conversation.isMuted ? "Unmute microphone" : "Mute microphone"}
              >
                {conversation.isMuted ? <MicOff /> : <Mic />}
              </button>
              <button
                className="round-call-control control-end"
                onClick={endCall}
                type="button"
                aria-label="End conversation"
              >
                <PhoneOff />
              </button>
              <span className="call-timer"><Clock3 /> {formatCallDuration(elapsed)}</span>
            </>
          )}
        </div>

        <div className="receptionist-trust">
          <span><ShieldCheck /> Microphone audio is used only for this conversation</span>
          <span><Volume2 /> Best with headphones</span>
        </div>
      </div>

      <div className="receptionist-side">
        <Card className="receptionist-transcript">
          <SectionHeading
            title="Live conversation"
            description={connected ? `${config.agentName} and you, as it happens.` : "Your transcript will appear here."}
            action={transcript.length ? (
              <button
                className="icon-button"
                type="button"
                aria-label="Copy transcript"
                onClick={() =>
                  copyText(
                    transcript.map((turn) => `${turn.role === "agent" ? config.agentName : "You"}: ${turn.message}`).join("\n"),
                    "transcript",
                  )
                }
              >
                {copied === "transcript" ? <Check /> : <Copy />}
              </button>
            ) : undefined}
          />
          <div className="transcript-feed" aria-live="polite">
            {!transcript.length ? (
              <div className="transcript-empty">
                <Headphones />
                <p>Start the call, say hello, and {config.agentName} will take it from there.</p>
              </div>
            ) : transcript.map((turn) => (
              <div className={`transcript-bubble transcript-bubble-${turn.role}`} key={turn.id}>
                <span>{turn.role === "agent" ? config.agentName : "You"}</span>
                <p>{turn.message}</p>
              </div>
            ))}
            <div ref={transcriptEnd} />
          </div>
        </Card>

        <Card className="receptionist-prompts">
          <SectionHeading
            title={`Try asking ${config.agentName}`}
            description="Use your own words, or copy one of these prompts."
            action={showShare && config.sharePath ? (
              <button className="share-demo-button" type="button" onClick={shareDemo}>
                {copied === "share" ? <Check /> : <Share2 />}
                {copied === "share" ? "Copied" : "Share demo"}
              </button>
            ) : undefined}
          />
          <div className="receptionist-scenarios">
            {config.scenarios.map((scenario) => (
              <button
                key={scenario}
                type="button"
                onClick={() => copyText(scenario, scenario)}
              >
                <span>{scenario}</span>
                {copied === scenario ? <Check /> : <Copy />}
              </button>
            ))}
          </div>
          <p className="demo-booking-note">
            This agent uses the workspace&apos;s configured diary. Test carefully: confirmed appointments may be created in that calendar.
          </p>
        </Card>
      </div>
    </section>
  );
}
