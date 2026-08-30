import type { WebSocket, RawData } from "ws";
import type { TwilioInboundMessage, TwilioMediaFormat } from "./types.js";

export interface MediaStreamHandlers {
  onStart?: (info: {
    streamSid: string;
    callSid: string;
    accountSid: string;
    mediaFormat: TwilioMediaFormat;
    customParameters?: Record<string, string>;
  }) => void;
  onAudioChunk?: (payload: Buffer, meta: { track: string; timestamp: string }) => void;
  onMark?: (name: string) => void;
  onDtmf?: (digit: string) => void;
  onStop?: () => void;
  onClose?: () => void;
}

/**
 * Wraps one Twilio Media Stream WebSocket connection: parses the wire
 * protocol and fans inbound events out to `handlers`, and exposes send
 * helpers for the outbound (TTS -> caller) direction. No STT/LLM/TTS logic
 * lives here — this is purely the Twilio <-> our process wire format.
 */
export class MediaStreamConnection {
  private streamSid: string | null = null;

  constructor(
    private ws: WebSocket,
    private handlers: MediaStreamHandlers = {},
  ) {
    ws.on("message", (data) => this.handleMessage(data));
    ws.on("close", () => this.handlers.onClose?.());
    ws.on("error", (err) => console.error("[media-stream] socket error:", err));
  }

  private handleMessage(data: RawData) {
    let msg: TwilioInboundMessage;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      console.warn("[media-stream] non-JSON frame received, ignoring");
      return;
    }

    switch (msg.event) {
      case "connected":
        console.log(`[media-stream] connected protocol=${msg.protocol} version=${msg.version}`);
        break;

      case "start":
        this.streamSid = msg.start.streamSid;
        console.log(`[media-stream] start streamSid=${msg.start.streamSid} callSid=${msg.start.callSid}`);
        this.handlers.onStart?.({
          streamSid: msg.start.streamSid,
          callSid: msg.start.callSid,
          accountSid: msg.start.accountSid,
          mediaFormat: msg.start.mediaFormat,
          customParameters: msg.start.customParameters,
        });
        break;

      case "media":
        // Forward raw Twilio mulaw frames to the configured STT adapter.
        this.handlers.onAudioChunk?.(Buffer.from(msg.media.payload, "base64"), {
          track: msg.media.track,
          timestamp: msg.media.timestamp,
        });
        break;

      case "mark":
        this.handlers.onMark?.(msg.mark.name);
        break;

      case "dtmf":
        this.handlers.onDtmf?.(msg.dtmf.digit);
        break;

      case "stop":
        console.log(`[media-stream] stop streamSid=${msg.streamSid}`);
        this.handlers.onStop?.();
        break;

      default:
        console.warn("[media-stream] unrecognized event:", (msg as { event?: string }).event);
    }
  }

  /**
   * Sends a chunk of outbound audio (e.g. ElevenLabs TTS output) to the
   * caller. `payload` must already be encoded to match the call's
   * negotiated codec (mulaw/8000 mono by default) — no transcoding happens
   * here.
   */
  sendAudio(payload: Buffer) {
    if (!this.streamSid) {
      console.warn("[media-stream] sendAudio called before 'start' — dropping frame");
      return;
    }
    this.ws.send(
      JSON.stringify({
        event: "media",
        streamSid: this.streamSid,
        media: { payload: payload.toString("base64") },
      }),
    );
  }

  /** Flushes Twilio's playback buffer — call this on barge-in/interruption. */
  clear() {
    if (!this.streamSid) return;
    this.ws.send(JSON.stringify({ event: "clear", streamSid: this.streamSid }));
  }

  /**
   * Asks Twilio to echo back a "mark" event once queued audio up to this
   * point has actually played — useful for knowing when TTS playback ends.
   */
  sendMark(name: string) {
    if (!this.streamSid) return;
    this.ws.send(JSON.stringify({ event: "mark", streamSid: this.streamSid, mark: { name } }));
  }
}
