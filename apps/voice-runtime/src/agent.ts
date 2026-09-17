import { defineAgent, AgentSessionEventTypes, voice } from "@livekit/agents";
import * as deepgram from "@livekit/agents-plugin-deepgram";
import * as elevenlabs from "@livekit/agents-plugin-elevenlabs";
import * as google from "@livekit/agents-plugin-google";
import * as openai from "@livekit/agents-plugin-openai";
import { compilePrompt, redactSensitiveText } from "@robinexis/brain";
import type { PostCallPayload, TranscriptItem } from "./contracts.js";
import { loadVoiceRuntimeEnv } from "./env.js";
import { runtimeLog } from "./logger.js";
import { parseJobMetadata, stableCallId } from "./metadata.js";
import { RuntimeApiClient } from "./apiClient.js";
import { collectLatency, normalizedUsage } from "./telemetry.js";
import { createToolBridge } from "./toolBridge.js";

export default defineAgent({
  entry: async (ctx) => {
    const env = loadVoiceRuntimeEnv();
    const metadata = parseJobMetadata(ctx.job.metadata);
    const providerJobId = ctx.job.id;
    const callId = stableCallId(metadata.tenantId, providerJobId);
    const api = new RuntimeApiClient(
      env.apiBaseUrl,
      env.internalSecret,
      env.signingSecret,
    );
    const config = await api.getPublishedConfig(metadata.tenantId, metadata.deploymentId);
    const startedAt = new Date();
    const toolHistory: PostCallPayload["toolHistory"] = [];
    const latency: PostCallPayload["latency"] = {};

    const session = new voice.AgentSession({
      stt: new deepgram.STT({
        apiKey: env.deepgramApiKey,
        model: "nova-3",
        language: "en-GB",
        interimResults: true,
        smartFormat: true,
        redact: ["pci"],
      }),
      llm: env.llmProvider === "groq"
        ? openai.LLM.withGroq({
          apiKey: env.groqApiKey,
          model: env.groqModel,
          temperature: 0.2,
        })
        : new google.LLM({
          apiKey: env.googleApiKey!,
          model: env.geminiModel,
          toolChoice: "auto",
        }),
      tts: new elevenlabs.TTS({
        apiKey: env.elevenLabsApiKey,
        model: env.elevenLabsTtsModel,
        voiceId: env.elevenLabsVoiceId,
        language: "en",
        enableLogging: false,
      }),
      maxToolSteps: 5,
    });
    session.on(AgentSessionEventTypes.MetricsCollected, (event) => {
      collectLatency(latency, event.metrics);
    });

    ctx.addShutdownCallback(async () => {
      const endedAt = new Date();
      const durationSeconds = Math.max(0, (endedAt.getTime() - startedAt.getTime()) / 1000);
      const payload: PostCallPayload = {
        version: 1,
        provider: "livekit-cascade",
        callId,
        tenantId: metadata.tenantId,
        providerJobId,
        direction: metadata.direction,
        objective: metadata.objective,
        promptVersionId: config.promptVersionId,
        startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
        durationSeconds,
        transcript: transcriptFromSession(session),
        toolHistory,
        latency,
        usage: normalizedUsage(session.usage.modelUsage, durationSeconds, env.llmProvider),
      };
      try {
        await api.sendPostCall(payload);
        runtimeLog("voice_runtime_post_call_sent", { callId, tenantId: metadata.tenantId });
      } catch (error) {
        runtimeLog("voice_runtime_post_call_failed", { callId, error: String(error) });
      }
    });

    await ctx.connect();
    await session.start({
      room: ctx.room,
      record: { audio: false, traces: false, logs: false, transcript: false, redaction: true },
      agent: new voice.Agent({
        instructions: compilePrompt({
          client: config.client,
          direction: metadata.direction,
          objective: metadata.objective,
        }),
        tools: createToolBridge({
          apiBaseUrl: env.apiBaseUrl,
          tenantId: metadata.tenantId,
          toolSecret: config.toolSecret,
          callId,
          history: toolHistory,
        }),
      }),
    });
    session.say(config.client.greeting || `Hello, you've reached ${config.client.businessName}. How can I help?`);
    runtimeLog("voice_runtime_session_started", { callId, tenantId: metadata.tenantId });
  },
});

function transcriptFromSession(session: voice.AgentSession): TranscriptItem[] {
  return session.history.items.flatMap((item) => {
    if (item.type !== "message") return [];
    const text = item.textContent?.trim();
    if (!text) return [];
    const role = item.role === "assistant" ? "agent" : item.role === "user" ? "caller" : "system";
    return [{
      role,
      text: redactSensitiveText(text),
      at: new Date(item.createdAt).toISOString(),
    }];
  });
}
