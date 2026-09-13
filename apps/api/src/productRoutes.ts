import type http from "node:http";
import { compilePrompt } from "@robinexis/brain";
import {
  isAiServiceEnabled,
  newId,
  type CallSession,
  type ClientConfig,
  type OutboundJob,
  type PlatformStore,
} from "@robinexis/database";
import {
  calcom,
  calcomTenantFromClient,
  checkoutConfigurationError,
  createTwilioOAuthState,
  createCheckoutSession,
  discoverTwilioAccountSid,
  encryptTwilioCredential,
  ElevenLabsManagementClient,
  exchangeTwilioOAuthCode,
  featureOperationallyAvailable,
  findOwnedTwilioNumber,
  isPlanTier,
  planCatalog,
  planDefinition,
  probeCalcomForClient,
  publicClientView,
  twilioOAuthAuthorizeUrl,
  verifyTwilioOAuthState,
} from "@robinexis/integrations";
import { GeminiEmbeddingProvider, KnowledgeService } from "@robinexis/knowledge";
import {
  canAccessClient,
  canAdministerPlatform,
  canManageClient,
  type AuthenticatedActor,
} from "./auth.js";
import { ensureSelfServeWorkspace, writableClientId } from "./billingService.js";
import { provisionClientAgent } from "./provisioningService.js";

export type ProductSend = (
  res: http.ServerResponse,
  status: number,
  body: unknown,
  type?: string,
) => void;

function primaryWebOrigin(): string {
  return (process.env.WEB_ORIGIN || "https://app.robinexis.com").split(",")[0].trim();
}

type ExtendedStore = PlatformStore & {
  listPromptVersions?: (clientId: string) => Promise<unknown[]>;
};

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
    status: "credentials_required",
    metadata: { oauthConnectedAt: now.toISOString() },
    createdAt: existing?.createdAt || now.toISOString(),
    updatedAt: now.toISOString(),
  });
  const returnTo = new URL(verified.returnTo);
  const allowedOrigin = new URL(primaryWebOrigin()).origin;
  if (returnTo.origin !== allowedOrigin) throw new Error("invalid_twilio_oauth_return_url");
  returnTo.searchParams.set("twilio", "connected");
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

export function integrationList(client: ClientConfig, calendar: Record<string, unknown>) {
  const now = new Date().toISOString();
  return [
    { id: "twilio", name: "Twilio", connected: Boolean(client.inboundNumbers.length), detail: client.inboundNumbers.length ? "Inbound numbers route directly to ElevenLabs" : "No inbound number assigned", lastCheckedAt: now },
    { id: "elevenlabs", name: "ElevenLabs", connected: client.voicePipeline === "elevenlabs-convai" && Boolean(client.elevenlabsAgentId), detail: client.elevenlabsAgentId ? "Realtime speech, barge-in and agent conversation" : "Assign this workspace's ElevenLabs agent ID", lastCheckedAt: now },
    { id: "calcom", name: "Cal.com", connected: Boolean(calendar.ok), detail: calendar.ok ? `${calendar.slotCount || 0} slots available` : String(calendar.error || "Not connected"), lastCheckedAt: String(calendar.probedAt || now) },
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
  if (!body.calendar.credentialRef || !/^[A-Z][A-Z0-9_]*$/.test(body.calendar.credentialRef)) {
    throw new Error("calendar_credential_reference_required");
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
      credentialRef: body.calendar.credentialRef,
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
    const plans = Object.values(planCatalog()).map((plan) => ({
      ...plan,
      features: plan.features.map((feature) => ({
        id: feature,
        operational: featureOperationallyAvailable(feature),
      })),
    }));
    send(res, 200, { items: plans, currency: "GBP" });
    return true;
  }

  if (route === "/admin/summary" && req.method === "GET") {
    if (!canAdministerPlatform(actor)) {
      send(res, 403, { error: "platform_admin_required" });
      return true;
    }
    const clients = await store.listClients();
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
      clients: items,
    });
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
    const calendar = selected ? await probeCalcomForClient({ client: selected }) : {};
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
        credentialRef: created.calendar.credentialRef!,
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

  const onboardingMatch = route.match(/^\/clients\/([^/]+)\/onboarding$/);
  if (onboardingMatch && req.method === "GET") {
    const client = await requireManageClient(ctx, onboardingMatch[1]);
    if (!client) return true;
    const draft = await store.getDraftClient(client.id);
    const runs = await store.listProvisioningRuns(client.id);
    send(res, 200, {
      client: safeEditableClient(draft?.config || client),
      provisioning: runs[0] || null,
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
        status: "pending",
        metadata: {},
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
    const body = await readJson<{ apiKeySid?: string; apiKeySecret?: string; twilioNumber?: string }>(ctx);
    if (
      !connection?.accountSid ||
      connection.mode !== "customer_oauth" ||
      !body.apiKeySid?.match(/^SK[0-9a-f]{32}$/i) ||
      !body.apiKeySecret ||
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
      connection.apiKeySid = body.apiKeySid;
      connection.encryptedApiKeySecret = encryptTwilioCredential(body.apiKeySecret);
      connection.status = "active";
      connection.metadata = { ...connection.metadata, verifiedPhoneSid: owned.sid };
      connection.updatedAt = new Date().toISOString();
      await store.upsertTwilioConnection(connection);
      send(res, 200, {
        mode: connection.mode,
        status: connection.status,
        accountSidMasked: `${connection.accountSid.slice(0, 4)}…${connection.accountSid.slice(-4)}`,
      });
    } catch (error) {
      send(res, 400, { error: error instanceof Error ? error.message : "twilio_credentials_invalid" });
    }
    return true;
  }
  if (twilioConnectionMatch && req.method === "DELETE") {
    const client = await requireManageClient(ctx, twilioConnectionMatch[1]);
    if (!client) return true;
    await store.deleteTwilioConnection(client.id);
    send(res, 200, { ok: true });
    return true;
  }

  const finalizeOnboardingMatch = route.match(/^\/clients\/([^/]+)\/onboarding\/finalize$/);
  if (finalizeOnboardingMatch && req.method === "POST") {
    const liveClient = await requireManageClient(ctx, finalizeOnboardingMatch[1]);
    if (!liveClient) return true;
    if (process.env.SAAS_PROVISIONING_ENABLED !== "true") {
      send(res, 503, { error: "saas_provisioning_disabled" });
      return true;
    }
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
      !body.twilioNumber?.match(/^\+[1-9]\d{7,14}$/)
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
      requestedPhoneNumber: body.twilioNumber,
      onboardingStatus: "ready_to_provision",
    });
    const now = new Date().toISOString();
    const latest = await store.latestPrompt(client.id);
    const prompt = {
      id: newId("pv_"),
      clientId: client.id,
      version: (latest?.version ?? 0) + 1,
      compiled: compilePrompt({
        client,
        direction: "inbound",
        objective: "Answer, retrieve knowledge, book, reschedule, cancel, capture a callback, or transfer safely.",
      }),
      createdAt: now,
    };
    client.promptVersionId = prompt.id;
    client.published = true;
    await store.publishClientDraft({
      id: existingDraft?.id || newId("client_revision_"),
      clientId: client.id,
      status: "draft",
      config: client,
      createdBy: actor.subject,
      createdAt: existingDraft?.createdAt || now,
      updatedAt: now,
    }, prompt);
    try {
      const result = await provisionClientAgent({
        clientId: client.id,
        operationKey: `self-serve-${client.id}-${prompt.id}`,
        apiBaseUrl: process.env.API_PUBLIC_BASE_URL || `https://${ctx.req.headers.host}`,
        transferNumber: client.transferNumber,
        twilioNumber: body.twilioNumber,
        phoneMode: body.phoneMode,
        twilioAccountSid: process.env.TWILIO_ACCOUNT_SID,
        twilioAuthToken: process.env.TWILIO_AUTH_TOKEN,
      }, {
        store,
        elevenLabs: new ElevenLabsManagementClient({ apiKey: process.env.ELEVENLABS_API_KEY || "" }),
      });
      send(res, 200, { client: safeEditableClient(await store.getClient(client.id) || client), provisioning: result });
    } catch (error) {
      send(res, 502, { error: error instanceof Error ? error.message : "provisioning_failed" });
    }
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
    send(res, 200, { client: safeEditableClient(client), promptVersion: prompt });
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
      send(res, 200, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "provisioning_failed";
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
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
        finishedAt: run.finishedAt,
      })),
    });
    return true;
  }

  const versionsMatch = route.match(/^\/clients\/([^/]+)\/prompt-versions$/);
  if (versionsMatch && req.method === "GET") {
    if (!(await requireClient(ctx, versionsMatch[1]))) return true;
    const extended = store as ExtendedStore;
    const versions = extended.listPromptVersions
      ? await extended.listPromptVersions(versionsMatch[1])
      : [await store.latestPrompt(versionsMatch[1])].filter(Boolean);
    send(res, 200, { items: versions });
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
    const probe = await probeCalcomForClient({
      client,
      eventTypeSlug: url.searchParams.get("eventTypeSlug") || undefined,
    });
    send(res, 200, {
      ...probe,
      items: probe.nextSlots.map((start) => ({ start })),
    });
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
    const tenant = calcomTenantFromClient(client);
    if (!tenant.apiKey || !tenant.username) {
      send(res, 200, { items: projected, configured: false, source: "projection" });
    } else {
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
    const tenant = calcomTenantFromClient(client);
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

  if (route === "/integrations/status" && req.method === "GET") {
    const client = await requireClient(ctx, clientId(url));
    if (!client) return true;
    const calendar = await probeCalcomForClient({ client });
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
