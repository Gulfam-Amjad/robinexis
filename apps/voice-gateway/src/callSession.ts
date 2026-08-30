import type { MediaStreamConnection } from "./mediaStream.js";
import type { SttSession } from "./stt.js";
import { sttFactory } from "./sttFactory.js";
import {
  createElevenLabsTtsSession,
  type TtsTurn,
} from "./elevenlabsTts.js";
import { transferCallToFrontDesk } from "./twilioControl.js";
import { BrainSession, GroqDriver, compilePrompt, greetingFor } from "@robinexis/brain";
import {
  getRedis,
  getStore,
  newId,
  structuredLog,
  type CallSession as DbCall,
  type ClientConfig,
} from "@robinexis/database";
import { createToolExecutor, finishCall, sendNotification } from "@robinexis/integrations";
import {
  GeminiEmbeddingProvider,
  KnowledgeService,
  createKnowledgeSearchCallback,
} from "@robinexis/knowledge";

export interface CallInfo {
  callSid: string;
  streamSid: string;
  client: ClientConfig;
  direction: "inbound" | "outbound";
  objective: string;
  outboundJobId?: string;
  fromPhone?: string;
  reservationId: string;
}

export interface LiveCallSession {
  feedAudio: (chunk: Buffer) => void;
  close: () => void;
}

interface TurnMetrics {
  id: number;
  speechEndedAt: number;
  llmStartedAt: number;
  firstTokenLogged: boolean;
  firstAudioLogged: boolean;
}

export function createCallSession(connection: MediaStreamConnection, info: CallInfo): LiveCallSession {
  const storeP = getStore();
  const greeting = greetingFor(info.client);
  const now = new Date().toISOString();
  const dbCall: DbCall = {
    id: newId("call_"),
    clientId: info.client.id,
    direction: info.direction,
    objective: info.objective,
    twilioCallSid: info.callSid,
    contactPhone: info.fromPhone,
    outboundJobId: info.outboundJobId,
    promptVersionId: info.client.promptVersionId ?? "runtime",
    transcript: [],
    collected: {},
    toolHistory: [],
    state: "live",
    status: "active",
    createdAt: now,
    updatedAt: now,
  };

  let botSpeaking = false;
  let closed = false;
  let brain: BrainSession | null = null;
  let reservationRefresh: NodeJS.Timeout | null = null;
  let activeTtsTurn: TtsTurn | null = null;
  let textBuffer = "";
  let lastSpeechEndedAt = 0;
  let turnNumber = 0;
  let currentMetrics: TurnMetrics | null = null;
  const tts = createElevenLabsTtsSession(
    (chunk) => {
      if (!closed) connection.sendAudio(chunk);
    },
    { voiceId: info.client.voiceId },
  );

  void storeP
    .then(async (store) => {
      const knowledgeSearch = process.env.GEMINI_API_KEY
        ? createKnowledgeSearchCallback(
            new KnowledgeService(
              store,
              new GeminiEmbeddingProvider({
                apiKey: process.env.GEMINI_API_KEY,
                model: process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001",
              }),
            ),
          )
        : undefined;
      const exec = createToolExecutor({
        store,
        notify: sendNotification,
        searchKnowledge: knowledgeSearch,
      });
      const llm = new GroqDriver();
      const promptVersion = info.client.promptVersionId
        ? await store.getPromptVersion(info.client.promptVersionId)
        : await store.latestPrompt(info.client.id);
      let frozenPrompt = promptVersion?.compiled;
      if (!frozenPrompt?.includes("Approved facts:")) {
        frozenPrompt = compilePrompt({
          client: info.client,
          direction: info.direction,
          objective: info.objective,
        });
        const publishedPrompt = {
          id: newId("pv_"),
          clientId: info.client.id,
          version: (promptVersion?.version ?? 0) + 1,
          compiled: frozenPrompt,
          createdAt: new Date().toISOString(),
        };
        await store.savePromptVersion(publishedPrompt);
        info.client.promptVersionId = publishedPrompt.id;
        await store.upsertClient(info.client);
        dbCall.promptVersionId = publishedPrompt.id;
      } else {
        dbCall.promptVersionId = promptVersion!.id;
      }
      brain = new BrainSession(llm, exec, info.client, dbCall, greeting, frozenPrompt);
      await store.saveCall(dbCall);
      const redis = await getRedis();
      await redis.setCall(dbCall);
      await redis.refreshCallSlot(info.client.id, info.reservationId);
      reservationRefresh = setInterval(
        () => void redis.refreshCallSlot(info.client.id, info.reservationId),
        60_000,
      );
    })
    .catch(async (err) => {
      structuredLog("call_initialization_failed", { callSid: info.callSid, err: String(err) });
      const redis = await getRedis();
      await redis.releaseCallSlot(info.client.id, info.reservationId);
      try {
        await transferCallToFrontDesk(info.callSid, "receptionist initialization failed", {
          callbackNumber: info.client.phone,
        });
      } catch (transferError) {
        structuredLog("provider_fallback_failed", { callSid: info.callSid, err: String(transferError) });
      }
    });

  function beginTtsTurn() {
    if (activeTtsTurn) return activeTtsTurn;
    botSpeaking = true;
    const metrics = currentMetrics;
    activeTtsTurn = tts.startTurn({
      onFirstAudio: () => {
        if (!metrics || metrics.firstAudioLogged) return;
        metrics.firstAudioLogged = true;
        structuredLog("tts_first_audio", {
          callSid: info.callSid,
          turn: metrics.id,
          llmToAudioMs: Date.now() - metrics.llmStartedAt,
          endOfSpeechToAudioMs: metrics.speechEndedAt
            ? Date.now() - metrics.speechEndedAt
            : undefined,
        });
      },
    });
    return activeTtsTurn;
  }

  function streamText(text: string) {
    if (closed || !text) return;
    if (currentMetrics && !currentMetrics.firstTokenLogged) {
      currentMetrics.firstTokenLogged = true;
      structuredLog("llm_first_token", {
        callSid: info.callSid,
        turn: currentMetrics.id,
        durationMs: Date.now() - currentMetrics.llmStartedAt,
      });
    }
    textBuffer += text;
    // Give ElevenLabs complete clauses where possible. This keeps prosody
    // natural while still starting synthesis before the LLM finishes.
    const boundary = /^(.*?[.!?;:](?:\s+|$))/s;
    let match = boundary.exec(textBuffer);
    while (match) {
      beginTtsTurn().write(match[1]);
      textBuffer = textBuffer.slice(match[1].length);
      match = boundary.exec(textBuffer);
    }
    // Do not let punctuation-free content block indefinitely.
    if (textBuffer.length >= 90) {
      const splitAt = textBuffer.lastIndexOf(" ", 90);
      const end = splitAt >= 50 ? splitAt + 1 : 90;
      beginTtsTurn().write(textBuffer.slice(0, end));
      textBuffer = textBuffer.slice(end);
    }
  }

  function cancelSpeech() {
    textBuffer = "";
    activeTtsTurn?.cancel();
    activeTtsTurn = null;
    if (botSpeaking) connection.clear();
    botSpeaking = false;
  }

  async function finishSpeech(fallbackText?: string) {
    if (textBuffer.trim()) {
      beginTtsTurn().write(textBuffer);
      textBuffer = "";
    } else if (!activeTtsTurn && fallbackText) {
      beginTtsTurn().write(fallbackText);
    }
    const turn = activeTtsTurn;
    if (!turn) return;
    try {
      await turn.finish();
    } catch (err) {
      if (closed) return;
      structuredLog("tts_failed", { callSid: info.callSid, err: String(err) });
      try {
        await transferCallToFrontDesk(info.callSid, "voice provider unavailable", {
          callbackNumber: info.client.phone,
        });
      } catch (transferError) {
        structuredLog("provider_fallback_failed", { callSid: info.callSid, err: String(transferError) });
      }
    } finally {
      if (activeTtsTurn === turn) {
        activeTtsTurn = null;
        botSpeaking = false;
      }
    }
  }

  async function speak(text: string) {
    streamText(text);
    await finishSpeech(text);
  }

  function bargeIn() {
    brain?.abortTurn();
    cancelSpeech();
  }

  async function waitBrain(ms = 5000) {
    const start = Date.now();
    while (!brain && Date.now() - start < ms) await new Promise((r) => setTimeout(r, 25));
    return brain;
  }

  async function handleUtterance(text: string) {
    const metrics: TurnMetrics = {
      id: ++turnNumber,
      speechEndedAt: lastSpeechEndedAt,
      llmStartedAt: Date.now(),
      firstTokenLogged: false,
      firstAudioLogged: false,
    };
    currentMetrics = metrics;
    structuredLog("caller_utterance", {
      callSid: info.callSid,
      clientId: info.client.id,
      turn: metrics.id,
      len: text.length,
      sttAfterSpeechMs: metrics.speechEndedAt ? Date.now() - metrics.speechEndedAt : undefined,
    });
    const b = await waitBrain();
    if (!b) return;
    let result;
    try {
      result = await b.handleUserTurn(text, {
        onTextDelta: streamText,
        onSpeakCancel: () => {
          structuredLog("llm_tool_decision", {
            callSid: info.callSid,
            turn: metrics.id,
            durationMs: Date.now() - metrics.llmStartedAt,
          });
          cancelSpeech();
        },
      });
      structuredLog("llm_turn_complete", {
        callSid: info.callSid,
        turn: metrics.id,
        durationMs: Date.now() - metrics.llmStartedAt,
        resultType: result.type,
      });
    } catch (err) {
      structuredLog("brain_failed", {
        callSid: info.callSid,
        model: process.env.GROQ_LLM_MODEL || "(default)",
        status: (err as { status?: number })?.status,
        err: String(err),
      });
      try {
        await transferCallToFrontDesk(info.callSid, "conversational service unavailable", {
          callbackNumber: info.client.phone,
        });
      } catch (transferError) {
        structuredLog("provider_fallback_failed", { callSid: info.callSid, err: String(transferError) });
      }
      return;
    }
    if (result.type === "aborted") return;
    if (result.type === "transfer") {
      cancelSpeech();
      dbCall.status = "transferred";
      try {
        await transferCallToFrontDesk(info.callSid, result.reason, {
          callbackNumber: info.client.phone,
        });
      } catch (err) {
        structuredLog("transfer_failed", { err: String(err) });
        await speak(`Sorry, I'm having trouble transferring you — please call us back on ${info.client.phone}.`);
      }
      return;
    }
    await finishSpeech(result.text);
    if (currentMetrics === metrics) currentMetrics = null;
    const store = await storeP;
    await store.saveCall(b.getCall());
    const redis = await getRedis();
    await redis.setCall(b.getCall());
  }

  const stt: SttSession = sttFactory()({
    onUtterance: (text) => {
      if (text) void handleUtterance(text);
    },
    onSpeechStarted: () => bargeIn(),
    onSpeechEnded: ({ audioMs }) => {
      lastSpeechEndedAt = Date.now();
      structuredLog("speech_ended", { callSid: info.callSid, audioMs });
    },
    onTranscriptionComplete: ({ durationMs, textLength }) => {
      structuredLog("stt_complete", {
        callSid: info.callSid,
        durationMs,
        textLength,
      });
    },
    onError: (err) => structuredLog("stt_error", { callSid: info.callSid, err: String(err) }),
  });

  void speak(greeting);

  return {
    feedAudio: (chunk: Buffer) => {
      if (!closed) stt.sendAudio(chunk);
    },
    close: () => {
      if (closed) return;
      closed = true;
      bargeIn();
      stt.close();
      tts.close();
      if (reservationRefresh) clearInterval(reservationRefresh);
      void storeP.then(async (store) => {
        try {
          await finishCall({ store, call: brain?.getCall() ?? dbCall, client: info.client });
        } finally {
          const redis = await getRedis();
          await redis.releaseCallSlot(info.client.id, info.reservationId);
        }
      }).catch(async (err) => {
        structuredLog("finish_call_failed", { callSid: info.callSid, err: String(err) });
        const redis = await getRedis();
        await redis.releaseCallSlot(info.client.id, info.reservationId);
      });
    },
  };
}
