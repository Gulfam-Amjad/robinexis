import { EventEmitter } from "node:events";
import type WebSocket from "ws";
import { describe, expect, it, vi } from "vitest";
import { MediaStreamConnection } from "./mediaStream.js";

class FakeTwilioSocket extends EventEmitter {
  sent: Array<Record<string, unknown>> = [];

  send(value: string) {
    this.sent.push(JSON.parse(value));
  }
}

describe("Twilio media stream connection", () => {
  it("forwards audio and clears queued playback for barge-in", () => {
    const socket = new FakeTwilioSocket();
    const onAudioChunk = vi.fn();
    const connection = new MediaStreamConnection(socket as unknown as WebSocket, {
      onAudioChunk,
    });
    socket.emit(
      "message",
      Buffer.from(JSON.stringify({
        event: "start",
        sequenceNumber: "1",
        streamSid: "MZ-test",
        start: {
          accountSid: "AC-test",
          streamSid: "MZ-test",
          callSid: "CA-test",
          tracks: ["inbound"],
          mediaFormat: { encoding: "audio/x-mulaw", sampleRate: 8000, channels: 1 },
        },
      })),
    );
    const audio = Buffer.from([1, 2, 3]);
    socket.emit(
      "message",
      Buffer.from(JSON.stringify({
        event: "media",
        sequenceNumber: "2",
        streamSid: "MZ-test",
        media: {
          track: "inbound",
          chunk: "1",
          timestamp: "20",
          payload: audio.toString("base64"),
        },
      })),
    );
    connection.clear();

    expect(onAudioChunk).toHaveBeenCalledWith(audio, {
      track: "inbound",
      timestamp: "20",
    });
    expect(socket.sent).toContainEqual({ event: "clear", streamSid: "MZ-test" });
  });
});
