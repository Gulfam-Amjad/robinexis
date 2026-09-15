import { createHash, randomBytes } from "node:crypto";
import { compilePrompt } from "@robinexis/brain";
import {
  assertOnboardingTransition,
  BLADES_HAIR_ID,
  newId,
  type CalendarEventType,
  type ClientConfig,
  type AgentInstance,
  type PlatformStore,
  type ProvisioningRun,
  type ProvisioningReadinessReport,
} from "@robinexis/database";
import {
  buildElevenLabsAgentConfig,
  calcom,
  resolveCalcomTenantConnection,
  decryptTwilioCredential,
  findOwnedTwilioNumber,
  PROTECTED_TWILIO_NUMBER,
  PROTECTED_TWILIO_RESOURCE_IDS,
  PROTECTED_TWILIO_TENANT_IDS,
  type ElevenLabsManagementClient,
} from "@robinexis/integrations";

type ManagementClient = Pick<
  ElevenLabsManagementClient,
  | "createWorkspaceSecret"
  | "createTool"
  | "createAgent"
  | "updateAgent"
>;

export interface ProvisionClientAgentInput {
  clientId: string;
  operationKey: string;
  apiBaseUrl: string;
  transferNumber?: string;
  twilioNumber?: string;
  twilioAccountSid?: string;
  twilioAuthToken?: string;
  phoneMode?: "robinexis_account" | "customer_oauth";
}

export interface ProvisionClientAgentDependencies {
  store: PlatformStore;
  elevenLabs: ManagementClient;
  now?: () => Date;
  randomSecret?: () => string;
  calendar?: {
    listEventTypes: typeof calcom.listEventTypes;
    createEventType: typeof calcom.createEventType;
    updateEventType: typeof calcom.updateEventType;
  };
  phone?: {
    findOwned: typeof findOwnedTwilioNumber;
  };
  readiness?: {
    authenticate: (clientId: string, credential: {
      providerSecretId: string;
      expectedCredentialHash: string;
    }) => Promise<boolean>;
    checkAvailability: (input: {
      client: ClientConfig;
      providerEventTypeSlug: string;
      start: string;
      end: string;
    }) => Promise<{ slots: string[] }>;
    createBooking: (input: {
      client: ClientConfig;
      providerEventTypeSlug: string;
      start: string;
      conversationId: string;
    }) => Promise<{ uid?: string; status: string }>;
    cancelBooking: (input: {
      client: ClientConfig;
      bookingUid: string;
    }) => Promise<{ status: string }>;
    testCallLink?: (providerAgentId: string) => string | undefined;
  };
}

export interface ProvisionClientAgentResult {
  runId: string;
  clientId: string;
  agentInstanceId: string;
  elevenlabsAgentId: string;
  providerSecretId: string;
  toolIds: string[];
  phoneNumberId?: string;
  phoneNumber?: string;
  calendarEventTypes?: Array<{ serviceSlug: string; providerSlug: string; providerEventTypeId: string }>;
  readinessReport: ProvisioningReadinessReport;
}

async function assertConfirmedProvisioningProfile(store: PlatformStore, clientId: string) {
  const wizard = await store.getOnboardingWizard(clientId);
  if (!wizard?.submittedAt || !wizard.data.websiteRunId) throw new Error("confirmed_profile_required");
  const run = await store.getWebsiteExtractionRun(clientId, wizard.data.websiteRunId);
  if (!run || run.status !== "succeeded") throw new Error("approved_knowledge_required");
  const source = await store.getWebsiteSource(clientId, run.sourceId);
  const facts = await store.listExtractedFacts(clientId, run.id);
  if (
    source?.metadata.approvedRunId !== run.id ||
    !facts.length ||
    facts.some((fact) => fact.reviewStatus === "extracted")
  ) throw new Error("approved_knowledge_required");
  const hardGaps = (await store.listOnboardingGaps(clientId))
    .filter((gap) => gap.status === "open").map((gap) => gap.key);
  if (hardGaps.length) throw new Error(`hard_onboarding_gaps:${hardGaps.join(",")}`);
  return { wizard, facts, hardGaps };
}

function readinessAdapter(
  store: PlatformStore,
  configured: ProvisionClientAgentDependencies["readiness"],
) {
  if (configured) return configured;
  return {
    authenticate: async (clientId: string, credential: {
      providerSecretId: string; expectedCredentialHash: string;
    }) => {
      const agent = (await store.listAgentInstances(clientId)).find((candidate) =>
        candidate.providerSecretId === credential.providerSecretId);
      return agent?.voiceCredentialHash === credential.expectedCredentialHash;
    },
    checkAvailability: async (input: {
      client: ClientConfig; providerEventTypeSlug: string; start: string; end: string;
    }) => {
      const { tenant } = await resolveCalcomTenantConnection(store, input.client);
      return calcom.checkAvailability(tenant, {
        eventTypeSlug: input.providerEventTypeSlug, start: input.start, end: input.end,
      });
    },
    createBooking: async (input: {
      client: ClientConfig; providerEventTypeSlug: string; start: string; conversationId: string;
    }) => {
      const { tenant } = await resolveCalcomTenantConnection(store, input.client);
      const email = await calcom.fetchAccountEmail(tenant);
      if (!email) throw new Error("synthetic_booking_email_unavailable");
      return calcom.createBooking(tenant, {
        eventTypeSlug: input.providerEventTypeSlug,
        start: input.start,
        attendeeName: "Robinexis readiness test",
        attendeeEmail: email,
        attendeeTimeZone: input.client.callingWindow.tz,
        notes: "Synthetic readiness booking; cancel immediately.",
        conversationId: input.conversationId,
      });
    },
    cancelBooking: async (input: { client: ClientConfig; bookingUid: string }) => {
      const { tenant } = await resolveCalcomTenantConnection(store, input.client);
      return calcom.cancelBooking(tenant, input.bookingUid);
    },
  };
}

function providerServiceSlug(clientSlug: string, serviceSlug: string) {
  return `${clientSlug}-${serviceSlug}`
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
}

async function provisionCalendarEventTypes(
  store: PlatformStore,
  client: ClientConfig,
  calendarConnectionId: string,
  adapter: ProvisionClientAgentDependencies["calendar"],
  now: Date,
  external: <T>(call: () => Promise<T>) => Promise<T>,
): Promise<CalendarEventType[]> {
  if (!client || !client.services.length) throw new Error("at_least_one_service_required");
  const tenant = adapter
    ? { apiKey: "injected-calendar-adapter", username: client.slug }
    : (await external(() => resolveCalcomTenantConnection(store, client))).tenant;
  const existingMappings = await store.listCalendarEventTypes(client.id);
  const remote = await external(() => (adapter || calcom).listEventTypes(tenant));
  const results: CalendarEventType[] = [];
  for (const service of client.services) {
    const providerSlug = providerServiceSlug(client.slug, service.slug);
    const mapping = existingMappings.find((item) => item.serviceSlug === service.slug);
    const remoteEvent = remote.find((item) =>
      String(item.id) === mapping?.providerEventTypeId || item.slug === providerSlug);
    const savedRemote = remoteEvent
        ? await external(() => (adapter || calcom).updateEventType(tenant, remoteEvent.id, {
            title: `${client.businessName} — ${service.title}`,
            slug: providerSlug,
            durationMinutes: service.durationMinutes,
            bufferBeforeMinutes: client.calendar.schedule?.bufferBeforeMinutes,
            bufferAfterMinutes: client.calendar.schedule?.bufferAfterMinutes,
            minimumNoticeMinutes: client.calendar.schedule?.minimumNoticeMinutes,
          }))
        : await external(() => (adapter || calcom).createEventType(tenant, {
            title: `${client.businessName} — ${service.title}`,
            slug: providerSlug,
            durationMinutes: service.durationMinutes,
            bufferBeforeMinutes: client.calendar.schedule?.bufferBeforeMinutes,
            bufferAfterMinutes: client.calendar.schedule?.bufferAfterMinutes,
            minimumNoticeMinutes: client.calendar.schedule?.minimumNoticeMinutes,
          }));
    const row: CalendarEventType = {
      id: mapping?.id || newId("calendar_event_"),
      clientId: client.id,
      calendarConnectionId,
      serviceSlug: service.slug,
      providerEventTypeId: String(savedRemote.id),
      providerSlug: savedRemote.slug,
      title: service.title,
      durationMinutes: service.durationMinutes,
      status: "active",
      readinessOnly: false,
      createdAt: mapping?.createdAt || now.toISOString(),
      updatedAt: now.toISOString(),
    };
    await store.upsertCalendarEventType(row);
    results.push(row);
  }
  const readinessSlug = providerServiceSlug(client.slug, "robinexis-readiness-test");
  const readinessMapping = existingMappings.find((item) => item.readinessOnly);
  const remoteReadiness = remote.find((item) =>
    String(item.id) === readinessMapping?.providerEventTypeId || item.slug === readinessSlug);
  const savedReadiness = remoteReadiness
    ? await external(() => (adapter || calcom).updateEventType(tenant, remoteReadiness.id, {
        title: `${client.businessName} — Robinexis readiness test`,
        slug: readinessSlug,
        durationMinutes: 15,
        minimumNoticeMinutes: client.calendar.schedule?.minimumNoticeMinutes,
      }))
    : await external(() => (adapter || calcom).createEventType(tenant, {
        title: `${client.businessName} — Robinexis readiness test`,
        slug: readinessSlug,
        durationMinutes: 15,
        minimumNoticeMinutes: client.calendar.schedule?.minimumNoticeMinutes,
      }));
  const readinessRow: CalendarEventType = {
    id: readinessMapping?.id || newId("calendar_readiness_"),
    clientId: client.id,
    calendarConnectionId,
    serviceSlug: "__robinexis_readiness__",
    providerEventTypeId: String(savedReadiness.id),
    providerSlug: savedReadiness.slug,
    title: "Robinexis readiness test",
    durationMinutes: 15,
    status: "active",
    readinessOnly: true,
    createdAt: readinessMapping?.createdAt || now.toISOString(),
    updatedAt: now.toISOString(),
  };
  await store.upsertCalendarEventType(readinessRow);
  results.push(readinessRow);
  return results;
}

function credentialHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function testedProfile(client: ClientConfig) {
  const {
    onboardingStatus: _onboardingStatus,
    onboardingNotes: _onboardingNotes,
    onboardingEta: _onboardingEta,
    elevenlabsAgentId: _elevenlabsAgentId,
    inboundNumbers: _inboundNumbers,
    published: _published,
    promptVersionId: _promptVersionId,
    ...profile
  } = client;
  return profile;
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

function resultOf(output: Record<string, unknown>): ProvisionClientAgentResult {
  return {
    runId: String(output.runId),
    clientId: String(output.clientId),
    agentInstanceId: String(output.agentInstanceId),
    elevenlabsAgentId: String(output.elevenlabsAgentId),
    providerSecretId: String(output.providerSecretId),
    toolIds: Array.isArray(output.toolIds) ? output.toolIds.map(String) : [],
    ...(output.phoneNumberId ? { phoneNumberId: String(output.phoneNumberId) } : {}),
    ...(output.phoneNumber ? { phoneNumber: String(output.phoneNumber) } : {}),
    calendarEventTypes: output.calendarEventTypes as ProvisionClientAgentResult["calendarEventTypes"],
    readinessReport: output.readinessReport as ProvisioningReadinessReport,
  };
}

async function saveStep(
  store: PlatformStore,
  run: ProvisioningRun,
  step: string,
  output: Record<string, unknown>,
  now: Date,
) {
  const timestamp = new Date(Math.max(now.getTime(), Date.parse(run.updatedAt || now.toISOString())))
    .toISOString();
  run.status = "running";
  run.startedAt ||= timestamp;
  run.step = step;
  run.output = output;
  run.updatedAt = timestamp;
  const saved = await store.saveProvisioningRun(run, run.claimToken);
  if (!saved) throw new Error("provisioning_claim_lost");
}

async function fencedExternalCall<T>(
  store: PlatformStore,
  run: ProvisioningRun,
  claimToken: string,
  now: () => Date,
  call: () => Promise<T>,
): Promise<T> {
  const before = now().toISOString();
  if (!await store.renewProvisioningRunClaim(run.clientId, run.id, claimToken, before)) {
    throw new Error("provisioning_claim_lost");
  }
  run.updatedAt = before;
  const result = await call();
  const after = now().toISOString();
  if (!await store.renewProvisioningRunClaim(run.clientId, run.id, claimToken, after)) {
    throw new Error("provisioning_claim_lost");
  }
  run.updatedAt = after;
  return result;
}

async function provisionClientAgentAttempt(
  input: ProvisionClientAgentInput,
  dependencies: ProvisionClientAgentDependencies,
  claimToken: string,
): Promise<ProvisionClientAgentResult> {
  const { store, elevenLabs } = dependencies;
  const now = dependencies.now?.() ?? new Date();
  const apiBaseUrl = input.apiBaseUrl.replace(/\/$/, "");
  if (!input.operationKey || !apiBaseUrl.startsWith("https://")) {
    throw new Error("valid_operation_key_and_https_api_base_required");
  }
  const liveClient = await store.getClient(input.clientId);
  if (!liveClient) throw new Error("client_not_found");
  if (
    liveClient.id === BLADES_HAIR_ID ||
    PROTECTED_TWILIO_TENANT_IDS.has(liveClient.id) ||
    PROTECTED_TWILIO_TENANT_IDS.has(liveClient.slug) ||
    liveClient.inboundNumbers.includes(PROTECTED_TWILIO_NUMBER) ||
    Boolean(liveClient.elevenlabsAgentId &&
      PROTECTED_TWILIO_RESOURCE_IDS.has(liveClient.elevenlabsAgentId)) ||
    input.twilioNumber === PROTECTED_TWILIO_NUMBER ||
    liveClient.requestedPhoneNumber === PROTECTED_TWILIO_NUMBER
  ) throw new Error("protected_blades_automation_target");
  const draft = await store.getDraftClient(input.clientId);
  const client = structuredClone(draft?.config || liveClient);
  const selfServeProvisioning = Boolean(
    client.onboardingStatus || input.phoneMode || client.phoneAcquisitionMode,
  );
  if (selfServeProvisioning) {
    await assertConfirmedProvisioningProfile(store, client.id);
    const subscription = await store.getCurrentSubscription(client.id);
    if (!subscription || !["active", "trialing"].includes(subscription.status)) {
      throw new Error("active_subscription_required");
    }
    if (
      !client.businessName.trim() ||
      !client.transferNumber.match(/^\+[1-9]\d{7,14}$/) ||
      !client.services.length ||
      !client.greeting?.trim()
    ) {
      throw new Error("complete_business_details_required");
    }
  }
  const calendarConnections = await store.listCalendarConnections(client.id);
  const calendar = calendarConnections.find((connection) => connection.status === "active");
  if (!calendar) throw new Error("calendar_connection_required");

  let run = await store.getProvisioningRunByIdempotency(client.id, input.operationKey);
  if (run?.status === "succeeded") return resultOf(outputOf(run));
  if (run?.status === "paused") throw new Error("provisioning_paused");
  if (!run) {
    const timestamp = now.toISOString();
    run = {
      id: newId("provision_"),
      clientId: client.id,
      idempotencyKey: input.operationKey,
      status: "running",
      input: {
        transferConfigured: Boolean(input.transferNumber || client.transferNumber),
        twilioNumberConfigured: Boolean(input.twilioNumber),
      },
      createdAt: timestamp,
      updatedAt: timestamp,
      claimToken,
    };
  } else {
    run = {
      ...run,
      status: "running",
      error: undefined,
      finishedAt: undefined,
      claimToken,
    };
  }
  const claimed = await store.claimProvisioningRun(
    run,
    claimToken,
    Math.max(60, Number(process.env.PROVISIONING_RUN_STALE_SECONDS) || 1800),
  );
  if (!claimed) throw new Error("provisioning_already_running");
  const external = <T>(call: () => Promise<T>) =>
    fencedExternalCall(store, run, claimToken, dependencies.now || (() => new Date()), call);

  const output = outputOf(run);
  const compiledPrompt = compilePrompt({
    client,
    direction: "inbound",
    objective: "Answer, book, reschedule, cancel, capture a callback, or transfer safely.",
  });
  const profileChecksum = createHash("sha256")
    .update(JSON.stringify({ client: testedProfile(client), compiledPrompt }))
    .digest("hex");
  if (!output.compiledPrompt) {
    output.compiledPrompt = compiledPrompt;
    output.profileChecksum = profileChecksum;
    await saveStep(store, run, "profile_and_knowledge_compiled", output, now);
  } else if (output.profileChecksum !== profileChecksum) {
    throw new Error("provisioning_profile_changed_start_new_operation");
  }
  if (selfServeProvisioning) {
    // Pre-lifecycle tenants had no status; completed readiness checks make
    // ready_to_provision the safe compatibility baseline.
    assertOnboardingTransition(client.onboardingStatus ?? "ready_to_provision", "provisioning");
    client.onboardingStatus = "provisioning";
    await store.upsertClient(client);
  }

  let calendarEventTypes = await store.listCalendarEventTypes(client.id);
  if (
    calendarEventTypes.filter((item) => !item.readinessOnly).length < client.services.length ||
    !calendarEventTypes.some((item) => item.readinessOnly)
  ) {
    calendarEventTypes = await provisionCalendarEventTypes(
      store,
      client,
      calendar.id,
      dependencies.calendar,
      now,
      external,
    );
    output.calendarEventTypes = calendarEventTypes.map((item) => ({
      serviceSlug: item.serviceSlug,
      providerSlug: item.providerSlug,
      providerEventTypeId: item.providerEventTypeId,
    }));
    await saveStep(store, run, "calendar_event_types_created", output, now);
  }

  const phoneMode = input.phoneMode || client.phoneAcquisitionMode;
  const twilioNumber =
    input.twilioNumber ||
    client.requestedPhoneNumber ||
    (phoneMode ? client.inboundNumbers[0] : undefined);
  let twilioProviderSid = String(output.twilioProviderSid || "");
  if (phoneMode) {
    if (!twilioNumber) throw new Error("customer_purchased_twilio_number_required");
    let verificationCredentials:
      | { accountSid: string; apiKeySid: string; apiKeySecret: string }
      | undefined;
    if (phoneMode === "customer_oauth") {
      const connection = await store.getTwilioConnection(client.id);
      if (
        !connection ||
        connection.status !== "active" ||
        !connection.accountSid ||
        !connection.apiKeySid ||
        !connection.encryptedApiKeySecret
      ) {
        throw new Error("customer_twilio_connection_required");
      }
      const providerAuthToken = decryptTwilioCredential(connection.encryptedApiKeySecret);
      verificationCredentials = {
        accountSid: connection.accountSid,
        apiKeySid: connection.apiKeySid,
        apiKeySecret: providerAuthToken,
      };
    }
    const owned = await external(() =>
      (dependencies.phone?.findOwned || findOwnedTwilioNumber)(
        twilioNumber,
        verificationCredentials,
      ));
    if (!owned) throw new Error("twilio_number_transfer_or_connect_required");
    twilioProviderSid = owned.sid || "";
    output.twilioProviderSid = twilioProviderSid;
    output.twilioNumber = twilioNumber;
    if (phoneMode === "robinexis_account") {
      const existingConnection = await store.getTwilioConnection(client.id);
      await store.upsertTwilioConnection({
        id: existingConnection?.id || `twilio_${client.id}`,
        clientId: client.id,
        mode: "robinexis_account",
        accountSid: input.twilioAccountSid || process.env.TWILIO_ACCOUNT_SID,
        selectedPhoneNumber: twilioNumber,
        status: "active",
        metadata: {
          ...(existingConnection?.metadata || {}),
          verifiedProviderSid: twilioProviderSid,
        },
        createdAt: existingConnection?.createdAt || now.toISOString(),
        updatedAt: now.toISOString(),
      });
    }
    await saveStep(store, run, "twilio_number_verified", output, now);
  }

  const existingAgent = (await store.listAgentInstances(client.id))
    .find((item) => item.provider === "elevenlabs" && item.status !== "disabled");
  const agentInstanceId = String(output.agentInstanceId || existingAgent?.id || newId("agent_instance_"));
  let agent = await store.getAgentInstance(client.id, agentInstanceId);
  const rawCredential = dependencies.randomSecret?.() ?? randomBytes(32).toString("base64url");
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
    const secret = await external(() => elevenLabs.createWorkspaceSecret(
      `robinexis-${client.slug}-${input.operationKey}`.slice(0, 120),
      rawCredential,
      `${input.operationKey}:secret`,
    ));
    providerSecretId = secret.secret_id;
    if (!providerSecretId) throw new Error("elevenlabs_secret_id_missing");
    agent.providerSecretId = providerSecretId;
    agent.updatedAt = now.toISOString();
    await store.upsertAgentInstance(agent);
    output.providerSecretId = providerSecretId;
    await saveStep(store, run, "workspace_secret_created", output, now);
  }
  const voiceCredentialHash = agent.voiceCredentialHash;
  if (!voiceCredentialHash) throw new Error("voice_credential_hash_missing");

  const persistedToolIds = Array.isArray(agent.config.toolIds)
    ? agent.config.toolIds.map(String)
    : [];
  const toolIds = Array.isArray(output.toolIds)
    ? output.toolIds.map(String)
    : persistedToolIds;
  if (!toolIds[0]) {
    const created = await external(() => elevenLabs.createTool(
      availabilityTool(apiBaseUrl, providerSecretId),
      `${input.operationKey}:availability-tool`,
    ));
    if (!created.tool_id) throw new Error("availability_tool_id_missing");
    toolIds[0] = created.tool_id;
    output.toolIds = toolIds;
    await saveStep(store, run, "availability_tool_created", output, now);
  }
  if (!toolIds[1]) {
    const created = await external(() => elevenLabs.createTool(
      bookingTool(apiBaseUrl, providerSecretId),
      `${input.operationKey}:booking-tool`,
    ));
    if (!created.tool_id) throw new Error("booking_tool_id_missing");
    toolIds[1] = created.tool_id;
    output.toolIds = toolIds;
    await saveStep(store, run, "booking_tool_created", output, now);
  }

  const built = buildElevenLabsAgentConfig({
    name: `${client.businessName} receptionist`,
    firstMessage: client.greeting || `Hello, you've reached ${client.businessName}. How can I help?`,
    systemPrompt: String(output.compiledPrompt),
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
    await external(() => elevenLabs.updateAgent(
      providerAgentId,
      built.agentConfig,
      `${input.operationKey}:agent`,
    ));
  } else {
    const created = await external(() => elevenLabs.createAgent(
      built.agentConfig,
      `${input.operationKey}:agent`,
    ));
    providerAgentId = created.agent_id;
    if (!providerAgentId) throw new Error("elevenlabs_agent_id_missing");
  }
  agent.providerAgentId = providerAgentId;
  agent.status = "pending";
  agent.config = { ...agent.config, toolIds, transferNumber: input.transferNumber || client.transferNumber || null };
  agent.updatedAt = now.toISOString();
  await store.upsertAgentInstance(agent);
  client.elevenlabsAgentId = providerAgentId;
  await store.upsertClient(client);
  output.elevenlabsAgentId = providerAgentId;
  await saveStep(store, run, "isolated_agent_staged", output, now);

  if (twilioNumber) {
    await store.upsertPhoneEndpoint({
      id: `phone_${agent.id}`,
      clientId: client.id,
      locationId: agent.locationId,
      agentInstanceId: agent.id,
      provider: "twilio",
      e164: twilioNumber,
      direction: "inbound",
      status: "pending",
      metadata: {
        acquisitionMode: phoneMode || "robinexis_account",
        twilioSid: twilioProviderSid || null,
        verifiedAt: now.toISOString(),
        assignmentStatus: "awaiting_owner_approval",
      },
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
    client.inboundNumbers = Array.from(new Set([...client.inboundNumbers, twilioNumber]));
    await store.upsertClient(client);
    await saveStep(store, run, "verified_twilio_number_staged", output, now);
  }

  const tests = readinessAdapter(store, dependencies.readiness);
  const checks: ProvisioningReadinessReport["checks"] = [];
  const authAlreadyPassed = output.toolAuthPassed === true;
  const authPassed = authAlreadyPassed || await external(() => tests.authenticate(client.id, {
    providerSecretId,
    expectedCredentialHash: voiceCredentialHash,
  }));
  checks.push({
    key: "tool_auth",
    status: authPassed ? "passed" : "failed",
    detail: authPassed ? "Tenant tool credential resolves only to this workspace." : "Tenant tool authentication failed.",
  });
  if (!authPassed) throw new Error("synthetic_tool_auth_failed");
  output.toolAuthPassed = true;
  await saveStep(store, run, "tool_auth_verified", output, now);

  const dedicatedEventType = calendarEventTypes.find((item) => item.readinessOnly);
  const eventType = dedicatedEventType;
  if (!eventType) throw new Error("dedicated_readiness_event_type_required");
  const startRange = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  const endRange = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();
  const availability = await external(() => tests.checkAvailability({
    client,
    providerEventTypeSlug: eventType.providerSlug,
    start: startRange,
    end: endRange,
  }));
  checks.push({
    key: "tool_availability",
    status: availability.slots.length ? "passed" : "failed",
    detail: availability.slots.length
      ? `Availability returned ${availability.slots.length} slot(s).`
      : "Availability returned no safe synthetic slot.",
  });
  if (!availability.slots[0]) throw new Error("synthetic_availability_failed");

  const conversationId = `readiness_${run.id}`;
  let syntheticUid = typeof output.syntheticBookingUid === "string"
    ? output.syntheticBookingUid
    : undefined;
  let syntheticCancelled = output.syntheticBookingCancelled === true;
  try {
    if (!syntheticUid) {
      const booking = await external(() => tests.createBooking({
        client,
        providerEventTypeSlug: eventType.providerSlug,
        start: availability.slots[0],
        conversationId,
      }));
      syntheticUid = booking.uid;
      if (!syntheticUid) throw new Error("synthetic_booking_id_missing");
      output.syntheticBookingUid = syntheticUid;
      output.syntheticBookingCancelled = false;
      await saveStep(store, run, "synthetic_booking_created", output, now);
    }
    checks.push({ key: "tool_booking", status: "passed", detail: "Synthetic booking was created." });
  } finally {
    if (syntheticUid && !syntheticCancelled) {
      let cancellationError: unknown;
      for (let attempt = 0; attempt < 3 && !syntheticCancelled; attempt += 1) {
        try {
          const cancelled = await external(() =>
            tests.cancelBooking({ client, bookingUid: syntheticUid! }));
          syntheticCancelled = cancelled.status === "cancelled";
        } catch (error) {
          cancellationError = error;
        }
      }
      if (!syntheticCancelled) {
        run.status = "paused";
        run.step = "synthetic_booking_cleanup_required";
        run.error = `synthetic_booking_cleanup_failed:${String(cancellationError || "not_cancelled")}`;
        run.output = output;
        run.updatedAt = (dependencies.now?.() ?? new Date()).toISOString();
        await store.saveProvisioningRun(run, claimToken);
        if (client.onboardingStatus) {
          assertOnboardingTransition(client.onboardingStatus, "needs_attention");
          client.onboardingStatus = "needs_attention";
          await store.upsertClient(client);
        }
        throw new Error(`synthetic_booking_cleanup_failed:${String(cancellationError || "not_cancelled")}`);
      }
      output.syntheticBookingCancelled = true;
      await saveStep(store, run, "synthetic_booking_cancelled", output, now);
    }
  }
  checks.push({
    key: "tool_booking_cleanup",
    status: syntheticCancelled ? "passed" : "failed",
    detail: syntheticCancelled ? "Synthetic booking was cancelled immediately." : "Synthetic booking cleanup failed.",
  });
  const webOrigin = (process.env.WEB_ORIGIN || "").split(",")[0]?.trim().replace(/\/$/, "");
  const safeTestCallLink = webOrigin?.startsWith("https://")
    ? `${webOrigin}/app/playground?clientId=${encodeURIComponent(client.id)}`
    : undefined;
  const readinessReport: ProvisioningReadinessReport = {
    generatedAt: now.toISOString(),
    passed: checks.every((check) => check.status === "passed") && syntheticCancelled,
    hardGaps: [],
    checks,
    syntheticBooking: {
      providerBookingId: syntheticUid,
      created: Boolean(syntheticUid),
      cancelled: syntheticCancelled,
    },
    testCallLink: tests.testCallLink?.(providerAgentId) || safeTestCallLink,
  };
  output.readinessReport = readinessReport;
  await saveStep(store, run, "readiness_tests_passed", output, now);

  const result: ProvisionClientAgentResult = {
    runId: run.id,
    clientId: client.id,
    agentInstanceId: agent.id,
    elevenlabsAgentId: providerAgentId,
    providerSecretId,
    toolIds,
    ...(twilioNumber ? { phoneNumber: twilioNumber } : {}),
    calendarEventTypes: calendarEventTypes.map((item) => ({
      serviceSlug: item.serviceSlug,
      providerSlug: item.providerSlug,
      providerEventTypeId: item.providerEventTypeId,
    })),
    readinessReport,
  };
  if (selfServeProvisioning) {
    const stagedPhone = (await store.listPhoneEndpoints(client.id))
      .some((endpoint) => endpoint.status === "pending" && endpoint.direction !== "outbound" &&
        endpoint.metadata.assignmentStatus === "awaiting_owner_approval");
    const completeCalendar = calendarEventTypes.length >= client.services.length &&
      calendarEventTypes.every((eventType) => eventType.status === "active");
    if (!completeCalendar || !agent.providerAgentId || !stagedPhone || !readinessReport.passed) {
      throw new Error("provisioning_readiness_gate_failed");
    }
    assertOnboardingTransition(client.onboardingStatus, "testing");
    client.onboardingStatus = "testing";
    await store.upsertClient(client);
    assertOnboardingTransition(client.onboardingStatus, "awaiting_approval");
    client.onboardingStatus = "awaiting_approval";
    await store.upsertClient(client);
  }
  run.status = "succeeded";
  run.step = "awaiting_approval";
  run.output = {
    ...output,
    ...(result as unknown as Record<string, unknown>),
    readinessReport,
    profileChecksum,
    compiledPrompt,
    phoneAssignment: twilioNumber ? {
      providerAgentId,
      status: "awaiting_owner_approval",
    } : undefined,
  };
  run.finishedAt = (dependencies.now?.() ?? new Date()).toISOString();
  run.updatedAt = run.finishedAt;
  await store.saveProvisioningRun(run, claimToken);
  return result;
}

export async function provisionClientAgent(
  input: ProvisionClientAgentInput,
  dependencies: ProvisionClientAgentDependencies,
): Promise<ProvisionClientAgentResult> {
  const claimToken = randomBytes(24).toString("base64url");
  try {
    return await provisionClientAgentAttempt(input, dependencies, claimToken);
  } catch (error) {
    const message = error instanceof Error ? error.message : "provisioning_failed";
    if (["provisioning_already_running", "provisioning_paused", "provisioning_claim_lost"].includes(message) ||
        message.startsWith("synthetic_booking_cleanup_failed:")) throw error;
    if (message === "protected_blades_automation_target") throw error;
    const run = await dependencies.store.getProvisioningRunByIdempotency(
      input.clientId,
      input.operationKey,
    );
    if (run?.status === "running" && run.claimToken === claimToken) {
      const now = dependencies.now?.() ?? new Date();
      run.status = "failed";
      run.error = message;
      run.finishedAt = now.toISOString();
      run.updatedAt = now.toISOString();
      const saved = await dependencies.store.saveProvisioningRun(run, claimToken);
      if (!saved) throw error;
      await dependencies.store.enqueueOnboardingJob({
        id: `job_${run.id}`,
        clientId: run.clientId,
        kind: "provision_client",
        idempotencyKey: `provision:${run.idempotencyKey}`,
        status: "pending",
        payload: { operationKey: run.idempotencyKey },
        attemptCount: 0,
        maxAttempts: 5,
        availableAt: now.toISOString(),
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      });
    }
    const client = await dependencies.store.getClient(input.clientId);
    if (run?.claimToken === claimToken && client?.onboardingStatus) {
      assertOnboardingTransition(client.onboardingStatus, "needs_attention");
      client.onboardingStatus = "needs_attention";
      await dependencies.store.upsertClient(client);
    }
    throw error;
  }
}

export function hashVoiceToolCredential(value: string): string {
  return credentialHash(value);
}
