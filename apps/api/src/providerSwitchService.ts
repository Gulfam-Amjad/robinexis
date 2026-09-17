import {
  BLADES_HAIR_ID,
  newId,
  type ActiveVoiceProvider,
  type ClientConfig,
  type PlatformStore,
  type ProviderDeployment,
  type ProviderRollbackSnapshot,
  type ProviderSwitchOperation,
  type ProviderSwitchStatus,
} from "@robinexis/database";
import {
  assertTwilioResourceNotProtected,
  buildElevenLabsAgentConfig,
  type ProviderAdapterContext,
  type ProviderRouteSnapshot,
  type VoiceProviderAdapter,
} from "@robinexis/integrations";
import { evaluateProviderQuality } from "@robinexis/evaluations";
import type {
  ProviderLaunchGateContract,
  ProviderLaunchGateInput,
  ProviderHealthView,
  ProviderSwitchCheck,
  ProviderSwitchOperationView,
  ProviderSwitchPreview,
} from "@robinexis/api-contracts";

export type ProviderAdapterRegistry = Record<ActiveVoiceProvider, VoiceProviderAdapter>;

export interface PrepareProviderInput {
  clientId: string;
  provider: ActiveVoiceProvider;
  actorId: string;
  livekit?: {
    providerDeploymentId?: string;
    phoneNumberId?: string;
    suspendVoiceUrl?: string;
    ingressKind?: "twilio_voice_url" | "sip_uri";
    voiceUrl?: string;
    sipUri?: string;
    twilioVoiceUrl?: string;
  };
}

export class ProviderSwitchService {
  private readonly flags: {
    enabled: boolean;
    routingEnabled: boolean;
    qualityEvaluationEnabled: boolean;
    launchGateMaxAgeMs: number;
  };

  constructor(
    private readonly store: PlatformStore,
    private readonly adapters: ProviderAdapterRegistry,
    flags: Partial<ProviderSwitchService["flags"]> = {},
  ) {
    this.flags = {
      enabled: process.env.PROVIDER_SWITCH_ENABLED === "true",
      routingEnabled: process.env.PROVIDER_SWITCH_ROUTING_ENABLED === "true",
      qualityEvaluationEnabled: process.env.PROVIDER_QUALITY_EVALUATION_ENABLED === "true",
      launchGateMaxAgeMs: launchGateMaxAgeMs(),
      ...flags,
    };
  }

  async evaluateLaunchGate(
    clientId: string,
    input: ProviderLaunchGateInput,
    actorId: string,
  ): Promise<ProviderLaunchGateContract> {
    if (!this.flags.enabled) throw new Error("provider_switch_disabled");
    if (!this.flags.qualityEvaluationEnabled) throw new Error("provider_quality_evaluation_disabled");
    await this.requireClient(clientId);
    const deployment = (await this.store.listProviderDeployments(clientId))
      .find((item) => item.id === input.deploymentId && item.status === "staged");
    if (!deployment) throw new Error("staged_provider_deployment_not_found");
    if (deployment.provider !== input.candidateProvider) throw new Error("candidate_provider_mismatch");

    const evaluatedAt = new Date().toISOString();
    const evaluation = evaluateProviderQuality(input);
    const gate: ProviderLaunchGateContract = {
      ...structuredClone(input),
      id: newId("provider_gate_"),
      evaluatedAt,
      evaluatedBy: actorId,
      ...evaluation,
    };
    deployment.launchGate = structuredClone(gate);
    deployment.updatedAt = evaluatedAt;
    await this.store.upsertProviderDeployment(deployment);
    await this.store.appendOperatorAudit({
      id: gate.id,
      clientId,
      actorId,
      action: "provider_launch_gate.evaluated",
      detail: structuredClone(gate) as unknown as Record<string, unknown>,
      createdAt: evaluatedAt,
    });
    return gate;
  }

  async getLaunchGate(clientId: string, deploymentId?: string): Promise<ProviderLaunchGateContract> {
    await this.requireClient(clientId);
    const deployments = await this.store.listProviderDeployments(clientId);
    const deployment = deploymentId
      ? deployments.find((item) => item.id === deploymentId)
      : deployments.find((item) => item.provider === "livekit-cascade" && item.status === "staged");
    if (!deployment) throw new Error("provider_deployment_not_found");
    if (!deployment.launchGate) throw new Error("provider_launch_gate_not_found");
    return structuredClone(deployment.launchGate);
  }

  async prepare(input: PrepareProviderInput): Promise<ProviderDeployment> {
    if (!this.flags.enabled) throw new Error("provider_switch_disabled");
    const client = await this.requirePublishedClient(input.clientId);
    await this.assertNotProtected(client);
    await this.ensureCurrentDeployment(client, input.actorId);
    const deployments = await this.store.listProviderDeployments(client.id);
    const active = deployments.find((item) => item.status === "active");
    if (active?.provider === input.provider) throw new Error("target_provider_already_active");
    const existing = deployments.find((item) =>
      item.provider === input.provider && ["staged", "retired", "failed"].includes(item.status));
    const now = new Date().toISOString();
    const deployment: ProviderDeployment = {
      id: existing?.id || newId("provider_deployment_"),
      clientId: client.id,
      agentInstanceId: existing?.agentInstanceId,
      provider: input.provider,
      providerDeploymentId: existing?.providerDeploymentId,
      status: "staged",
      config: input.provider === "elevenlabs-convai"
        ? await this.elevenLabsPreparation(client, existing)
        : await this.liveKitPreparation(client, input.livekit, existing),
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    if (input.provider === "livekit-cascade") {
      deployment.providerDeploymentId = input.livekit?.providerDeploymentId ||
        existing?.providerDeploymentId ||
        process.env.LIVEKIT_DEPLOYMENT_ID ||
        deployment.id;
    }
    let health = await this.adapters[input.provider].health(
      this.context(client, deployment, `prepare:${deployment.id}`),
    );
    if (!health.healthy) throw new Error(`provider_prepare_preflight_failed:${health.checks.filter((item) => !item.passed).map((item) => item.key).join(",")}`);
    if (input.provider === "livekit-cascade") {
      if (!deployment.config.suspendVoiceUrl && health.routeSnapshot?.route) {
        deployment.config = {
          ...deployment.config,
          suspendVoiceUrl: health.routeSnapshot.route,
        };
      }
      const provisioned = await this.adapters[input.provider].provision(
        this.context(client, deployment, `prepare:${deployment.id}:sip`),
      );
      deployment.providerDeploymentId = provisioned.providerDeploymentId;
      health = await this.adapters[input.provider].health(
        this.context(client, deployment, `prepare:${deployment.id}:post-sip`),
      );
      if (!health.healthy) {
        throw new Error(`provider_prepare_preflight_failed:${health.checks.filter((item) => !item.passed).map((item) => item.key).join(",")}`);
      }
    }
    await this.store.upsertProviderDeployment(deployment);
    await this.store.appendOperatorAudit({
      id: newId("audit_"),
      clientId: client.id,
      actorId: input.actorId,
      action: "provider_deployment.prepared",
      detail: { deploymentId: deployment.id, provider: deployment.provider },
      createdAt: now,
    });
    return deployment;
  }

  async preview(clientId: string, toProvider: ActiveVoiceProvider): Promise<ProviderSwitchPreview> {
    const client = await this.requireClient(clientId);
    await this.ensureCurrentDeployment(client);
    const deployments = await this.store.listProviderDeployments(client.id);
    const active = deployments.find((item) => item.status === "active");
    const target = deployments.find((item) => item.provider === toProvider && item.status === "staged");
    const checks: ProviderSwitchCheck[] = [
      check("feature_enabled", this.flags.enabled, "Provider switching feature is enabled.", "Provider switching is disabled."),
      check("routing_enabled", this.flags.routingEnabled, "External routing writes are enabled.", "External routing writes are disabled."),
      check("active_deployment", Boolean(active), "An active source deployment exists.", "No active source deployment exists."),
      check("different_provider", Boolean(active && active.provider !== toProvider), "Target differs from the active provider.", "Target is already active."),
      check("target_staged", Boolean(target), "A staged target deployment exists.", "No staged target deployment exists."),
    ];

    try {
      await this.assertNotProtected(client);
      checks.push(check("protected_number", true, "Tenant and live numbers are not protected.", ""));
    } catch {
      checks.push(check("protected_number", false, "", "Blades and protected live numbers cannot be switched."));
    }

    if (target) {
      const health = await this.adapters[toProvider].health(this.context(client, target, "preview"));
      for (const item of health.checks) {
        checks.push({ key: `target_${item.key}`, passed: item.passed, blocking: true, detail: item.detail });
      }
      if (toProvider === "livekit-cascade") {
        const gate = target.launchGate;
        const ageMs = gate ? Date.now() - Date.parse(gate.evaluatedAt) : Number.POSITIVE_INFINITY;
        const passedAndRecent = Boolean(
          gate?.passed &&
          Number.isFinite(ageMs) &&
          ageMs >= 0 &&
          ageMs <= this.flags.launchGateMaxAgeMs,
        );
        checks.push(check(
          "quality_launch_gate",
          passedAndRecent,
          `Stored quality gate passed and is within ${Math.round(this.flags.launchGateMaxAgeMs / 3_600_000)} hours.`,
          gate?.passed ? "Stored quality gate is stale or invalid." : "A stored passing quality gate is required.",
        ));
      }
    }

    return {
      clientId,
      fromProvider: activeProvider(active),
      toProvider,
      targetDeploymentId: target?.id,
      status: checks.every((item) => item.passed || !item.blocking) ? "ready" : "blocked",
      featureEnabled: this.flags.enabled && this.flags.routingEnabled,
      checks,
    };
  }

  async start(input: {
    clientId: string;
    toProvider: ActiveVoiceProvider;
    idempotencyKey: string;
    confirmation: string;
    actorId: string;
  }): Promise<ProviderSwitchOperationView> {
    const existing = await this.store.getProviderSwitchOperationByIdempotency(input.clientId, input.idempotencyKey);
    if (existing) return this.view(existing);

    const client = await this.requireClient(input.clientId);
    if (input.confirmation !== `SWITCH ${client.businessName}`) throw new Error("typed_confirmation_invalid");
    const preview = await this.preview(client.id, input.toProvider);
    if (preview.status !== "ready") throw new Error(`provider_switch_preflight_failed:${failedKeys(preview.checks)}`);

    const deployments = await this.store.listProviderDeployments(client.id);
    const source = deployments.find((item) => item.status === "active")!;
    const target = deployments.find((item) => item.id === preview.targetDeploymentId)!;
    const now = new Date().toISOString();
    const operation: ProviderSwitchOperation = {
      id: newId("provider_switch_"),
      clientId: client.id,
      idempotencyKey: input.idempotencyKey,
      fromDeploymentId: source.id,
      toDeploymentId: target.id,
      status: "pending",
      requestedBy: input.actorId,
      createdAt: now,
      updatedAt: now,
    };
    if (!(await this.store.claimProviderSwitchOperation(operation))) {
      return this.view((await this.store.getProviderSwitchOperationByIdempotency(client.id, input.idempotencyKey))!);
    }
    await this.audit(operation, "provider_switch.requested", { from: source.provider, to: target.provider });

    let snapshot: ProviderRollbackSnapshot | undefined;
    let routingAttempted = false;
    try {
      await this.transition(operation, "running");
      const preRouteHealth = await this.adapters[input.toProvider].health(
        this.context(client, target, operation.idempotencyKey),
      );
      if (!preRouteHealth.healthy) throw new Error("target_pre_route_health_failed");
      const capturedSnapshot: ProviderRollbackSnapshot = {
        id: newId("provider_snapshot_"),
        clientId: client.id,
        switchOperationId: operation.id,
        provider: source.provider,
        deploymentId: source.id,
        snapshot: {
          ...this.sourceSnapshot(source, {
            provider: input.toProvider,
            phoneNumberId: preRouteHealth.routeSnapshot?.phoneNumberId ||
              String(target.config.phoneNumberId || source.config.phoneNumberId || ""),
            route: preRouteHealth.routeSnapshot?.route,
            capturedAt: preRouteHealth.routeSnapshot?.capturedAt || new Date().toISOString(),
          }),
        },
        createdAt: new Date().toISOString(),
      };
      snapshot = capturedSnapshot;
      if (!(await this.store.saveProviderRollbackSnapshot(capturedSnapshot))) throw new Error("rollback_snapshot_conflict");
      operation.rollbackSnapshotId = capturedSnapshot.id;
      await this.store.saveProviderSwitchOperation(operation);

      const provisioned = await this.adapters[input.toProvider].provision(
        this.context(client, target, operation.idempotencyKey),
      );
      target.providerDeploymentId = provisioned.providerDeploymentId;
      target.updatedAt = new Date().toISOString();
      await this.store.upsertProviderDeployment(target);

      routingAttempted = true;
      await this.adapters[input.toProvider].route(
        this.context(client, target, operation.idempotencyKey),
      );
      const routedHealth = await this.adapters[input.toProvider].health(
        this.context(client, { ...target, status: "active" }, operation.idempotencyKey),
      );
      if (!routedHealth.healthy) throw new Error("target_route_health_failed");

      if (source.provider === "elevenlabs-convai") {
        const route = String(capturedSnapshot.snapshot.route || "");
        if (route) source.config = { ...source.config, twilioVoiceUrl: route };
      }
      source.status = "draining";
      source.updatedAt = new Date().toISOString();
      await this.store.upsertProviderDeployment(source);
      target.status = "active";
      target.activatedAt = new Date().toISOString();
      target.updatedAt = target.activatedAt;
      await this.store.upsertProviderDeployment(target);
      source.status = "retired";
      source.retiredAt = new Date().toISOString();
      source.updatedAt = source.retiredAt;
      await this.store.upsertProviderDeployment(source);
      client.voicePipeline = input.toProvider;
      await this.store.upsertClient(client);
      await this.transition(operation, "succeeded");
      return this.view(operation);
    } catch (error) {
      await this.compensate(operation, client, source, target, snapshot, routingAttempted, error);
      return this.view(operation);
    }
  }

  async rollback(clientId: string, operationId: string, actorId: string) {
    if (!this.flags.enabled || !this.flags.routingEnabled) throw new Error("provider_switch_disabled");
    const client = await this.requireClient(clientId);
    await this.assertNotProtected(client);
    const operation = (await this.store.listProviderSwitchOperations(clientId)).find((item) => item.id === operationId);
    if (!operation) throw new Error("provider_switch_not_found");
    if (operation.status === "rolled_back") return this.view(operation);
    if (operation.status !== "succeeded" || !operation.rollbackSnapshotId || !operation.fromDeploymentId) {
      throw new Error("provider_switch_not_rollbackable");
    }
    const deployments = await this.store.listProviderDeployments(clientId);
    const source = deployments.find((item) => item.id === operation.fromDeploymentId)!;
    const target = deployments.find((item) => item.id === operation.toDeploymentId)!;
    const snapshot = await this.store.getProviderRollbackSnapshot(clientId, operation.rollbackSnapshotId);
    if (!source || !target || !snapshot) throw new Error("provider_switch_rollback_state_missing");
    await this.store.appendOperatorAudit({
      id: newId("audit_"),
      clientId,
      actorId,
      action: "provider_switch.rollback_requested",
      detail: { operationId: operation.id },
      createdAt: new Date().toISOString(),
    });
    await this.transition(operation, "rolling_back");
    try {
      await this.adapters[target.provider as ActiveVoiceProvider].suspend(
        this.context(client, target, `${operation.idempotencyKey}:manual-rollback`),
      );
      await this.adapters[source.provider as ActiveVoiceProvider].restore(
        this.context(client, source, `${operation.idempotencyKey}:manual-rollback`),
        snapshot.snapshot as unknown as ProviderRouteSnapshot,
      );
      target.status = "retired";
      target.retiredAt = new Date().toISOString();
      target.updatedAt = target.retiredAt;
      await this.store.upsertProviderDeployment(target);
      source.status = "active";
      source.retiredAt = undefined;
      source.activatedAt = new Date().toISOString();
      source.updatedAt = source.activatedAt;
      await this.store.upsertProviderDeployment(source);
      client.voicePipeline = source.provider;
      await this.store.upsertClient(client);
      await this.transition(operation, "rolled_back");
    } catch (error) {
      operation.error = errorMessage(error);
      await this.transition(operation, "failed");
    }
    return this.view(operation);
  }

  async status(clientId: string, operationId?: string) {
    const operations = await this.store.listProviderSwitchOperations(clientId);
    const operation = operationId ? operations.find((item) => item.id === operationId) : operations[0];
    if (!operation) throw new Error("provider_switch_not_found");
    return this.view(operation);
  }

  async health(clientId: string): Promise<ProviderHealthView> {
    const client = await this.requireClient(clientId);
    const active = await this.store.getActiveProviderDeployment(clientId);
    const checkedAt = new Date().toISOString();
    if (!active || !activeProvider(active)) {
      return { clientId, status: "unavailable", checks: [], checkedAt };
    }
    const health = await this.adapters[active.provider as ActiveVoiceProvider].health(
      this.context(client, active, `health:${clientId}`),
    );
    return {
      clientId,
      provider: active.provider as ActiveVoiceProvider,
      deploymentId: active.id,
      status: health.healthy ? "healthy" : "degraded",
      checks: health.checks.map((item) => ({ ...item, blocking: true })),
      checkedAt,
    };
  }

  private async compensate(
    operation: ProviderSwitchOperation,
    client: ClientConfig,
    source: ProviderDeployment,
    target: ProviderDeployment,
    snapshot: ProviderRollbackSnapshot | undefined,
    routingAttempted: boolean,
    cause: unknown,
  ) {
    operation.error = errorMessage(cause);
    await this.transition(operation, "rolling_back");
    const failures: string[] = [];
    if (routingAttempted) {
      try {
        await this.adapters[target.provider as ActiveVoiceProvider].suspend(
          this.context(client, target, `${operation.idempotencyKey}:compensate`),
        );
      } catch (error) {
        failures.push(`target_suspend:${errorMessage(error)}`);
      }
    }
    if (snapshot) {
      try {
        await this.adapters[source.provider as ActiveVoiceProvider].restore(
          this.context(client, source, `${operation.idempotencyKey}:compensate`),
          snapshot.snapshot as unknown as ProviderRouteSnapshot,
        );
      } catch (error) {
        failures.push(`source_restore:${errorMessage(error)}`);
      }
    }
    try {
      target.status = "failed";
      target.updatedAt = new Date().toISOString();
      await this.store.upsertProviderDeployment(target);
      source.status = "active";
      source.retiredAt = undefined;
      source.updatedAt = new Date().toISOString();
      await this.store.upsertProviderDeployment(source);
      client.voicePipeline = source.provider;
      await this.store.upsertClient(client);
    } catch (error) {
      failures.push(`state_restore:${errorMessage(error)}`);
    }
    if (failures.length) operation.error = `${operation.error};compensation_failed:${failures.join(",")}`.slice(0, 1_000);
    await this.transition(operation, failures.length ? "failed" : "rolled_back");
  }

  private sourceSnapshot(source: ProviderDeployment, routed: ProviderRouteSnapshot): ProviderRouteSnapshot {
    const config = source.config as {
      phoneNumberId?: string;
      agentId?: string;
      ingress?: { voiceUrl?: string; twilioVoiceUrl?: string };
    };
    return {
      provider: source.provider as ActiveVoiceProvider,
      phoneNumberId: routed.phoneNumberId || config.phoneNumberId || "",
      route: routed.route || config.ingress?.twilioVoiceUrl || config.ingress?.voiceUrl,
      agentId: config.agentId || source.providerDeploymentId,
      capturedAt: routed.capturedAt,
    };
  }

  private async transition(operation: ProviderSwitchOperation, status: ProviderSwitchStatus) {
    operation.status = status;
    operation.updatedAt = new Date().toISOString();
    if (["succeeded", "rolled_back", "failed"].includes(status)) operation.completedAt = operation.updatedAt;
    else operation.completedAt = undefined;
    await this.store.saveProviderSwitchOperation(operation);
    await this.audit(operation, `provider_switch.${status}`, { error: operation.error });
  }

  private async audit(operation: ProviderSwitchOperation, action: string, detail: Record<string, unknown>) {
    await this.store.appendOperatorAudit({
      id: newId("audit_"),
      clientId: operation.clientId,
      actorId: operation.requestedBy,
      action,
      detail: { operationId: operation.id, ...detail },
      createdAt: new Date().toISOString(),
    });
  }

  private async assertNotProtected(client: ClientConfig) {
    const endpoints = await this.store.listPhoneEndpoints(client.id);
    const relevant = endpoints.filter((item) => item.status === "active" && item.direction !== "outbound");
    for (const endpoint of relevant.length ? relevant : [undefined]) {
      assertTwilioResourceNotProtected({
        clientId: client.id === BLADES_HAIR_ID ? client.id : undefined,
        tenantSlug: client.slug,
        phoneNumber: endpoint?.e164,
        resourceIds: endpoints.flatMap((item) => [item.id, item.providerEndpointId]),
      });
    }
  }

  private async requireClient(clientId: string) {
    const client = await this.store.getClient(clientId);
    if (!client) throw new Error("client_not_found");
    return client;
  }

  private async requirePublishedClient(clientId: string) {
    const client = await this.store.getPublishedClient(clientId);
    if (!client) throw new Error("published_tenant_not_found");
    return client;
  }

  private async ensureCurrentDeployment(client: ClientConfig, actorId = "provider-control-plane") {
    if (await this.store.getActiveProviderDeployment(client.id)) return;
    if (client.voicePipeline !== "elevenlabs-convai" || !client.elevenlabsAgentId) return;
    const phone = (await this.store.listProviderResources(client.id)).find((item) =>
      item.provider === "elevenlabs" &&
      item.resourceType === "phone_number" &&
      item.lifecycleStatus === "active");
    const twilioEndpoint = (await this.store.listPhoneEndpoints(client.id)).find((item) =>
      item.provider === "twilio" && item.status === "active" && item.direction !== "outbound");
    const now = new Date().toISOString();
    const deployment: ProviderDeployment = {
      id: `provider_deployment_el_${client.id}`,
      clientId: client.id,
      provider: "elevenlabs-convai",
      providerDeploymentId: client.elevenlabsAgentId,
      status: "active",
      config: {
        agentId: client.elevenlabsAgentId,
        ...(phone?.providerResourceId ? { phoneNumberId: phone.providerResourceId } : {}),
        ...(twilioEndpoint?.providerEndpointId ? { twilioPhoneNumberId: twilioEndpoint.providerEndpointId } : {}),
      },
      activatedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    await this.store.upsertProviderDeployment(deployment);
    const health = await this.adapters["elevenlabs-convai"].health(
      this.context(client, deployment, `backfill:${client.id}`),
    );
    if (health.routeSnapshot?.route) {
      deployment.config = { ...deployment.config, twilioVoiceUrl: health.routeSnapshot.route };
      deployment.updatedAt = new Date().toISOString();
      await this.store.upsertProviderDeployment(deployment);
    }
    await this.store.appendOperatorAudit({
      id: newId("audit_"),
      clientId: client.id,
      actorId,
      action: "provider_deployment.elevenlabs_backfilled",
      detail: { deploymentId: deployment.id, routingChanged: false },
      createdAt: now,
    });
  }

  private async elevenLabsPreparation(client: ClientConfig, existing?: ProviderDeployment) {
    const prompt = client.promptVersionId ? await this.store.getPromptVersion(client.promptVersionId) : undefined;
    if (!prompt) throw new Error("published_prompt_version_missing");
    const phone = (await this.store.listProviderResources(client.id)).find((item) =>
      item.provider === "elevenlabs" && item.resourceType === "phone_number" && item.providerResourceId);
    const twilioEndpoint = (await this.store.listPhoneEndpoints(client.id)).find((item) =>
      item.provider === "twilio" && item.status === "active" && item.direction !== "outbound");
    const built = buildElevenLabsAgentConfig({
      name: `${client.businessName} Receptionist`,
      firstMessage: client.greeting || `Hello, you've reached ${client.businessName}. How can I help?`,
      systemPrompt: prompt.compiled,
      externalOperationKey: `prepare-${client.id}`.slice(0, 128),
      voiceId: client.voiceId,
      ...(client.transferNumber ? {
        transfer: {
          phoneNumber: client.transferNumber,
          callerHoldMessage: "Please hold while I connect you.",
          humanOperatorSummaryMessage: "Incoming caller requesting assistance.",
        },
      } : {}),
      costOptimized: client.id !== BLADES_HAIR_ID,
    });
    return {
      ...existing?.config,
      agentConfig: built.agentConfig,
      agentId: existing?.providerDeploymentId,
      phoneNumberId: existing?.config.phoneNumberId || phone?.providerResourceId,
      twilioPhoneNumberId: existing?.config.twilioPhoneNumberId || twilioEndpoint?.providerEndpointId,
      twilioVoiceUrl: existing?.config.twilioVoiceUrl || process.env.ELEVENLABS_TWILIO_VOICE_URL,
      promptVersionId: prompt.id,
    };
  }

  private async liveKitPreparation(
    client: ClientConfig,
    provided: PrepareProviderInput["livekit"],
    existing?: ProviderDeployment,
  ) {
    const twilioEndpoint = (await this.store.listPhoneEndpoints(client.id)).find((item) =>
      item.provider === "twilio" && item.status === "active" && item.direction !== "outbound");
    const phoneNumberId = provided?.phoneNumberId ||
      String(existing?.config.phoneNumberId || "") ||
      twilioEndpoint?.providerEndpointId ||
      process.env.LIVEKIT_PHONE_NUMBER_ID ||
      "";
    const ingressKind = provided?.ingressKind ||
      (process.env.LIVEKIT_SIP_URI ? "sip_uri" : "twilio_voice_url");
    const providerDeploymentId = provided?.providerDeploymentId ||
      existing?.providerDeploymentId ||
      process.env.LIVEKIT_DEPLOYMENT_ID ||
      existing?.id ||
      `livekit-${client.id}`;
    const twilioVoiceUrl = liveKitTwilioVoiceUrl(client.id, provided);
    return {
      ...existing?.config,
      tenantId: client.id,
      promptVersionId: client.promptVersionId,
      phoneNumberId,
      suspendVoiceUrl: provided?.suspendVoiceUrl ||
        process.env.LIVEKIT_SUSPEND_VOICE_URL ||
        process.env.ELEVENLABS_TWILIO_VOICE_URL,
      ingress: ingressKind === "sip_uri"
        ? {
          kind: "sip_uri",
          sipUri: provided?.sipUri || process.env.LIVEKIT_SIP_URI,
          twilioVoiceUrl,
        }
        : {
          kind: "twilio_voice_url",
          voiceUrl: twilioVoiceUrl,
        },
      preparedFromPublishedConfig: true,
      providerDeploymentId,
    };
  }

  private context(client: ClientConfig, deployment: ProviderDeployment, operationKey: string): ProviderAdapterContext {
    return { client, deployment, operationKey, now: new Date().toISOString() };
  }

  private async view(operation: ProviderSwitchOperation): Promise<ProviderSwitchOperationView> {
    const deployments = await this.store.listProviderDeployments(operation.clientId);
    const source = deployments.find((item) => item.id === operation.fromDeploymentId);
    const target = deployments.find((item) => item.id === operation.toDeploymentId);
    return {
      id: operation.id,
      clientId: operation.clientId,
      idempotencyKey: operation.idempotencyKey,
      fromProvider: activeProvider(source),
      toProvider: activeProvider(target) || "livekit-cascade",
      status: normalizeStatus(operation.status),
      error: operation.error,
      createdAt: operation.createdAt,
      updatedAt: operation.updatedAt,
      completedAt: operation.completedAt,
      rollbackAvailable: operation.status === "succeeded" && Boolean(operation.rollbackSnapshotId),
    };
  }
}

function liveKitTwilioVoiceUrl(
  tenantId: string,
  provided: PrepareProviderInput["livekit"],
): string | undefined {
  const explicit = provided?.twilioVoiceUrl || provided?.voiceUrl;
  if (explicit) return explicit;
  const configured = process.env.LIVEKIT_TWILIO_VOICE_URL?.trim();
  if (configured) {
    if (configured.includes("{tenantId}")) {
      return configured.replaceAll("{tenantId}", encodeURIComponent(tenantId));
    }
    const url = new URL(configured);
    url.searchParams.set("tenantId", tenantId);
    return url.toString();
  }
  const base = process.env.API_PUBLIC_BASE_URL?.trim();
  if (!base) return undefined;
  const url = new URL("/webhooks/twilio/livekit-inbound", base);
  url.searchParams.set("tenantId", tenantId);
  return url.toString();
}

function activeProvider(deployment?: ProviderDeployment): ActiveVoiceProvider | undefined {
  return deployment?.provider === "elevenlabs-convai" || deployment?.provider === "livekit-cascade"
    ? deployment.provider
    : undefined;
}

function check(key: string, passed: boolean, success: string, failure: string): ProviderSwitchCheck {
  return { key, passed, blocking: true, detail: passed ? success : failure };
}

function failedKeys(checks: ProviderSwitchCheck[]) {
  return checks.filter((item) => item.blocking && !item.passed).map((item) => item.key).join(",");
}

function errorMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

function launchGateMaxAgeMs() {
  const hours = Number(process.env.PROVIDER_LAUNCH_GATE_MAX_AGE_HOURS || 168);
  return Number.isFinite(hours) && hours > 0 ? hours * 3_600_000 : 168 * 3_600_000;
}

export function normalizeStatus(status: ProviderSwitchStatus): ProviderSwitchOperationView["status"] {
  if (status === "pending" || status === "running") return "in_progress";
  if (status === "succeeded") return "live";
  if (status === "rolling_back") return "rollback_in_progress";
  return status;
}
