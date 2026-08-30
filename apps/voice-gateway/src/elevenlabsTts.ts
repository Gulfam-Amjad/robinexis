import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";

export interface TtsTurn {
  write(text: string): void;
  finish(): Promise<void>;
  cancel(): void;
}

export interface ElevenLabsTtsSession {
  startTurn(opts?: { onFirstAudio?: () => void }): TtsTurn;
  close(): void;
}

interface ContextState {
  id: string;
  text: string[];
  initialized: boolean;
  finished: boolean;
  flushSent: boolean;
  cancelled: boolean;
  audioReceived: boolean;
  retries: number;
  onAudio: (chunk: Buffer) => void;
  onFirstAudio?: () => void;
  resolve: () => void;
  reject: (error: Error) => void;
}

const KEEPALIVE_CONTEXT = "keepalive";
const KEEPALIVE_MS = 10_000;

/**
 * One ElevenLabs multi-context WebSocket per phone call. Each response gets a
 * separate context, so barge-in can cancel the active generation without
 * closing the connection or contaminating the next response.
 */
export function createElevenLabsTtsSession(
  onAudioChunk: (chunk: Buffer) => void,
  opts?: {
    voiceId?: string;
    socketFactory?: (url: string, headers: Record<string, string>) => WebSocket;
  },
): ElevenLabsTtsSession {
  const voiceId = opts?.voiceId || config.elevenLabsVoiceId;
  const url =
    `wss://api.elevenlabs.io/v1/text-to-speech/${voiceId}/multi-stream-input` +
    `?model_id=${encodeURIComponent(config.elevenLabsModelId)}&output_format=ulaw_8000`;
  const contexts = new Map<string, ContextState>();
  let socket: WebSocket | null = null;
  let connecting: Promise<WebSocket> | null = null;
  let closed = false;
  let keepalive: NodeJS.Timeout | null = null;

  function send(ws: WebSocket, payload: Record<string, unknown>) {
    if (ws.readyState !== WebSocket.OPEN) throw new Error("ElevenLabs TTS socket is not open");
    ws.send(JSON.stringify(payload));
  }

  function initialiseContext(ws: WebSocket, contextId: string) {
    send(ws, {
      text: " ",
      context_id: contextId,
      voice_settings: { stability: 0.5, similarity_boost: 0.8 },
      generation_config: { chunk_length_schedule: config.elevenLabsChunkSchedule },
    });
  }

  function flushAndCloseContext(ws: WebSocket, context: ContextState) {
    send(ws, { context_id: context.id, flush: true });
    send(ws, { context_id: context.id, close_context: true });
    context.flushSent = true;
  }

  function replayContext(ws: WebSocket, context: ContextState) {
    initialiseContext(ws, context.id);
    for (const text of context.text) send(ws, { text, context_id: context.id });
    if (context.finished) {
      flushAndCloseContext(ws, context);
    }
  }

  function scheduleKeepalive() {
    if (keepalive) clearInterval(keepalive);
    keepalive = setInterval(() => {
      if (socket?.readyState === WebSocket.OPEN) {
        try {
          send(socket, { text: "", context_id: KEEPALIVE_CONTEXT });
        } catch {
          /* close/reconnect handlers own recovery */
        }
      }
    }, KEEPALIVE_MS);
    keepalive.unref();
  }

  async function connect(): Promise<WebSocket> {
    if (closed) throw new Error("ElevenLabs TTS session is closed");
    if (socket?.readyState === WebSocket.OPEN) return socket;
    if (connecting) return connecting;

    connecting = new Promise<WebSocket>((resolve, reject) => {
      const headers = { "xi-api-key": config.elevenLabsApiKey };
      const ws = opts?.socketFactory
        ? opts.socketFactory(url, headers)
        : new WebSocket(url, { headers });
      let opened = false;

      ws.once("open", () => {
        if (closed) {
          ws.close();
          reject(new Error("ElevenLabs TTS session closed while connecting"));
          return;
        }
        opened = true;
        socket = ws;
        initialiseContext(ws, KEEPALIVE_CONTEXT);
        scheduleKeepalive();
        resolve(ws);
      });
      ws.on("message", (data) => {
        let message: {
          audio?: string;
          isFinal?: boolean;
          contextId?: string;
          context_id?: string;
          error?: string;
          message?: string;
        };
        try {
          message = JSON.parse(data.toString());
        } catch {
          console.warn("[elevenlabs] non-JSON frame received, ignoring");
          return;
        }
        const contextId = message.contextId || message.context_id;
        const context = contextId ? contexts.get(contextId) : undefined;
        if (message.error) {
          const error = new Error(
            `ElevenLabs TTS error: ${message.error}${message.message ? ` — ${message.message}` : ""}`,
          );
          if (context) {
            contexts.delete(context.id);
            context.reject(error);
          } else {
            for (const item of contexts.values()) item.reject(error);
            contexts.clear();
          }
          return;
        }
        if (!context || context.cancelled) return;
        if (message.audio) {
          if (!context.audioReceived) {
            context.audioReceived = true;
            context.onFirstAudio?.();
          }
          context.onAudio(Buffer.from(message.audio, "base64"));
        }
        if (message.isFinal) {
          contexts.delete(context.id);
          context.resolve();
        }
      });
      ws.once("error", (error) => {
        if (!opened) reject(error);
      });
      ws.once("close", () => {
        if (socket === ws) socket = null;
        connecting = null;
        if (closed) return;
        if (!opened) return;
        const retryable = [...contexts.values()].filter(
          (context) => !context.cancelled && !context.audioReceived && context.retries < 1,
        );
        const failed = [...contexts.values()].filter((context) => !retryable.includes(context));
        for (const context of failed) {
          contexts.delete(context.id);
          context.reject(new Error("ElevenLabs TTS socket closed during generation"));
        }
        if (retryable.length) {
          for (const context of retryable) context.retries++;
          void connect()
            .then((replacement) => {
              for (const context of retryable) {
                if (contexts.has(context.id)) replayContext(replacement, context);
              }
            })
            .catch((error) => {
              for (const context of retryable) {
                contexts.delete(context.id);
                context.reject(error instanceof Error ? error : new Error(String(error)));
              }
            });
        }
      });
    }).finally(() => {
      connecting = null;
    });
    return connecting;
  }

  // Preconnect while the rest of the call session is being initialised.
  void connect().catch(() => {
    /* startTurn will surface a persistent connection failure */
  });

  return {
    startTurn(turnOpts) {
      const id = `turn-${randomUUID()}`;
      let resolve!: () => void;
      let reject!: (error: Error) => void;
      const done = new Promise<void>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      const context: ContextState = {
        id,
        text: [],
        initialized: false,
        finished: false,
        flushSent: false,
        cancelled: false,
        audioReceived: false,
        retries: 0,
        onAudio: onAudioChunk,
        onFirstAudio: turnOpts?.onFirstAudio,
        resolve,
        reject,
      };
      contexts.set(id, context);
      const ready = connect().catch(async (error) => {
        if (context.cancelled || context.retries >= 1) throw error;
        context.retries++;
        return connect();
      }).then((ws) => {
        if (context.cancelled) return ws;
        initialiseContext(ws, id);
        for (const text of context.text) send(ws, { text, context_id: id });
        if (context.finished) {
          flushAndCloseContext(ws, context);
        }
        context.initialized = true;
        return ws;
      });
      ready.catch((error) => {
        contexts.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      });

      return {
        write(text) {
          const chunk = text.trim();
          if (!chunk || context.finished || context.cancelled) return;
          const framed = `${chunk} `;
          context.text.push(framed);
          if (context.initialized && socket?.readyState === WebSocket.OPEN) {
            send(socket, { text: framed, context_id: id });
          }
        },
        async finish() {
          if (context.cancelled) return;
          if (!context.finished) {
            context.finished = true;
            const ws = await ready;
            if (contexts.has(id) && !context.flushSent) {
              flushAndCloseContext(ws, context);
            }
          }
          await done;
        },
        cancel() {
          if (context.cancelled) return;
          context.cancelled = true;
          contexts.delete(id);
          if (socket?.readyState === WebSocket.OPEN) {
            send(socket, { context_id: id, close_context: true });
          }
          resolve();
        },
      };
    },
    close() {
      if (closed) return;
      closed = true;
      if (keepalive) clearInterval(keepalive);
      for (const context of contexts.values()) {
        context.cancelled = true;
        context.resolve();
      }
      contexts.clear();
      if (socket?.readyState === WebSocket.OPEN) {
        const ws = socket;
        send(ws, { close_socket: true });
        setTimeout(() => ws.close(), 250).unref();
      } else {
        socket?.close();
      }
      socket = null;
    },
  };
}
