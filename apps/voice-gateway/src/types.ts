// Twilio Media Streams wire protocol (bidirectional WebSocket).
// https://www.twilio.com/docs/voice/media-streams/websocket-messages

export interface TwilioMediaFormat {
  encoding: string;
  sampleRate: number;
  channels: number;
}

export interface TwilioConnectedMessage {
  event: "connected";
  protocol: string;
  version: string;
}

export interface TwilioStartMessage {
  event: "start";
  sequenceNumber: string;
  streamSid: string;
  start: {
    accountSid: string;
    streamSid: string;
    callSid: string;
    tracks: string[];
    mediaFormat: TwilioMediaFormat;
    customParameters?: Record<string, string>;
  };
}

export interface TwilioMediaMessage {
  event: "media";
  sequenceNumber: string;
  streamSid: string;
  media: {
    track: "inbound" | "outbound";
    chunk: string;
    timestamp: string;
    payload: string; // base64-encoded audio, mulaw/8000 mono unless negotiated otherwise
  };
}

export interface TwilioMarkMessage {
  event: "mark";
  sequenceNumber: string;
  streamSid: string;
  mark: { name: string };
}

export interface TwilioDtmfMessage {
  event: "dtmf";
  streamSid: string;
  dtmf: { track: string; digit: string };
}

export interface TwilioStopMessage {
  event: "stop";
  sequenceNumber: string;
  streamSid: string;
  stop: {
    accountSid: string;
    callSid: string;
  };
}

export type TwilioInboundMessage =
  | TwilioConnectedMessage
  | TwilioStartMessage
  | TwilioMediaMessage
  | TwilioMarkMessage
  | TwilioDtmfMessage
  | TwilioStopMessage;
