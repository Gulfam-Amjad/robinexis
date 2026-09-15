import type http from "node:http";
import { createHash } from "node:crypto";
import { compilePrompt } from "@robinexis/brain";
import {
  BLADES_HAIR_ID,
  canTransitionOnboarding,
  isAiServiceEnabled,
  newId,
  structuredLog,
  type CallSession,
  type ClientConfig,
  type ExtractedFact,
  type OutboundJob,
  type OnboardingStatus,
  type OnboardingWizardData,
  type OnboardingWizardState,
  type OnboardingWizardStep,
  type PlatformStore,
  type TenantRequest,
  type WebsiteExtractionRun,
  type WebsiteSource,
} from "@robinexis/database";
import {
  calcom,
  CALCOM_SCOPES,
  calcomOAuthAuthorizeUrl,
  checkoutConfigurationError,
  createBillingPortalSession,
  createTwilioOAuthState,
  createCalcomOAuthState,
  createManagedCalcomUser,
  createCheckoutSession,
  decryptTwilioCredential,
  discoverTwilioAccountSid,
  encryptTwilioCredential,
  ElevenLabsManagementClient,
  exchangeTwilioOAuthCode,
  encryptCalcomCredential,
  exchangeCalcomOAuthCode,
  fetchCalcomIdentity,
  featureOperationallyAvailable,
  FirecrawlWebsiteClient,
  findOwnedTwilioNumber,
  listOwnedTwilioNumbers,
  listCalcomDestinationCalendars,
  isPlanTier,
  planCatalog,
  planDefinition,
  provisionManagedTwilioNumber,
  publicClientView,
  replayStripeEvent,
  enqueueLifecycleEmail,
  twilioOAuthAuthorizeUrl,
  verifyTwilioOAuthState,
  probeCalcomForClient,
  publicCalcomProbe,
  resolveCalcomTenantConnection,
  revokeCalcomOAuthToken,
  verifyCalcomOAuthState,
  TwilioHttpManagementAdapter,
  TwilioManagedNeedsAttentionError,
  WEBSITE_EXTRACTOR_VERSION,
  analyzeReceptionistGaps,
  approvedWebsiteMarkdown,
  validatePublicWebsiteUrl,
  type NormalizedWebsiteFact,
  type PublicCalcomProbe,
} from "@robinexis/integrations";
import { GeminiEmbeddingProvider, KnowledgeService } from "@robinexis/knowledge";
import {
  canAccessClient,
  canAdministerPlatform,
  canManageClient,
  type AuthenticatedActor,
} from "./auth.js";
import { ensureSelfServeWorkspace, writableClientId } from "./billingService.js";
import { provisionClientAgent, repairCalendarEventTypes } from "./provisioningService.js";

export type ProductSend = (
  res: http.ServerResponse,
  status: number,
  body: unknown,
  type?: string,
) => void;

export function publicPlansResponse() {
  return {
    items: Object.values(planCatalog()).map((plan) => ({
      ...plan,
      features: plan.features.map((feature) => ({
        id: feature,
        operational: featureOperationallyAvailable(feature),
      })),
    })),
    currency: "GBP",
  };
}

function primaryWebOrigin(): string {
  return (process.env.WEB_ORIGIN || "https://app.robinexis.com").split(",")[0].trim();
}

type ExtendedStore = PlatformStore & {
  listPromptVersions?: (clientId: string) => Promise<unknown[]>;
};

function provisioningProfileChecksum(client: ClientConfig, compiledPrompt: string) {
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
  return createHash("sha256")
    .update(JSON.stringify({ client: profile, compiledPrompt }))
    .digest("hex");
}

function publicProvisioningOutput(output: Record<string, unknown> | undefined) {
  if (!output) return undefined;
  const allowed = new Set([
    "runId",
    "clientId",
    "agentInstanceId",
    "elevenlabsAgentId",
    "toolIds",
    "phoneNumber",
    "calendarEventTypes",
    "readinessReport",
  ]);
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(output)) {
    if (allowed.has(key)) safe[key] = value;
  }
  return safe;
}

function protectedAutomationTarget(client: ClientConfig) {
  return client.id === BLADES_HAIR_ID || client.slug === "blades-hair";
}

async function twilioActivationCredentials(
  store: PlatformStore,
  client: ClientConfig,
): Promise<{ accountSid: string; authToken: string; accountAuthToken?: string }> {
  const connection = await store.getTwilioConnection(client.id);
  if (connection?.mode === "customer_oauth") {
    if (
      connection.status !== "active" ||
      !connection.apiKeySid ||
      !connection.encryptedApiKeySecret ||
      !connection.encryptedAccountAuthToken
    ) {
      throw new Error("customer_twilio_connection_required");
    }
    return {
      accountSid: connection.apiKeySid,
      authToken: decryptTwilioCredential(connection.encryptedApiKeySecret),
      accountAuthToken: decryptTwilioCredential(connection.encryptedAccountAuthToken),
    };
  }
  const accountSid = connection?.accountSid || process.env.TWILIO_ACCOUNT_SID || "";
  const authToken = process.env.TWILIO_AUTH_TOKEN || "";
  if (!accountSid || !authToken) throw new Error("twilio_credentials_required");
  return { accountSid, authToken };
}

function knowledgeService(store: PlatformStore): KnowledgeService | undefined {
  const apiKey = process.env.GEMINI_API_KEY || "";
  if (!apiKey) return undefined;
  return new KnowledgeService(
    store,
    new GeminiEmbeddingProvider({
      apiKey,
      model: process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001",
    }),
  );
}

export async function completeTwilioOAuthCallback(
  store: PlatformStore,
  input: { code: string; state: string },
): Promise<string> {
  const verified = verifyTwilioOAuthState(input.state);
  const client = await store.getClient(verified.clientId);
  if (!client) throw new Error("client_not_found");
  const tokens = await exchangeTwilioOAuthCode(input.code);
  const accountSid = await discoverTwilioAccountSid(tokens.accessToken);
  const existing = await store.getTwilioConnection(client.id);
  const now = new Date();
  await store.upsertTwilioConnection({
    id: existing?.id || newId("twilio_connection_"),
    clientId: client.id,
    mode: "customer_oauth",
    accountSid,
    encryptedAccessToken: encryptTwilioCredential(tokens.accessToken),
    encryptedRefreshToken: encryptTwilioCredential(tokens.refreshToken),
    accessTokenExpiresAt: new Date(now.getTime() + tokens.expiresIn * 1000).toISOString(),
    apiKeySid: existing?.apiKeySid,
    encryptedApiKeySecret: existing?.encryptedApiKeySecret,
    encryptedAccountAuthToken: existing?.encryptedAccountAuthToken,
    selectedPhoneNumber: existing?.selectedPhoneNumber,
    status: existing?.status === "active" &&
      existing.encryptedApiKeySecret &&
      existing.encryptedAccountAuthToken
      ? "active"
      : "credentials_required",
    metadata: { ...existing?.metadata, oauthConnectedAt: now.toISOString(), reconnectPendingAt: undefined },
    createdAt: existing?.createdAt || now.toISOString(),
    updatedAt: now.toISOString(),
  });
  await store.appendOperatorAudit({
    id: newId("audit_"), clientId: client.id, actorId: "twilio_oauth",
    action: "twilio.customer_oauth_connected",
    detail: { connectionId: existing?.id || undefined, accountSidMasked: `${accountSid.slice(0, 4)}…${accountSid.slice(-4)}` },
    createdAt: now.toISOString(),
  });
  await store.saveOnboardingOutbox({
    id: newId("outbox_"), clientId: client.id, topic: "twilio.customer_oauth_connected",
    idempotencyKey: `twilio-oauth:${client.id}:${accountSid}`,
    payload: { accountSidMasked: `${accountSid.slice(0, 4)}…${accountSid.slice(-4)}` },
    attemptCount: 0, createdAt: now.toISOString(), updatedAt: now.toISOString(),
  });
  const returnTo = new URL(verified.returnTo);
  const allowedOrigin = new URL(primaryWebOrigin()).origin;
  if (returnTo.origin !== allowedOrigin) throw new Error("invalid_twilio_oauth_return_url");
  returnTo.searchParams.set("twilio", "connected");
  return returnTo.toString();
}

export async function completeCalcomOAuthCallback(
  store: PlatformStore,
  input: { code: string; state: string },
): Promise<string> {
  const verified = verifyCalcomOAuthState(input.state);
  const client = await store.getClient(verified.clientId);
  if (!client) throw new Error("client_not_found");
  const tokens = await exchangeCalcomOAuthCode(input.code);
  const identity = await fetchCalcomIdentity(tokens.accessToken);
  const existing = (await store.listCalendarConnections(client.id))
    .find((item) => item.provider === "calcom");
  const now = new Date();
  const connectionId = existing?.id || `calendar_${client.id}_primary`;
  await store.upsertCalendarConnection({
    id: connectionId,
    clientId: client.id,
    locationId: existing?.locationId,
    provider: "calcom",
    externalAccountId: identity.username,
    mode: "oauth",
    encryptedAccessToken: encryptCalcomCredential(tokens.accessToken),
    encryptedRefreshToken: tokens.refreshToken
      ? encryptCalcomCredential(tokens.refreshToken)
      : existing?.encryptedRefreshToken,
    accessTokenExpiresAt: new Date(now.getTime() + tokens.expiresIn * 1000).toISOString(),
    scopes: (tokens.scope?.split(/\s+/).filter(Boolean) || [...CALCOM_SCOPES]),
    calendarId: existing?.calendarId,
    destinationProvider: existing?.destinationProvider,
    status: "active",
    metadata: { ...existing?.metadata, oauthConnectedAt: now.toISOString(), externalUserId: identity.id },
    createdAt: existing?.createdAt || now.toISOString(),
    updatedAt: now.toISOString(),
  });
  await store.upsertProviderResource({
    id: `provider_calcom_user_${client.id}`,
    clientId: client.id,
    provider: "calcom",
    resourceType: "oauth_user",
    providerResourceId: identity.id,
    lifecycleStatus: "active",
    metadata: { connectionId },
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  });
  const returnTo = new URL(verified.returnTo);
  if (returnTo.origin !== new URL(primaryWebOrigin()).origin) throw new Error("invalid_calcom_oauth_return_url");
  returnTo.searchParams.set("calcom", "connected");
  return returnTo.toString();
}

function publicKnowledgeDocument(document: Awaited<ReturnType<PlatformStore["getKnowledgeDocument"]>>) {
  if (!document) return undefined;
  return {
    id: document.id,
    clientId: document.clientId,
    title: document.title,
    source: document.sourceUri || document.sourceType,
    status: document.status === "indexed" ? "ready" : document.status === "pending" ? "indexing" : "failed",
    chunkCount: Number(document.metadata?.chunkCount || 0),
    updatedAt: document.updatedAt,
    error: document.error,
  };
}

export interface ProductRouteContext {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  url: URL;
  store: PlatformStore;
  actor: AuthenticatedActor;
  send: ProductSend;
  readRaw: (req: http.IncomingMessage) => Promise<Buffer>;
}

function clientId(url: URL): string {
  return (url.searchParams.get("clientId") || "").trim();
}

function safeEditableClient(client: ClientConfig) {
  return {
    ...publicClientView(client),
    greeting: client.greeting,
    tone: client.tone,
    transferNumber: client.transferNumber,
    voiceId: client.voiceId,
    hours: client.hours,
    prices: client.prices,
    policies: client.policies,
    unknownTopics: client.unknownTopics,
    calendarNoteMode: client.calendarNoteMode,
    callingWindow: client.callingWindow,
    maxConcurrentCalls: client.maxConcurrentCalls,
    outboundRatePerHour: client.outboundRatePerHour,
    firstCampaignRequiresApproval: client.firstCampaignRequiresApproval,
    monthlyMinuteLimit: client.monthlyMinuteLimit,
    outboundCallerId: client.outboundCallerId,
    promptVersionId: client.promptVersionId,
    calendar: {
      provider: client.calendar.provider,
      username: client.calendar.username,
      configured: Boolean(client.calendar.credentialRef),
    },
  };
}

async function readJson<T>(ctx: ProductRouteContext): Promise<T> {
  const raw = await ctx.readRaw(ctx.req);
  if (raw.byteLength > 6 * 1024 * 1024) throw new Error("payload_too_large");
  return JSON.parse(raw.toString() || "{}") as T;
}

function parseLimit(url: URL, fallback = 50, max = 250): number {
  return Math.min(max, Math.max(1, Number(url.searchParams.get("limit") || fallback) || fallback));
}

const onboardingWizardSteps: OnboardingWizardStep[] = [
  "website", "facts", "behavior", "operations", "phone", "calendar", "review",
];

function initialOnboardingWizard(client: ClientConfig): OnboardingWizardState {
  const now = new Date().toISOString();
  return {
    clientId: client.id,
    currentStep: "website",
    completedSteps: [],
    data: {
      businessName: client.businessName,
      location: client.location,
      greeting: client.greeting || `Hello, you've reached ${client.businessName}. How can I help?`,
      tone: client.tone,
      transferNumber: client.transferNumber,
      services: client.services,
      hours: client.hours,
      timezone: client.callingWindow?.tz || "Europe/London",
      phoneMode: client.phoneAcquisitionMode === "customer_oauth" ? "customer_twilio" : "managed",
      customerPhoneNumber: client.requestedPhoneNumber,
      calendarMode: client.calendar?.credentialRef ? "connect_existing" : "managed_calcom",
      existingCalendarProvider: client.calendar?.provider,
      calendarSchedule: client.calendar.schedule || {
        timezone: client.callingWindow?.tz || "Europe/London",
        weeklyHours: {},
        overrides: [],
        bufferBeforeMinutes: 0,
        bufferAfterMinutes: 0,
        minimumNoticeMinutes: 60,
        cancellationAllowed: true,
        rescheduleAllowed: true,
      },
    },
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
}

function dataReadinessBlockers(data: OnboardingWizardData) {
  const blockers: Array<{ key: string; step: OnboardingWizardStep; message: string }> = [];
  const add = (key: string, step: OnboardingWizardStep, message: string) => blockers.push({ key, step, message });
  if (!data.businessName?.trim()) add("business_name", "facts", "Confirm your business name.");
  if (!data.greeting?.trim() || data.greeting.trim().length < 8) add("greeting", "behavior", "Add a caller greeting.");
  if (!data.tone?.trim()) add("tone", "behavior", "Choose how the receptionist should sound.");
  if (!data.transferNumber?.match(/^\+[1-9]\d{7,14}$/)) add("transfer_number", "behavior", "Add a transfer number in international format.");
  if (!data.recordingConsent) add("recording_consent", "behavior", "Choose how recording consent is handled.");
  if (!data.services?.length || data.services.some((service) =>
    !service.title?.trim() || !/^[a-z0-9-]{2,80}$/.test(service.slug) ||
    !Number.isFinite(service.durationMinutes) || service.durationMinutes <= 0
  )) add("services", "operations", "Add at least one service with a valid duration.");
  if (!data.hours?.trim()) add("hours", "operations", "Add your opening hours.");
  if (!data.timezone?.trim()) add("timezone", "operations", "Choose your business timezone.");
  if (!data.bookingRules?.trim()) add("booking_rules", "operations", "Add the rules callers should know before booking.");
  if (!data.phoneMode) add("phone_mode", "phone", "Choose a phone setup route.");
  if (data.phoneMode === "customer_twilio" && !data.customerPhoneNumber?.match(/^\+[1-9]\d{7,14}$/)) {
    add("customer_phone_number", "phone", "Add the Twilio number you want Robinexis to assess.");
  }
  if (!data.calendarMode) add("calendar_mode", "calendar", "Choose a calendar setup route.");
  if (data.calendarMode === "connect_existing" && !data.existingCalendarProvider) {
    add("calendar_provider", "calendar", "Choose the calendar you want to connect.");
  }
  return blockers;
}

async function onboardingReadiness(store: PlatformStore, state: OnboardingWizardState) {
  const blockers = dataReadinessBlockers(state.data);
  for (const gap of (await store.listOnboardingGaps(state.clientId)).filter((item) => item.status === "open")) {
    blockers.push({
      key: `hard_gap_${gap.key}`,
      step: ["calendar_connection", "timezone"].includes(gap.key) ? "calendar" : "operations",
      message: gap.detail || `Resolve the required ${gap.key.replaceAll("_", " ")} mapping.`,
    });
  }
  if (state.data.phoneMode === "customer_twilio") {
    const connection = await store.getTwilioConnection(state.clientId);
    if (
      connection?.status !== "active" ||
      connection.selectedPhoneNumber !== state.data.customerPhoneNumber
    ) {
      blockers.push({
        key: "twilio_connection",
        step: "phone",
        message: "Connect Twilio and verify the selected owned number.",
      });
    }
  }
  if (state.data.calendarMode) {
    const calendarConnected = (await store.listCalendarConnections(state.clientId))
      .some((connection) => connection.provider === "calcom" && connection.status === "active");
    if (!calendarConnected) {
      blockers.push({
        key: "calendar_connection",
        step: "calendar",
        message: state.data.calendarMode === "managed_calcom"
          ? "Create the managed Cal.com connection."
          : "Connect the existing Cal.com account.",
      });
    }
  }
  const run = state.data.websiteRunId
    ? await store.getWebsiteExtractionRun(state.clientId, state.data.websiteRunId)
    : undefined;
  if (!state.data.websiteUrl?.trim() || !run || run.status !== "succeeded") {
    blockers.unshift({ key: "website_scan", step: "website", message: "Scan your public business website." });
  } else {
    const facts = await store.listExtractedFacts(state.clientId, run.id);
    const source = await store.getWebsiteSource(state.clientId, run.sourceId);
    if (!facts.length || facts.some((fact) => fact.reviewStatus === "extracted")) {
      blockers.push({ key: "website_facts", step: "facts", message: "Confirm or edit every website fact." });
    }
    if (source?.metadata.approvedRunId !== run.id) {
      blockers.push({ key: "website_approval", step: "facts", message: "Approve the reviewed facts for setup." });
    }
  }
  return { ready: blockers.length === 0, blockers };
}

function filterCalls(calls: CallSession[], url: URL): CallSession[] {
  const search = (url.searchParams.get("search") || "").trim().toLowerCase();
  const direction = url.searchParams.get("direction");
  const status = url.searchParams.get("status");
  const outcome = url.searchParams.get("outcome");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  return calls.filter((call) => {
    if (direction && call.direction !== direction) return false;
    if (status && call.status !== status) return false;
    if (outcome && call.outcome !== outcome) return false;
    if (from && call.createdAt < from) return false;
    if (to && call.createdAt > to) return false;
    if (search) {
      const haystack = [
        call.id,
        call.contactPhone,
        call.objective,
        call.outcome,
        ...call.transcript.map((turn) => turn.text),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
}

/**
 * A calendar_connections row only records that a tenant once connected. It says
 * nothing about whether the event types the agent books against still exist, so
 * connection health has to come from a live probe of the mapped event type.
 * Cached briefly because the dashboard polls far more often than Cal.com changes.
 */
const calendarProbeCache = new Map<string, { probe: PublicCalcomProbe; expiresAt: number }>();
const CALENDAR_PROBE_TTL_MS = 60_000;

export async function probeTenantCalendar(
  store: PlatformStore,
  client: ClientConfig,
  now = Date.now(),
): Promise<PublicCalcomProbe> {
  const cached = calendarProbeCache.get(client.id);
  if (cached && cached.expiresAt > now) return cached.probe;

  const probedAt = new Date(now).toISOString();
  const shape = (probe: PublicCalcomProbe) => {
    calendarProbeCache.set(client.id, { probe, expiresAt: now + CALENDAR_PROBE_TTL_MS });
    return probe;
  };

  const connected = (await store.listCalendarConnections(client.id))
    .some((item) => item.provider === "calcom" && item.status === "active");
  if (!connected) {
    return shape(publicCalcomProbe({ configured: false, username: "", eventTypeSlug: "", probedAt }));
  }
  const mappings = (await store.listCalendarEventTypes(client.id))
    .filter((item) => item.status === "active" && !item.readinessOnly);
  const mapping = mappings[0];
  if (!mapping) {
    return shape(publicCalcomProbe({
      configured: true, username: client.calendar.username || "", eventTypeSlug: "",
      error: "no_booking_types_configured", probedAt,
    }));
  }
  try {
    const { tenant } = await resolveCalcomTenantConnection(store, client);
    return shape(await probeCalcomForClient({
      client,
      tenant,
      eventTypeSlug: mapping.providerSlug,
      eventTypeId: mapping.providerEventTypeId,
    }));
  } catch (error) {
    return shape(publicCalcomProbe({
      configured: true, username: client.calendar.username || "", eventTypeSlug: mapping.providerSlug,
      error: error instanceof Error ? error.message : String(error), probedAt,
    }));
  }
}

/** Turns a probe failure into something a salon owner can act on. */
export function calendarDetail(calendar: Record<string, unknown>): string {
  const error = String(calendar.error || "");
  if (!error || error === "calcom_not_configured") return "Not connected";
  if (error === "no_booking_types_configured") return "Connected, but no booking types exist yet — repair the calendar";
  if (/Event Type not found|HTTP 404/i.test(error)) return "Booking types are missing in Cal.com — repair the calendar";
  if (/tenant_calendar_(connection|credential)_required|calcom_reconnect_required/.test(error)) {
    return "Cal.com needs reconnecting";
  }
  return error.slice(0, 160);
}

export function integrationList(client: ClientConfig, calendar: Record<string, unknown>) {
  const now = new Date().toISOString();
  return [
    { id: "twilio", name: "Twilio", connected: Boolean(client.inboundNumbers.length), detail: client.inboundNumbers.length ? "Inbound numbers route directly to ElevenLabs" : "No inbound number assigned", lastCheckedAt: now },
    { id: "elevenlabs", name: "ElevenLabs", connected: client.voicePipeline === "elevenlabs-convai" && Boolean(client.elevenlabsAgentId), detail: client.elevenlabsAgentId ? "Realtime speech, barge-in and agent conversation" : "Assign this workspace's ElevenLabs agent ID", lastCheckedAt: now },
    { id: "calcom", name: "Cal.com", connected: Boolean(calendar.ok), detail: calendar.ok ? `${calendar.slotCount || 0} slots available in the next 7 days` : calendarDetail(calendar), lastCheckedAt: String(calendar.probedAt || now) },
    { id: "gemini", name: "Gemini", connected: Boolean(process.env.GEMINI_API_KEY), detail: "Knowledge embeddings", lastCheckedAt: now },
    { id: "stripe", name: "Stripe", connected: Boolean(process.env.STRIPE_SECRET_KEY), detail: "Billing webhook", lastCheckedAt: now },
    { id: "database", name: "PostgreSQL", connected: Boolean(process.env.DATABASE_URL), detail: "Tenant data and pgvector", lastCheckedAt: now },
  ];
}

function timeseries(calls: CallSession[]) {
  const days = new Map<string, { date: string; calls: number; bookings: number; transfers: number }>();
  for (const call of calls) {
    const date = call.createdAt.slice(0, 10);
    const row = days.get(date) || { date, calls: 0, bookings: 0, transfers: 0 };
    row.calls += 1;
    if (call.outcome === "transferred") row.transfers += 1;
    if (call.toolHistory.some((tool) => tool.name === "create_booking" && !tool.error)) row.bookings += 1;
    days.set(date, row);
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function createClient(body: Partial<ClientConfig>): ClientConfig {
  if (!body.slug || !body.businessName || !body.calendar?.provider) {
    throw new Error("slug_businessName_calendar_required");
  }
  if (!/^[a-z0-9-]{2,80}$/.test(body.slug)) {
    throw new Error("invalid_slug");
  }
  if (!body.transferNumber || !/^\+[1-9]\d{7,14}$/.test(body.transferNumber)) {
    throw new Error("valid_transfer_number_required");
  }
  if (body.calendar.credentialRef) {
    throw new Error("shared_calendar_credentials_forbidden_for_new_tenants");
  }
  return {
    id: body.id || newId("client_"),
    slug: body.slug,
    businessName: body.businessName,
    role: body.role || "voice receptionist",
    greeting: body.greeting,
    tone: body.tone || "warm, brief and natural; ask one useful question at a time",
    location: body.location || "",
    phone: body.phone || "",
    email: body.email || "",
    transferNumber: body.transferNumber || "",
    voiceId: body.voiceId || process.env.ELEVENLABS_VOICE_ID || "",
    voicePipeline: "elevenlabs-convai",
    services: body.services || [],
    staff: body.staff || [],
    hours: body.hours,
    prices: body.prices,
    policies: body.policies || [],
    publishedFacts: body.publishedFacts || [],
    unknownTopics: body.unknownTopics || [],
    calendar: {
      provider: body.calendar.provider,
      username: body.calendar.username,
      destinationCalendarId: body.calendar.destinationCalendarId,
      destinationProvider: body.calendar.destinationProvider,
      schedule: body.calendar.schedule,
    },
    calendarNotes: body.calendarNotes,
    calendarNoteMode: body.calendarNoteMode || "summary",
    enabledFeatures: body.enabledFeatures || ["inbound", "booking", "transfer"],
    inboundNumbers: body.inboundNumbers || [],
    outboundCallerId: body.outboundCallerId,
    callingWindow: body.callingWindow || {
      tz: "Europe/London",
      startHour: 8,
      endHour: 21,
      skipSunday: true,
    },
    maxConcurrentCalls: body.maxConcurrentCalls || 2,
    outboundRatePerHour: body.outboundRatePerHour || 10,
    firstCampaignRequiresApproval: body.firstCampaignRequiresApproval ?? true,
    published: false,
    serviceStatus: body.serviceStatus || "trialing",
    monthlyMinuteLimit: body.monthlyMinuteLimit,
  };
}

async function requireClient(ctx: ProductRouteContext, id: string): Promise<ClientConfig | undefined> {
  const client = id ? await ctx.store.getClient(id) : undefined;
  if (!client || !canAccessClient(ctx.actor, id)) {
    ctx.send(ctx.res, 404, { error: "client_not_found" });
    return undefined;
  }
  return client;
}

async function requireManageClient(ctx: ProductRouteContext, id: string): Promise<ClientConfig | undefined> {
  const client = await requireClient(ctx, id);
  if (client && !canManageClient(ctx.actor, id)) {
    ctx.send(ctx.res, 403, { error: "workspace_write_forbidden" });
    return undefined;
  }
  return client;
}

async function notifyCustomer(
  store: PlatformStore,
  clientId: string,
  operationId: string,
  idempotencyKey: string,
  to: string | undefined,
  template: string,
) {
  return enqueueLifecycleEmail({ store, clientId, operationId, idempotencyKey, to, template });
}

function publicWebsiteFact(fact: ExtractedFact) {
  let evidence: unknown = fact.sourceEvidence;
  try {
    evidence = fact.sourceEvidence ? JSON.parse(fact.sourceEvidence) : undefined;
  } catch {
    // Preserve legacy string evidence.
  }
  return {
    id: fact.id,
    key: fact.key,
    value: fact.value,
    confidence: fact.confidence,
    evidence,
    reviewStatus: fact.reviewStatus,
    reviewedAt: fact.reviewedAt,
  };
}

function normalizedReviewedFacts(facts: ExtractedFact[]): NormalizedWebsiteFact[] {
  return facts
    .filter((fact) => fact.reviewStatus !== "extracted")
    .map((fact) => {
      let evidence: { url: string; excerpt?: string } = { url: "" };
      try {
        evidence = JSON.parse(fact.sourceEvidence || "{}") as typeof evidence;
      } catch {
        evidence.excerpt = fact.sourceEvidence;
      }
      return {
        key: fact.key as NormalizedWebsiteFact["key"],
        value: fact.value,
        confidence: fact.confidence ?? 0.5,
        evidence,
      };
    });
}

function applyApprovedWebsiteFacts(client: ClientConfig, facts: NormalizedWebsiteFact[]): ClientConfig {
  const draft = structuredClone(client);
  const byKey = new Map(facts.map((fact) => [fact.key, fact.value]));
  const text = (key: NormalizedWebsiteFact["key"]) => {
    const value = byKey.get(key);
    return typeof value === "string" ? value.trim() : "";
  };
  if (text("businessName")) draft.businessName = text("businessName");
  if (text("hours")) draft.hours = text("hours");
  if (text("tone")) draft.tone = text("tone");
  if (text("transferDestination").match(/^\+[1-9]\d{7,14}$/)) {
    draft.transferNumber = text("transferDestination");
  }
  const locations = byKey.get("locations");
  if (Array.isArray(locations) && typeof locations[0] === "string") draft.location = locations.join("; ");
  const contacts = byKey.get("contacts");
  if (contacts && typeof contacts === "object") {
    const record = contacts as { phones?: unknown[]; emails?: unknown[] };
    if (typeof record.phones?.[0] === "string") draft.phone = record.phones[0];
    if (typeof record.emails?.[0] === "string") draft.email = record.emails[0];
  }
  const services = byKey.get("services");
  if (Array.isArray(services)) {
    draft.services = services.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const service = item as { name?: unknown; durationMinutes?: unknown };
      if (typeof service.name !== "string" || typeof service.durationMinutes !== "number" || service.durationMinutes <= 0) return [];
      const slug = service.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
      return slug.length >= 2 ? [{ title: service.name, slug, durationMinutes: service.durationMinutes }] : [];
    });
  }
  const policies = [
    ...(Array.isArray(byKey.get("bookingRules")) ? byKey.get("bookingRules") as unknown[] : []),
    ...(Array.isArray(byKey.get("cancellationRules")) ? byKey.get("cancellationRules") as unknown[] : []),
    ...(Array.isArray(byKey.get("transferEscalation")) ? byKey.get("transferEscalation") as unknown[] : []),
  ].filter((value): value is string => typeof value === "string");
  if (policies.length) draft.policies = [...new Set(policies)];
  draft.published = false;
  return draft;
}

async function refreshWebsiteGaps(
  store: PlatformStore,
  clientId: string,
  facts: ReadonlyArray<Pick<NormalizedWebsiteFact, "key" | "value">>,
  now: string,
) {
  const calendarConnected = (await store.listCalendarConnections(clientId))
    .some((connection) => connection.status === "active");
  const gaps = analyzeReceptionistGaps(facts, { calendarConnected });
  const allGapKeys = [
    "hours", "timezone", "service_duration", "calendar_connection",
    "transfer_destination", "recording_consent",
  ] as const;
  for (const key of allGapKeys) {
    const gap = gaps.find((item) => item.key === key);
    await store.upsertOnboardingGap({
      id: `website_gap_${clientId}_${key}`,
      clientId,
      key,
      status: gap ? "open" : "resolved",
      detail: gap?.detail,
      resolvedAt: gap ? undefined : now,
      createdAt: now,
      updatedAt: now,
    });
  }
  return gaps;
}

export async function handleProductRoute(ctx: ProductRouteContext): Promise<boolean> {
  const { req, res, url, store, actor, send } = ctx;
  const route = url.pathname.slice("/api/v1".length) || "/";

  if (route === "/session" && req.method === "GET") {
    const clientId = writableClientId(actor) || Object.keys(actor.clientRoles)[0];
    const client = clientId ? await store.getClient(clientId) : undefined;
    const subscription = client ? await store.getCurrentSubscription(client.id) : undefined;
    send(res, 200, {
      email: actor.email,
      role: actor.role,
      clientRoles: actor.clientRoles,
      clientId: client?.id,
      subscriptionStatus: subscription?.status || client?.serviceStatus,
      onboardingStatus: client?.onboardingStatus,
      capabilities: {
        administerPlatform: canAdministerPlatform(actor),
        createClients: canAdministerPlatform(actor),
      },
    });
    return true;
  }

  if (route === "/plans" && req.method === "GET") {
    send(res, 200, publicPlansResponse());
    return true;
  }

  if (route === "/admin/summary" && req.method === "GET") {
    if (!canAdministerPlatform(actor)) {
      send(res, 403, { error: "platform_admin_required" });
      return true;
    }
    const clients = await store.listClients();
    const failedBillingEvents = await store.listStripeEvents("failed", 25);
    const month = new Date().toISOString().slice(0, 7);
    const items = await Promise.all(clients.map(async (client) => {
      const subscription = await store.getCurrentSubscription(client.id);
      const usage = await store.getUsage(client.id, month);
      const calls = await store.listCallsForClient(client.id, 1_000);
      const ledger = await store.listCreditLedger(client.id);
      const plan = subscription?.planTier ||
        (isPlanTier(client.subscribedProduct) ? client.subscribedProduct : "starter");
      return {
        clientId: client.id,
        plan,
        subscriptionStatus: subscription?.status || client.serviceStatus,
        subscriptionProvider: subscription?.provider,
        usedMinutes: (usage?.inboundMinutes || 0) + (usage?.outboundMinutes || 0),
        remainingMinutes: Math.max(0, ledger.reduce((sum, entry) => sum + entry.minutes, 0)),
        failedCalls: calls.filter((call) => call.status === "failed").length,
      };
    }));
    const mrrPence = items.reduce((sum, item) => {
      if (item.subscriptionProvider !== "stripe" || item.subscriptionStatus !== "active") return sum;
      return sum + (planDefinition(item.plan).monthlyPricePence || 0);
    }, 0);
    send(res, 200, {
      month,
      mrrPence,
      totalUsedMinutes: items.reduce((sum, item) => sum + item.usedMinutes, 0),
      totalFailedCalls: items.reduce((sum, item) => sum + item.failedCalls, 0),
      failedBillingEvents: failedBillingEvents.map((event) => ({
        id: event.id,
        clientId: event.clientId,
        eventType: event.eventType,
        error: event.error,
        receivedAt: event.receivedAt,
      })),
      setupQueueCount: clients.filter((client) =>
        ["setup_queued", "setup_in_progress", "needs_attention"].includes(client.onboardingStatus || ""),
      ).length,
      clients: items,
    });
    return true;
  }
  if (route === "/admin/control-plane" && req.method === "GET") {
    if (!canAdministerPlatform(actor)) {
      send(res, 403, { error: "platform_admin_required" });
      return true;
    }
    const clients = await store.listClients();
    const clientNames = new Map(clients.map((client) => [client.id, client.businessName]));
    const now = new Date();
    const [tenantRequests, perClient, notificationHealth] = await Promise.all([
      store.listTenantRequests(),
      Promise.all(clients.map(async (client) => {
        const [runs, resources, twilio] = await Promise.all([
          store.listProvisioningRuns(client.id),
          store.listProviderResources(client.id),
          store.getTwilioConnection(client.id),
        ]);
        return { client, run: runs[0], resources, twilio };
      })),
      store.notificationHealth(now.toISOString()),
    ]);
    const blades = clients.find((client) => client.slug === "blades-hair");
    const configuredCaps = perClient.filter(({ twilio }) => typeof twilio?.monthlySpendCapPence === "number").length;
    const uncappedConnections = perClient.filter(({ twilio }) =>
      Boolean(twilio && typeof twilio.monthlySpendCapPence !== "number")).length;
    send(res, 200, {
      generatedAt: now.toISOString(),
      health: {
        status: notificationHealth.deadLetter || notificationHealth.providerFailures24h ||
          uncappedConnections || !process.env.BACKUP_OUTPUT_PATH ? "degraded" : "ok",
        notificationQueue: {
          ...notificationHealth,
          oldestPendingAt: undefined,
          oldestPendingAgeSeconds: notificationHealth.oldestPendingAt
            ? Math.max(0, Math.floor((now.getTime() - Date.parse(notificationHealth.oldestPendingAt)) / 1000))
            : undefined,
        },
        spend: {
          status: uncappedConnections ? "needs_attention" : "configured",
          configuredCapCount: configuredCaps,
          uncappedConnectionCount: uncappedConnections,
        },
        backup: {
          status: process.env.BACKUP_OUTPUT_PATH ? "configured" : "not_configured",
          freshness: "unknown",
        },
      },
      provisioning: perClient
        .filter(({ client, run }) => Boolean(run) ||
          ["setup_queued", "setup_in_progress", "needs_attention", "provisioning", "testing", "awaiting_approval", "failed"]
            .includes(client.onboardingStatus || ""))
        .map(({ client, run }) => {
          const readiness = run?.output?.readinessReport as
            | { passed?: boolean; hardGaps?: string[] }
            | undefined;
          return ({
          clientId: client.id,
          businessName: client.businessName,
          onboardingStatus: client.onboardingStatus,
          runId: run?.id,
          runStatus: run?.status,
          step: run?.step,
          readinessPassed: readiness?.passed,
          blockers: readiness?.hardGaps || (run?.error ? [run.error] : []),
          updatedAt: run?.updatedAt,
          });
        }),
      resources: perClient.flatMap(({ client, resources }) => resources.map((resource) => ({
        clientId: client.id,
        businessName: client.businessName,
        provider: resource.provider,
        resourceType: resource.resourceType,
        lifecycleStatus: resource.lifecycleStatus,
        healthy: resource.lifecycleStatus === "active",
        updatedAt: resource.updatedAt,
      }))),
      requests: tenantRequests.map((request) => ({
        id: request.id,
        clientId: request.clientId,
        businessName: clientNames.get(request.clientId) || "Unknown workspace",
        type: request.type,
        status: request.status,
        createdAt: request.createdAt,
      })),
      spendAlarms: perClient
        .filter(({ twilio }) => typeof twilio?.monthlySpendCapPence === "number")
        .map(({ client, twilio }) => ({
          clientId: client.id,
          businessName: client.businessName,
          monthlySpendCapPence: twilio!.monthlySpendCapPence!,
          status: "configured",
        })),
      blades: {
        present: Boolean(blades),
        published: Boolean(blades?.published),
        serviceStatus: blades?.serviceStatus,
        inboundActive: Boolean(blades?.published && blades?.serviceStatus === "active" && blades.inboundNumbers.length),
      },
    });
    return true;
  }
  const notificationStatusMatch = route.match(/^\/clients\/([^/]+)\/notifications\/status$/);
  if (notificationStatusMatch && req.method === "GET") {
    const client = await requireClient(ctx, notificationStatusMatch[1]);
    if (!client) return true;
    const deliveries = await store.listNotifications(client.id, 20);
    send(res, 200, {
      pending: deliveries.filter((item) => ["pending", "leased"].includes(item.status)).length,
      failed: deliveries.filter((item) => item.status === "dead_letter").length,
      lastDeliveryAt: deliveries.find((item) => item.status === "delivered")?.deliveredAt,
    });
    return true;
  }
  if (route === "/admin/audit" && req.method === "GET") {
    if (!canAdministerPlatform(actor)) {
      send(res, 403, { error: "platform_admin_required" });
      return true;
    }
    const clientId = url.searchParams.get("clientId") || undefined;
    send(res, 200, { items: await store.listOperatorAudit(clientId, 100) });
    return true;
  }
  if (route === "/audit" && req.method === "GET") {
    const id = url.searchParams.get("clientId") || "";
    if (!(await requireClient(ctx, id))) return true;
    const items = await store.listOperatorAudit(id, 100);
    send(res, 200, {
      items: items.map((item) => ({
        id: item.id,
        action: item.action,
        createdAt: item.createdAt,
      })),
    });
    return true;
  }
  const billingReplayMatch = route.match(/^\/admin\/billing-events\/([^/]+)\/replay$/);
  if (billingReplayMatch && req.method === "POST") {
    if (!canAdministerPlatform(actor)) {
      send(res, 403, { error: "platform_admin_required" });
      return true;
    }
    const eventId = decodeURIComponent(billingReplayMatch[1]);
    const failed = (await store.listStripeEvents("failed", 500)).find((event) => event.id === eventId);
    if (!failed) {
      send(res, 404, { error: "failed_billing_event_not_found" });
      return true;
    }
    await store.appendOperatorAudit({
      id: newId("audit_"),
      clientId: failed.clientId,
      actorId: actor.subject,
      action: "billing.webhook_replay_requested",
      detail: { eventId, eventType: failed.eventType },
      createdAt: new Date().toISOString(),
    });
    const result = await replayStripeEvent({ store, eventId });
    send(res, result.ok ? 200 : 409, result);
    return true;
  }
  const setupTransitionMatch = route.match(/^\/admin\/setup\/([^/]+)\/transition$/);
  if (setupTransitionMatch && req.method === "POST") {
    if (!canAdministerPlatform(actor)) {
      send(res, 403, { error: "platform_admin_required" });
      return true;
    }
    const client = await requireClient(ctx, setupTransitionMatch[1]);
    if (!client) return true;
    const body = await readJson<{
      status?: OnboardingStatus;
      note?: string;
      eta?: string;
    }>(ctx);
    if (!body.status || !canTransitionOnboarding(client.onboardingStatus, body.status)) {
      send(res, 409, { error: "invalid_setup_transition" });
      return true;
    }
    if (body.status === "active") {
      send(res, 403, { error: "customer_owner_approval_required" });
      return true;
    }
    if (body.eta && !Number.isFinite(Date.parse(body.eta))) {
      send(res, 400, { error: "valid_setup_eta_required" });
      return true;
    }
    const previous = client.onboardingStatus;
    client.onboardingStatus = body.status;
    client.onboardingNotes = body.note?.trim().slice(0, 1_000) || client.onboardingNotes;
    client.onboardingEta = body.eta || client.onboardingEta;
    await store.upsertClient(client);
    await store.appendOperatorAudit({
      id: newId("audit_"),
      clientId: client.id,
      actorId: actor.subject,
      action: "onboarding.status_changed",
      detail: { from: previous, to: body.status, note: client.onboardingNotes, eta: client.onboardingEta },
      createdAt: new Date().toISOString(),
    });
    if (body.status === "needs_attention") {
      await notifyCustomer(store, client.id, `onboarding:${client.id}:${body.status}`, `status:${client.id}:${body.status}:${client.onboardingNotes || ""}`, client.email, `Robinexis setup needs your input\n${client.onboardingNotes || "Open your workspace to review the information we need."}`);
    }
    send(res, 200, { client: safeEditableClient(client) });
    return true;
  }
  if (route === "/account/legal-consent" && req.method === "POST") {
    const now = new Date().toISOString();
    const existing = await store.getUserProfileByAuthUserId(actor.subject);
    await store.upsertUserProfile({
      id: existing?.id || `user_${actor.subject}`,
      clientId: existing?.clientId,
      authUserId: actor.subject,
      email: actor.email,
      displayName: existing?.displayName,
      platformRole: existing?.platformRole || "client",
      workspaceRole: existing?.workspaceRole,
      termsAcceptedAt: now,
      privacyAcceptedAt: now,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    });
    send(res, 200, { acceptedAt: now });
    return true;
  }
  if (route === "/invitations/accept" && req.method === "POST") {
    const invitations = (await store.listTenantRequests(undefined, "team_invite"))
      .filter((request) => request.status === "pending" && request.email === actor.email.toLowerCase());
    if (!invitations.length) {
      send(res, 404, { error: "pending_invitation_not_found" });
      return true;
    }
    const accepted: string[] = [];
    for (const invitation of invitations) {
      const role = invitation.payload.role === "manager" ? "manager" : "viewer";
      await store.upsertMembership({
        id: `mem_${invitation.clientId}_${actor.subject}`,
        clientId: invitation.clientId,
        email: actor.email,
        role,
        createdAt: new Date().toISOString(),
      });
      invitation.status = "completed";
      invitation.updatedAt = new Date().toISOString();
      await store.saveTenantRequest(invitation);
      accepted.push(invitation.clientId);
      await store.appendOperatorAudit({
        id: newId("audit_"), clientId: invitation.clientId, actorId: actor.subject,
        action: "team_invite.accepted", detail: { requestId: invitation.id, role }, createdAt: invitation.updatedAt,
      });
    }
    const primary = invitations[0];
    const profile = await store.getUserProfileByAuthUserId(actor.subject);
    await store.upsertUserProfile({
      id: profile?.id || `user_${actor.subject}`,
      clientId: primary.clientId,
      authUserId: actor.subject,
      email: actor.email,
      displayName: profile?.displayName,
      platformRole: "client",
      workspaceRole: primary.payload.role === "manager" ? "manager" : "viewer",
      termsAcceptedAt: profile?.termsAcceptedAt,
      privacyAcceptedAt: profile?.privacyAcceptedAt,
      createdAt: profile?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    send(res, 200, { clientIds: accepted });
    return true;
  }
  if (route === "/requests" && req.method === "GET") {
    const requestedClientId = url.searchParams.get("clientId") || undefined;
    const clientId = requestedClientId && canAdministerPlatform(actor)
      ? requestedClientId
      : writableClientId(actor);
    if (!clientId) {
      send(res, 403, { error: "workspace_required" });
      return true;
    }
    send(res, 200, { items: await store.listTenantRequests(clientId) });
    return true;
  }
  if (route === "/requests" && req.method === "POST") {
    const body = await readJson<{
      type?: "team_invite" | "data_export" | "workspace_deletion" | "support";
      email?: string;
      role?: "manager" | "staff" | "viewer";
      subject?: string;
      message?: string;
    }>(ctx);
    const clientId = writableClientId(actor);
    if (!clientId || !body.type) {
      send(res, 403, { error: "workspace_required" });
      return true;
    }
    const role = actor.clientRoles[clientId];
    if (body.type !== "support" && role !== "owner" && role !== "manager") {
      send(res, 403, { error: "workspace_owner_or_manager_required" });
      return true;
    }
    if (body.type === "workspace_deletion" && role !== "owner") {
      send(res, 403, { error: "workspace_owner_required" });
      return true;
    }
    if (body.type === "team_invite" && (!body.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email))) {
      send(res, 400, { error: "valid_invite_email_required" });
      return true;
    }
    if (body.type === "support" && (!body.subject?.trim() || !body.message?.trim())) {
      send(res, 400, { error: "support_subject_and_message_required" });
      return true;
    }
    const now = new Date().toISOString();
    const request: TenantRequest = {
      id: newId("request_"),
      clientId,
      type: body.type,
      status: "pending" as const,
      requestedBy: actor.subject,
      email: body.email?.trim().toLowerCase(),
      payload: {
        role: body.role,
        subject: body.subject?.trim(),
        message: body.message?.trim(),
        delivery: body.type === "team_invite" ? "queued_provider_required" : undefined,
        exportScope: body.type === "data_export"
          ? ["website_facts", "provider_resources", "jobs", "notifications"]
          : undefined,
        reviewOnly: body.type === "workspace_deletion" ? true : undefined,
        automaticProviderDeletion: body.type === "workspace_deletion" ? false : undefined,
      },
      createdAt: now,
      updatedAt: now,
    };
    await store.saveTenantRequest(request);
    const delivery = body.type === "team_invite"
      ? await notifyCustomer(store, clientId, `request:${request.id}`, `request:${request.id}`, request.email, `You are invited to Robinexis\n${actor.email} invited you to join their workspace as ${body.role || "viewer"}. Sign in securely at ${process.env.WEB_ORIGIN || "https://app.robinexis.com"}/login.`)
      : body.type === "support"
        ? await notifyCustomer(store, clientId, `request:${request.id}`, `request:${request.id}`, process.env.SUPPORT_EMAIL, `New Robinexis support request\nTenant: ${clientId}\nSubject: ${body.subject}\n\n${body.message}`)
        : undefined;
    if (delivery?.queued) {
      request.payload = { ...request.payload, delivery: "queued", notificationId: delivery.id };
      await store.saveTenantRequest(request);
    }
    await store.appendOperatorAudit({
      id: newId("audit_"),
      clientId,
      actorId: actor.subject,
      action: `${body.type}.requested`,
      detail: { requestId: request.id, email: request.email },
      createdAt: now,
    });
    send(res, 202, { request });
    return true;
  }
  const tenantRequestMatch = route.match(/^\/requests\/([^/]+)$/);
  if (tenantRequestMatch && req.method === "PATCH") {
    const request = await store.getTenantRequest(tenantRequestMatch[1]);
    if (!request || (!canAdministerPlatform(actor) && !actor.clientRoles[request.clientId])) {
      send(res, 404, { error: "request_not_found" });
      return true;
    }
    if (!canAdministerPlatform(actor) && !["owner", "manager"].includes(actor.clientRoles[request.clientId])) {
      send(res, 403, { error: "workspace_owner_or_manager_required" });
      return true;
    }
    const body = await readJson<{ action?: "resend" | "revoke" }>(ctx);
    if (request.type !== "team_invite" || !body.action || request.status !== "pending") {
      send(res, 409, { error: "pending_invitation_required" });
      return true;
    }
    request.updatedAt = new Date().toISOString();
    if (body.action === "revoke") request.status = "revoked";
    if (body.action === "resend") {
      const resendCount = Number(request.payload.resendCount || 0) + 1;
      const delivery = await notifyCustomer(
        store,
        request.clientId,
        `request:${request.id}:resend:${resendCount}`,
        `request:${request.id}:resend:${resendCount}`,
        request.email,
        `You are invited to Robinexis\nSign in securely at ${primaryWebOrigin()}/login.`,
      );
      request.payload = {
        ...request.payload,
        delivery: delivery.queued ? "queued" : "duplicate",
        notificationId: delivery.id,
        resendCount,
      };
    }
    await store.saveTenantRequest(request);
    await store.appendOperatorAudit({
      id: newId("audit_"), clientId: request.clientId, actorId: actor.subject,
      action: `team_invite.${body.action}`, detail: { requestId: request.id }, createdAt: request.updatedAt,
    });
    send(res, 200, { request });
    return true;
  }
  const requestStatusMatch = route.match(/^\/admin\/requests\/([^/]+)\/status$/);
  if (requestStatusMatch && req.method === "POST") {
    if (!canAdministerPlatform(actor)) {
      send(res, 403, { error: "platform_admin_required" });
      return true;
    }
    const request = await store.getTenantRequest(requestStatusMatch[1]);
    if (!request) {
      send(res, 404, { error: "request_not_found" });
      return true;
    }
    const body = await readJson<{ status?: "pending" | "in_progress" | "completed" | "rejected" | "revoked" }>(ctx);
    if (!body.status) {
      send(res, 400, { error: "request_status_required" });
      return true;
    }
    request.status = body.status;
    request.updatedAt = new Date().toISOString();
    await store.saveTenantRequest(request);
    await store.appendOperatorAudit({
      id: newId("audit_"),
      clientId: request.clientId,
      actorId: actor.subject,
      action: `${request.type}.status_changed`,
      detail: { requestId: request.id, status: body.status },
      createdAt: request.updatedAt,
    });
    send(res, 200, { request });
    return true;
  }

  if (route === "/bootstrap" && req.method === "GET") {
    const clients = (await store.listClients()).filter((item) => canAccessClient(actor, item.id));
    const selected = clients.find((item) => item.id === clientId(url)) || clients[0];
    const calls = selected ? await store.listCallsForClient(selected.id, 8) : [];
    const to = new Date().toISOString();
    const from = new Date(Date.parse(to) - 30 * 24 * 60 * 60 * 1000).toISOString();
    const periodSummary = selected
      ? await store.getAnalyticsSummary(selected.id, { from, to })
      : undefined;
    const calendar = selected
      ? await probeTenantCalendar(store, selected)
      : { ok: false, error: "calcom_not_configured" };
    send(res, 200, {
      clients: clients.map((item) => safeEditableClient(item)),
      client: selected ? safeEditableClient(selected) : null,
      access: selected ? isAiServiceEnabled(selected) : null,
      features: selected?.enabledFeatures || [],
      summary: periodSummary ? {
        totalCalls: periodSummary.totalCalls,
        answeredCalls: periodSummary.completedCalls + periodSummary.transferredCalls,
        bookedAppointments: periodSummary.bookedCalls,
        transferredCalls: periodSummary.transferredCalls,
        minutesUsed: Math.round(periodSummary.totalMinutes),
        bookingRate: periodSummary.totalCalls
          ? (periodSummary.bookedCalls / periodSummary.totalCalls) * 100
          : 0,
        inbound: periodSummary.inboundCalls,
        outbound: periodSummary.outboundCalls,
      } : undefined,
      recentCalls: calls,
      integrations: selected ? integrationList(selected, calendar) : [],
      actor: {
        email: actor.email,
        role: actor.role,
        clientRoles: actor.clientRoles,
      },
    });
    return true;
  }

  if (route === "/clients" && req.method === "GET") {
    const clients = (await store.listClients()).filter((item) => canAccessClient(actor, item.id));
    send(res, 200, { items: clients.map(safeEditableClient) });
    return true;
  }
  if (route === "/clients" && req.method === "POST") {
    if (!canAdministerPlatform(actor)) {
      send(res, 403, { error: "platform_admin_required" });
      return true;
    }
    try {
      const body = await readJson<Partial<ClientConfig> & { planTier?: unknown }>(ctx);
      const planTier = isPlanTier(body.planTier) ? body.planTier : "starter";
      const plan = planDefinition(planTier);
      const created = createClient(body);
      created.subscribedProduct = planTier;
      created.monthlyMinuteLimit = plan.includedMinutes;
      await store.upsertClient(created);
      const now = new Date();
      const nowIso = now.toISOString();
      const trialEndsAt = new Date(now.getTime() + plan.trialDays * 86_400_000).toISOString();
      await store.upsertLocation({
        id: `loc_${created.id}_primary`,
        clientId: created.id,
        slug: "primary",
        name: created.businessName,
        timezone: created.callingWindow.tz,
        phone: created.phone || undefined,
        address: created.location ? { formatted: created.location } : {},
        isPrimary: true,
        createdAt: nowIso,
        updatedAt: nowIso,
      });
      await store.upsertCalendarConnection({
        id: `calendar_${created.id}_primary`,
        clientId: created.id,
        locationId: `loc_${created.id}_primary`,
        provider: created.calendar.provider,
        externalAccountId: created.calendar.username,
        credentialRef: created.calendar.credentialRef,
        status: "pending",
        metadata: {},
        createdAt: nowIso,
        updatedAt: nowIso,
      });
      await store.upsertSubscription({
        id: `subscription_${created.id}_trial`,
        clientId: created.id,
        provider: "internal",
        planTier,
        status: "trialing",
        trialEndsAt,
        cancelAtPeriodEnd: false,
        metadata: { noCardRequired: true },
        createdAt: nowIso,
        updatedAt: nowIso,
      });
      await store.appendCreditLedgerEntry({
        id: `credit_${created.id}_trial`,
        clientId: created.id,
        minutes: plan.includedMinutes,
        kind: "grant",
        referenceType: "subscription",
        referenceId: `subscription_${created.id}_trial`,
        description: `${plan.name} trial minute allocation`,
        createdAt: nowIso,
      });
      send(res, 201, safeEditableClient(created));
    } catch (err) {
      send(res, 400, { error: err instanceof Error ? err.message : "invalid_client" });
    }
    return true;
  }

  const clientMatch = route.match(/^\/clients\/([^/]+)$/);
  if (clientMatch && req.method === "GET") {
    const client = await requireClient(ctx, clientMatch[1]);
    if (client) {
      const draft = await store.getDraftClient(client.id);
      send(res, 200, {
        ...safeEditableClient(draft?.config || client),
        hasUnpublishedChanges: Boolean(draft),
      });
    }
    return true;
  }

  const serviceStatusMatch = route.match(/^\/clients\/([^/]+)\/service-status$/);
  if (serviceStatusMatch && req.method === "POST") {
    if (!canAdministerPlatform(actor)) {
      send(res, 403, { error: "platform_admin_required" });
      return true;
    }
    const client = await requireClient(ctx, serviceStatusMatch[1]);
    if (!client) return true;
    const body = await readJson<{ action?: string }>(ctx);
    if (body.action !== "suspend" && body.action !== "reactivate") {
      send(res, 400, { error: "valid_service_action_required" });
      return true;
    }
    client.serviceStatus = body.action === "suspend" ? "paused" : "active";
    await store.upsertClient(client);
    await store.appendOperatorAudit({
      id: newId("audit_"),
      clientId: client.id,
      actorId: actor.subject,
      action: `service.${body.action}`,
      detail: { serviceStatus: client.serviceStatus },
      createdAt: new Date().toISOString(),
    });
    send(res, 200, { clientId: client.id, serviceStatus: client.serviceStatus });
    return true;
  }

  const creditAdjustmentMatch = route.match(/^\/clients\/([^/]+)\/credit-adjustments$/);
  if (creditAdjustmentMatch && req.method === "POST") {
    if (!canAdministerPlatform(actor)) {
      send(res, 403, { error: "platform_admin_required" });
      return true;
    }
    const client = await requireClient(ctx, creditAdjustmentMatch[1]);
    if (!client) return true;
    const body = await readJson<{
      minutes?: number;
      reason?: string;
      idempotencyKey?: string;
    }>(ctx);
    if (
      !Number.isFinite(body.minutes) ||
      body.minutes === 0 ||
      !body.reason?.trim() ||
      !body.idempotencyKey?.trim()
    ) {
      send(res, 400, { error: "minutes_reason_and_idempotency_key_required" });
      return true;
    }
    const appended = await store.appendCreditLedgerEntry({
      id: newId("credit_adjustment_"),
      clientId: client.id,
      minutes: Number(body.minutes),
      kind: "adjustment",
      referenceType: "admin_adjustment",
      referenceId: body.idempotencyKey.trim(),
      description: `${body.reason.trim()} — ${actor.email}`,
      createdAt: new Date().toISOString(),
    });
    if (appended) {
      await store.appendOperatorAudit({
        id: newId("audit_"),
        clientId: client.id,
        actorId: actor.subject,
        action: "billing.credit_adjusted",
        detail: { minutes: Number(body.minutes), reason: body.reason.trim(), idempotencyKey: body.idempotencyKey.trim() },
        createdAt: new Date().toISOString(),
      });
    }
    send(res, appended ? 201 : 200, {
      appended,
      remainingMinutes: Math.max(0, await store.getCreditBalance(client.id)),
    });
    return true;
  }
  if (clientMatch && req.method === "PATCH") {
    const liveClient = await requireManageClient(ctx, clientMatch[1]);
    if (!liveClient) return true;
    const existingDraft = await store.getDraftClient(liveClient.id);
    const client = structuredClone(existingDraft?.config || liveClient);
    const body = await readJson<Partial<ClientConfig> & { calendar?: Record<string, unknown> }>(ctx);
    if (body.calendar && ("apiKey" in body.calendar || "token" in body.calendar || "secret" in body.calendar)) {
      send(res, 400, { error: "raw_credentials_forbidden" });
      return true;
    }
    const immutable = new Set(["id", "serviceStatus", "stripeCustomerId", "stripeSubscriptionId"]);
    const salonEditable = new Set([
      "businessName",
      "role",
      "greeting",
      "tone",
      "location",
      "phone",
      "email",
      "transferNumber",
      "inboundNumbers",
      "services",
      "staff",
      "hours",
      "prices",
      "policies",
      "publishedFacts",
      "unknownTopics",
      "calendarNoteMode",
      "callingWindow",
      "firstCampaignRequiresApproval",
    ]);
    for (const [key, value] of Object.entries(body)) {
      const permitted =
        !immutable.has(key) &&
        (canAdministerPlatform(actor) || salonEditable.has(key));
      if (permitted && value !== undefined) {
        (client as unknown as Record<string, unknown>)[key] = value;
      }
    }
    const now = new Date().toISOString();
    await store.saveDraftClient({
      id: existingDraft?.id || newId("client_revision_"),
      clientId: liveClient.id,
      status: "draft",
      config: client,
      createdBy: actor.subject,
      createdAt: existingDraft?.createdAt || now,
      updatedAt: now,
    });
    send(res, 200, {
      ...safeEditableClient(client),
      hasUnpublishedChanges: true,
    });
    return true;
  }

  const websiteIntelligenceMatch = route.match(/^\/clients\/([^/]+)\/website-intelligence$/);
  if (websiteIntelligenceMatch && req.method === "POST") {
    const client = await requireManageClient(ctx, websiteIntelligenceMatch[1]);
    if (!client) return true;
    const body = await readJson<{ url?: string }>(ctx);
    let verifiedUrl: URL;
    try {
      verifiedUrl = validatePublicWebsiteUrl(String(body.url || ""));
    } catch (error) {
      send(res, 400, { error: error instanceof Error ? error.message : "invalid_website_url" });
      return true;
    }
    const now = new Date().toISOString();
    const existingSource = (await store.listWebsiteSources(client.id))
      .find((source) => source.url === verifiedUrl.toString());
    const source: WebsiteSource = existingSource || {
      id: newId("website_source_"),
      clientId: client.id,
      url: verifiedUrl.toString(),
      status: "pending" as const,
      metadata: {},
      createdAt: now,
      updatedAt: now,
    };
    source.status = "pending";
    source.updatedAt = now;
    await store.saveWebsiteSource(source);
    const run: WebsiteExtractionRun = {
      id: newId("website_run_"),
      clientId: client.id,
      sourceId: source.id,
      status: "running" as const,
      extractorVersion: WEBSITE_EXTRACTOR_VERSION,
      startedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    await store.saveWebsiteExtractionRun(run);
    await store.appendOperatorAudit({
      id: newId("audit_"), clientId: client.id, actorId: actor.subject,
      action: "website_intelligence.scan_started",
      detail: { runId: run.id, sourceId: source.id, url: source.url },
      createdAt: now,
    });
    try {
      const result = await new FirecrawlWebsiteClient().extract(source.url);
      const completedAt = new Date().toISOString();
      const facts: ExtractedFact[] = result.facts.map((fact) => ({
        id: `website_fact_${run.id}_${fact.key}`,
        clientId: client.id,
        extractionRunId: run.id,
        key: fact.key,
        value: fact.value,
        confidence: fact.confidence,
        sourceEvidence: JSON.stringify(fact.evidence),
        reviewStatus: "extracted",
        createdAt: completedAt,
      }));
      await store.replaceExtractedFacts(client.id, run.id, facts);
      const gaps = await refreshWebsiteGaps(store, client.id, result.facts, completedAt);
      Object.assign(run, {
        status: "succeeded" as const,
        finishedAt: completedAt,
        updatedAt: completedAt,
      });
      source.status = "active";
      source.lastFetchedAt = completedAt;
      source.metadata = {
        ...source.metadata,
        pageCount: result.pages,
        contentChecksum: createHash("sha256").update(result.markdown).digest("hex"),
        contentChars: result.markdown.length,
        latestRunId: run.id,
        indexingStatus: "awaiting_approval",
      };
      source.updatedAt = completedAt;
      await store.saveWebsiteSource(source);
      await store.saveWebsiteExtractionRun(run);
      await store.saveOnboardingOutbox({
        id: newId("outbox_"),
        clientId: client.id,
        topic: "website_intelligence.extracted",
        idempotencyKey: `website-extracted:${run.id}`,
        payload: { runId: run.id, sourceId: source.id, factCount: facts.length, gapCount: gaps.length },
        attemptCount: 0,
        createdAt: completedAt,
        updatedAt: completedAt,
      });
      await store.appendOperatorAudit({
        id: newId("audit_"), clientId: client.id, actorId: actor.subject,
        action: "website_intelligence.scan_completed",
        detail: { runId: run.id, factCount: facts.length, gapCount: gaps.length, pages: result.pages },
        createdAt: completedAt,
      });
      await notifyCustomer(
        store, client.id, run.id, `website-scan-complete:${client.id}:${run.id}`,
        client.email,
        "Your website scan is ready\nReview and confirm the extracted business facts in your Robinexis workspace.",
      );
      send(res, 201, {
        run,
        source: { id: source.id, url: source.url, status: source.status },
        facts: facts.map(publicWebsiteFact),
        gaps: await store.listOnboardingGaps(client.id),
      });
    } catch (error) {
      const failedAt = new Date().toISOString();
      const message = error instanceof Error ? error.message : "website_scan_failed";
      run.status = "failed";
      run.error = message.slice(0, 500);
      run.finishedAt = failedAt;
      run.updatedAt = failedAt;
      source.status = "failed";
      source.updatedAt = failedAt;
      source.metadata = { ...source.metadata, latestRunId: run.id };
      await store.saveWebsiteSource(source);
      await store.saveWebsiteExtractionRun(run);
      await store.appendOperatorAudit({
        id: newId("audit_"), clientId: client.id, actorId: actor.subject,
        action: "website_intelligence.scan_failed",
        detail: { runId: run.id, error: run.error }, createdAt: failedAt,
      });
      send(res, message === "firecrawl_not_configured" ? 503 : 502, { error: message, run });
    }
    return true;
  }
  if (websiteIntelligenceMatch && req.method === "GET") {
    const client = await requireClient(ctx, websiteIntelligenceMatch[1]);
    if (!client) return true;
    const sources = await store.listWebsiteSources(client.id);
    const runs = await store.listWebsiteExtractionRuns(client.id);
    const requestedRunId = url.searchParams.get("runId");
    const run = requestedRunId
      ? await store.getWebsiteExtractionRun(client.id, requestedRunId)
      : [...runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (requestedRunId && !run) {
      send(res, 404, { error: "website_scan_not_found" });
      return true;
    }
    send(res, 200, {
      sources: sources.map((source) => ({
        id: source.id,
        url: source.url,
        status: source.status,
        lastFetchedAt: source.lastFetchedAt,
        indexingStatus: source.metadata.indexingStatus,
      })),
      run: run || null,
      facts: run ? (await store.listExtractedFacts(client.id, run.id)).map(publicWebsiteFact) : [],
      gaps: await store.listOnboardingGaps(client.id),
    });
    return true;
  }

  const websiteFactMatch = route.match(/^\/clients\/([^/]+)\/website-intelligence\/runs\/([^/]+)\/facts\/([^/]+)$/);
  if (websiteFactMatch && req.method === "PATCH") {
    const client = await requireManageClient(ctx, websiteFactMatch[1]);
    if (!client) return true;
    const run = await store.getWebsiteExtractionRun(client.id, websiteFactMatch[2]);
    const fact = run
      ? (await store.listExtractedFacts(client.id, run.id)).find((item) => item.id === websiteFactMatch[3])
      : undefined;
    if (!run || !fact) {
      send(res, 404, { error: "website_fact_not_found" });
      return true;
    }
    const body = await readJson<{ action?: "confirm" | "edit"; value?: unknown }>(ctx);
    if (!body.action || (body.action === "edit" && body.value === undefined)) {
      send(res, 400, { error: "confirm_or_edit_action_required" });
      return true;
    }
    if (body.action === "edit") {
      const size = Buffer.byteLength(JSON.stringify(body.value));
      if (size > 100_000) {
        send(res, 413, { error: "fact_value_too_large" });
        return true;
      }
      fact.value = body.value;
      fact.confidence = 1;
    }
    fact.reviewStatus = body.action === "edit" ? "edited" : "confirmed";
    fact.reviewedBy = actor.subject;
    fact.reviewedAt = new Date().toISOString();
    await store.saveExtractedFact(fact);
    const reviewedRunFacts = await store.listExtractedFacts(client.id, run.id);
    await refreshWebsiteGaps(
      store,
      client.id,
      reviewedRunFacts.map((item) => ({
        key: item.key as NormalizedWebsiteFact["key"],
        value: item.value,
      })),
      fact.reviewedAt,
    );
    await store.appendOperatorAudit({
      id: newId("audit_"), clientId: client.id, actorId: actor.subject,
      action: `website_intelligence.fact_${body.action === "edit" ? "edited" : "confirmed"}`,
      detail: { runId: run.id, factId: fact.id, key: fact.key },
      createdAt: fact.reviewedAt,
    });
    send(res, 200, { fact: publicWebsiteFact(fact) });
    return true;
  }

  const websiteApproveMatch = route.match(/^\/clients\/([^/]+)\/website-intelligence\/runs\/([^/]+)\/approve-indexing$/);
  if (websiteApproveMatch && req.method === "POST") {
    const client = await requireManageClient(ctx, websiteApproveMatch[1]);
    if (!client) return true;
    const run = await store.getWebsiteExtractionRun(client.id, websiteApproveMatch[2]);
    if (!run || run.status !== "succeeded") {
      send(res, 404, { error: "successful_website_scan_not_found" });
      return true;
    }
    const allFacts = await store.listExtractedFacts(client.id, run.id);
    const reviewedFacts = normalizedReviewedFacts(allFacts);
    if (!reviewedFacts.length || allFacts.some((fact) => fact.reviewStatus === "extracted")) {
      send(res, 409, { error: "all_website_facts_require_review" });
      return true;
    }
    const source = await store.getWebsiteSource(client.id, run.sourceId);
    if (!source) {
      send(res, 404, { error: "website_source_not_found" });
      return true;
    }
    const body = await readJson<{ indexKnowledge?: boolean }>(ctx);
    const existingDraft = await store.getDraftClient(client.id);
    const draft = applyApprovedWebsiteFacts(existingDraft?.config || client, reviewedFacts);
    const now = new Date().toISOString();
    await store.saveDraftClient({
      id: existingDraft?.id || newId("client_revision_"),
      clientId: client.id,
      status: "draft",
      config: draft,
      createdBy: actor.subject,
      createdAt: existingDraft?.createdAt || now,
      updatedAt: now,
    });
    const markdown = approvedWebsiteMarkdown(source.url, reviewedFacts);
    let knowledgeDocument;
    let indexingStatus = "not_requested";
    let indexingError: string | undefined;
    if (body.indexKnowledge !== false) {
      const service = knowledgeService(store);
      if (service) {
        try {
          knowledgeDocument = await service.index({
            clientId: client.id,
            title: `Approved website facts — ${draft.businessName}`,
            sourceType: "markdown",
            sourceUri: source.url,
            content: markdown,
            metadata: { websiteSourceId: source.id, extractionRunId: run.id, approvedBy: actor.subject },
          });
          indexingStatus = knowledgeDocument.status;
        } catch (error) {
          indexingStatus = "failed";
          indexingError = error instanceof Error ? error.message.slice(0, 500) : "knowledge_index_failed";
        }
      } else {
        indexingStatus = "approved_pending_gemini";
      }
    }
    source.metadata = {
      ...source.metadata,
      indexingStatus,
      approvedRunId: run.id,
      approvedAt: now,
      approvedBy: actor.subject,
      knowledgeDocumentId: knowledgeDocument?.id,
      indexingError,
    };
    source.updatedAt = now;
    await store.saveWebsiteSource(source);
    await store.saveOnboardingOutbox({
      id: newId("outbox_"), clientId: client.id, topic: "website_intelligence.approved",
      idempotencyKey: `website-approved:${run.id}`,
      payload: { runId: run.id, sourceId: source.id, knowledgeDocumentId: knowledgeDocument?.id },
      attemptCount: 0, createdAt: now, updatedAt: now,
    });
    await store.appendOperatorAudit({
      id: newId("audit_"), clientId: client.id, actorId: actor.subject,
      action: "website_intelligence.indexing_approved",
      detail: { runId: run.id, sourceId: source.id, factCount: reviewedFacts.length, indexingStatus, indexingError },
      createdAt: now,
    });
    send(res, 200, {
      approved: true,
      published: false,
      draft: safeEditableClient(draft),
      indexingStatus,
      indexingError,
      knowledgeDocument: publicKnowledgeDocument(knowledgeDocument),
    });
    return true;
  }

  const onboardingWizardMatch = route.match(/^\/clients\/([^/]+)\/onboarding\/wizard$/);
  if (onboardingWizardMatch && req.method === "GET") {
    const client = await requireManageClient(ctx, onboardingWizardMatch[1]);
    if (!client) return true;
    const draft = await store.getDraftClient(client.id);
    const effectiveClient = draft?.config || client;
    const wizard = await store.getOnboardingWizard(client.id) || initialOnboardingWizard(effectiveClient);
    if (!(await store.getOnboardingWizard(client.id))) await store.saveOnboardingWizard(wizard);
    const runs = await store.listProvisioningRuns(client.id);
    send(res, 200, {
      client: safeEditableClient(effectiveClient),
      wizard,
      readiness: await onboardingReadiness(store, wizard),
      provisioning: runs[0] ? {
        ...runs[0],
        claimToken: undefined,
        output: publicProvisioningOutput(runs[0].output),
      } : null,
    });
    return true;
  }
  if (onboardingWizardMatch && req.method === "PATCH") {
    const client = await requireManageClient(ctx, onboardingWizardMatch[1]);
    if (!client) return true;
    const body = await readJson<{
      currentStep?: OnboardingWizardStep;
      completedStep?: OnboardingWizardStep;
      data?: Partial<OnboardingWizardData>;
      expectedVersion?: number;
    }>(ctx);
    if ((body.currentStep && !onboardingWizardSteps.includes(body.currentStep)) ||
        (body.completedStep && !onboardingWizardSteps.includes(body.completedStep))) {
      send(res, 400, { error: "invalid_onboarding_step" });
      return true;
    }
    const existing = await store.getOnboardingWizard(client.id) || initialOnboardingWizard(client);
    if (body.expectedVersion !== undefined && body.expectedVersion !== existing.version) {
      send(res, 409, { error: "onboarding_wizard_changed", wizard: existing });
      return true;
    }
    const allowedData = new Set([
      "websiteUrl", "websiteRunId", "businessName", "location", "greeting", "tone",
      "transferNumber", "recordingConsent", "services", "hours", "timezone",
      "bookingRules", "phoneMode", "customerPhoneNumber", "calendarMode",
      "existingCalendarProvider", "calendarSchedule",
    ]);
    const data = { ...existing.data };
    for (const [key, value] of Object.entries(body.data || {})) {
      if (allowedData.has(key) && value !== undefined) (data as Record<string, unknown>)[key] = value;
    }
    const updated: OnboardingWizardState = {
      ...existing,
      data,
      currentStep: body.currentStep || existing.currentStep,
      completedSteps: [...existing.completedSteps],
      version: existing.version + 1,
      updatedAt: new Date().toISOString(),
    };
    if (body.completedStep) {
      const readiness = await onboardingReadiness(store, updated);
      const stepBlockers = readiness.blockers.filter((blocker) => blocker.step === body.completedStep);
      if (stepBlockers.length) {
        send(res, 400, { error: "onboarding_step_incomplete", blockers: stepBlockers, wizard: updated });
        return true;
      }
      if (!updated.completedSteps.includes(body.completedStep)) updated.completedSteps.push(body.completedStep);
    }
    await store.saveOnboardingWizard(updated);
    send(res, 200, { wizard: updated, readiness: await onboardingReadiness(store, updated) });
    return true;
  }

  const onboardingWizardSubmitMatch = route.match(/^\/clients\/([^/]+)\/onboarding\/wizard\/submit$/);
  if (onboardingWizardSubmitMatch && req.method === "POST") {
    const liveClient = await requireManageClient(ctx, onboardingWizardSubmitMatch[1]);
    if (!liveClient) return true;
    if (protectedAutomationTarget(liveClient)) {
      send(res, 409, { error: "protected_blades_automation_target" });
      return true;
    }
    const subscription = await store.getCurrentSubscription(liveClient.id);
    if (!subscription || !["active", "trialing"].includes(subscription.status)) {
      send(res, 402, { error: "active_subscription_required" });
      return true;
    }
    const wizard = await store.getOnboardingWizard(liveClient.id);
    if (!wizard) {
      send(res, 409, { error: "onboarding_wizard_not_started" });
      return true;
    }
    const readiness = await onboardingReadiness(store, wizard);
    if (!readiness.ready) {
      send(res, 409, { error: "onboarding_not_ready", readiness });
      return true;
    }
    const transitionFrom = liveClient.onboardingStatus ?? "integrations_required";
    if (!canTransitionOnboarding(transitionFrom, "ready_to_provision")) {
      send(res, 409, {
        error: `invalid_onboarding_transition:${transitionFrom}:ready_to_provision`,
      });
      return true;
    }
    const existingDraft = await store.getDraftClient(liveClient.id);
    const client = structuredClone(existingDraft?.config || liveClient);
    const data = wizard.data;
    Object.assign(client, {
      businessName: data.businessName!.trim(),
      location: data.location?.trim() || "",
      greeting: data.greeting!.trim(),
      tone: data.tone!.trim(),
      transferNumber: data.transferNumber!,
      services: data.services!,
      hours: data.hours!.trim(),
      policies: [data.bookingRules!.trim(), `Recording consent: ${data.recordingConsent}`],
      phoneAcquisitionMode: data.phoneMode === "customer_twilio" ? "customer_oauth" : "robinexis_account",
      requestedPhoneNumber: data.phoneMode === "customer_twilio" ? data.customerPhoneNumber : undefined,
      callingWindow: { ...client.callingWindow, tz: data.timezone! },
      calendar: {
        ...client.calendar,
        provider: data.calendarMode === "managed_calcom" ? "calcom" : data.existingCalendarProvider!,
        schedule: data.calendarSchedule,
      },
      onboardingStatus: "ready_to_provision",
      published: false,
    });
    const now = new Date().toISOString();
    await store.saveDraftClient({
      id: existingDraft?.id || newId("client_revision_"),
      clientId: client.id,
      status: "draft",
      config: client,
      createdBy: actor.subject,
      createdAt: existingDraft?.createdAt || now,
      updatedAt: now,
    });
    await store.upsertClient(client);
    wizard.currentStep = "review";
    wizard.completedSteps = [...new Set([...wizard.completedSteps, ...onboardingWizardSteps])];
    wizard.submittedAt = now;
    wizard.updatedAt = now;
    wizard.version += 1;
    await store.saveOnboardingWizard(wizard);
    await store.appendOperatorAudit({
      id: newId("audit_"), clientId: client.id, actorId: actor.subject,
      action: "onboarding.completed",
      detail: { source: "onboarding_wizard", phoneMode: data.phoneMode, calendarMode: data.calendarMode },
      createdAt: now,
    });
    const operationKey = `onboarding-${wizard.version}`;
    const automationEnabled =
      process.env.SAAS_PROVISIONING_ENABLED === "true" && client.id !== BLADES_HAIR_ID;
    if (automationEnabled) {
      await store.enqueueOnboardingJob({
        id: newId("job_"),
        clientId: client.id,
        kind: "provision_client",
        idempotencyKey: `provision:${operationKey}`,
        status: "pending",
        payload: { operationKey },
        attemptCount: 0,
        maxAttempts: 5,
        availableAt: now,
        createdAt: now,
        updatedAt: now,
      });
    }
    await notifyCustomer(store, client.id, `wizard:${wizard.version}`, `wizard-submit:${client.id}:${wizard.version}`, client.email, "Robinexis setup received\nYour readiness report is available. We will test the staged receptionist and ask for owner approval before activation.");
    send(res, 202, {
      client: safeEditableClient(client),
      wizard,
      onboardingStatus: "ready_to_provision",
      automationEnabled,
      message: automationEnabled
        ? "Your setup passed prechecks and provisioning is queued."
        : "Your setup is ready. Provider automation is disabled, so no provider changes were made.",
    });
    return true;
  }

  const onboardingMatch = route.match(/^\/clients\/([^/]+)\/onboarding$/);
  if (onboardingMatch && req.method === "GET") {
    const client = await requireManageClient(ctx, onboardingMatch[1]);
    if (!client) return true;
    const draft = await store.getDraftClient(client.id);
    const runs = await store.listProvisioningRuns(client.id);
    send(res, 200, {
      client: safeEditableClient(draft?.config || client),
      provisioning: runs[0] ? {
        ...runs[0],
        claimToken: undefined,
        output: publicProvisioningOutput(runs[0].output),
      } : null,
    });
    return true;
  }
  if (onboardingMatch && req.method === "PATCH") {
    const client = await requireManageClient(ctx, onboardingMatch[1]);
    if (!client) return true;
    const existingDraft = await store.getDraftClient(client.id);
    const draft = structuredClone(existingDraft?.config || client);
    const body = await readJson<Partial<Pick<ClientConfig,
      "businessName" | "greeting" | "tone" | "location" | "phone" |
      "transferNumber" | "hours" | "prices" | "policies" | "publishedFacts" |
      "services" | "phoneAcquisitionMode" | "requestedPhoneNumber"
    >>>(ctx);
    const allowed = new Set([
      "businessName", "greeting", "tone", "location", "phone", "transferNumber",
      "hours", "prices", "policies", "publishedFacts", "services",
      "phoneAcquisitionMode", "requestedPhoneNumber",
    ]);
    for (const [key, value] of Object.entries(body)) {
      if (allowed.has(key) && value !== undefined) {
        (draft as unknown as Record<string, unknown>)[key] = value;
      }
    }
    draft.onboardingStatus = "details_required";
    const now = new Date().toISOString();
    await store.saveDraftClient({
      id: existingDraft?.id || newId("client_revision_"),
      clientId: client.id,
      status: "draft",
      config: draft,
      createdBy: actor.subject,
      createdAt: existingDraft?.createdAt || now,
      updatedAt: now,
    });
    send(res, 200, { client: safeEditableClient(draft) });
    return true;
  }

  const twilioConnectionMatch = route.match(/^\/clients\/([^/]+)\/twilio-connection$/);
  if (twilioConnectionMatch && req.method === "GET") {
    const client = await requireManageClient(ctx, twilioConnectionMatch[1]);
    if (!client) return true;
    const connection = await store.getTwilioConnection(client.id);
    send(res, 200, {
      mode: connection?.mode || client.phoneAcquisitionMode || "robinexis_account",
      status: connection?.status || "not_connected",
      accountSidMasked: connection?.accountSid
        ? `${connection.accountSid.slice(0, 4)}…${connection.accountSid.slice(-4)}`
        : undefined,
      selectedPhoneNumber: connection?.selectedPhoneNumber,
      verifiedPhoneNumber: typeof connection?.metadata.verifiedPhoneNumber === "string"
        ? connection.metadata.verifiedPhoneNumber
        : undefined,
      canReconnect: !connection || ["expired", "revoked", "failed"].includes(connection.status),
    });
    return true;
  }
  const twilioStartMatch = route.match(/^\/clients\/([^/]+)\/twilio-connection\/start$/);
  if (twilioStartMatch && req.method === "POST") {
    const client = await requireManageClient(ctx, twilioStartMatch[1]);
    if (!client) return true;
    const returnTo = new URL("/onboarding", primaryWebOrigin()).toString();
    try {
      const state = createTwilioOAuthState({ clientId: client.id, returnTo });
      const now = new Date().toISOString();
      const existing = await store.getTwilioConnection(client.id);
      await store.upsertTwilioConnection({
        id: existing?.id || newId("twilio_connection_"),
        clientId: client.id,
        mode: "customer_oauth",
        accountSid: existing?.accountSid,
        encryptedAccessToken: existing?.encryptedAccessToken,
        encryptedRefreshToken: existing?.encryptedRefreshToken,
        accessTokenExpiresAt: existing?.accessTokenExpiresAt,
        apiKeySid: existing?.apiKeySid,
        encryptedApiKeySecret: existing?.encryptedApiKeySecret,
        encryptedAccountAuthToken: existing?.encryptedAccountAuthToken,
        selectedPhoneNumber: existing?.selectedPhoneNumber,
        status: existing?.status || "pending",
        metadata: { ...existing?.metadata, reconnectPendingAt: now },
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      });
      send(res, 200, { url: twilioOAuthAuthorizeUrl(state) });
    } catch (error) {
      send(res, 503, { error: error instanceof Error ? error.message : "twilio_oauth_not_configured" });
    }
    return true;
  }
  const twilioCredentialsMatch = route.match(/^\/clients\/([^/]+)\/twilio-connection\/credentials$/);
  if (twilioCredentialsMatch && req.method === "POST") {
    const client = await requireManageClient(ctx, twilioCredentialsMatch[1]);
    if (!client) return true;
    const connection = await store.getTwilioConnection(client.id);
    const body = await readJson<{
      apiKeySid?: string;
      apiKeySecret?: string;
      accountAuthToken?: string;
      twilioNumber?: string;
    }>(ctx);
    if (
      !connection?.accountSid ||
      connection.mode !== "customer_oauth" ||
      !body.apiKeySid?.match(/^SK[0-9a-f]{32}$/i) ||
      !body.apiKeySecret ||
      !body.accountAuthToken ||
      !body.twilioNumber?.match(/^\+[1-9]\d{7,14}$/)
    ) {
      send(res, 400, { error: "connected_account_api_key_and_number_required" });
      return true;
    }
    try {
      const owned = await findOwnedTwilioNumber(body.twilioNumber, {
        accountSid: connection.accountSid,
        apiKeySid: body.apiKeySid,
        apiKeySecret: body.apiKeySecret,
      });
      if (!owned) {
        send(res, 409, { error: "twilio_number_transfer_or_connect_required" });
        return true;
      }
      const claimed = await store.findPhoneEndpointByE164(body.twilioNumber);
      if (claimed && claimed.clientId !== client.id) {
        send(res, 409, { error: "phone_number_claimed_by_another_tenant" });
        return true;
      }
      const now = new Date().toISOString();
      connection.apiKeySid = body.apiKeySid;
      connection.encryptedApiKeySecret = encryptTwilioCredential(body.apiKeySecret);
      connection.encryptedAccountAuthToken = encryptTwilioCredential(body.accountAuthToken);
      connection.selectedPhoneNumber = body.twilioNumber;
      connection.status = "active";
      connection.metadata = {
        ...connection.metadata,
        verifiedPhoneSid: owned.sid,
        verifiedPhoneNumber: owned.phoneNumber,
        verifiedAt: now,
      };
      connection.updatedAt = now;
      await store.upsertTwilioConnection(connection);
      await store.upsertPhoneEndpoint({
        id: `phone_twilio_${client.id}`,
        clientId: client.id,
        provider: "twilio",
        e164: owned.phoneNumber,
        providerEndpointId: owned.sid,
        direction: "inbound",
        status: "pending",
        metadata: { acquisitionMode: "customer_oauth", connectionId: connection.id },
        createdAt: now,
        updatedAt: now,
      });
      await store.upsertProviderResource({
        id: `provider_twilio_number_${client.id}`,
        clientId: client.id,
        provider: "twilio",
        resourceType: "phone_number",
        providerResourceId: owned.sid,
        lifecycleStatus: "active",
        metadata: { e164: owned.phoneNumber, acquisitionMode: "customer_oauth" },
        createdAt: now,
        updatedAt: now,
      });
      await store.appendOperatorAudit({
        id: newId("audit_"), clientId: client.id, actorId: actor.subject,
        action: "twilio.customer_number_verified",
        detail: { phoneNumber: owned.phoneNumber, connectionId: connection.id },
        createdAt: now,
      });
      await store.saveOnboardingOutbox({
        id: newId("outbox_"), clientId: client.id, topic: "twilio.customer_number_verified",
        idempotencyKey: `twilio-customer-number:${connection.id}:${owned.sid || owned.phoneNumber}`,
        payload: { phoneNumber: owned.phoneNumber, connectionId: connection.id },
        attemptCount: 0, createdAt: now, updatedAt: now,
      });
      send(res, 200, {
        mode: connection.mode,
        status: connection.status,
        accountSidMasked: `${connection.accountSid.slice(0, 4)}…${connection.accountSid.slice(-4)}`,
        selectedPhoneNumber: connection.selectedPhoneNumber,
        verifiedPhoneNumber: owned.phoneNumber,
        canReconnect: false,
      });
    } catch (error) {
      send(res, 400, { error: error instanceof Error ? error.message : "twilio_credentials_invalid" });
    }
    return true;
  }
  const twilioNumbersMatch = route.match(/^\/clients\/([^/]+)\/twilio-connection\/numbers$/);
  if (twilioNumbersMatch && req.method === "GET") {
    const client = await requireManageClient(ctx, twilioNumbersMatch[1]);
    if (!client) return true;
    const connection = await store.getTwilioConnection(client.id);
    if (
      !connection?.accountSid ||
      !connection.apiKeySid ||
      !connection.encryptedApiKeySecret ||
      connection.status !== "active"
    ) {
      send(res, 409, { error: "active_customer_twilio_connection_required" });
      return true;
    }
    try {
      const numbers = await listOwnedTwilioNumbers({
        accountSid: connection.accountSid,
        apiKeySid: connection.apiKeySid,
        apiKeySecret: decryptTwilioCredential(connection.encryptedApiKeySecret),
      });
      send(res, 200, {
        items: numbers.map((number) => ({
          phoneNumber: number.phoneNumber,
          selected: number.phoneNumber === connection.selectedPhoneNumber,
        })),
      });
    } catch (error) {
      connection.status = "expired";
      connection.updatedAt = new Date().toISOString();
      await store.upsertTwilioConnection(connection);
      send(res, 401, { error: "twilio_customer_connection_reconnect_required" });
    }
    return true;
  }
  const twilioManagedMatch = route.match(/^\/clients\/([^/]+)\/twilio-connection\/managed$/);
  if (twilioManagedMatch && req.method === "POST") {
    const client = await requireManageClient(ctx, twilioManagedMatch[1]);
    if (!client) return true;
    const isOwnerOrOperator =
      actor.role === "operator" || actor.clientRoles[client.id] === "owner";
    if (!isOwnerOrOperator) {
      send(res, 403, { error: "twilio_managed_owner_confirmation_required" });
      return true;
    }
    if (process.env.TWILIO_MANAGED_PROVISIONING_ENABLED !== "true") {
      send(res, 503, { error: "twilio_managed_provisioning_disabled" });
      return true;
    }
    const subscription = await store.getCurrentSubscription(client.id);
    const tier = subscription?.planTier || "starter";
    const entitlement = planDefinition(tier).phoneProvisioning;
    if (!entitlement.managed) {
      send(res, 403, { error: "twilio_managed_plan_required" });
      return true;
    }
    const body = await readJson<{
      operationKey?: string;
      countryCode?: string;
      numberType?: "local" | "tollFree";
      areaCode?: string;
      contains?: string;
      selectedPhoneNumber?: string;
      confirmsPurchaseCost?: boolean;
      confirmsRegulatoryRequirements?: boolean;
      regulatoryBundleSid?: string;
      emergencyAddressSid?: string;
      estimatedMonthlyCostPence?: number;
      monthlySpendCapPence?: number;
    }>(ctx);
    const operationKey = body.operationKey?.trim() || "";
    const resources = await store.listProviderResources(client.id);
    const existingNumber = resources.find((resource) =>
      resource.provider === "twilio" &&
      resource.resourceType === "phone_number" &&
      resource.metadata.operationKey === operationKey &&
      resource.lifecycleStatus !== "deleted");
    if (existingNumber) {
      send(res, existingNumber.lifecycleStatus === "failed" ? 409 : 200, {
        idempotent: true,
        status: existingNumber.lifecycleStatus === "failed" ? "needs_attention" : existingNumber.lifecycleStatus,
        phoneNumber: existingNumber.metadata.e164,
      });
      return true;
    }
    const requestedCap = Number(body.monthlySpendCapPence ?? entitlement.monthlySpendCapPence);
    if (requestedCap > entitlement.monthlySpendCapPence) {
      send(res, 409, { error: "twilio_managed_plan_spend_cap_exceeded" });
      return true;
    }
    const request = {
      clientId: client.id,
      tenantSlug: client.slug,
      operationKey,
      countryCode: (body.countryCode || "GB").toUpperCase(),
      numberType: body.numberType || "local",
      areaCode: body.areaCode,
      contains: body.contains,
      selectedPhoneNumber: body.selectedPhoneNumber,
      friendlyName: `${client.businessName} main line`,
      voiceUrl: process.env.TWILIO_MANAGED_VOICE_URL || "",
      statusCallbackUrl: `${process.env.API_PUBLIC_BASE_URL || ""}/webhooks/twilio/number-status?clientId=${encodeURIComponent(client.id)}`,
      confirmedBy: actor.subject,
      confirmsPurchaseCost: body.confirmsPurchaseCost === true,
      confirmsRegulatoryRequirements: body.confirmsRegulatoryRequirements === true,
      regulatoryBundleSid: body.regulatoryBundleSid,
      emergencyAddressSid: body.emergencyAddressSid,
      monthlySpendCapPence: requestedCap,
      estimatedMonthlyCostPence: Number(body.estimatedMonthlyCostPence ?? 0),
    };
    const now = new Date().toISOString();
    try {
      const result = await provisionManagedTwilioNumber(
        request,
        new TwilioHttpManagementAdapter(
          process.env.TWILIO_ACCOUNT_SID || "",
          process.env.TWILIO_AUTH_TOKEN || "",
        ),
      );
      await store.upsertProviderResource({
        id: `provider_twilio_subaccount_${client.id}`,
        clientId: client.id,
        provider: "twilio",
        resourceType: "subaccount",
        providerResourceId: result.subaccount.sid,
        lifecycleStatus: "active",
        metadata: { operationKey, friendlyName: result.subaccount.friendlyName },
        createdAt: now,
        updatedAt: now,
      });
      if (result.purchasedNumber) {
        const claimed = await store.findPhoneEndpointByE164(result.purchasedNumber.phoneNumber);
        if (claimed && claimed.clientId !== client.id) throw new Error("phone_number_claimed_by_another_tenant");
        await store.upsertProviderResource({
          id: `provider_twilio_number_${client.id}`,
          clientId: client.id,
          provider: "twilio",
          resourceType: "phone_number",
          providerResourceId: result.purchasedNumber.sid,
          lifecycleStatus: "active",
          metadata: {
            operationKey, e164: result.purchasedNumber.phoneNumber,
            acquisitionMode: "robinexis_account", neverAutoRelease: true,
          },
          createdAt: now,
          updatedAt: now,
        });
        await store.upsertPhoneEndpoint({
          id: `phone_twilio_${client.id}`,
          clientId: client.id,
          provider: "twilio",
          e164: result.purchasedNumber.phoneNumber,
          providerEndpointId: result.purchasedNumber.sid,
          direction: "inbound",
          status: "pending",
          metadata: { acquisitionMode: "robinexis_account", operationKey },
          createdAt: now,
          updatedAt: now,
        });
        const existingConnection = await store.getTwilioConnection(client.id);
        await store.upsertTwilioConnection({
          id: existingConnection?.id || newId("twilio_connection_"),
          clientId: client.id,
          mode: "robinexis_account",
          accountSid: result.subaccount.sid,
          selectedPhoneNumber: result.purchasedNumber.phoneNumber,
          regulatoryBundleSid: body.regulatoryBundleSid,
          emergencyAddressSid: body.emergencyAddressSid,
          monthlySpendCapPence: requestedCap,
          purchaseConfirmedBy: actor.subject,
          purchaseConfirmedAt: now,
          status: "active",
          metadata: { operationKey, providerPhoneSid: result.purchasedNumber.sid },
          createdAt: existingConnection?.createdAt || now,
          updatedAt: now,
        });
        await store.appendOperatorAudit({
          id: newId("audit_"), clientId: client.id, actorId: actor.subject,
          action: "twilio.managed_number_purchased",
          detail: {
            operationKey, phoneNumber: result.purchasedNumber.phoneNumber,
            estimatedMonthlyCostPence: request.estimatedMonthlyCostPence,
            monthlySpendCapPence: requestedCap,
            regulatoryConfirmed: true,
          },
          createdAt: now,
        });
        await store.saveOnboardingOutbox({
          id: newId("outbox_"), clientId: client.id, topic: "twilio.managed_number_purchased",
          idempotencyKey: `twilio-managed:${operationKey}`,
          payload: { phoneNumber: result.purchasedNumber.phoneNumber, providerPhoneSid: result.purchasedNumber.sid },
          attemptCount: 0, createdAt: now, updatedAt: now,
        });
      }
      send(res, 200, {
        status: result.purchasedNumber ? "active" : "available",
        availableNumbers: result.availableNumbers,
        phoneNumber: result.purchasedNumber?.phoneNumber,
      });
    } catch (error) {
      if (error instanceof TwilioManagedNeedsAttentionError && error.result.purchasedNumber) {
        const purchased = error.result.purchasedNumber;
        await store.upsertProviderResource({
          id: `provider_twilio_subaccount_${client.id}`,
          clientId: client.id,
          provider: "twilio",
          resourceType: "subaccount",
          providerResourceId: error.result.subaccount.sid,
          lifecycleStatus: "active",
          metadata: { operationKey, friendlyName: error.result.subaccount.friendlyName },
          createdAt: now,
          updatedAt: now,
        });
        await store.upsertProviderResource({
          id: `provider_twilio_number_${client.id}`,
          clientId: client.id,
          provider: "twilio",
          resourceType: "phone_number",
          providerResourceId: purchased.sid,
          lifecycleStatus: "failed",
          metadata: {
            operationKey, e164: purchased.phoneNumber, acquisitionMode: "robinexis_account",
            neverAutoRelease: true, needsAttention: true, compensation: "manual_callback_configuration",
          },
          lastError: String(error.cause),
          createdAt: now,
          updatedAt: now,
        });
        client.onboardingStatus = "needs_attention";
        client.onboardingNotes = "A Twilio number was purchased but callback configuration needs manual attention. Do not release it automatically.";
        await store.upsertClient(client);
        await store.appendOperatorAudit({
          id: newId("audit_"), clientId: client.id, actorId: actor.subject,
          action: "twilio.managed_number_needs_attention",
          detail: { operationKey, phoneNumber: purchased.phoneNumber, neverAutoRelease: true },
          createdAt: now,
        });
        send(res, 502, { error: error.message, status: "needs_attention" });
        return true;
      }
      const message = error instanceof Error ? error.message : "twilio_managed_provisioning_failed";
      const status = message === "twilio_managed_provisioning_disabled" ? 503 : 400;
      send(res, status, { error: message });
    }
    return true;
  }
  if (twilioConnectionMatch && req.method === "DELETE") {
    const client = await requireManageClient(ctx, twilioConnectionMatch[1]);
    if (!client) return true;
    const connection = await store.getTwilioConnection(client.id);
    if (connection) {
      const now = new Date().toISOString();
      connection.status = "revoked";
      connection.encryptedAccessToken = undefined;
      connection.encryptedRefreshToken = undefined;
      connection.encryptedApiKeySecret = undefined;
      connection.encryptedAccountAuthToken = undefined;
      connection.accessTokenExpiresAt = undefined;
      connection.metadata = { ...connection.metadata, disconnectedAt: now, disconnectedBy: actor.subject };
      connection.updatedAt = now;
      await store.upsertTwilioConnection(connection);
      for (const endpoint of await store.listPhoneEndpoints(client.id)) {
        if (endpoint.provider !== "twilio") continue;
        endpoint.status = "disabled";
        endpoint.updatedAt = now;
        await store.upsertPhoneEndpoint(endpoint);
      }
      await store.appendOperatorAudit({
        id: newId("audit_"), clientId: client.id, actorId: actor.subject,
        action: "twilio.customer_connection_revoked", detail: { connectionId: connection.id }, createdAt: now,
      });
      await store.saveOnboardingOutbox({
        id: newId("outbox_"), clientId: client.id, topic: "twilio.customer_connection_revoked",
        idempotencyKey: `twilio-revoked:${connection.id}:${now}`,
        payload: { connectionId: connection.id }, attemptCount: 0, createdAt: now, updatedAt: now,
      });
    }
    send(res, 200, { ok: true, status: "revoked" });
    return true;
  }

  const finalizeOnboardingMatch = route.match(/^\/clients\/([^/]+)\/onboarding\/finalize$/);
  if (finalizeOnboardingMatch && req.method === "POST") {
    const liveClient = await requireManageClient(ctx, finalizeOnboardingMatch[1]);
    if (!liveClient) return true;
    const subscription = await store.getCurrentSubscription(liveClient.id);
    if (!subscription || !["active", "trialing"].includes(subscription.status)) {
      send(res, 402, { error: "active_subscription_required" });
      return true;
    }
    const body = await readJson<{
      businessName?: string;
      greeting?: string;
      tone?: string;
      location?: string;
      phone?: string;
      transferNumber?: string;
      hours?: string;
      prices?: string;
      policies?: string[];
      publishedFacts?: string[];
      services?: ClientConfig["services"];
      phoneMode?: "robinexis_account" | "customer_oauth";
      twilioNumber?: string;
    }>(ctx);
    if (
      !body.businessName?.trim() ||
      !body.transferNumber?.match(/^\+[1-9]\d{7,14}$/) ||
      !body.services?.length ||
      !body.services.every((service) =>
        service.title?.trim() &&
        /^[a-z0-9-]{2,80}$/.test(service.slug) &&
        Number.isFinite(service.durationMinutes) &&
        service.durationMinutes > 0
      ) ||
      !["robinexis_account", "customer_oauth"].includes(body.phoneMode || "") ||
      (body.twilioNumber && !body.twilioNumber.match(/^\+[1-9]\d{7,14}$/))
    ) {
      send(res, 400, { error: "complete_business_services_phone_details_required" });
      return true;
    }
    const existingDraft = await store.getDraftClient(liveClient.id);
    const client = structuredClone(existingDraft?.config || liveClient);
    Object.assign(client, {
      businessName: body.businessName.trim(),
      greeting: body.greeting?.trim() || `Hello, you've reached ${body.businessName.trim()}. How can I help?`,
      tone: body.tone?.trim() || client.tone,
      location: body.location?.trim() || "",
      phone: body.phone?.trim() || "",
      transferNumber: body.transferNumber,
      hours: body.hours?.trim() || "",
      prices: body.prices?.trim() || "",
      policies: body.policies || [],
      publishedFacts: body.publishedFacts || [],
      services: body.services,
      phoneAcquisitionMode: body.phoneMode,
      requestedPhoneNumber: body.twilioNumber || undefined,
      onboardingStatus: "setup_queued",
    });
    const now = new Date().toISOString();
    client.published = false;
    await store.saveDraftClient({
      id: existingDraft?.id || newId("client_revision_"),
      clientId: client.id,
      status: "draft",
      config: client,
      createdBy: actor.subject,
      createdAt: existingDraft?.createdAt || now,
      updatedAt: now,
    });
    await store.upsertClient(client);
    await store.appendOperatorAudit({
      id: newId("audit_"),
      clientId: client.id,
      actorId: actor.subject,
      action: "onboarding.setup_queued",
      detail: { phoneMode: body.phoneMode, serviceCount: body.services.length },
      createdAt: now,
    });
    await notifyCustomer(store, client.id, `onboarding-submit:${now}`, `onboarding-submit:${client.id}:${now}`, client.email, "Robinexis setup received\nYour receptionist brief is safely in our specialist queue. We will show progress and any questions in your workspace.");
    structuredLog("onboarding_setup_queued", { clientId: client.id, actorId: actor.subject });
    send(res, 202, {
      client: safeEditableClient(client),
      onboardingStatus: "setup_queued",
      message: "Your setup details are queued for Robinexis review.",
    });
    return true;
  }

  const publishMatch = route.match(/^\/clients\/([^/]+)\/publish$/);
  if (publishMatch && req.method === "POST") {
    const liveClient = await requireManageClient(ctx, publishMatch[1]);
    if (!liveClient) return true;
    const existingDraft = await store.getDraftClient(liveClient.id);
    const client = structuredClone(existingDraft?.config || liveClient);
    const latest = await store.latestPrompt(liveClient.id);
    const prompt = {
      id: newId("pv_"),
      clientId: client.id,
      version: (latest?.version ?? 0) + 1,
      compiled: compilePrompt({
        client,
        direction: "inbound",
        objective: "Answer, retrieve knowledge, book, reschedule, cancel, capture a callback, or transfer safely.",
      }),
      createdAt: new Date().toISOString(),
    };
    const automaticPreActivation =
      process.env.SAAS_PROVISIONING_ENABLED === "true" &&
      Boolean(liveClient.onboardingStatus) &&
      liveClient.onboardingStatus !== "active";
    if (automaticPreActivation) {
      client.promptVersionId = prompt.id;
      client.published = false;
      const now = new Date().toISOString();
      await store.savePromptVersion(prompt);
      await store.saveDraftClient({
        id: existingDraft?.id || newId("client_revision_"),
        clientId: liveClient.id,
        status: "draft",
        config: client,
        createdBy: actor.subject,
        createdAt: existingDraft?.createdAt || now,
        updatedAt: now,
      });
      send(res, 202, {
        client: safeEditableClient(client),
        draftPublished: true,
        activationRequired: true,
        promptVersion: { id: prompt.id, clientId: prompt.clientId, version: prompt.version, createdAt: prompt.createdAt },
      });
      return true;
    }
    client.promptVersionId = prompt.id;
    client.published = true;
    const now = new Date().toISOString();
    await store.publishClientDraft(
      {
        id: existingDraft?.id || newId("client_revision_"),
        clientId: liveClient.id,
        status: "draft",
        config: client,
        createdBy: actor.subject,
        createdAt: existingDraft?.createdAt || now,
        updatedAt: now,
      },
      prompt,
    );
    const location = (await store.listLocations(client.id)).find((item) => item.isPrimary);
    if (location) {
      await store.upsertLocation({
        ...location,
        name: client.businessName,
        timezone: client.callingWindow.tz,
        phone: client.phone || undefined,
        address: client.location ? { formatted: client.location } : location.address,
        updatedAt: now,
      });
    }
    send(res, 200, {
      client: safeEditableClient(client),
      promptVersion: { id: prompt.id, clientId: prompt.clientId, version: prompt.version, createdAt: prompt.createdAt },
    });
    return true;
  }

  const provisioningMatch = route.match(/^\/clients\/([^/]+)\/provision$/);
  if (provisioningMatch && req.method === "POST") {
    if (!canAdministerPlatform(actor)) {
      send(res, 403, { error: "platform_admin_required" });
      return true;
    }
    if (process.env.SAAS_PROVISIONING_ENABLED !== "true") {
      send(res, 503, { error: "saas_provisioning_disabled" });
      return true;
    }
    const client = await requireClient(ctx, provisioningMatch[1]);
    if (!client) return true;
    if (protectedAutomationTarget(client)) {
      send(res, 409, { error: "protected_blades_automation_target" });
      return true;
    }
    if (!process.env.ELEVENLABS_API_KEY) {
      send(res, 503, { error: "elevenlabs_not_configured" });
      return true;
    }
    const body = await readJson<{
      operationKey?: string;
      transferNumber?: string;
      twilioNumber?: string;
      phoneMode?: "robinexis_account" | "customer_oauth";
    }>(ctx);
    if (!body.operationKey) {
      send(res, 400, { error: "operation_key_required" });
      return true;
    }
    await store.appendOperatorAudit({
      id: newId("audit_"),
      clientId: client.id,
      actorId: actor.subject,
      action: "provisioning.started",
      detail: { operationKey: body.operationKey, phoneMode: body.phoneMode || client.phoneAcquisitionMode },
      createdAt: new Date().toISOString(),
    });
    try {
      const result = await provisionClientAgent(
        {
          clientId: client.id,
          operationKey: body.operationKey,
          apiBaseUrl: process.env.API_PUBLIC_BASE_URL || `https://${ctx.req.headers.host}`,
          transferNumber: body.transferNumber,
          twilioNumber:
            body.twilioNumber ||
            client.requestedPhoneNumber ||
            client.inboundNumbers[0],
          phoneMode: body.phoneMode || client.phoneAcquisitionMode,
          twilioAccountSid: process.env.TWILIO_ACCOUNT_SID,
          twilioAuthToken: process.env.TWILIO_AUTH_TOKEN,
        },
        {
          store,
          elevenLabs: new ElevenLabsManagementClient({
            apiKey: process.env.ELEVENLABS_API_KEY,
          }),
        },
      );
      await store.appendOperatorAudit({
        id: newId("audit_"),
        clientId: client.id,
        actorId: actor.subject,
        action: "provisioning.succeeded",
        detail: { operationKey: body.operationKey, runId: result.runId },
        createdAt: new Date().toISOString(),
      });
      structuredLog("lifecycle_transition_completed", {
        tenantId: client.id, operationId: body.operationKey,
        transition: "provisioning_to_awaiting_approval", runId: result.runId,
      });
      await notifyCustomer(
        store, client.id, body.operationKey, `test-ready:${client.id}:${result.runId}`,
        client.email,
        "Your Robinexis receptionist is ready to test\nOpen your workspace to review readiness and approve activation.",
      );
      send(res, 200, publicProvisioningOutput(
        result as unknown as Record<string, unknown>,
      ));
    } catch (error) {
      const message = error instanceof Error ? error.message : "provisioning_failed";
      await store.appendOperatorAudit({
        id: newId("audit_"),
        clientId: client.id,
        actorId: actor.subject,
        action: "provisioning.failed",
        detail: { operationKey: body.operationKey, error: message.slice(0, 300) },
        createdAt: new Date().toISOString(),
      });
      structuredLog("lifecycle_transition_failed", {
        tenantId: client.id, operationId: body.operationKey,
        transition: "provisioning", error: message,
      });
      await notifyCustomer(
        store, client.id, body.operationKey, `provisioning-failed:${client.id}:${body.operationKey}`,
        client.email,
        "Robinexis setup needs attention\nWe could not complete staged setup. No live routing was changed; our team will review it.",
      );
      send(res, message === "provisioning_already_running" ? 409 : 502, { error: message });
    }
    return true;
  }

  const provisioningStatusMatch = route.match(/^\/clients\/([^/]+)\/provisioning$/);
  if (provisioningStatusMatch && req.method === "GET") {
    const client = await requireClient(ctx, provisioningStatusMatch[1]);
    if (!client) return true;
    const runs = await store.listProvisioningRuns(client.id);
    send(res, 200, {
      items: runs.map((run) => ({
        id: run.id,
        status: run.status,
        step: run.step,
        error: run.error,
        output: publicProvisioningOutput(run.output),
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
        finishedAt: run.finishedAt,
      })),
    });
    return true;
  }

  const provisioningApprovalMatch =
    route.match(/^\/clients\/([^/]+)\/provisioning\/([^/]+)\/approve$/);
  if (provisioningApprovalMatch && req.method === "POST") {
    const client = await requireClient(ctx, provisioningApprovalMatch[1]);
    if (!client) return true;
    if (actor.clientRoles[client.id] !== "owner") {
      send(res, 403, { error: "workspace_owner_required" });
      return true;
    }
    const runId = decodeURIComponent(provisioningApprovalMatch[2]);
    const run = await store.getProvisioningRun(client.id, runId);
    if (!run) {
      send(res, 404, { error: "provisioning_run_not_found" });
      return true;
    }
    if (
      client.onboardingStatus === "active" &&
      (await store.listOperatorAudit(client.id)).some((item) =>
        item.id === `activation_${runId}` && item.action === "provisioning.owner_activated")
    ) {
      send(res, 200, { client: safeEditableClient(client), runId, activated: true, idempotent: true });
      return true;
    }
    const draft = await store.getDraftClient(client.id);
    const effective = draft?.config || client;
    const latest = await store.latestPrompt(client.id);
    const now = new Date().toISOString();
    const compiledPrompt = compilePrompt({
      client: effective,
      direction: "inbound",
      objective: "Answer, book, reschedule, cancel, capture a callback, or transfer safely.",
    });
    const profileChecksum = provisioningProfileChecksum(effective, compiledPrompt);
    const prompt = {
      id: newId("prompt_"),
      clientId: client.id,
      version: (latest?.version || 0) + 1,
      compiled: String(run.output?.compiledPrompt || ""),
      createdAt: now,
    };
    if (!prompt.compiled || run.output?.profileChecksum !== profileChecksum ||
        prompt.compiled !== compiledPrompt) {
      send(res, 409, {
        error: "activation_requirements_not_met",
        blockers: ["provisioning_profile_changed"],
      });
      return true;
    }
    const prepared = await store.prepareProvisionedClientActivation({
      clientId: client.id,
      runId,
      actorId: actor.subject,
      actorEmail: actor.email,
      prompt,
      profileChecksum,
      now,
    });
    if (!prepared.intent) {
      const status = prepared.error === "client_not_found"
        ? 404
        : prepared.error === "workspace_owner_required" ? 403 : 409;
      send(res, status, {
        error: prepared.error,
        blockers: prepared.blockers,
      });
      return true;
    }
    const intent = prepared.intent;
    let providerPhoneNumberId = intent.providerPhoneNumberId;
    try {
      if (intent.phoneNumber) {
        if (!process.env.ELEVENLABS_API_KEY) {
          throw new Error("elevenlabs_not_configured");
        }
        const management = new ElevenLabsManagementClient({ apiKey: process.env.ELEVENLABS_API_KEY });
        if (!providerPhoneNumberId) {
          const credentials = await twilioActivationCredentials(store, client);
          const imported = await management.importTwilioNumber({
            phoneNumber: intent.phoneNumber,
            label: `${effective.businessName} main line`,
            accountSid: credentials.accountSid,
            authToken: credentials.authToken,
            accountAuthToken: credentials.accountAuthToken,
            enableSms: false,
          }, `${intent.operationKey}:import`);
          providerPhoneNumberId = imported.phone_number_id;
          if (!providerPhoneNumberId) throw new Error("elevenlabs_phone_id_missing");
          const importedProgress = await store.recordProvisioningActivationProgress(
            client.id,
            runId,
            "imported",
            providerPhoneNumberId,
            new Date().toISOString(),
          );
          if (importedProgress.error) throw new Error(importedProgress.error);
        }
        await management.assignAgentToPhoneNumber(
          providerPhoneNumberId,
          intent.providerAgentId,
          `${intent.operationKey}:assign`,
        );
        const assignedProgress = await store.recordProvisioningActivationProgress(
          client.id,
          runId,
          "assigned",
          providerPhoneNumberId,
          new Date().toISOString(),
        );
        if (assignedProgress.error) throw new Error(assignedProgress.error);
      }
      const stablePrompt = {
        ...prompt,
        id: intent.promptId,
        version: intent.promptVersion,
      };
      const result = await store.finalizeProvisionedClientActivation({
        clientId: client.id,
        runId,
        actorId: actor.subject,
        actorEmail: actor.email,
        prompt: stablePrompt,
        profileChecksum,
        now,
      });
      if (!result.activated) {
        throw new Error(`${result.error}:${(result.blockers || []).join(",")}`);
      }
      await notifyCustomer(store, client.id, `activation:${runId}`, `activation:${client.id}:${runId}`, client.email, "Your Robinexis receptionist is active\nYour approved configuration is now published and the staged phone routing is active.");
      send(res, 200, { client: safeEditableClient(result.client!), runId, activated: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "activation_failed";
      let rollback: { status: "deleted" | "failed"; error?: string } | undefined;
      if (providerPhoneNumberId && process.env.ELEVENLABS_API_KEY) {
        try {
          await new ElevenLabsManagementClient({ apiKey: process.env.ELEVENLABS_API_KEY })
            .deletePhoneNumber(providerPhoneNumberId, `${intent.operationKey}:delete-compensation`);
          rollback = { status: "deleted" };
        } catch (rollbackError) {
          rollback = { status: "failed", error: String(rollbackError) };
          structuredLog("activation_compensation_failed", {
            clientId: client.id,
            runId,
            error: String(rollbackError),
          });
        }
      }
      await store.failProvisionedClientActivation(
        client.id,
        runId,
        message,
        new Date().toISOString(),
        rollback,
      );
      const responseError = rollback?.status === "failed"
        ? `activation_rollback_incomplete:${message}`
        : message;
      send(res, message === "elevenlabs_not_configured" ? 503 : 502, { error: responseError });
    }
    return true;
  }

  const provisioningActionMatch =
    route.match(/^\/clients\/([^/]+)\/provisioning\/([^/]+)\/action$/);
  if (provisioningActionMatch && req.method === "POST") {
    if (!canAdministerPlatform(actor)) {
      send(res, 403, { error: "platform_admin_required" });
      return true;
    }
    const client = await requireClient(ctx, provisioningActionMatch[1]);
    if (!client) return true;
    const run = await store.getProvisioningRun(client.id, decodeURIComponent(provisioningActionMatch[2]));
    if (!run) {
      send(res, 404, { error: "provisioning_run_not_found" });
      return true;
    }
    const body = await readJson<{ action?: "pause" | "retry" | "review"; note?: string }>(ctx);
    if (!body.action || !["pause", "retry", "review"].includes(body.action)) {
      send(res, 400, { error: "valid_provisioning_action_required" });
      return true;
    }
    const now = new Date().toISOString();
    if (body.action === "pause") {
      run.status = "paused";
      run.updatedAt = now;
      await store.saveProvisioningRun(run);
    } else if (body.action === "retry") {
      if (run.status === "succeeded") {
        send(res, 409, { error: "completed_provisioning_cannot_retry" });
        return true;
      }
      run.status = "pending";
      run.error = undefined;
      run.finishedAt = undefined;
      run.updatedAt = now;
      await store.saveProvisioningRun(run);
      await store.enqueueOnboardingJob({
        id: newId("job_"), clientId: client.id, kind: "provision_client",
        idempotencyKey: `manual-retry:${run.id}:${now}`, status: "pending",
        payload: { operationKey: run.idempotencyKey }, attemptCount: 0, maxAttempts: 5,
        availableAt: now, createdAt: now, updatedAt: now,
      });
    }
    await store.appendOperatorAudit({
      id: newId("audit_"), clientId: client.id, actorId: actor.subject,
      action: `provisioning.${body.action}`,
      detail: { runId: run.id, note: body.note?.trim().slice(0, 1_000) },
      createdAt: now,
    });
    send(res, 200, {
      run: {
        ...run,
        claimToken: undefined,
        output: publicProvisioningOutput(run.output),
      },
    });
    return true;
  }

  const versionsMatch = route.match(/^\/clients\/([^/]+)\/prompt-versions$/);
  if (versionsMatch && req.method === "GET") {
    if (!(await requireClient(ctx, versionsMatch[1]))) return true;
    const extended = store as ExtendedStore;
    const rawVersions: unknown[] = extended.listPromptVersions
      ? await extended.listPromptVersions(versionsMatch[1])
      : [await store.latestPrompt(versionsMatch[1])];
    const versions = rawVersions
      .filter((version): version is { id: string; clientId: string; version: number; createdAt: string } =>
        Boolean(version && typeof version === "object" && "id" in version && "clientId" in version &&
          "version" in version && "createdAt" in version));
    send(res, 200, {
      items: versions.map((version) => ({
        id: version.id,
        clientId: version.clientId,
        version: version.version,
        createdAt: version.createdAt,
      })),
    });
    return true;
  }

  if (route === "/calls" && req.method === "GET") {
    const id = clientId(url);
    if (!(await requireClient(ctx, id))) return true;
    const all = await store.listCallsForClient(id, 1000);
    const filtered = filterCalls(all, url);
    const limit = parseLimit(url);
    const offset = Math.max(0, Number(url.searchParams.get("cursor") || 0) || 0);
    send(res, 200, {
      items: filtered.slice(offset, offset + limit),
      total: filtered.length,
      nextCursor: offset + limit < filtered.length ? String(offset + limit) : null,
    });
    return true;
  }

  const callMatch = route.match(/^\/calls\/([^/]+)$/);
  if (callMatch && req.method === "GET") {
    const requestedClientId = clientId(url);
    if (!requestedClientId || !canAccessClient(actor, requestedClientId)) {
      send(res, 404, { error: "call_not_found" });
      return true;
    }
    const call = await store.getCallForClient(requestedClientId, callMatch[1]);
    if (!call) send(res, 404, { error: "call_not_found" });
    else send(res, 200, call);
    return true;
  }

  if ((route === "/analytics/summary" || route === "/analytics/timeseries") && req.method === "GET") {
    const id = clientId(url);
    if (!(await requireClient(ctx, id))) return true;
    const to = url.searchParams.get("to") || new Date().toISOString();
    const from = url.searchParams.get("from") ||
      new Date(new Date(to).getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    if (route.endsWith("summary")) {
      const summary = await store.getAnalyticsSummary(id, { from, to });
      send(res, 200, {
        totalCalls: summary.totalCalls,
        answeredCalls: summary.completedCalls + summary.transferredCalls,
        bookedAppointments: summary.bookedCalls,
        transferredCalls: summary.transferredCalls,
        minutesUsed: Math.round(summary.totalMinutes),
        bookingRate: summary.totalCalls ? (summary.bookedCalls / summary.totalCalls) * 100 : 0,
        inbound: summary.inboundCalls,
        outbound: summary.outboundCalls,
      });
    } else {
      const points = await store.getAnalyticsTimeseries(id, { from, to });
      send(res, 200, {
        items: points.map((point) => ({
          date: point.date,
          calls: point.calls,
          bookings: point.booked,
          completed: point.completed,
          transferred: point.transferred,
          failed: point.failed,
        })),
      });
    }
    return true;
  }

  if (route === "/usage" && req.method === "GET") {
    const id = clientId(url);
    const client = await requireClient(ctx, id);
    if (!client) return true;
    const month = url.searchParams.get("month") || new Date().toISOString().slice(0, 7);
    const usage = await store.getUsage(id, month);
    const ledger = await store.listCreditLedger(id);
    const remainingMinutes = ledger.reduce((sum, entry) => sum + entry.minutes, 0);
    const allocatedMinutes = ledger
      .filter((entry) => entry.kind === "grant" || entry.kind === "purchase")
      .reduce((sum, entry) => sum + entry.minutes, 0);
    const usedMinutes = Math.abs(
      ledger
        .filter((entry) => entry.kind === "usage")
        .reduce((sum, entry) => sum + entry.minutes, 0),
    );
    send(res, 200, {
      ...(usage || {
      clientId: id,
      month,
      inboundMinutes: 0,
      outboundMinutes: 0,
      }),
      plan: isPlanTier(client.subscribedProduct) ? client.subscribedProduct : "starter",
      allocatedMinutes,
      usedMinutes,
      remainingMinutes: Math.max(0, remainingMinutes),
    });
    return true;
  }

  if (route === "/billing/status" && req.method === "GET") {
    const requestedId = url.searchParams.get("clientId") || "";
    const id = requestedId || writableClientId(actor);
    if (!id) {
      send(res, 200, { configured: false, status: "incomplete" });
      return true;
    }
    const client = await requireManageClient(ctx, id);
    if (!client) return true;
    const subscription = await store.getCurrentSubscription(client.id);
    send(res, 200, {
      configured: Boolean(client.stripeCustomerId),
      canManagePortal: Boolean(client.stripeCustomerId),
      plan: subscription?.planTier || (isPlanTier(client.subscribedProduct) ? client.subscribedProduct : "starter"),
      status: subscription?.status || client.serviceStatus,
      trialEndsAt: subscription?.trialEndsAt,
      currentPeriodEnd: subscription?.currentPeriodEnd,
      cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd || false,
    });
    return true;
  }

  if (route === "/billing/portal" && req.method === "POST") {
    const body = await readJson<{ clientId?: string }>(ctx);
    const requestedId = String(body.clientId || "");
    const id = requestedId || writableClientId(actor);
    if (!id) {
      send(res, 403, { error: "workspace_write_forbidden" });
      return true;
    }
    const client = await requireManageClient(ctx, id);
    if (!client) return true;
    if (!client.stripeCustomerId) {
      send(res, 409, { error: "billing_profile_pending" });
      return true;
    }
    const portal = await createBillingPortalSession({
      customerId: client.stripeCustomerId,
      returnUrl: `${primaryWebOrigin()}/billing`,
    });
    if (!portal.configured) {
      send(res, 503, { error: portal.reason });
      return true;
    }
    send(res, 201, { portalSessionId: portal.id, url: portal.url });
    return true;
  }

  if (route === "/billing/checkout" && req.method === "POST") {
    const body = await readJson<{ clientId?: string; plan?: unknown }>(ctx);
    if (!isPlanTier(body.plan)) {
      send(res, 400, { error: "invalid_plan" });
      return true;
    }
    if (body.plan === "enterprise") {
      send(res, 400, { error: "enterprise_contact_sales" });
      return true;
    }
    const configurationError = checkoutConfigurationError(body.plan);
    if (configurationError) {
      send(res, 503, { error: configurationError });
      return true;
    }
    let client;
    const requestedId = String(body.clientId || "");
    if (requestedId) {
      client = await requireManageClient(ctx, requestedId);
      if (!client) return true;
    } else if (actor.role === "pending") {
      client = await ensureSelfServeWorkspace(store, actor, body.plan);
    } else {
      const id = writableClientId(actor);
      if (!id) {
        send(res, 403, { error: "workspace_write_forbidden" });
        return true;
      }
      client = await requireManageClient(ctx, id);
      if (!client) return true;
    }
    const webOrigin = (process.env.WEB_ORIGIN || "http://localhost:5173")
      .split(",")[0]
      .trim()
      .replace(/\/$/, "");
    const checkout = await createCheckoutSession({
      clientId: client.id,
      plan: body.plan,
      customerId: client.stripeCustomerId,
      customerEmail: client.email || actor.email,
      authUserId: actor.subject,
      idempotencyKey: `checkout:${client.id}:${body.plan}:${Math.floor(Date.now() / 600_000)}`,
      successUrl: `${webOrigin}/billing?checkout=success`,
      cancelUrl: `${webOrigin}/billing?checkout=cancelled`,
    });
    if (!checkout.configured) {
      send(res, 503, { error: checkout.reason });
      return true;
    }
    send(res, 201, { checkoutSessionId: checkout.id, url: checkout.url, clientId: client.id });
    return true;
  }

  if (route === "/calendar/slots" && req.method === "GET") {
    const client = await requireClient(ctx, clientId(url));
    if (!client) return true;
    try {
      const { tenant } = await resolveCalcomTenantConnection(store, client);
      const start = new Date();
      const end = new Date(start.getTime() + 7 * 86_400_000);
      const result = await calcom.checkAvailability(tenant, {
        eventTypeSlug: url.searchParams.get("eventTypeSlug") || client.services[0]?.slug || "15min",
        start: start.toISOString(),
        end: end.toISOString(),
      });
      send(res, 200, { configured: true, items: result.slots.map((slot) => ({ start: slot })) });
    } catch (error) {
      send(res, 503, { error: error instanceof Error ? error.message : "calendar_unavailable" });
    }
    return true;
  }

  if (route === "/calendar/bookings" && req.method === "GET") {
    const client = await requireClient(ctx, clientId(url));
    if (!client) return true;
    const projected = (await store.listBookingRecords(client.id)).map((booking) => ({
      uid: booking.providerBookingId || booking.id,
      title: booking.serviceSlug,
      start: booking.startsAt,
      end: booking.endsAt,
      status: booking.status,
      attendeeName: booking.attendeeName,
      attendeeEmail: booking.attendeeEmail,
      sourceCallId: booking.callId,
    }));
    let tenant;
    try {
      tenant = (await resolveCalcomTenantConnection(store, client)).tenant;
    } catch {
      send(res, 200, { items: projected, configured: false, source: "projection" });
      return true;
    }
    {
      try {
        const result = await calcom.listBookings(tenant, { status: "upcoming" });
        const remote = result.bookings.map((booking) => ({
            uid: booking.uid,
            title: booking.title,
            start: booking.start,
            end: booking.end,
            status: booking.status,
            attendeeName: booking.attendees?.[0]?.name,
            attendeeEmail: booking.attendees?.[0]?.email,
        }));
        const remoteIds = new Set(remote.map((booking) => booking.uid));
        send(res, 200, {
          items: [...remote, ...projected.filter((booking) => !remoteIds.has(booking.uid))],
          configured: true,
          source: "calcom",
        });
      } catch {
        send(res, 200, {
          items: projected,
          configured: true,
          source: "projection",
          syncStatus: "temporarily_unavailable",
        });
      }
    }
    return true;
  }

  const calendarAction = route.match(/^\/calendar\/bookings\/([^/]+)\/(reschedule|cancel)$/);
  if (calendarAction && req.method === "POST") {
    const body = await readJson<{ clientId?: string; start?: string; newStart?: string; confirmed?: boolean }>(ctx);
    const client = await requireManageClient(ctx, body.clientId || clientId(url));
    if (!client) return true;
    if (body.confirmed !== true) {
      send(res, 400, { error: "explicit_confirmation_required" });
      return true;
    }
    if (
      (calendarAction[2] === "cancel" && client.calendar.schedule?.cancellationAllowed === false) ||
      (calendarAction[2] === "reschedule" && client.calendar.schedule?.rescheduleAllowed === false)
    ) {
      send(res, 403, { error: `${calendarAction[2]}_not_allowed` });
      return true;
    }
    const tenant = (await resolveCalcomTenantConnection(store, client)).tenant;
    const result = calendarAction[2] === "cancel"
      ? await calcom.cancelBooking(tenant, calendarAction[1])
      : await calcom.rescheduleBooking(tenant, {
          bookingUid: calendarAction[1],
          start: String(body.newStart || body.start || ""),
        });
    const projected = (await store.listBookingRecords(client.id))
      .find((booking) => booking.providerBookingId === calendarAction[1]);
    if (projected) {
      if (calendarAction[2] === "cancel") projected.status = "cancelled";
      else {
        const nextStart = String(body.newStart || body.start || "");
        const duration = Date.parse(projected.endsAt) - Date.parse(projected.startsAt);
        projected.startsAt = new Date(nextStart).toISOString();
        projected.endsAt = new Date(Date.parse(nextStart) + Math.max(0, duration)).toISOString();
      }
      projected.updatedAt = new Date().toISOString();
      await store.saveBookingRecord(projected);
    }
    send(res, 200, result);
    return true;
  }

  if (route === "/jobs" && req.method === "GET") {
    const id = clientId(url);
    if (!id && !canAdministerPlatform(actor)) {
      send(res, 400, { error: "clientId_required" });
      return true;
    }
    if (id && !(await requireClient(ctx, id))) return true;
    send(res, 200, { items: await store.listJobs(id || undefined) });
    return true;
  }
  if (route === "/jobs" && req.method === "POST") {
    const body = await readJson<Partial<OutboundJob> & { clientId?: string; contactPhone?: string }>(ctx);
    if (!body.clientId || !body.contactPhone) {
      send(res, 400, { error: "valid_clientId_and_contactPhone_required" });
      return true;
    }
    if (!(await requireManageClient(ctx, body.clientId))) return true;
    const job: OutboundJob = {
      id: newId("job_"),
      clientId: body.clientId,
      campaign: body.campaign || "appointment-reminder",
      contactPhone: body.contactPhone,
      contactName: body.contactName,
      purpose: body.purpose || "appointment reminder",
      scheduledAt: body.scheduledAt || new Date().toISOString(),
      attemptCount: 0,
      maxAttempts: body.maxAttempts || 3,
      status: body.approved ? "approved" : "pending",
      approved: Boolean(body.approved),
      sourceRecordId: body.sourceRecordId,
    };
    await store.saveJob(job);
    send(res, 201, job);
    return true;
  }

  const jobAction = route.match(/^\/jobs\/([^/]+)\/(approve|cancel)$/);
  if (jobAction && req.method === "POST") {
    const expectedClient = clientId(url);
    if (!expectedClient || !canManageClient(actor, expectedClient)) {
      send(res, 404, { error: "job_not_found" });
      return true;
    }
    const job = await store.getJobForClient(expectedClient, jobAction[1]);
    if (!job) {
      send(res, 404, { error: "job_not_found" });
      return true;
    }
    if (jobAction[2] === "approve") {
      job.approved = true;
      job.status = "approved";
      await store.saveJob(job);
    } else {
      await store.cancelJob(job.id, job.clientId);
      job.approved = false;
      job.status = "cancelled";
    }
    send(res, 200, job);
    return true;
  }

  if (route === "/memberships" && req.method === "GET") {
    const id = clientId(url);
    if (!(await requireClient(ctx, id))) return true;
    send(res, 200, { items: await store.listMembershipsForClient(id) });
    return true;
  }

  if (route === "/memberships" && req.method === "POST") {
    const body = await readJson<{
      clientId?: string;
      email?: string;
      role?: "owner" | "manager" | "viewer";
    }>(ctx);
    const id = String(body.clientId || "");
    if (!(await requireClient(ctx, id))) return true;
    const canAdministerWorkspace =
      canAdministerPlatform(actor) || actor.clientRoles[id] === "owner";
    if (!canAdministerWorkspace) {
      send(res, 403, { error: "workspace_owner_required" });
      return true;
    }
    const email = String(body.email || "").trim().toLowerCase();
    const role = body.role || "viewer";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !["owner", "manager", "viewer"].includes(role)) {
      send(res, 400, { error: "valid_email_and_role_required" });
      return true;
    }
    const existing = await store.listMembershipsForClient(id);
    if (!existing.length && role !== "owner") {
      send(res, 400, { error: "first_membership_must_be_owner" });
      return true;
    }
    const membership = {
      id: newId("member_"),
      clientId: id,
      email,
      role,
      createdAt: new Date().toISOString(),
    };
    await store.upsertMembership(membership);
    const saved = (await store.listMembershipsForClient(id)).find((item) => item.email === email);
    send(res, 201, saved || membership);
    return true;
  }

  const membershipMatch = route.match(/^\/memberships\/([^/]+)$/);
  if (membershipMatch && req.method === "PATCH") {
    const id = clientId(url);
    if (!(await requireClient(ctx, id))) return true;
    if (!canAdministerPlatform(actor) && actor.clientRoles[id] !== "owner") {
      send(res, 403, { error: "workspace_owner_required" });
      return true;
    }
    const body = await readJson<{ role?: "manager" | "viewer" }>(ctx);
    if (!body.role) {
      send(res, 400, { error: "manager_or_viewer_role_required" });
      return true;
    }
    const memberships = await store.listMembershipsForClient(id);
    const selected = memberships.find((item) => item.id === membershipMatch[1]);
    if (!selected) {
      send(res, 404, { error: "membership_not_found" });
      return true;
    }
    if (selected.role === "owner" && memberships.filter((item) => item.role === "owner").length === 1) {
      send(res, 409, { error: "transfer_ownership_before_demoting_last_owner" });
      return true;
    }
    await store.upsertMembership({ ...selected, role: body.role });
    await store.appendOperatorAudit({
      id: newId("audit_"), clientId: id, actorId: actor.subject, action: "membership.role_changed",
      detail: { membershipId: selected.id, from: selected.role, to: body.role }, createdAt: new Date().toISOString(),
    });
    send(res, 200, { ...selected, role: body.role });
    return true;
  }
  const ownershipMatch = route.match(/^\/memberships\/([^/]+)\/transfer-ownership$/);
  if (ownershipMatch && req.method === "POST") {
    const id = clientId(url);
    if (!(await requireClient(ctx, id))) return true;
    if (!canAdministerPlatform(actor) && actor.clientRoles[id] !== "owner") {
      send(res, 403, { error: "workspace_owner_required" });
      return true;
    }
    const memberships = await store.listMembershipsForClient(id);
    const target = memberships.find((item) => item.id === ownershipMatch[1]);
    const current = memberships.find((item) => item.email === actor.email && item.role === "owner");
    if (!target || (!current && !canAdministerPlatform(actor))) {
      send(res, 404, { error: "ownership_membership_not_found" });
      return true;
    }
    await store.upsertMembership({ ...target, role: "owner" });
    if (current && current.id !== target.id) await store.upsertMembership({ ...current, role: "manager" });
    await store.appendOperatorAudit({
      id: newId("audit_"), clientId: id, actorId: actor.subject, action: "membership.ownership_transferred",
      detail: { fromMembershipId: current?.id, toMembershipId: target.id }, createdAt: new Date().toISOString(),
    });
    send(res, 200, { ...target, role: "owner" });
    return true;
  }
  if (membershipMatch && req.method === "DELETE") {
    const id = clientId(url);
    if (!(await requireClient(ctx, id))) return true;
    const canAdministerWorkspace =
      canAdministerPlatform(actor) || actor.clientRoles[id] === "owner";
    if (!canAdministerWorkspace) {
      send(res, 403, { error: "workspace_owner_required" });
      return true;
    }
    const memberships = await store.listMembershipsForClient(id);
    const selected = memberships.find((item) => item.id === membershipMatch[1]);
    if (!selected) {
      send(res, 404, { error: "membership_not_found" });
      return true;
    }
    if (selected.role === "owner" && memberships.filter((item) => item.role === "owner").length === 1) {
      send(res, 409, { error: "last_workspace_owner" });
      return true;
    }
    await store.deleteMembership(id, selected.id);
    send(res, 200, { ok: true });
    return true;
  }

  const calcomConnectionMatch = route.match(/^\/clients\/([^/]+)\/calendar-connection$/);
  if (calcomConnectionMatch && req.method === "GET") {
    const client = await requireClient(ctx, calcomConnectionMatch[1]);
    if (!client) return true;
    const connection = (await store.listCalendarConnections(client.id))
      .find((item) => item.provider === "calcom");
    let availableCalendars: Array<{ id: string; name: string; provider?: string }> = [];
    if (connection?.status === "active" && canManageClient(actor, client.id)) {
      try {
        const resolved = await resolveCalcomTenantConnection(store, client);
        availableCalendars = await listCalcomDestinationCalendars(resolved.tenant.apiKey);
      } catch {
        // Status remains useful when provider discovery is temporarily unavailable.
      }
    }
    send(res, 200, {
      mode: connection?.mode,
      status: connection?.status || "not_connected",
      accountMasked: connection?.externalAccountId
        ? `${connection.externalAccountId.slice(0, 3)}***`
        : undefined,
      destinationCalendarId: connection?.calendarId,
      destinationProvider: connection?.destinationProvider,
      availableCalendars,
      canReconnect: !connection || ["disabled", "failed"].includes(connection.status),
    });
    return true;
  }

  const calendarRepairMatch = route.match(/^\/clients\/([^/]+)\/calendar-connection\/repair$/);
  if (calendarRepairMatch && req.method === "POST") {
    const client = await requireManageClient(ctx, calendarRepairMatch[1]);
    if (!client) return true;
    try {
      const eventTypes = await repairCalendarEventTypes(store, client);
      calendarProbeCache.delete(client.id);
      await store.appendOperatorAudit({
        id: newId("audit_"), clientId: client.id, actorId: actor.subject,
        action: "calendar.repaired",
        detail: { eventTypes: eventTypes.map((item) => item.providerSlug) },
        createdAt: new Date().toISOString(),
      });
      send(res, 200, {
        eventTypes: eventTypes.map((item) => ({
          serviceSlug: item.serviceSlug,
          providerSlug: item.providerSlug,
          durationMinutes: item.durationMinutes,
          readinessOnly: item.readinessOnly ?? false,
        })),
        probe: await probeTenantCalendar(store, client),
      });
    } catch (error) {
      send(res, 502, { error: error instanceof Error ? error.message : "calendar_repair_failed" });
    }
    return true;
  }

  const calcomStartMatch = route.match(/^\/clients\/([^/]+)\/calendar-connection\/oauth\/start$/);
  if (calcomStartMatch && req.method === "POST") {
    const client = await requireManageClient(ctx, calcomStartMatch[1]);
    if (!client) return true;
    try {
      const returnTo = new URL("/app/integrations", primaryWebOrigin()).toString();
      const state = createCalcomOAuthState({ clientId: client.id, returnTo });
      const existing = (await store.listCalendarConnections(client.id)).find((item) => item.provider === "calcom");
      const now = new Date().toISOString();
      await store.upsertCalendarConnection({
        id: existing?.id || `calendar_${client.id}_primary`,
        clientId: client.id,
        locationId: existing?.locationId,
        provider: "calcom",
        externalAccountId: existing?.externalAccountId,
        credentialRef: existing?.credentialRef,
        calendarId: existing?.calendarId,
        destinationProvider: existing?.destinationProvider,
        mode: existing?.mode || "oauth",
        encryptedAccessToken: existing?.encryptedAccessToken,
        encryptedRefreshToken: existing?.encryptedRefreshToken,
        accessTokenExpiresAt: existing?.accessTokenExpiresAt,
        scopes: existing?.scopes,
        status: existing?.status || "pending",
        metadata: { ...existing?.metadata, reconnectPendingAt: now },
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      });
      send(res, 200, { url: calcomOAuthAuthorizeUrl(state) });
    } catch (error) {
      send(res, 503, { error: error instanceof Error ? error.message : "calcom_oauth_not_configured" });
    }
    return true;
  }

  const calcomManagedMatch = route.match(/^\/clients\/([^/]+)\/calendar-connection\/managed$/);
  if (calcomManagedMatch && req.method === "POST") {
    const client = await requireManageClient(ctx, calcomManagedMatch[1]);
    if (!client) return true;
    const previous = (await store.listCalendarConnections(client.id))
      .find((item) => item.provider === "calcom");
    if (previous?.mode === "managed" && previous.status === "active") {
      send(res, 200, { status: "active", mode: "managed", idempotent: true });
      return true;
    }
    try {
      const managed = await createManagedCalcomUser({
        clientId: client.id,
        email: client.email,
        name: client.businessName,
        timeZone: client.calendar.schedule?.timezone || client.callingWindow.tz,
      });
      const now = new Date();
      const connectionId = previous?.id || `calendar_${client.id}_primary`;
      await store.upsertCalendarConnection({
        id: connectionId,
        clientId: client.id,
        provider: "calcom",
        externalAccountId: managed.username,
        mode: "managed",
        encryptedAccessToken: encryptCalcomCredential(managed.accessToken),
        encryptedRefreshToken: managed.refreshToken ? encryptCalcomCredential(managed.refreshToken) : undefined,
        accessTokenExpiresAt: new Date(now.getTime() + managed.expiresIn * 1000).toISOString(),
        scopes: [...CALCOM_SCOPES],
        status: "active",
        metadata: {
          managedAt: now.toISOString(),
          externalUserId: managed.externalAccountId,
          ...(managed.organizationId ? { organizationId: managed.organizationId } : {}),
        },
        createdAt: previous?.createdAt || now.toISOString(),
        updatedAt: now.toISOString(),
      });
      await store.upsertProviderResource({
        id: `provider_calcom_user_${client.id}`,
        clientId: client.id,
        provider: "calcom",
        resourceType: "managed_user",
        providerResourceId: managed.externalAccountId,
        lifecycleStatus: "active",
        metadata: { connectionId },
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      });
      send(res, 201, { status: "active", mode: "managed" });
    } catch (error) {
      send(res, 502, { error: error instanceof Error ? error.message : "calcom_managed_user_failed" });
    }
    return true;
  }

  const calcomDestinationMatch = route.match(/^\/clients\/([^/]+)\/calendar-connection\/destination$/);
  if (calcomDestinationMatch && req.method === "PATCH") {
    const client = await requireManageClient(ctx, calcomDestinationMatch[1]);
    if (!client) return true;
    const body = await readJson<{ calendarId?: string; provider?: string }>(ctx);
    const connection = (await store.listCalendarConnections(client.id))
      .find((item) => item.provider === "calcom" && item.status === "active");
    if (!connection || !body.calendarId) {
      send(res, 409, { error: "active_calendar_connection_required" });
      return true;
    }
    const resolved = await resolveCalcomTenantConnection(store, client);
    const calendars = await listCalcomDestinationCalendars(resolved.tenant.apiKey);
    const selected = calendars.find((item) => item.id === body.calendarId);
    if (!selected) {
      send(res, 400, { error: "calendar_destination_not_available" });
      return true;
    }
    connection.calendarId = selected.id;
    connection.destinationProvider = selected.provider || body.provider;
    connection.updatedAt = new Date().toISOString();
    await store.upsertCalendarConnection(connection);
    send(res, 200, { status: connection.status, destinationCalendarId: selected.id, destinationProvider: connection.destinationProvider });
    return true;
  }

  if (calcomConnectionMatch && req.method === "DELETE") {
    const client = await requireManageClient(ctx, calcomConnectionMatch[1]);
    if (!client) return true;
    const connection = (await store.listCalendarConnections(client.id)).find((item) => item.provider === "calcom");
    let providerRevoked = false;
    if (connection) {
      if (connection.encryptedAccessToken && connection.mode === "oauth") {
        try {
          const resolved = await resolveCalcomTenantConnection(store, client);
          providerRevoked = (await revokeCalcomOAuthToken(resolved.tenant.apiKey)).revoked;
        } catch (error) {
          structuredLog("calcom_revoke_skipped", { clientId: client.id, reason: String(error) });
        }
      }
      connection.status = "disabled";
      connection.encryptedAccessToken = undefined;
      connection.encryptedRefreshToken = undefined;
      connection.accessTokenExpiresAt = undefined;
      connection.updatedAt = new Date().toISOString();
      await store.upsertCalendarConnection(connection);
    }
    send(res, 200, { status: "disabled", providerRevoked });
    return true;
  }

  if (route === "/integrations/status" && req.method === "GET") {
    const client = await requireClient(ctx, clientId(url));
    if (!client) return true;
    const calendar = await probeTenantCalendar(store, client);
    send(res, 200, { items: integrationList(client, calendar) });
    return true;
  }

  if (route === "/knowledge/documents" && req.method === "GET") {
    const id = clientId(url);
    if (!(await requireClient(ctx, id))) return true;
    try {
      const page = await store.listKnowledgeDocuments(id, {
        limit: parseLimit(url),
        cursor: url.searchParams.get("cursor") || undefined,
      });
      send(res, 200, {
        items: page.items.map(publicKnowledgeDocument),
        nextCursor: page.nextCursor,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      send(res, 503, {
        error: "knowledge_store_not_ready",
        message: /knowledge_documents|vector/i.test(message)
          ? "Run the database migration against a Postgres + pgvector database."
          : "Knowledge storage is currently unavailable.",
      });
    }
    return true;
  }

  if (route === "/knowledge/documents" && req.method === "POST") {
    const body = await readJson<{
      clientId?: string;
      title?: string;
      source?: string;
      sourceType?: "txt" | "markdown" | "pdf";
      content?: string;
      contentBase64?: string;
    }>(ctx);
    if (!body.clientId || !(await requireManageClient(ctx, body.clientId))) return true;
    if (!body.title || (!body.content && !body.contentBase64)) {
      send(res, 400, { error: "title_and_content_required" });
      return true;
    }
    const service = knowledgeService(store);
    if (!service) {
      send(res, 503, { error: "gemini_not_configured", message: "Set GEMINI_API_KEY before indexing knowledge." });
      return true;
    }
    const inferredType = body.sourceType ||
      (body.source?.toLowerCase().endsWith(".pdf")
        ? "pdf"
        : body.source?.toLowerCase().match(/\.md(?:own)?$/)
          ? "markdown"
          : "txt");
    const content = body.contentBase64
      ? Uint8Array.from(Buffer.from(body.contentBase64, "base64"))
      : String(body.content || "");
    try {
      const document = await service.index({
        clientId: body.clientId,
        title: body.title,
        sourceType: inferredType,
        sourceUri: body.source,
        content,
      });
      send(res, 201, publicKnowledgeDocument(document));
    } catch (err) {
      send(res, 502, { error: "knowledge_index_failed", message: err instanceof Error ? err.message : String(err) });
    }
    return true;
  }

  const knowledgeDocumentMatch = route.match(/^\/knowledge\/documents\/([^/]+)$/);
  if (knowledgeDocumentMatch && req.method === "DELETE") {
    const id = clientId(url);
    if (!(await requireManageClient(ctx, id))) return true;
    const deleted = await store.deleteKnowledgeDocument(id, knowledgeDocumentMatch[1]);
    send(res, deleted ? 200 : 404, deleted ? { ok: true } : { error: "document_not_found" });
    return true;
  }

  const reindexMatch = route.match(/^\/knowledge\/documents\/([^/]+)\/reindex$/);
  if (reindexMatch && req.method === "POST") {
    const body = await readJson<{ clientId?: string }>(ctx);
    const document = body.clientId
      ? await store.getKnowledgeDocument(body.clientId, reindexMatch[1])
      : undefined;
    if (!document) send(res, 404, { error: "document_not_found" });
    else send(res, 409, {
      error: "source_content_required",
      message: "Upload the source again to replace its index; original source text is not retained.",
      document: publicKnowledgeDocument(document),
    });
    return true;
  }

  if (route === "/knowledge/search" && req.method === "POST") {
    const body = await readJson<{ clientId?: string; query?: string; limit?: number }>(ctx);
    if (!body.clientId || !(await requireClient(ctx, body.clientId))) return true;
    if (!body.query?.trim()) {
      send(res, 400, { error: "query_required" });
      return true;
    }
    const service = knowledgeService(store);
    if (!service) {
      send(res, 503, { error: "gemini_not_configured", message: "Set GEMINI_API_KEY before searching knowledge." });
      return true;
    }
    const results = await service.search(body.clientId, body.query, {
      limit: body.limit || Number(process.env.RAG_TOP_K || 5),
      minScore: Number(process.env.RAG_MIN_SIMILARITY || 0.55),
    });
    send(res, 200, {
      results: results.map((result) => ({
        text: result.chunk.content,
        score: result.score,
        documentId: result.document.id,
        documentTitle: result.document.title,
      })),
    });
    return true;
  }

  return false;
}
