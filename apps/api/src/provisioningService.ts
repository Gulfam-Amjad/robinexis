import { createHash, randomBytes } from "node:crypto";
import { compilePrompt } from "@robinexis/brain";
import {
  newId,
  type AgentInstance,
  type PlatformStore,
  type ProvisioningRun,
} from "@robinexis/database";
import {
  buildElevenLabsAgentConfig,
  type ElevenLabsManagementClient,
} from "@robinexis/integrations";

type ManagementClient = Pick<
  ElevenLabsManagementClient,
  | "createWorkspaceSecret"
  | "createTool"
  | "createAgent"
  | "updateAgent"
  | "importTwilioNumber"
  | "assignAgentToPhoneNumber"
>;

export interface ProvisionClientAgentInput {
  clientId: string;
  operationKey: string;
  apiBaseUrl: string;
  transferNumber?: string;
  twilioNumber?: string;
  twilioAccountSid?: string;
  twilioAuthToken?: string;
}

export interface ProvisionClientAgentDependencies {
  store: PlatformStore;
  elevenLabs: ManagementClient;
  now?: () => Date;
  randomSecret?: () => string;
}

export interface ProvisionClientAgentResult {
  runId: string;
  clientId: string;
  agentInstanceId: string;
  elevenlabsAgentId: string;
  providerSecretId: string;
  toolIds: string[];
  phoneNumberId?: string;
}

function credentialHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function toolHeaders(secretId: string) {
  return {
    "Content-Type": "application/json",
    "x-voice-tool-secret": { secret_id: secretId },
  };
}

function availabilityTool(apiBaseUrl: string, secretId: string) {
  return {
    type: "webhook",
    name: "check_availability",
    description: "Check this business's live calendar. Offer only returned slots.",
    api_schema: {
      url: `${apiBaseUrl}/api/v1/voice-tools/check-availability`,
      method: "POST",
      content_type: "application/json",
      request_headers: toolHeaders(secretId),
      request_body_schema: {
        type: "object",
        properties: {
          conversationId: { type: "string", description: "Stable ElevenLabs conversation ID." },
          eventTypeSlug: { type: "string", description: "Configured service slug." },
          start: { type: "string", description: "ISO 8601 range start." },
          end: { type: "string", description: "ISO 8601 range end, at most 14 days later." },
        },
        required: ["conversationId", "eventTypeSlug", "start", "end"],
      },
    },
    response_timeout_secs: 12,
  };
}

function bookingTool(apiBaseUrl: string, secretId: string) {
  return {
    type: "webhook",
    name: "create_booking",
    description: "Create a booking only after a returned slot and explicit caller confirmation.",
    api_schema: {
      url: `${apiBaseUrl}/api/v1/voice-tools/create-booking`,
      method: "POST",
      content_type: "application/json",
      request_headers: toolHeaders(secretId),
      request_body_schema: {
        type: "object",
        properties: {
          conversationId: { type: "string" },
          eventTypeSlug: { type: "string" },
          start: { type: "string" },
          attendeeName: { type: "string" },
          attendeePhone: { type: "string" },
          attendeeEmail: { type: "string" },
          attendeeTimeZone: { type: "string" },
          notes: { type: "string" },
          callerConfirmed: { type: "boolean" },
          idempotencyKey: { type: "string" },
        },
        required: [
          "conversationId",
          "eventTypeSlug",
          "start",
          "attendeeName",
          "attendeePhone",
          "callerConfirmed",
          "idempotencyKey",
        ],
      },
    },
    response_timeout_secs: 12,
  };
}

function outputOf(run: ProvisioningRun) {
  return (run.output || {}) as Record<string, unknown>;
}

async function saveStep(
  store: PlatformStore,
  run: ProvisioningRun,
  step: string,
  output: Record<string, unknown>,
  now: Date,
) {
  run.status = "running";
  run.step = step;
  run.output = output;
  run.updatedAt = now.toISOString();
  await store.saveProvisioningRun(run);
}

async function provisionClientAgentAttempt(
  input: ProvisionClientAgentInput,
  dependencies: ProvisionClientAgentDependencies,
): Promise<ProvisionClientAgentResult> {
  const { store, elevenLabs } = dependencies;
  const now = dependencies.now?.() ?? new Date();
  const apiBaseUrl = input.apiBaseUrl.replace(/\/$/, "");
  if (!input.operationKey || !apiBaseUrl.startsWith("https://")) {
    throw new Error("valid_operation_key_and_https_api_base_required");
  }
  const client = await store.getClient(input.clientId);
  if (!client) throw new Error("client_not_found");
  const calendarConnections = await store.listCalendarConnections(client.id);
  const calendar = calendarConnections.find((connection) => connection.status !== "disabled");
  if (!calendar) throw new Error("calendar_connection_required");
  if (!process.env[calendar.credentialRef] && process.env.NODE_ENV !== "test") {
    throw new Error("calendar_credential_not_configured");
  }

  let run = await store.getProvisioningRunByIdempotency(client.id, input.operationKey);
  if (run?.status === "succeeded") return run.output as unknown as ProvisionClientAgentResult;
  if (run?.status === "running") throw new Error("provisioning_already_running");
  if (!run) {
    const timestamp = now.toISOString();
    run = {
      id: newId("provision_"),
      clientId: client.id,
      idempotencyKey: input.operationKey,
      status: "pending",
      input: {
        transferConfigured: Boolean(input.transferNumber || client.transferNumber),
        twilioNumberConfigured: Boolean(input.twilioNumber),
      },
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const claimed = await store.claimProvisioningRun(run);
    if (!claimed) throw new Error("provisioning_already_claimed");
  } else {
    run.status = "pending";
    run.error = undefined;
    run.finishedAt = undefined;
  }

  const output = outputOf(run);
  const agentInstanceId = String(output.agentInstanceId || newId("agent_instance_"));
  let agent = await store.getAgentInstance(client.id, agentInstanceId);
  const rawCredential =
    dependencies.randomSecret?.() ?? randomBytes(32).toString("base64url");
  const hash = agent?.voiceCredentialHash || credentialHash(rawCredential);
  if (!agent) {
    agent = {
      id: agentInstanceId,
      clientId: client.id,
      locationId: calendar.locationId,
      provider: "elevenlabs",
      name: `${client.businessName} receptionist`,
      status: "pending",
      voiceCredentialHash: hash,
      config: { operationKey: input.operationKey },
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    await store.upsertAgentInstance(agent);
  }
  output.agentInstanceId = agent.id;
  await saveStep(store, run, "agent_recorded", output, now);

  let providerSecretId = agent.providerSecretId || String(output.providerSecretId || "");
  if (!providerSecretId) {
    // A previous attempt may have failed before ElevenLabs returned a secret
    // id. In that case the raw value is unrecoverable by design, so rotate the
    // hash to this attempt's new value before creating the provider secret.
    agent.voiceCredentialHash = credentialHash(rawCredential);
    const secret = await elevenLabs.createWorkspaceSecret(
      `robinexis-${client.slug}-${input.operationKey}`.slice(0, 120),
      rawCredential,
      `${input.operationKey}:secret`,
    );
    providerSecretId = secret.secret_id;
    if (!providerSecretId) throw new Error("elevenlabs_secret_id_missing");
    agent.providerSecretId = providerSecretId;
    agent.updatedAt = now.toISOString();
    await store.upsertAgentInstance(agent);
    output.providerSecretId = providerSecretId;
    await saveStep(store, run, "workspace_secret_created", output, now);
  }

  const toolIds = Array.isArray(output.toolIds)
    ? output.toolIds.map(String)
    : [];
  if (!toolIds[0]) {
    const created = await elevenLabs.createTool(
      availabilityTool(apiBaseUrl, providerSecretId),
      `${input.operationKey}:availability-tool`,
    );
    if (!created.tool_id) throw new Error("availability_tool_id_missing");
    toolIds[0] = created.tool_id;
    output.toolIds = toolIds;
    await saveStep(store, run, "availability_tool_created", output, now);
  }
  if (!toolIds[1]) {
    const created = await elevenLabs.createTool(
      bookingTool(apiBaseUrl, providerSecretId),
      `${input.operationKey}:booking-tool`,
    );
    if (!created.tool_id) throw new Error("booking_tool_id_missing");
    toolIds[1] = created.tool_id;
    output.toolIds = toolIds;
    await saveStep(store, run, "booking_tool_created", output, now);
  }

  const prompt = compilePrompt({
    client,
    direction: "inbound",
    objective: "Answer, book, reschedule, cancel, capture a callback, or transfer safely.",
  });
  const built = buildElevenLabsAgentConfig({
    name: `${client.businessName} receptionist`,
    firstMessage: client.greeting || `Hello, you've reached ${client.businessName}. How can I help?`,
    systemPrompt: prompt,
    externalOperationKey: input.operationKey,
    tags: ["robinexis", `client:${client.id}`],
    voiceId: client.voiceId || undefined,
    toolIds,
    transfer: (input.transferNumber || client.transferNumber)
      ? {
          phoneNumber: input.transferNumber || client.transferNumber,
          callerHoldMessage: "One moment, I'll connect you now.",
          humanOperatorSummaryMessage:
            `Robinexis receptionist transfer for ${client.businessName}. Listen for a concise summary of who is calling and why.`,
        }
      : undefined,
  });

  let providerAgentId = agent.providerAgentId || String(output.elevenlabsAgentId || "");
  if (providerAgentId) {
    await elevenLabs.updateAgent(
      providerAgentId,
      built.agentConfig,
      `${input.operationKey}:agent`,
    );
  } else {
    const created = await elevenLabs.createAgent(
      built.agentConfig,
      `${input.operationKey}:agent`,
    );
    providerAgentId = created.agent_id;
    if (!providerAgentId) throw new Error("elevenlabs_agent_id_missing");
  }
  agent.providerAgentId = providerAgentId;
  agent.status = "active";
  agent.config = { ...agent.config, toolIds, transferNumber: input.transferNumber || client.transferNumber || null };
  agent.updatedAt = now.toISOString();
  await store.upsertAgentInstance(agent);
  client.elevenlabsAgentId = providerAgentId;
  await store.upsertClient(client);
  output.elevenlabsAgentId = providerAgentId;
  await saveStep(store, run, "agent_created", output, now);

  let phoneNumberId = String(output.phoneNumberId || "");
  if (input.twilioNumber) {
    if (!input.twilioAccountSid || !input.twilioAuthToken) {
      throw new Error("twilio_credentials_required");
    }
    if (!phoneNumberId) {
      const imported = await elevenLabs.importTwilioNumber(
        {
          phoneNumber: input.twilioNumber,
          label: `${client.businessName} main line`,
          accountSid: input.twilioAccountSid,
          authToken: input.twilioAuthToken,
          agentId: providerAgentId,
          enableSms: false,
        },
        `${input.operationKey}:phone`,
      );
      phoneNumberId = imported.phone_number_id;
      if (!phoneNumberId) throw new Error("elevenlabs_phone_id_missing");
    } else {
      await elevenLabs.assignAgentToPhoneNumber(
        phoneNumberId,
        providerAgentId,
        `${input.operationKey}:phone`,
      );
    }
    await store.upsertPhoneEndpoint({
      id: `phone_${agent.id}`,
      clientId: client.id,
      locationId: agent.locationId,
      agentInstanceId: agent.id,
      provider: "twilio",
      e164: input.twilioNumber,
      providerEndpointId: phoneNumberId,
      direction: "inbound",
      status: "active",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
    client.inboundNumbers = Array.from(new Set([...client.inboundNumbers, input.twilioNumber]));
    await store.upsertClient(client);
    output.phoneNumberId = phoneNumberId;
    await saveStep(store, run, "phone_assigned", output, now);
  }

  const result: ProvisionClientAgentResult = {
    runId: run.id,
    clientId: client.id,
    agentInstanceId: agent.id,
    elevenlabsAgentId: providerAgentId,
    providerSecretId,
    toolIds,
    ...(phoneNumberId ? { phoneNumberId } : {}),
  };
  run.status = "succeeded";
  run.step = "complete";
  run.output = result as unknown as Record<string, unknown>;
  run.finishedAt = now.toISOString();
  run.updatedAt = now.toISOString();
  await store.saveProvisioningRun(run);
  return result;
}

export async function provisionClientAgent(
  input: ProvisionClientAgentInput,
  dependencies: ProvisionClientAgentDependencies,
): Promise<ProvisionClientAgentResult> {
  try {
    return await provisionClientAgentAttempt(input, dependencies);
  } catch (error) {
    if (error instanceof Error && error.message === "provisioning_already_running") throw error;
    const run = await dependencies.store.getProvisioningRunByIdempotency(
      input.clientId,
      input.operationKey,
    );
    if (run && run.status !== "succeeded") {
      const now = dependencies.now?.() ?? new Date();
      run.status = "failed";
      run.error = error instanceof Error ? error.message : "provisioning_failed";
      run.finishedAt = now.toISOString();
      run.updatedAt = now.toISOString();
      await dependencies.store.saveProvisioningRun(run);
    }
    throw error;
  }
}

export function hashVoiceToolCredential(value: string): string {
  return credentialHash(value);
}
