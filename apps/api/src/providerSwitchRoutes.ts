import type { ActiveVoiceProvider } from "@robinexis/database";
import type { ProviderLaunchGateInput } from "@robinexis/api-contracts";
import {
  ElevenLabsManagementClient,
  ElevenLabsVoiceProviderAdapter,
  LiveKitVoiceProviderAdapter,
  TwilioVoiceRoutingClient,
} from "@robinexis/integrations";
import type { ProductRouteContext } from "./productRoutes.js";
import { canAdministerPlatform } from "./auth.js";
import { ProviderSwitchService } from "./providerSwitchService.js";

export async function handleProviderSwitchRoute(
  ctx: ProductRouteContext,
  route: string,
): Promise<boolean> {
  const match = route.match(/^\/admin\/clients\/([^/]+)\/provider-switch\/(prepare|preview|start|status|rollback|health|launch-gate)$/);
  if (!match) return false;
  if (!canAdministerPlatform(ctx.actor)) {
    ctx.send(ctx.res, 403, { error: "platform_admin_required" });
    return true;
  }

  const clientId = decodeURIComponent(match[1]);
  const action = match[2];
  if (
    (action === "prepare" || action === "preview" || action === "start" || action === "rollback") && ctx.req.method !== "POST" ||
    (action === "status" || action === "health") && ctx.req.method !== "GET" ||
    action === "launch-gate" && ctx.req.method !== "GET" && ctx.req.method !== "POST"
  ) {
    ctx.send(ctx.res, 405, { error: "method_not_allowed" });
    return true;
  }

  if (action !== "launch-gate" &&
      (!process.env.ELEVENLABS_API_KEY || !process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN)) {
    ctx.send(ctx.res, 503, { error: "provider_management_not_configured" });
    return true;
  }
  const elevenLabs = new ElevenLabsManagementClient({ apiKey: process.env.ELEVENLABS_API_KEY || "" });
  const routing = new TwilioVoiceRoutingClient(
    process.env.TWILIO_ACCOUNT_SID || "",
    process.env.TWILIO_AUTH_TOKEN || "",
  );
  const service = new ProviderSwitchService(ctx.store, {
    "elevenlabs-convai": new ElevenLabsVoiceProviderAdapter(elevenLabs, routing),
    "livekit-cascade": new LiveKitVoiceProviderAdapter(routing),
  });

  try {
    if (action === "launch-gate") {
      if (ctx.req.method === "GET") {
        ctx.send(ctx.res, 200, await service.getLaunchGate(
          clientId,
          ctx.url.searchParams.get("deploymentId") || undefined,
        ));
      } else {
        const body = await readBody<ProviderLaunchGateInput>(ctx);
        ctx.send(ctx.res, 201, await service.evaluateLaunchGate(clientId, body, ctx.actor.subject));
      }
      return true;
    }
    if (action === "prepare") {
      const body = await readBody<{
        provider?: ActiveVoiceProvider;
        livekit?: {
          providerDeploymentId?: string;
          phoneNumberId?: string;
          suspendVoiceUrl?: string;
          ingressKind?: "twilio_voice_url" | "sip_uri";
          voiceUrl?: string;
          sipUri?: string;
          twilioVoiceUrl?: string;
        };
      }>(ctx);
      if (!validProvider(body.provider)) {
        ctx.send(ctx.res, 400, { error: "valid_target_provider_required" });
      } else {
        const deployment = await service.prepare({
          clientId,
          provider: body.provider,
          actorId: ctx.actor.subject,
          livekit: body.livekit,
        });
        ctx.send(ctx.res, 201, {
          deploymentId: deployment.id,
          provider: deployment.provider,
          status: deployment.status,
          preparedAt: deployment.updatedAt,
        });
      }
      return true;
    }
    if (action === "preview") {
      const body = await readBody<{ toProvider?: ActiveVoiceProvider }>(ctx);
      if (!validProvider(body.toProvider)) {
        ctx.send(ctx.res, 400, { error: "valid_target_provider_required" });
      } else {
        const preview = await service.preview(clientId, body.toProvider);
        ctx.send(ctx.res, 200, preview);
      }
      return true;
    }
    if (action === "start") {
      const body = await readBody<{
        toProvider?: ActiveVoiceProvider;
        idempotencyKey?: string;
        confirmation?: string;
      }>(ctx);
      if (!validProvider(body.toProvider) || !body.idempotencyKey?.trim() || !body.confirmation) {
        ctx.send(ctx.res, 400, { error: "target_idempotency_and_confirmation_required" });
      } else {
        const operation = await service.start({
          clientId,
          toProvider: body.toProvider,
          idempotencyKey: body.idempotencyKey.trim().slice(0, 128),
          confirmation: body.confirmation,
          actorId: ctx.actor.subject,
        });
        ctx.send(ctx.res, operation.status === "rolled_back" || operation.status === "failed" ? 502 : 202, operation);
      }
      return true;
    }
    if (action === "status") {
      ctx.send(ctx.res, 200, await service.status(clientId, ctx.url.searchParams.get("operationId") || undefined));
      return true;
    }
    if (action === "rollback") {
      const body = await readBody<{ operationId?: string; confirmation?: string }>(ctx);
      const client = await ctx.store.getClient(clientId);
      if (!client) {
        ctx.send(ctx.res, 404, { error: "client_not_found" });
      } else if (!body.operationId || body.confirmation !== `ROLLBACK ${client.businessName}`) {
        ctx.send(ctx.res, 400, { error: "rollback_confirmation_invalid" });
      } else {
        ctx.send(ctx.res, 202, await service.rollback(clientId, body.operationId, ctx.actor.subject));
      }
      return true;
    }
    ctx.send(ctx.res, 200, await service.health(clientId));
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message === "client_not_found" || message === "published_tenant_not_found" ||
      message === "provider_switch_not_found" || message.endsWith("_not_found")
      ? 404
      : message === "provider_switch_disabled"
        || message === "provider_quality_evaluation_disabled"
        ? 503
      : message.includes("confirmation") || message.includes("_invalid") || message.includes("_required") ||
        message === "candidate_provider_mismatch"
        ? 400
        : message.includes("protected") || message.includes("not_rollbackable") || message.includes("preflight") ||
          message === "target_provider_already_active"
          ? 409
          : 500;
    ctx.send(ctx.res, status, { error: message });
    return true;
  }
}

async function readBody<T>(ctx: ProductRouteContext): Promise<T> {
  return JSON.parse((await ctx.readRaw(ctx.req)).toString() || "{}") as T;
}

function validProvider(value: unknown): value is ActiveVoiceProvider {
  return value === "elevenlabs-convai" || value === "livekit-cascade";
}
