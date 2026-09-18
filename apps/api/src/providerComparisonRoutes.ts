import { randomUUID } from "node:crypto";
import { AccessToken, AgentDispatchClient, RoomServiceClient } from "livekit-server-sdk";
import {
  BLADES_HAIR_ID,
  newId,
  type PlatformStore,
  type ProviderDeployment,
} from "@robinexis/database";
import { LIVEKIT_RUNTIME_AGENT_NAME } from "@robinexis/integrations";
import { canAdministerPlatform } from "./auth.js";
import type { ProductRouteContext } from "./productRoutes.js";

const COMPARISON_DEPLOYMENT_ID = `provider_comparison_livekit_${BLADES_HAIR_ID}`;
const SESSION_TTL_SECONDS = 5 * 60;

type LiveKitManagement = {
  createRoom(input: {
    name: string;
    emptyTimeout?: number;
    departureTimeout?: number;
    maxParticipants?: number;
    metadata?: string;
  }): Promise<unknown>;
  createDispatch(
    roomName: string,
    agentName: string,
    options?: { metadata?: string },
  ): Promise<unknown>;
  createToken(input: { roomName: string; identity: string }): Promise<string>;
};

export type ProviderComparisonReadiness = {
  clientId: string;
  businessName?: string;
  premium: { ready: boolean; reason?: string };
  costSaver: { ready: boolean; reason?: string; missing: string[] };
};

export async function providerComparisonReadiness(
  store: PlatformStore,
): Promise<ProviderComparisonReadiness> {
  const client = await store.getPublishedClient(BLADES_HAIR_ID);
  const missing = liveKitMissingConfiguration();
  return {
    clientId: BLADES_HAIR_ID,
    businessName: client?.businessName,
    premium: {
      ready: Boolean(client?.elevenlabsAgentId),
      ...(!client
        ? { reason: "The published Blades Hair configuration is unavailable." }
        : !client.elevenlabsAgentId
          ? { reason: "The Blades Hair ElevenLabs agent is not connected." }
          : {}),
    },
    costSaver: {
      ready: Boolean(client && missing.length === 0),
      ...(!client
        ? { reason: "The published Blades Hair configuration is unavailable." }
        : missing.length
          ? { reason: "The Cost Saver browser runtime is not fully configured." }
          : {}),
      missing,
    },
  };
}

export async function createProviderComparisonSession(
  store: PlatformStore,
  management = liveKitManagementFromEnv(),
  actorId = "provider-comparison",
) {
  const readiness = await providerComparisonReadiness(store);
  if (!readiness.costSaver.ready) {
    throw new Error(readiness.businessName
      ? "cost_saver_runtime_not_configured"
      : "published_blades_configuration_not_found");
  }
  const deployment = await ensureComparisonDeployment(store);
  const roomName = `comparison-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const identity = `operator-${randomUUID()}`;
  const metadata = JSON.stringify({
    tenantId: BLADES_HAIR_ID,
    deploymentId: deployment.id,
    direction: "inbound",
    objective: "Browser provider comparison",
  });
  await management.createRoom({
    name: roomName,
    emptyTimeout: 60,
    departureTimeout: 15,
    maxParticipants: 2,
    metadata: JSON.stringify({ purpose: "provider-comparison", tenantId: BLADES_HAIR_ID }),
  });
  await management.createDispatch(roomName, LIVEKIT_RUNTIME_AGENT_NAME, { metadata });
  const token = await management.createToken({ roomName, identity });
  await store.appendOperatorAudit({
    id: newId("audit_"),
    clientId: BLADES_HAIR_ID,
    actorId,
    action: "provider_comparison.session_created",
    detail: { roomName, deploymentId: deployment.id, routingChanged: false },
    createdAt: new Date().toISOString(),
  });
  return {
    url: process.env.LIVEKIT_URL!,
    token,
    roomName,
    expiresInSeconds: SESSION_TTL_SECONDS,
    clientId: BLADES_HAIR_ID,
  };
}

export async function handleProviderComparisonRoute(
  ctx: ProductRouteContext,
  route: string,
  management?: LiveKitManagement,
): Promise<boolean> {
  if (route !== "/admin/provider-comparison/readiness" &&
      route !== "/admin/provider-comparison/session") return false;
  if (!canAdministerPlatform(ctx.actor)) {
    ctx.send(ctx.res, 403, { error: "platform_admin_required" });
    return true;
  }
  const expectedMethod = route.endsWith("/readiness") ? "GET" : "POST";
  if (ctx.req.method !== expectedMethod) {
    ctx.send(ctx.res, 405, { error: "method_not_allowed" });
    return true;
  }
  try {
    if (expectedMethod === "GET") {
      ctx.send(ctx.res, 200, await providerComparisonReadiness(ctx.store));
    } else {
      ctx.send(ctx.res, 201, await createProviderComparisonSession(
        ctx.store,
        management || liveKitManagementFromEnv(),
        ctx.actor.subject,
      ));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.endsWith("_not_found") ? 404
      : message.includes("not_configured") ? 503
        : 502;
    ctx.send(ctx.res, status, { error: message });
  }
  return true;
}

async function ensureComparisonDeployment(store: PlatformStore): Promise<ProviderDeployment> {
  const existing = (await store.listProviderDeployments(BLADES_HAIR_ID))
    .find((item) => item.id === COMPARISON_DEPLOYMENT_ID);
  if (existing && existing.provider === "livekit-cascade" &&
      (existing.status === "staged" || existing.status === "active")) return existing;
  const now = new Date().toISOString();
  const deployment: ProviderDeployment = {
    id: COMPARISON_DEPLOYMENT_ID,
    clientId: BLADES_HAIR_ID,
    provider: "livekit-cascade",
    providerDeploymentId: LIVEKIT_RUNTIME_AGENT_NAME,
    status: "staged",
    config: {
      browserOnly: true,
      purpose: "provider-comparison",
      routingChanged: false,
    },
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  await store.upsertProviderDeployment(deployment);
  return deployment;
}

function liveKitMissingConfiguration() {
  const required = [
    "VOICE_RUNTIME_ENABLED",
    "LIVEKIT_URL",
    "LIVEKIT_API_KEY",
    "LIVEKIT_API_SECRET",
    "DEEPGRAM_API_KEY",
    "GROQ_API_KEY",
    "ELEVENLABS_API_KEY",
  ];
  return required.filter((name) =>
    name === "VOICE_RUNTIME_ENABLED"
      ? process.env[name] !== "true"
      : !process.env[name]?.trim());
}

function liveKitManagementFromEnv(): LiveKitManagement {
  const url = process.env.LIVEKIT_URL || "";
  const apiKey = process.env.LIVEKIT_API_KEY || "";
  const apiSecret = process.env.LIVEKIT_API_SECRET || "";
  if (!url || !apiKey || !apiSecret) throw new Error("cost_saver_runtime_not_configured");
  const host = `https://${new URL(url).hostname}`;
  const rooms = new RoomServiceClient(host, apiKey, apiSecret);
  const dispatch = new AgentDispatchClient(host, apiKey, apiSecret);
  return {
    createRoom: (input) => rooms.createRoom(input),
    createDispatch: (roomName, agentName, options) =>
      dispatch.createDispatch(roomName, agentName, options),
    createToken: async ({ roomName, identity }) => {
      const token = new AccessToken(apiKey, apiSecret, {
        identity,
        name: "Robinexis operator",
        ttl: SESSION_TTL_SECONDS,
      });
      token.addGrant({
        room: roomName,
        roomJoin: true,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
      });
      return token.toJwt();
    },
  };
}
