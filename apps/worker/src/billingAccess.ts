import {
  BLADES_HAIR_ID,
  isAiServiceEnabled,
  newId,
  type PlatformStore,
} from "@robinexis/database";
import {
  ElevenLabsManagementClient,
  LiveKitVoiceProviderAdapter,
  TwilioVoiceRoutingClient,
  type VoiceProviderAdapter,
} from "@robinexis/integrations";

type PhoneAssignmentManager = Pick<
  ElevenLabsManagementClient,
  "assignAgentToPhoneNumber" | "unassignAgentFromPhoneNumber"
>;

/**
 * Reconciles plan access against the actual ElevenLabs phone assignment.
 * Unassigning keeps the customer's imported Twilio number recoverable.
 */
export async function reconcileBillingAccess(
  store: PlatformStore,
  options: {
    management?: PhoneAssignmentManager;
    livekitAdapter?: Pick<VoiceProviderAdapter, "suspend" | "restore">;
    now?: Date;
  } = {},
) {
  const management = options.management || (process.env.ELEVENLABS_API_KEY
    ? new ElevenLabsManagementClient({ apiKey: process.env.ELEVENLABS_API_KEY })
    : undefined);
  const livekitAdapter = options.livekitAdapter || (
    process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
      ? new LiveKitVoiceProviderAdapter(
        new TwilioVoiceRoutingClient(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN),
      )
      : undefined
  );
  if (!management && !livekitAdapter) {
    return { skipped: "voice_provider_management_not_configured", suspended: 0, restored: 0, failed: 0 };
  }
  const now = options.now || new Date();
  const result = { suspended: 0, restored: 0, failed: 0 };

  for (const client of await store.listClients()) {
    if (client.id === BLADES_HAIR_ID) continue;
    const activeDeployment = await store.getActiveProviderDeployment(client.id);
    const activeProvider = activeDeployment?.provider || client.voicePipeline;
    if (activeProvider === "livekit-cascade") {
      if (!activeDeployment || !livekitAdapter) continue;
      const entitlement = await billingEntitlement(store, client, now);
      const assignmentState = String(activeDeployment.config.assignmentState || "assigned");
      try {
        const context = {
          client,
          deployment: activeDeployment,
          operationKey: `billing-access:${client.id}:${activeDeployment.id}`,
          now: now.toISOString(),
        };
        if (entitlement.shouldAssign && assignmentState === "suspended") {
          await livekitAdapter.restore(context, {
            provider: "livekit-cascade",
            phoneNumberId: String(activeDeployment.config.phoneNumberId || ""),
            capturedAt: now.toISOString(),
          });
          activeDeployment.config = { ...activeDeployment.config, assignmentState: "assigned", accessReason: entitlement.reason };
          result.restored += 1;
          await audit(store, client.id, activeDeployment.id, "restored", entitlement.reason, now, "livekit-cascade");
        } else if (!entitlement.shouldAssign && assignmentState !== "suspended") {
          await livekitAdapter.suspend(context);
          activeDeployment.config = { ...activeDeployment.config, assignmentState: "suspended", accessReason: entitlement.reason };
          result.suspended += 1;
          await audit(store, client.id, activeDeployment.id, "suspended", entitlement.reason, now, "livekit-cascade");
        } else {
          continue;
        }
        activeDeployment.updatedAt = now.toISOString();
        await store.upsertProviderDeployment(activeDeployment);
      } catch (error) {
        activeDeployment.config = { ...activeDeployment.config, billingAccessError: String(error).slice(0, 500) };
        activeDeployment.updatedAt = now.toISOString();
        await store.upsertProviderDeployment(activeDeployment);
        result.failed += 1;
      }
      continue;
    }
    if (!management) continue;
    const resources = (await store.listProviderResources(client.id))
      .filter((resource) =>
        resource.provider === "elevenlabs" &&
        resource.resourceType === "phone_number" &&
        resource.providerResourceId &&
        resource.lifecycleStatus === "active");
    if (!resources.length) continue;

    const { shouldAssign, reason } = await billingEntitlement(store, client, now);

    for (const resource of resources) {
      const assignmentState = String(resource.metadata.assignmentState || "assigned");
      const agentId = String(resource.metadata.agentId || "");
      try {
        if (shouldAssign && assignmentState === "suspended") {
          if (!agentId) throw new Error("agent_id_missing");
          await management.assignAgentToPhoneNumber(
            resource.providerResourceId!,
            agentId,
            `billing-restore:${client.id}:${resource.id}`,
          );
          resource.metadata = {
            ...resource.metadata,
            assignmentState: "assigned",
            accessReason: reason,
            restoredAt: now.toISOString(),
          };
          result.restored += 1;
          await audit(store, client.id, resource.id, "restored", reason, now);
        } else if (!shouldAssign && assignmentState !== "suspended") {
          await management.unassignAgentFromPhoneNumber(
            resource.providerResourceId!,
            `billing-suspend:${client.id}:${resource.id}`,
          );
          resource.metadata = {
            ...resource.metadata,
            assignmentState: "suspended",
            accessReason: reason,
            suspendedAt: now.toISOString(),
          };
          result.suspended += 1;
          await audit(store, client.id, resource.id, "suspended", reason, now);
        } else {
          continue;
        }
        resource.lastError = undefined;
        resource.updatedAt = now.toISOString();
        await store.upsertProviderResource(resource);
      } catch (error) {
        resource.lastError = String(error).slice(0, 500);
        resource.updatedAt = now.toISOString();
        await store.upsertProviderResource(resource);
        result.failed += 1;
      }
    }
  }
  return result;
}

async function audit(
  store: PlatformStore,
  clientId: string,
  resourceId: string,
  action: "suspended" | "restored",
  reason: string,
  now: Date,
  provider = "elevenlabs-convai",
) {
  await store.appendOperatorAudit({
    id: newId("audit_"),
    clientId,
    actorId: "billing-access-worker",
    action: `billing.phone_assignment_${action}`,
    detail: { resourceId, reason, provider },
    createdAt: now.toISOString(),
  });
}

async function billingEntitlement(
  store: PlatformStore,
  client: Parameters<typeof isAiServiceEnabled>[0] & { id: string },
  now: Date,
) {
  const subscription = await store.getCurrentSubscription(client.id);
  const access = isAiServiceEnabled(client);
  const trialExpired = Boolean(
    subscription?.status === "trialing" &&
    subscription.trialEndsAt &&
    Date.parse(subscription.trialEndsAt) <= now.getTime(),
  );
  const creditsExhausted = subscription?.provider === "stripe"
    ? await store.getCreditBalance(client.id) <= 0
    : false;
  return {
    shouldAssign: access.inbound && !trialExpired && !creditsExhausted,
    reason: !access.inbound
      ? access.reason
      : trialExpired
        ? "trial_expired"
        : creditsExhausted
          ? "minute_allowance_exhausted"
          : "entitled",
  };
}
