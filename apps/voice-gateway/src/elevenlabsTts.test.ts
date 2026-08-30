import { EventEmitter } from "node:events";
import type WebSocket from "ws";
import { describe, expect, it } from "vitest";
import { createElevenLabsTtsSession } from "./elevenlabsTts.js";

class FakeSocket extends EventEmitter {
  readyState = 0;
  sent: Array<Record<string, unknown>> = [];

  constructor(autoOpen = true) {
    super();
    if (autoOpen) {
      queueMicrotask(() => {
        this.readyState = 1;
        this.emit("open");
      });
    }
  }

  send(value: string) {
    const message = JSON.parse(value) as Record<string, unknown>;
    this.sent.push(message);
    if (message.flush && message.context_id) {
      const contextId = String(message.context_id);
      queueMicrotask(() => {
        this.emit(
          "message",
          Buffer.from(JSON.stringify({ contextId, audio: Buffer.from("audio").toString("base64") })),
        );
        this.emit("message", Buffer.from(JSON.stringify({ contextId, isFinal: true })));
      });
    }
  }

  close() {
    this.readyState = 3;
    this.emit("close");
  }
}

describe("persistent ElevenLabs TTS session", () => {
  it("reuses one socket across response contexts", async () => {
    const sockets: FakeSocket[] = [];
    const audio: string[] = [];
    const session = createElevenLabsTtsSession(
      (chunk) => audio.push(chunk.toString()),
      {
        socketFactory: () => {
          const socket = new FakeSocket();
          sockets.push(socket);
          return socket as unknown as WebSocket;
        },
      },
    );

    const first = session.startTurn();
    first.write("Hello there.");
    await first.finish();
    const second = session.startTurn();
    second.write("How can I help?");
    await second.finish();

    expect(sockets).toHaveLength(1);
    expect(audio).toEqual(["audio", "audio"]);
    const initializedContexts = sockets[0]!.sent
      .filter((message) => message.text === " " && String(message.context_id).startsWith("turn-"))
      .map((message) => message.context_id);
    expect(new Set(initializedContexts).size).toBe(2);
    session.close();
  });

  it("cancels one context without closing the call socket", async () => {
    const socket = new FakeSocket();
    const session = createElevenLabsTtsSession(() => undefined, {
      socketFactory: () => socket as unknown as WebSocket,
    });
    const turn = session.startTurn();
    turn.write("This response will be interrupted.");
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    turn.cancel();
    await turn.finish();

    expect(socket.sent.some((message) => message.close_context === true)).toBe(true);
    expect(socket.readyState).toBe(1);
    session.close();
    session.close();
    expect(socket.sent.filter((message) => message.close_socket === true)).toHaveLength(1);
  });

  it("reconnects once when the initial socket fails before audio", async () => {
    const sockets: FakeSocket[] = [];
    const session = createElevenLabsTtsSession(() => undefined, {
      socketFactory: () => {
        const socket = new FakeSocket(sockets.length > 0);
        sockets.push(socket);
        if (sockets.length === 1) {
          queueMicrotask(() => {
            socket.emit("error", new Error("temporary connection failure"));
            socket.emit("close");
          });
        }
        return socket as unknown as WebSocket;
      },
    });
    const turn = session.startTurn();
    turn.write("Retry this response.");
    await turn.finish();

    expect(sockets).toHaveLength(2);
    session.close();
  });
});
