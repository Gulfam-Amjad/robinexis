import { randomUUID } from "node:crypto";
import { AccessToken, AgentDispatchClient, RoomServiceClient } from "livekit-server-sdk";
import {
  BLADES_HAIR_ID,
  newId,
  type PlatformStore,
  type ProviderDeployment,
} from "@robinexis/database";
import { LIVEKIT_RUNTIME_AGENT_NAME } from "@robinexis/integrations";
import { canAccessClient, canAdministerPlatform } from "./auth.js";
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
  deleteRoom?(roomName: string): Promise<unknown>;
};

export type ProviderComparisonReadiness = {
  clientId: string;
  businessName?: string;
  premium: { ready: boolean; reason?: string };
  costSaver: { ready: boolean; reason?: string; missing: string[] };
};

export type CostSaverReadiness = {
  clientId: string;
  businessName?: string;
  configured: boolean;
  ready: boolean;
  reason?: string;
  missing: string[];
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

export async function costSaverReadiness(
  store: PlatformStore,
  clientId: string,
): Promise<CostSaverReadiness> {
  const client = await store.getPublishedClient(clientId);
  const missing = liveKitMissingConfiguration();
  const configured = Boolean(client && missing.length === 0);
  return {
    clientId,
    businessName: client?.businessName,
    configured,
    // A session still verifies that an agent actually joins. Environment
    // configuration alone cannot prove a LiveKit worker is registered.
    ready: configured,
    ...(!client
      ? { reason: "Publish this workspace before starting a Cost Saver test call." }
      : missing.length
        ? { reason: "The Cost Saver browser runtime is not fully configured." }
        : {}),
    missing,
  };
}

export async function createProviderComparisonSession(
  store: PlatformStore,
  management = liveKitManagementFromEnv(),
  actorId = "provider-comparison",
) {
  return createCostSaverSession({
    store,
    clientId: BLADES_HAIR_ID,
    management,
    actorId,
    objective: "Browser provider comparison",
    auditAction: "provider_comparison.session_created",
    comparison: true,
  });
}

export async function createClientCostSaverSession(
  store: PlatformStore,
  clientId: string,
  management = liveKitManagementFromEnv(),
  actorId = "cost-saver-preview",
) {
  return createCostSaverSession({
    store,
    clientId,
    management,
    actorId,
    objective: "Workspace browser test call",
    auditAction: "cost_saver.preview_session_created",
    comparison: false,
  });
}

async function createCostSaverSession(input: {
  store: PlatformStore;
  clientId: string;
  management: LiveKitManagement;
  actorId: string;
  objective: string;
  auditAction: string;
  comparison: boolean;
}) {
  const readiness = await costSaverReadiness(input.store, input.clientId);
  if (!readiness.ready) {
    throw new Error(readiness.businessName
      ? "cost_saver_runtime_not_configured"
      : "published_workspace_configuration_not_found");
  }
  const deployment = input.comparison
    ? await ensureComparisonDeployment(input.store)
    : await ensurePreviewDeployment(input.store, input.clientId);
  const roomScope = input.comparison
    ? "comparison"
    : `preview-${input.clientId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  const roomName = `${roomScope}-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const identity = `operator-${randomUUID()}`;
  const metadata = JSON.stringify({
    tenantId: input.clientId,
    deploymentId: deployment.id,
    direction: "inbound",
    objective: input.objective,
  });
  try {
    await input.management.createRoom({
      name: roomName,
      emptyTimeout: 60,
      departureTimeout: 15,
      maxParticipants: 2,
      metadata: JSON.stringify({
        purpose: input.comparison ? "provider-comparison" : "workspace-preview",
        tenantId: input.clientId,
      }),
    });
    await input.management.createDispatch(roomName, LIVEKIT_RUNTIME_AGENT_NAME, { metadata });
    const token = await input.management.createToken({ roomName, identity });
    await input.store.appendOperatorAudit({
      id: newId("audit_"),
      clientId: input.clientId,
      actorId: input.actorId,
      action: input.auditAction,
      detail: { roomName, deploymentId: deployment.id, routingChanged: false },
      createdAt: new Date().toISOString(),
    });
    return {
      url: process.env.LIVEKIT_URL!,
      token,
      roomName,
      expiresInSeconds: SESSION_TTL_SECONDS,
      clientId: input.clientId,
    };
  } catch (error) {
    await input.management.deleteRoom?.(roomName).catch(() => undefined);
    throw error;
  }
}

export async function handleProviderComparisonRoute(
  ctx: ProductRouteContext,
  route: string,
  management?: LiveKitManagement,
): Promise<boolean> {
  const previewMatch = route.match(/^\/clients\/([^/]+)\/cost-saver\/(readiness|session)$/);
  const previewCleanupMatch =
    route.match(/^\/clients\/([^/]+)\/cost-saver\/session\/([^/]+)$/);
  const comparisonCleanupMatch =
    route.match(/^\/admin\/provider-comparison\/session\/([^/]+)$/);
  const comparison = route === "/admin/provider-comparison/readiness" ||
    route === "/admin/provider-comparison/session" || Boolean(comparisonCleanupMatch);
  if (!comparison && !previewMatch && !previewCleanupMatch) return false;
  const clientId = previewMatch || previewCleanupMatch
    ? decodeURIComponent((previewMatch || previewCleanupMatch)![1])
    : BLADES_HAIR_ID;
  if (comparison && !canAdministerPlatform(ctx.actor)) {
    ctx.send(ctx.res, 403, { error: "platform_admin_required" });
    return true;
  }
  if ((previewMatch || previewCleanupMatch) && !canAccessClient(ctx.actor, clientId)) {
    ctx.send(ctx.res, 404, { error: "client_not_found" });
    return true;
  }
  const cleanupRoomName = decodeURIComponent(
    previewCleanupMatch?.[2] || comparisonCleanupMatch?.[1] || "",
  );
  const expectedMethod = cleanupRoomName
    ? "DELETE"
    : route.endsWith("/readiness") ? "GET" : "POST";
  if (ctx.req.method !== expectedMethod) {
    ctx.send(ctx.res, 405, { error: "method_not_allowed" });
    return true;
  }
  try {
    if (expectedMethod === "DELETE") {
      const expectedPrefix = comparison
        ? "comparison-"
        : `preview-${clientId.replace(/[^a-zA-Z0-9_-]/g, "-")}-`;
      if (!cleanupRoomName.startsWith(expectedPrefix)) {
        ctx.send(ctx.res, 404, { error: "cost_saver_session_not_found" });
        return true;
      }
      const runtime = management || liveKitManagementFromEnv();
      if (!runtime.deleteRoom) throw new Error("cost_saver_cleanup_unavailable");
      await runtime.deleteRoom(cleanupRoomName);
      ctx.send(ctx.res, 200, { ended: true, roomName: cleanupRoomName });
    } else if (expectedMethod === "GET") {
      ctx.send(ctx.res, 200, comparison
        ? await providerComparisonReadiness(ctx.store)
        : await costSaverReadiness(ctx.store, clientId));
    } else {
      ctx.send(ctx.res, 201, comparison
        ? await createProviderComparisonSession(
          ctx.store,
          management || liveKitManagementFromEnv(),
          ctx.actor.subject,
        )
        : await createClientCostSaverSession(
          ctx.store,
          clientId,
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

async function ensurePreviewDeployment(
  store: PlatformStore,
  clientId: string,
): Promise<ProviderDeployment> {
  const id = `browser_preview_livekit_${clientId}`;
  const existing = (await store.listProviderDeployments(clientId))
    .find((item) => item.id === id);
  if (existing && existing.provider === "livekit-cascade" &&
      (existing.status === "staged" || existing.status === "active")) return existing;
  const now = new Date().toISOString();
  const deployment: ProviderDeployment = {
    id,
    clientId,
    provider: "livekit-cascade",
    // Provider deployment ids are globally unique in Postgres. Browser
    // previews share one registered LiveKit agent name, but must never collide
    // with routable deployments or another tenant's preview row.
    providerDeploymentId: `${LIVEKIT_RUNTIME_AGENT_NAME}:preview:${clientId}`,
    status: "staged",
    config: {
      browserOnly: true,
      purpose: "workspace-preview",
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
    deleteRoom: (roomName) => rooms.deleteRoom(roomName),
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
