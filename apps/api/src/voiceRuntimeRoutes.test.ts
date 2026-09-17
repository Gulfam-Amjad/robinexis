import { createHash, createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { BLADES_HAIR_ID, MemoryStore, seedStore } from "@robinexis/database";
import {
  ingestVoiceRuntimePostCall,
  runtimeConfigFor,
  verifyVoiceRuntimeSignature,
  voiceRuntimeAuthorized,
} from "./voiceRuntimeRoutes.js";

const oldVoiceToolSecret = process.env.VOICE_TOOL_SECRET;
const costVars = [
  "LIVEKIT_COST_PER_MINUTE_PENCE",
  "DEEPGRAM_COST_PER_MINUTE_PENCE",
  "GROQ_INPUT_COST_PER_MILLION_TOKENS_PENCE",
  "GROQ_OUTPUT_COST_PER_MILLION_TOKENS_PENCE",
  "ELEVENLABS_TTS_COST_PER_MILLION_CHARACTERS_PENCE",
] as const;
afterEach(() => {
  process.env.VOICE_TOOL_SECRET = oldVoiceToolSecret;
  for (const name of costVars) delete process.env[name];
});

describe("alternate voice runtime API contracts", () => {
  it("uses constant-time internal authentication and expiring signatures", () => {
    expect(voiceRuntimeAuthorized("right", "right")).toBe(true);
    expect(voiceRuntimeAuthorized("wrong", "right")).toBe(false);
    const raw = Buffer.from('{"version":1}');
    const signature = createHmac("sha256", "secret").update(`100.${raw}`).digest("hex");
    expect(verifyVoiceRuntimeSignature(raw, "100", signature, "secret", 100)).toBe(true);
    expect(verifyVoiceRuntimeSignature(raw, "100", signature, "secret", 401)).toBe(false);
  });

  it("returns config only for a matching staged or active LiveKit deployment", async () => {
    process.env.VOICE_TOOL_SECRET = "legacy-tenant-secret";
    const store = new MemoryStore();
    await seedStore(store);
    expect(await runtimeConfigFor(store, BLADES_HAIR_ID, "")).toMatchObject({
      status: 400,
      body: { error: "deployment_id_required" },
    });
    expect(await runtimeConfigFor(store, BLADES_HAIR_ID, "wrong")).toMatchObject({
      status: 403,
      body: { error: "livekit_not_active_for_tenant" },
    });
    await store.upsertProviderDeployment({
      id: "deployment_livekit_blades_test",
      clientId: BLADES_HAIR_ID,
      provider: "livekit-cascade",
      providerDeploymentId: "dispatch_test",
      status: "staged",
      config: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const result = await runtimeConfigFor(store, BLADES_HAIR_ID, "deployment_livekit_blades_test");
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      client: { id: BLADES_HAIR_ID, published: true },
      deploymentId: "deployment_livekit_blades_test",
      toolSecret: "legacy-tenant-secret",
    });
  });

  it("accepts a signed normalized post-call payload and rejects altered identity", async () => {
    process.env.LIVEKIT_COST_PER_MINUTE_PENCE = "1";
    process.env.DEEPGRAM_COST_PER_MINUTE_PENCE = "2";
    process.env.GROQ_INPUT_COST_PER_MILLION_TOKENS_PENCE = "1000000";
    process.env.GROQ_OUTPUT_COST_PER_MILLION_TOKENS_PENCE = "1000000";
    process.env.ELEVENLABS_TTS_COST_PER_MILLION_CHARACTERS_PENCE = "10000";
    const store = new MemoryStore();
    await seedStore(store);
    const providerJobId = "job-42";
    const callId = stableId(BLADES_HAIR_ID, providerJobId);
    const payload = {
      version: 1,
      provider: "livekit-cascade",
      callId,
      tenantId: BLADES_HAIR_ID,
      providerJobId,
      direction: "inbound",
      objective: "Reception",
      promptVersionId: "published-1",
      startedAt: "2026-09-16T10:00:00.000Z",
      endedAt: "2026-09-16T10:01:00.000Z",
      durationSeconds: 60,
      transcript: [{ role: "caller", text: "Hello", at: "2026-09-16T10:00:05.000Z" }],
      toolHistory: [{ name: "get_business_info", input: {}, result: { ok: true }, at: "2026-09-16T10:00:10.000Z" }],
      latency: { llmTtftMs: 120 },
      usage: {
        livekit: { roomSeconds: 60 },
        stt: { provider: "deepgram", audioSeconds: 20 },
        llm: { provider: "groq", inputTokens: 50, outputTokens: 20 },
        tts: { provider: "elevenlabs", characters: 100, audioSeconds: 15 },
      },
    };
    const raw = Buffer.from(JSON.stringify(payload));
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = createHmac("sha256", "secret").update(`${timestamp}.${raw}`).digest("hex");
    const result = await ingestVoiceRuntimePostCall(store, raw, String(timestamp), signature, "secret");
    expect(result).toEqual({ status: 200, body: { received: true, callId } });
    expect(await store.getCall(callId)).toMatchObject({
      clientId: BLADES_HAIR_ID,
      durationSeconds: 60,
      collected: { provider: "livekit-cascade" },
    });
    const events = await store.listProviderUsageCostEvents(BLADES_HAIR_ID);
    expect(events).toHaveLength(4);
    expect(events.map((event) => event.costMinor)).toEqual([1, 1, 70, 1]);
    expect(events.every((event) => event.metadata.estimated === true)).toBe(true);

    const altered = Buffer.from(JSON.stringify({ ...payload, callId: "call_forged" }));
    const alteredSignature = createHmac("sha256", "secret").update(`${timestamp}.${altered}`).digest("hex");
    expect(await ingestVoiceRuntimePostCall(store, altered, String(timestamp), alteredSignature, "secret"))
      .toMatchObject({ status: 400, body: { error: "invalid_call_id" } });
  });
});

function stableId(tenantId: string, providerJobId: string): string {
  return `call_${createHash("sha256")
    .update(`livekit-cascade\0${tenantId}\0${providerJobId}`)
    .digest("hex")
    .slice(0, 32)}`;
}
