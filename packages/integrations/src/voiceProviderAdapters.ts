import type {
  ActiveVoiceProvider,
  ClientConfig,
  ProviderDeployment,
  ProviderUsageCostEvent,
} from "@robinexis/database";
import {
  ElevenLabsManagementClient,
  provisionElevenLabsAgent,
  type ElevenLabsAgentConfig,
} from "./elevenLabsProvisioning.js";

export interface ProviderRouteSnapshot {
  provider: ActiveVoiceProvider;
  phoneNumberId: string;
  route?: string;
  agentId?: string;
  capturedAt: string;
}

export interface ProviderAdapterContext {
  client: ClientConfig;
  deployment: ProviderDeployment;
  operationKey: string;
  now: string;
}

export interface ProviderAdapterHealth {
  healthy: boolean;
  checks: Array<{ key: string; passed: boolean; detail: string }>;
  routeSnapshot?: ProviderRouteSnapshot;
}

export interface VoiceProviderAdapter {
  readonly provider: ActiveVoiceProvider;
  health(context: ProviderAdapterContext): Promise<ProviderAdapterHealth>;
  provision(context: ProviderAdapterContext): Promise<{ providerDeploymentId: string }>;
  route(context: ProviderAdapterContext): Promise<ProviderRouteSnapshot>;
  suspend(context: ProviderAdapterContext): Promise<void>;
  restore(context: ProviderAdapterContext, snapshot: ProviderRouteSnapshot): Promise<void>;
  usage(context: ProviderAdapterContext): Promise<ProviderUsageCostEvent[]>;
}

export interface TwilioVoiceRoute {
  phoneNumberId: string;
  phoneNumber?: string;
  voiceUrl?: string;
}

export interface TwilioVoiceRouting {
  inspect(phoneNumberId: string): Promise<TwilioVoiceRoute>;
  setVoiceUrl(phoneNumberId: string, voiceUrl: string): Promise<void>;
}

export class TwilioVoiceRoutingClient implements TwilioVoiceRouting {
  constructor(
    private readonly accountSid: string,
    private readonly authToken: string,
    private readonly request: typeof fetch = fetch,
  ) {
    if (!accountSid || !authToken) throw new Error("twilio_routing_not_configured");
  }

  private endpoint(phoneNumberId: string) {
    return `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(this.accountSid)}/IncomingPhoneNumbers/${encodeURIComponent(phoneNumberId)}.json`;
  }

  private headers(content = false) {
    return {
      Authorization: `Basic ${Buffer.from(`${this.accountSid}:${this.authToken}`).toString("base64")}`,
      ...(content ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    };
  }

  async inspect(phoneNumberId: string): Promise<TwilioVoiceRoute> {
    const response = await this.request(this.endpoint(phoneNumberId), { headers: this.headers() });
    const body = await response.json() as { sid?: string; phone_number?: string; voice_url?: string; code?: number };
    if (!response.ok || body.sid !== phoneNumberId) {
      throw new Error(`twilio_route_inspection_failed:${body.code || response.status}`);
    }
    return { phoneNumberId: body.sid, phoneNumber: body.phone_number, voiceUrl: body.voice_url };
  }

  async setVoiceUrl(phoneNumberId: string, voiceUrl: string): Promise<void> {
    const response = await this.request(this.endpoint(phoneNumberId), {
      method: "POST",
      headers: this.headers(true),
      body: new URLSearchParams({ VoiceUrl: voiceUrl, VoiceMethod: "POST" }),
    });
    if (!response.ok) throw new Error(`twilio_route_update_failed:${response.status}`);
  }
}

type ElevenLabsConfig = {
  agentConfig?: ElevenLabsAgentConfig;
  phoneNumberId?: string;
  twilioPhoneNumberId?: string;
  twilioVoiceUrl?: string;
  agentId?: string;
};

export class ElevenLabsVoiceProviderAdapter implements VoiceProviderAdapter {
  readonly provider = "elevenlabs-convai" as const;

  constructor(
    private readonly management: ElevenLabsManagementClient,
    private readonly routing?: TwilioVoiceRouting,
  ) {}

  async health(context: ProviderAdapterContext): Promise<ProviderAdapterHealth> {
    const config = context.deployment.config as ElevenLabsConfig;
    const agentId = context.deployment.providerDeploymentId || config.agentId;
    const prepared = Boolean(agentId || (context.deployment.status === "staged" && config.agentConfig));
    const checks: ProviderAdapterHealth["checks"] = [{
        key: "elevenlabs_agent",
        passed: prepared,
        detail: agentId
          ? "ElevenLabs agent identifier is configured."
          : prepared
            ? "ElevenLabs agent configuration is prepared for isolated provisioning."
            : "ElevenLabs agent identifier or staged configuration is missing.",
      }];
    let routeSnapshot: ProviderRouteSnapshot | undefined;
    if (config.twilioPhoneNumberId && this.routing) {
      try {
        const route = await this.routing.inspect(config.twilioPhoneNumberId);
        const targetConfigured = validHttps(config.twilioVoiceUrl);
        const matches = targetConfigured && route.voiceUrl === config.twilioVoiceUrl;
        const passed = context.deployment.status === "staged" ? targetConfigured : matches;
        checks.push({
          key: "twilio_voice_url",
          passed,
          detail: matches
            ? "Twilio VoiceUrl matches the configured ElevenLabs route."
            : !targetConfigured
              ? "A valid HTTPS ElevenLabs VoiceUrl is required."
              : context.deployment.status === "staged"
                ? "Twilio VoiceUrl is readable and will be snapshotted before switching."
                : "Twilio VoiceUrl does not match the active ElevenLabs route.",
        });
        routeSnapshot = {
          provider: this.provider,
          phoneNumberId: route.phoneNumberId,
          route: route.voiceUrl,
          agentId,
          capturedAt: context.now,
        };
      } catch (error) {
        checks.push({ key: "twilio_voice_url", passed: false, detail: error instanceof Error ? error.message : String(error) });
      }
    } else if (context.deployment.status === "staged") {
      checks.push({
        key: "twilio_voice_url",
        passed: false,
        detail: "A verifiable Twilio number and ElevenLabs VoiceUrl are required for a staged deployment.",
      });
    }
    return {
      healthy: checks.every((item) => item.passed),
      checks,
      ...(routeSnapshot ? { routeSnapshot } : config.phoneNumberId && agentId ? {
        routeSnapshot: {
          provider: this.provider,
          phoneNumberId: config.phoneNumberId,
          agentId,
          capturedAt: context.now,
        },
      } : {}),
    };
  }

  async provision(context: ProviderAdapterContext) {
    const config = context.deployment.config as ElevenLabsConfig;
    const existingAgentId = context.deployment.providerDeploymentId || config.agentId;
    if (!config.agentConfig) {
      if (!existingAgentId) throw new Error("elevenlabs_agent_config_missing");
      return { providerDeploymentId: existingAgentId };
    }
    const result = await provisionElevenLabsAgent(this.management, {
      config: config.agentConfig,
      externalOperationKey: context.operationKey,
      existingAgentId,
    });
    return { providerDeploymentId: result.agentId };
  }

  async route(context: ProviderAdapterContext): Promise<ProviderRouteSnapshot> {
    const config = context.deployment.config as ElevenLabsConfig;
    const agentId = context.deployment.providerDeploymentId || config.agentId;
    if (!config.phoneNumberId || !agentId) throw new Error("elevenlabs_route_config_missing");
    await this.management.assignAgentToPhoneNumber(
      config.phoneNumberId,
      agentId,
      `${context.operationKey}:route`,
    );
    if (!this.routing || !config.twilioPhoneNumberId || !validHttps(config.twilioVoiceUrl)) {
      throw new Error("elevenlabs_twilio_route_config_missing");
    }
    await this.routing.setVoiceUrl(config.twilioPhoneNumberId, config.twilioVoiceUrl);
    const routed = await this.routing.inspect(config.twilioPhoneNumberId);
    if (routed.voiceUrl !== config.twilioVoiceUrl) throw new Error("elevenlabs_route_verification_failed");
    return {
      provider: this.provider,
      phoneNumberId: config.twilioPhoneNumberId,
      route: routed.voiceUrl,
      agentId,
      capturedAt: context.now,
    };
  }

  async suspend(context: ProviderAdapterContext) {
    const phoneNumberId = String(context.deployment.config.phoneNumberId || "");
    if (!phoneNumberId) throw new Error("elevenlabs_phone_number_id_missing");
    await this.management.unassignAgentFromPhoneNumber(phoneNumberId, `${context.operationKey}:suspend`);
  }

  async restore(context: ProviderAdapterContext, snapshot: ProviderRouteSnapshot) {
    const agentId = snapshot.agentId || context.deployment.providerDeploymentId;
    const config = context.deployment.config as ElevenLabsConfig;
    if (!config.phoneNumberId || !agentId) throw new Error("elevenlabs_restore_snapshot_invalid");
    await this.management.assignAgentToPhoneNumber(
      config.phoneNumberId,
      agentId,
      `${context.operationKey}:restore`,
    );
    if (this.routing && config.twilioPhoneNumberId && validHttps(snapshot.route)) {
      await this.routing.setVoiceUrl(config.twilioPhoneNumberId, snapshot.route);
      const restored = await this.routing.inspect(config.twilioPhoneNumberId);
      if (restored.voiceUrl !== snapshot.route) throw new Error("elevenlabs_restore_verification_failed");
    }
  }

  async usage() {
    return [];
  }
}

type LiveKitTelephonyConfig = {
  phoneNumberId?: string;
  suspendVoiceUrl?: string;
  ingress?: {
    kind?: "twilio_voice_url" | "sip_uri";
    voiceUrl?: string;
    sipUri?: string;
    twilioVoiceUrl?: string;
  };
};

export class LiveKitVoiceProviderAdapter implements VoiceProviderAdapter {
  readonly provider = "livekit-cascade" as const;

  constructor(private readonly routing: TwilioVoiceRouting) {}

  private config(context: ProviderAdapterContext): Required<Pick<LiveKitTelephonyConfig, "ingress" | "phoneNumberId">> {
    const config = context.deployment.config as LiveKitTelephonyConfig;
    const ingress = config.ingress;
    if (!config.phoneNumberId) throw new Error("livekit_phone_number_id_missing");
    if (!validHttps(config.suspendVoiceUrl)) throw new Error("livekit_suspend_voice_url_invalid");
    if (!ingress?.kind) throw new Error("livekit_ingress_missing");
    if (ingress.kind === "twilio_voice_url" && !validHttps(ingress.voiceUrl)) {
      throw new Error("livekit_twilio_voice_url_invalid");
    }
    if (ingress.kind === "sip_uri") {
      if (!validSip(ingress.sipUri)) throw new Error("livekit_sip_uri_invalid");
      if (!validHttps(ingress.twilioVoiceUrl)) throw new Error("livekit_sip_twilio_voice_url_missing");
    }
    return { phoneNumberId: config.phoneNumberId, ingress };
  }

  private expectedVoiceUrl(context: ProviderAdapterContext) {
    const { ingress } = this.config(context);
    return ingress.kind === "sip_uri" ? ingress.twilioVoiceUrl! : ingress.voiceUrl!;
  }

  async health(context: ProviderAdapterContext): Promise<ProviderAdapterHealth> {
    const checks: ProviderAdapterHealth["checks"] = [];
    let route: TwilioVoiceRoute | undefined;
    try {
      const config = this.config(context);
      checks.push({ key: "ingress_config", passed: true, detail: `Configured ingress: ${config.ingress.kind}.` });
      route = await this.routing.inspect(config.phoneNumberId);
      const expected = this.expectedVoiceUrl(context);
      const routeMatches = route.voiceUrl === expected;
      checks.push({
        key: "twilio_voice_url",
        passed: context.deployment.status !== "active" || routeMatches,
        detail: routeMatches
          ? "Twilio VoiceUrl matches the target ingress."
          : context.deployment.status === "active"
            ? "Twilio VoiceUrl does not match the active ingress."
            : "Twilio VoiceUrl is readable and will be snapshotted before switching.",
      });
      if (config.ingress.kind === "sip_uri") {
        checks.push({
          key: "external_sip_ingress",
          passed: false,
          detail: "External SIP ingress cannot be independently verified by this adapter.",
        });
      }
    } catch (error) {
      checks.push({ key: "ingress_config", passed: false, detail: error instanceof Error ? error.message : String(error) });
    }
    return {
      healthy: checks.length > 0 && checks.every((check) => check.passed),
      checks,
      ...(route ? {
        routeSnapshot: {
          provider: this.provider,
          phoneNumberId: route.phoneNumberId,
          route: route.voiceUrl,
          capturedAt: context.now,
        },
      } : {}),
    };
  }

  async provision(context: ProviderAdapterContext) {
    this.config(context);
    if (!context.deployment.providerDeploymentId) throw new Error("livekit_deployment_id_missing");
    return { providerDeploymentId: context.deployment.providerDeploymentId };
  }

  async route(context: ProviderAdapterContext): Promise<ProviderRouteSnapshot> {
    const { phoneNumberId } = this.config(context);
    const before = await this.routing.inspect(phoneNumberId);
    await this.routing.setVoiceUrl(phoneNumberId, this.expectedVoiceUrl(context));
    const after = await this.routing.inspect(phoneNumberId);
    if (after.voiceUrl !== this.expectedVoiceUrl(context)) throw new Error("livekit_route_verification_failed");
    return {
      provider: this.provider,
      phoneNumberId,
      route: before.voiceUrl,
      capturedAt: context.now,
    };
  }

  async suspend(context: ProviderAdapterContext) {
    const config = context.deployment.config as LiveKitTelephonyConfig;
    const { phoneNumberId } = this.config(context);
    await this.routing.setVoiceUrl(phoneNumberId, config.suspendVoiceUrl!);
    const suspended = await this.routing.inspect(phoneNumberId);
    if (suspended.voiceUrl !== config.suspendVoiceUrl) throw new Error("livekit_suspend_verification_failed");
  }

  async restore(context: ProviderAdapterContext, snapshot: ProviderRouteSnapshot) {
    const { phoneNumberId } = this.config(context);
    const route = validHttps(snapshot.route) ? snapshot.route : this.expectedVoiceUrl(context);
    if (snapshot.phoneNumberId && snapshot.phoneNumberId !== phoneNumberId) throw new Error("livekit_restore_snapshot_invalid");
    await this.routing.setVoiceUrl(phoneNumberId, route);
    const restored = await this.routing.inspect(phoneNumberId);
    if (restored.voiceUrl !== route) throw new Error("livekit_restore_verification_failed");
  }

  async usage() {
    return [];
  }
}

function validHttps(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function validSip(value: unknown): value is string {
  return typeof value === "string" && /^sips?:[^@\s]+@[^@\s]+$/i.test(value);
}
