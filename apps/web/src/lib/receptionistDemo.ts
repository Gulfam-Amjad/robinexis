export const BLADES_RECEPTIONIST_DEMO = {
  agentId: "agent_6101m1c3n4wnfsgskgzr13w2gt9s",
  agentName: "Sophie",
  businessName: "Blades Hair",
  location: "8 Cullum Street, City of London",
  phone: "+447446868067",
  phoneDisplay: "+44 7446 868067",
  sharePath: "/demo/blades-hair",
  greeting: "Hi, thanks for calling Blades Hair on Cullum Street — you're through to Sophie.",
  scenarios: [
    "What time do you close on Friday?",
    "How much are full-head highlights?",
    "Can you find me an appointment next Tuesday afternoon?",
    "I'd like to speak to someone about a restyle.",
  ],
} as const;

export type ReceptionistStatus =
  | "idle"
  | "permission"
  | "connecting"
  | "listening"
  | "speaking"
  | "muted"
  | "ended"
  | "error";

export type VoiceConnectionStatus = "disconnected" | "connecting" | "connected" | "error";
export type LocalCallPhase = "idle" | "permission" | "starting" | "ended";

export function deriveReceptionistStatus({
  connection,
  phase,
  isMuted,
  isSpeaking,
  hasError,
}: {
  connection: VoiceConnectionStatus;
  phase: LocalCallPhase;
  isMuted: boolean;
  isSpeaking: boolean;
  hasError: boolean;
}): ReceptionistStatus {
  if (hasError || connection === "error") return "error";
  if (phase === "permission") return "permission";
  if (phase === "starting" || connection === "connecting") return "connecting";
  if (connection === "connected" && isMuted) return "muted";
  if (connection === "connected" && isSpeaking) return "speaking";
  if (connection === "connected") return "listening";
  if (phase === "ended") return "ended";
  return "idle";
}

export const RECEPTIONIST_STATUS_COPY: Record<
  ReceptionistStatus,
  { label: string; detail: string }
> = {
  idle: { label: "Ready when you are", detail: "Start a private voice conversation with Sophie." },
  permission: { label: "Microphone access", detail: "Your browser will ask permission so Sophie can hear you." },
  connecting: { label: "Connecting to Sophie", detail: "This normally takes just a moment." },
  listening: { label: "Sophie is listening", detail: "Speak naturally—you can pause or interrupt at any time." },
  speaking: { label: "Sophie is speaking", detail: "You can interrupt whenever you need to." },
  muted: { label: "Microphone muted", detail: "Unmute when you're ready to continue." },
  ended: { label: "Conversation ended", detail: "Thanks for trying the Blades Hair receptionist." },
  error: { label: "We couldn't start the call", detail: "Check microphone permission and try again." },
};

export function formatCallDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.max(0, totalSeconds % 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
