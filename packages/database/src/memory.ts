import { randomUUID } from "node:crypto";
import { sortClientsForDashboard } from "./clientOrder.js";
import { assertOnboardingTransition } from "./lifecycle.js";
import type {
  AgentInstance,
  AnalyticsRange,
  AnalyticsSummary,
  AnalyticsTimeseriesPoint,
  BookingRecord,
  CalendarConnection,
  CalendarEventType,
  CallListOptions,
  CallNote,
  CallSession,
  ClientConfigRevision,
  ClientConfig,
  CreditLedgerEntry,
  ExtractedFact,
  KnowledgeChunk,
  KnowledgeDocument,
  KnowledgeDocumentListOptions,
  KnowledgeSearchOptions,
  KnowledgeSearchResult,
  Location,
  OperatorAuditRecord,
  OnboardingGap,
  OnboardingJob,
  OnboardingOutboxEvent,
  OnboardingWizardState,
  NotificationDelivery,
  NotificationHealth,
  OutboundJob,
  Page,
  PhoneEndpoint,
  PromptVersion,
  ProvisioningRun,
  ProvisioningActivationInput,
  ProvisioningActivationIntent,
  ProvisioningActivationResult,
  ProviderAccountSnapshot,
  ProviderAlertRule,
  ProviderDeployment,
  ProviderRollbackSnapshot,
  ProviderResource,
  ProviderSwitchOperation,
  ProviderUsageCostEvent,
  StripeEvent,
  Subscription,
  Suppression,
  TenantRequest,
  ToolActionRow,
  TwilioConnection,
  UsageCounters,
  UserProfile,
  WebsiteExtractionRun,
  WebsiteSource,
  WorkspaceMembership,
} from "./types.js";

export interface BillingTransition {
  client: ClientConfig;
  subscription: Subscription;
  credit?: CreditLedgerEntry;
  audit: OperatorAuditRecord;
  event: StripeEvent;
}

export interface PlatformStore {
  getClient(id: string): Promise<ClientConfig | undefined>;
  getClientBySlug(slug: string): Promise<ClientConfig | undefined>;
  getClientByInboundNumber(e164: string): Promise<ClientConfig | undefined>;
  getClientByElevenLabsAgentId(agentId: string): Promise<ClientConfig | undefined>;
  listClients(): Promise<ClientConfig[]>;
  upsertClient(c: ClientConfig): Promise<void>;
  getDraftClient(clientId: string): Promise<ClientConfigRevision | undefined>;
  saveDraftClient(revision: ClientConfigRevision): Promise<void>;
  publishClientDraft(revision: ClientConfigRevision, prompt: PromptVersion): Promise<void>;
  getPublishedClient(id: string): Promise<ClientConfig | undefined>;
  listMembershipsForEmail(email: string): Promise<WorkspaceMembership[]>;
  listMembershipsForClient(clientId: string): Promise<WorkspaceMembership[]>;
  upsertMembership(membership: WorkspaceMembership): Promise<void>;
  deleteMembership(clientId: string, membershipId: string): Promise<boolean>;
  getUserProfile(clientId: string, authUserId: string): Promise<UserProfile | undefined>;
  getUserProfileByAuthUserId(authUserId: string): Promise<UserProfile | undefined>;
  listUserProfilesForAuthUser(authUserId: string): Promise<UserProfile[]>;
  listUserProfiles(clientId: string): Promise<UserProfile[]>;
  upsertUserProfile(profile: UserProfile): Promise<void>;
  saveTenantRequest(request: TenantRequest): Promise<void>;
  listTenantRequests(clientId?: string, type?: TenantRequest["type"]): Promise<TenantRequest[]>;
  getTenantRequest(id: string): Promise<TenantRequest | undefined>;

  getLocation(clientId: string, id: string): Promise<Location | undefined>;
  listLocations(clientId: string): Promise<Location[]>;
  upsertLocation(location: Location): Promise<void>;
  getAgentInstance(clientId: string, id: string): Promise<AgentInstance | undefined>;
  getAgentInstanceByProviderAgentId(providerAgentId: string): Promise<AgentInstance | undefined>;
  getAgentInstanceByVoiceCredentialHash(hash: string): Promise<AgentInstance | undefined>;
  listAgentInstances(clientId: string): Promise<AgentInstance[]>;
  upsertAgentInstance(agent: AgentInstance): Promise<void>;
  listPhoneEndpoints(clientId: string): Promise<PhoneEndpoint[]>;
  findPhoneEndpointByE164(e164: string): Promise<PhoneEndpoint | undefined>;
  upsertPhoneEndpoint(endpoint: PhoneEndpoint): Promise<void>;
  getTwilioConnection(clientId: string): Promise<TwilioConnection | undefined>;
  upsertTwilioConnection(connection: TwilioConnection): Promise<void>;
  deleteTwilioConnection(clientId: string): Promise<void>;
  listCalendarConnections(clientId: string): Promise<CalendarConnection[]>;
  upsertCalendarConnection(connection: CalendarConnection): Promise<void>;
  listCalendarEventTypes(clientId: string): Promise<CalendarEventType[]>;
  upsertCalendarEventType(eventType: CalendarEventType): Promise<void>;

  getCurrentSubscription(clientId: string): Promise<Subscription | undefined>;
  upsertSubscription(subscription: Subscription): Promise<void>;
  claimStripeEvent(event: StripeEvent): Promise<boolean>;
  saveStripeEvent(event: StripeEvent): Promise<void>;
  getStripeEvent(clientId: string, id: string): Promise<StripeEvent | undefined>;
  listStripeEvents(status?: StripeEvent["status"], limit?: number): Promise<StripeEvent[]>;
  applyBillingTransition(transition: BillingTransition): Promise<void>;

  saveBookingRecord(booking: BookingRecord): Promise<void>;
  findBookingByIdempotency(clientId: string, key: string): Promise<BookingRecord | undefined>;
  listBookingRecords(clientId: string): Promise<BookingRecord[]>;
  appendCreditLedgerEntry(entry: CreditLedgerEntry): Promise<boolean>;
  listCreditLedger(clientId: string): Promise<CreditLedgerEntry[]>;
  getCreditBalance(clientId: string): Promise<number>;
  appendOperatorAudit(record: OperatorAuditRecord): Promise<boolean>;
  listOperatorAudit(clientId?: string, limit?: number): Promise<OperatorAuditRecord[]>;
  claimProvisioningRun(run: ProvisioningRun, claimToken?: string, staleAfterSeconds?: number): Promise<boolean>;
  renewProvisioningRunClaim(clientId: string, runId: string, claimToken: string, now: string): Promise<boolean>;
  saveProvisioningRun(run: ProvisioningRun, claimToken?: string): Promise<boolean>;
  getProvisioningRun(clientId: string, id: string): Promise<ProvisioningRun | undefined>;
  getProvisioningRunByIdempotency(clientId: string, key: string): Promise<ProvisioningRun | undefined>;
  listProvisioningRuns(clientId: string): Promise<ProvisioningRun[]>;
  prepareProvisionedClientActivation(input: ProvisioningActivationInput): Promise<ProvisioningActivationResult>;
  recordProvisioningActivationProgress(
    clientId: string,
    runId: string,
    assignmentStatus: "imported" | "assigned",
    providerPhoneNumberId: string,
    now: string,
  ): Promise<ProvisioningActivationResult>;
  finalizeProvisionedClientActivation(input: ProvisioningActivationInput): Promise<ProvisioningActivationResult>;
  failProvisionedClientActivation(
    clientId: string,
    runId: string,
    error: string,
    now: string,
    rollback?: { status: "deleted" | "failed"; error?: string },
  ): Promise<void>;
  enqueueOnboardingJob(job: OnboardingJob): Promise<boolean>;
  claimOnboardingJobs(workerId: string, nowIso: string, leaseSeconds: number, limit: number): Promise<OnboardingJob[]>;
  extendOnboardingJobLease(clientId: string, id: string, workerId: string, nowIso: string, leaseSeconds: number): Promise<boolean>;
  completeOnboardingJob(clientId: string, id: string, workerId: string, completedAt: string): Promise<boolean>;
  retryOnboardingJob(clientId: string, id: string, workerId: string, error: string, availableAt: string): Promise<boolean>;
  deadLetterOnboardingJob(clientId: string, id: string, workerId: string, error: string, failedAt: string): Promise<boolean>;
  getOnboardingJob(clientId: string, id: string): Promise<OnboardingJob | undefined>;
  saveOnboardingOutbox(event: OnboardingOutboxEvent): Promise<boolean>;
  listPendingOnboardingOutbox(limit?: number): Promise<OnboardingOutboxEvent[]>;
  enqueueNotification(delivery: NotificationDelivery): Promise<boolean>;
  claimNotifications(workerId: string, nowIso: string, leaseSeconds: number, limit: number): Promise<NotificationDelivery[]>;
  completeNotification(clientId: string, id: string, workerId: string, providerId: string, deliveredAt: string): Promise<boolean>;
  retryNotification(clientId: string, id: string, workerId: string, error: string, nextAttemptAt: string): Promise<boolean>;
  deadLetterNotification(clientId: string, id: string, workerId: string, error: string, failedAt: string): Promise<boolean>;
  listNotifications(clientId: string, limit?: number): Promise<NotificationDelivery[]>;
  notificationHealth(nowIso: string): Promise<NotificationHealth>;
  saveWebsiteSource(source: WebsiteSource): Promise<void>;
  getWebsiteSource(clientId: string, id: string): Promise<WebsiteSource | undefined>;
  listWebsiteSources(clientId: string): Promise<WebsiteSource[]>;
  saveWebsiteExtractionRun(run: WebsiteExtractionRun): Promise<void>;
  getWebsiteExtractionRun(clientId: string, id: string): Promise<WebsiteExtractionRun | undefined>;
  listWebsiteExtractionRuns(clientId: string, sourceId?: string): Promise<WebsiteExtractionRun[]>;
  replaceExtractedFacts(clientId: string, runId: string, facts: ExtractedFact[]): Promise<void>;
  saveExtractedFact(fact: ExtractedFact): Promise<void>;
  listExtractedFacts(clientId: string, runId: string): Promise<ExtractedFact[]>;
  upsertOnboardingGap(gap: OnboardingGap): Promise<void>;
  listOnboardingGaps(clientId: string): Promise<OnboardingGap[]>;
  getOnboardingWizard(clientId: string): Promise<OnboardingWizardState | undefined>;
  saveOnboardingWizard(state: OnboardingWizardState): Promise<void>;
  upsertProviderResource(resource: ProviderResource): Promise<void>;
  listProviderResources(clientId: string): Promise<ProviderResource[]>;
  upsertProviderDeployment(deployment: ProviderDeployment): Promise<void>;
  listProviderDeployments(clientId: string): Promise<ProviderDeployment[]>;
  getActiveProviderDeployment(clientId: string): Promise<ProviderDeployment | undefined>;
  claimProviderSwitchOperation(operation: ProviderSwitchOperation): Promise<boolean>;
  saveProviderSwitchOperation(operation: ProviderSwitchOperation): Promise<void>;
  getProviderSwitchOperationByIdempotency(clientId: string, key: string): Promise<ProviderSwitchOperation | undefined>;
  listProviderSwitchOperations(clientId: string): Promise<ProviderSwitchOperation[]>;
  saveProviderRollbackSnapshot(snapshot: ProviderRollbackSnapshot): Promise<boolean>;
  getProviderRollbackSnapshot(clientId: string, id: string): Promise<ProviderRollbackSnapshot | undefined>;
  appendProviderUsageCostEvent(event: ProviderUsageCostEvent): Promise<boolean>;
  listProviderUsageCostEvents(clientId: string, from?: string, to?: string): Promise<ProviderUsageCostEvent[]>;
  saveProviderAccountSnapshot(snapshot: ProviderAccountSnapshot): Promise<void>;
  getLatestProviderAccountSnapshot(provider: ProviderAccountSnapshot["provider"]): Promise<ProviderAccountSnapshot | undefined>;
  upsertProviderAlertRule(rule: ProviderAlertRule): Promise<void>;
  listProviderAlertRules(clientId: string): Promise<ProviderAlertRule[]>;

  getPromptVersion(id: string): Promise<PromptVersion | undefined>;
  latestPrompt(clientId: string): Promise<PromptVersion | undefined>;
  listPromptVersions(clientId: string, limit?: number): Promise<PromptVersion[]>;
  savePromptVersion(p: PromptVersion): Promise<void>;

  saveCall(c: CallSession): Promise<void>;
  getCall(id: string): Promise<CallSession | undefined>;
  getCallForClient(clientId: string, id: string): Promise<CallSession | undefined>;
  getCallByTwilioSid(clientId: string, twilioCallSid: string): Promise<CallSession | undefined>;
  listCallsForClient(clientId: string, limit?: number): Promise<CallSession[]>;
  listCallsForClient(clientId: string, options: CallListOptions): Promise<Page<CallSession>>;
  getAnalyticsSummary(clientId: string, range: AnalyticsRange): Promise<AnalyticsSummary>;
  getAnalyticsTimeseries(clientId: string, range: AnalyticsRange): Promise<AnalyticsTimeseriesPoint[]>;

  saveToolAction(row: ToolActionRow): Promise<void>;
  claimToolAction(row: ToolActionRow): Promise<boolean>;
  findToolByIdempotency(clientId: string, key: string): Promise<ToolActionRow | undefined>;
  listToolActionsForCall(clientId: string, callId: string): Promise<ToolActionRow[]>;

  saveJob(j: OutboundJob): Promise<void>;
  getJob(id: string): Promise<OutboundJob | undefined>;
  getJobForClient(clientId: string, id: string): Promise<OutboundJob | undefined>;
  listJobs(clientId?: string): Promise<OutboundJob[]>;
  claimJob(id: string, attemptedAt: string): Promise<boolean>;
  dueJobs(nowIso: string, limit: number): Promise<OutboundJob[]>;
  cancelJob(id: string, clientId?: string): Promise<boolean>;

  addSuppression(s: Suppression): Promise<void>;
  isSuppressed(clientId: string, phone: string): Promise<boolean>;

  saveNote(n: CallNote): Promise<void>;
  addUsage(clientId: string, inboundMin: number, outboundMin: number): Promise<UsageCounters>;
  getUsage(clientId: string, month: string): Promise<UsageCounters | undefined>;

  saveKnowledgeDocument(document: KnowledgeDocument): Promise<void>;
  getKnowledgeDocument(clientId: string, id: string): Promise<KnowledgeDocument | undefined>;
  listKnowledgeDocuments(clientId: string, options?: KnowledgeDocumentListOptions): Promise<Page<KnowledgeDocument>>;
  deleteKnowledgeDocument(clientId: string, id: string): Promise<boolean>;
  replaceKnowledgeChunks(clientId: string, documentId: string, chunks: KnowledgeChunk[]): Promise<void>;
  searchKnowledge(clientId: string, embedding: number[], options?: KnowledgeSearchOptions): Promise<KnowledgeSearchResult[]>;

  deleteCallsOlderThan(isoDate: string): Promise<number>;
  deleteLifecycleDataOlderThan(isoDate: string): Promise<Record<string, number>>;
}

function monthKey(d = new Date()) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export class MemoryStore implements PlatformStore {
  clients = new Map<string, ClientConfig>();
  clientRevisions = new Map<string, ClientConfigRevision>();
  prompts: PromptVersion[] = [];
  calls = new Map<string, CallSession>();
  tools: ToolActionRow[] = [];
  jobs = new Map<string, OutboundJob>();
  suppressions: Suppression[] = [];
  notes: CallNote[] = [];
  usage = new Map<string, UsageCounters>();
  knowledgeDocuments = new Map<string, KnowledgeDocument>();
  knowledgeChunks = new Map<string, KnowledgeChunk>();
  memberships = new Map<string, WorkspaceMembership>();
  userProfiles = new Map<string, UserProfile>();
  tenantRequests = new Map<string, TenantRequest>();
  locations = new Map<string, Location>();
  agentInstances = new Map<string, AgentInstance>();
  phoneEndpoints = new Map<string, PhoneEndpoint>();
  twilioConnections = new Map<string, TwilioConnection>();
  calendarConnections = new Map<string, CalendarConnection>();
  calendarEventTypes = new Map<string, CalendarEventType>();
  subscriptions = new Map<string, Subscription>();
  stripeEvents = new Map<string, StripeEvent>();
  bookingRecords = new Map<string, BookingRecord>();
  creditLedger = new Map<string, CreditLedgerEntry>();
  operatorAudit = new Map<string, OperatorAuditRecord>();
  provisioningRuns = new Map<string, ProvisioningRun>();
  onboardingJobs = new Map<string, OnboardingJob>();
  onboardingOutbox = new Map<string, OnboardingOutboxEvent>();
  notifications = new Map<string, NotificationDelivery>();
  websiteSources = new Map<string, WebsiteSource>();
  websiteExtractionRuns = new Map<string, WebsiteExtractionRun>();
  extractedFacts = new Map<string, ExtractedFact>();
  onboardingGaps = new Map<string, OnboardingGap>();
  onboardingWizards = new Map<string, OnboardingWizardState>();
  providerResources = new Map<string, ProviderResource>();
  providerDeployments = new Map<string, ProviderDeployment>();
  providerSwitchOperations = new Map<string, ProviderSwitchOperation>();
  providerRollbackSnapshots = new Map<string, ProviderRollbackSnapshot>();
  providerUsageCostEvents = new Map<string, ProviderUsageCostEvent>();
  providerAccountSnapshots = new Map<string, ProviderAccountSnapshot>();
  providerAlertRules = new Map<string, ProviderAlertRule>();

  async getClient(id: string) {
    return this.clients.get(id);
  }
  async getClientBySlug(slug: string) {
    return [...this.clients.values()].find((c) => c.slug === slug);
  }
  async getClientByInboundNumber(e164: string) {
    const n = e164.replace(/\s/g, "");
    return [...this.clients.values()].find((c) => c.inboundNumbers.some((x) => x.replace(/\s/g, "") === n));
  }
  async getClientByElevenLabsAgentId(agentId: string) {
    const instance = await this.getAgentInstanceByProviderAgentId(agentId);
    return instance
      ? this.clients.get(instance.clientId)
      : [...this.clients.values()].find((client) => client.elevenlabsAgentId === agentId);
  }
  async listClients() {
    return sortClientsForDashboard([...this.clients.values()]);
  }
  async upsertClient(c: ClientConfig) {
    this.clients.set(c.id, c);
  }
  async getDraftClient(clientId: string) {
    return [...this.clientRevisions.values()]
      .filter((revision) => revision.clientId === clientId && revision.status === "draft")
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  }
  async saveDraftClient(revision: ClientConfigRevision) {
    for (const [id, existing] of this.clientRevisions) {
      if (existing.clientId === revision.clientId && existing.status === "draft" && id !== revision.id) {
        this.clientRevisions.set(id, { ...existing, status: "superseded" });
      }
    }
    this.clientRevisions.set(revision.id, { ...revision });
  }
  async publishClientDraft(revision: ClientConfigRevision, prompt: PromptVersion) {
    this.prompts = this.prompts.filter((item) => item.id !== prompt.id);
    this.prompts.push({ ...prompt });
    this.clients.set(revision.clientId, { ...revision.config });
    this.clientRevisions.set(revision.id, {
      ...revision,
      status: "published",
      publishedAt: new Date().toISOString(),
    });
  }
  async getPublishedClient(idOrSlug: string) {
    const c = this.clients.get(idOrSlug) ?? (await this.getClientBySlug(idOrSlug));
    return c?.published ? c : undefined;
  }
  async listMembershipsForEmail(email: string) {
    const normalized = email.trim().toLowerCase();
    return [...this.memberships.values()].filter((membership) => membership.email === normalized);
  }
  async listMembershipsForClient(clientId: string) {
    return [...this.memberships.values()].filter((membership) => membership.clientId === clientId);
  }
  async upsertMembership(membership: WorkspaceMembership) {
    const normalized = { ...membership, email: membership.email.trim().toLowerCase() };
    for (const [id, existing] of this.memberships) {
      if (existing.clientId === normalized.clientId && existing.email === normalized.email && id !== normalized.id) {
        this.memberships.delete(id);
      }
    }
    this.memberships.set(normalized.id, normalized);
  }
  async deleteMembership(clientId: string, membershipId: string) {
    const membership = this.memberships.get(membershipId);
    if (!membership || membership.clientId !== clientId) return false;
    return this.memberships.delete(membershipId);
  }
  async getUserProfile(clientId: string, authUserId: string) {
    return [...this.userProfiles.values()].find((profile) => profile.clientId === clientId && profile.authUserId === authUserId);
  }
  async getUserProfileByAuthUserId(authUserId: string) {
    return [...this.userProfiles.values()].find((profile) => profile.authUserId === authUserId);
  }
  async listUserProfilesForAuthUser(authUserId: string) {
    return [...this.userProfiles.values()].filter((profile) => profile.authUserId === authUserId);
  }
  async listUserProfiles(clientId: string) {
    return [...this.userProfiles.values()].filter((profile) => profile.clientId === clientId);
  }
  async upsertUserProfile(profile: UserProfile) {
    for (const [key, existing] of this.userProfiles) {
      if (existing.authUserId === profile.authUserId && key !== profile.id) this.userProfiles.delete(key);
    }
    this.userProfiles.set(profile.id, { ...profile, email: profile.email.trim().toLowerCase() });
  }
  async saveTenantRequest(request: TenantRequest) {
    const existing = this.tenantRequests.get(request.id);
    if (existing && existing.clientId !== request.clientId) throw new Error("tenant_request_conflict");
    this.tenantRequests.set(request.id, request);
  }
  async listTenantRequests(clientId?: string, type?: TenantRequest["type"]) {
    return [...this.tenantRequests.values()]
      .filter((request) => (!clientId || request.clientId === clientId) && (!type || request.type === type))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async getTenantRequest(id: string) {
    return this.tenantRequests.get(id);
  }
  async getLocation(clientId: string, id: string) {
    return this.locations.get(`${clientId}:${id}`);
  }
  async listLocations(clientId: string) {
    return [...this.locations.values()].filter((location) => location.clientId === clientId);
  }
  async upsertLocation(location: Location) {
    this.locations.set(`${location.clientId}:${location.id}`, { ...location });
  }
  async getAgentInstance(clientId: string, id: string) {
    return this.agentInstances.get(`${clientId}:${id}`);
  }
  async getAgentInstanceByProviderAgentId(providerAgentId: string) {
    return [...this.agentInstances.values()].find((agent) => agent.providerAgentId === providerAgentId);
  }
  async getAgentInstanceByVoiceCredentialHash(hash: string) {
    return [...this.agentInstances.values()].find((agent) => agent.voiceCredentialHash === hash);
  }
  async listAgentInstances(clientId: string) {
    return [...this.agentInstances.values()].filter((agent) => agent.clientId === clientId);
  }
  async upsertAgentInstance(agent: AgentInstance) {
    if (agent.locationId && !this.locations.has(`${agent.clientId}:${agent.locationId}`)) throw new Error("location_not_found");
    this.agentInstances.set(`${agent.clientId}:${agent.id}`, { ...agent });
  }
  async listPhoneEndpoints(clientId: string) {
    return [...this.phoneEndpoints.values()].filter((endpoint) => endpoint.clientId === clientId);
  }
  async findPhoneEndpointByE164(e164: string) {
    return [...this.phoneEndpoints.values()].find((endpoint) => endpoint.e164 === e164);
  }
  async upsertPhoneEndpoint(endpoint: PhoneEndpoint) {
    const claimed = await this.findPhoneEndpointByE164(endpoint.e164);
    if (claimed && claimed.clientId !== endpoint.clientId) throw new Error("phone_number_claimed_by_another_tenant");
    if (endpoint.locationId && !this.locations.has(`${endpoint.clientId}:${endpoint.locationId}`)) throw new Error("location_not_found");
    if (endpoint.agentInstanceId && !this.agentInstances.has(`${endpoint.clientId}:${endpoint.agentInstanceId}`)) {
      throw new Error("agent_instance_not_found");
    }
    this.phoneEndpoints.set(`${endpoint.clientId}:${endpoint.id}`, { ...endpoint });
  }
  async getTwilioConnection(clientId: string) {
    return this.twilioConnections.get(clientId);
  }
  async upsertTwilioConnection(connection: TwilioConnection) {
    if (!this.clients.has(connection.clientId)) throw new Error("client_not_found");
    this.twilioConnections.set(connection.clientId, { ...connection });
  }
  async deleteTwilioConnection(clientId: string) {
    this.twilioConnections.delete(clientId);
  }
  async listCalendarConnections(clientId: string) {
    return [...this.calendarConnections.values()].filter((connection) => connection.clientId === clientId);
  }
  async upsertCalendarConnection(connection: CalendarConnection) {
    if (connection.locationId && !this.locations.has(`${connection.clientId}:${connection.locationId}`)) {
      throw new Error("location_not_found");
    }
    this.calendarConnections.set(`${connection.clientId}:${connection.id}`, { ...connection });
  }
  async listCalendarEventTypes(clientId: string) {
    return [...this.calendarEventTypes.values()].filter((eventType) => eventType.clientId === clientId);
  }
  async upsertCalendarEventType(eventType: CalendarEventType) {
    const connection = this.calendarConnections.get(`${eventType.clientId}:${eventType.calendarConnectionId}`);
    if (!connection) throw new Error("calendar_connection_not_found");
    this.calendarEventTypes.set(`${eventType.clientId}:${eventType.id}`, { ...eventType });
  }
  async getCurrentSubscription(clientId: string) {
    return [...this.subscriptions.values()]
      .filter((subscription) => subscription.clientId === clientId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  }
  async upsertSubscription(subscription: Subscription) {
    this.subscriptions.set(`${subscription.clientId}:${subscription.id}`, { ...subscription });
  }
  async claimStripeEvent(event: StripeEvent) {
    const key = event.id;
    if (this.stripeEvents.has(key)) return false;
    this.stripeEvents.set(key, { ...event });
    return true;
  }
  async saveStripeEvent(event: StripeEvent) {
    this.stripeEvents.set(event.id, { ...event });
  }
  async getStripeEvent(clientId: string, id: string) {
    const event = this.stripeEvents.get(id);
    return event?.clientId === clientId ? event : undefined;
  }
  async listStripeEvents(status?: StripeEvent["status"], limit = 100) {
    return [...this.stripeEvents.values()]
      .filter((event) => !status || event.status === status)
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
      .slice(0, limit);
  }
  async applyBillingTransition(transition: BillingTransition) {
    await this.upsertClient(transition.client);
    await this.upsertSubscription(transition.subscription);
    if (transition.credit) await this.appendCreditLedgerEntry(transition.credit);
    await this.appendOperatorAudit(transition.audit);
    await this.saveStripeEvent(transition.event);
  }
  async saveBookingRecord(booking: BookingRecord) {
    this.bookingRecords.set(`${booking.clientId}:${booking.id}`, { ...booking });
  }
  async findBookingByIdempotency(clientId: string, key: string) {
    return [...this.bookingRecords.values()].find((booking) => booking.clientId === clientId && booking.idempotencyKey === key);
  }
  async listBookingRecords(clientId: string) {
    return [...this.bookingRecords.values()]
      .filter((booking) => booking.clientId === clientId)
      .sort((a, b) => b.startsAt.localeCompare(a.startsAt));
  }
  async appendCreditLedgerEntry(entry: CreditLedgerEntry) {
    const key = `${entry.clientId}:${entry.id}`;
    if (this.creditLedger.has(key)) return false;
    const duplicateReference = [...this.creditLedger.values()].some(
      (existing) =>
        existing.clientId === entry.clientId &&
        entry.referenceType &&
        entry.referenceId &&
        existing.referenceType === entry.referenceType &&
        existing.referenceId === entry.referenceId,
    );
    if (duplicateReference) return false;
    this.creditLedger.set(key, { ...entry });
    return true;
  }
  async listCreditLedger(clientId: string) {
    return [...this.creditLedger.values()]
      .filter((entry) => entry.clientId === clientId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async getCreditBalance(clientId: string) {
    return [...this.creditLedger.values()]
      .filter((entry) => entry.clientId === clientId)
      .reduce((sum, entry) => sum + entry.minutes, 0);
  }
  async appendOperatorAudit(record: OperatorAuditRecord) {
    if (this.operatorAudit.has(record.id)) return false;
    this.operatorAudit.set(record.id, structuredClone(record));
    return true;
  }
  async listOperatorAudit(clientId?: string, limit = 100) {
    return [...this.operatorAudit.values()]
      .filter((record) => !clientId || record.clientId === clientId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map((record) => structuredClone(record));
  }
  async claimProvisioningRun(run: ProvisioningRun, claimToken = run.claimToken || "", staleAfterSeconds = 1800) {
    const existing = await this.getProvisioningRunByIdempotency(run.clientId, run.idempotencyKey);
    if (existing) {
      const staleBefore = new Date(Date.parse(run.updatedAt) - staleAfterSeconds * 1000).toISOString();
      const reclaimable = ["pending", "failed"].includes(existing.status) ||
        (existing.status === "running" && existing.updatedAt <= staleBefore);
      if (!reclaimable) return false;
      Object.assign(existing, {
        status: "running",
        error: undefined,
        finishedAt: undefined,
        startedAt: run.startedAt || existing.startedAt || run.updatedAt,
        updatedAt: run.updatedAt,
        claimToken,
      });
      run.id = existing.id;
      run.output = structuredClone(existing.output);
      run.startedAt = existing.startedAt;
      run.claimToken = claimToken;
      return true;
    }
    run.claimToken = claimToken;
    this.provisioningRuns.set(`${run.clientId}:${run.id}`, { ...run });
    return true;
  }
  async renewProvisioningRunClaim(clientId: string, runId: string, claimToken: string, now: string) {
    const run = this.provisioningRuns.get(`${clientId}:${runId}`);
    if (!run || run.status !== "running" || run.claimToken !== claimToken) return false;
    run.updatedAt = now;
    return true;
  }
  async saveProvisioningRun(run: ProvisioningRun, claimToken?: string) {
    const existing = this.provisioningRuns.get(`${run.clientId}:${run.id}`);
    if (claimToken && existing?.claimToken !== claimToken) return false;
    this.provisioningRuns.set(`${run.clientId}:${run.id}`, { ...run });
    return true;
  }
  async getProvisioningRun(clientId: string, id: string) {
    return this.provisioningRuns.get(`${clientId}:${id}`);
  }
  async getProvisioningRunByIdempotency(clientId: string, key: string) {
    return [...this.provisioningRuns.values()].find((run) => run.clientId === clientId && run.idempotencyKey === key);
  }
  async listProvisioningRuns(clientId: string) {
    return [...this.provisioningRuns.values()]
      .filter((run) => run.clientId === clientId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async prepareProvisionedClientActivation(input: ProvisioningActivationInput): Promise<ProvisioningActivationResult> {
    const client = this.clients.get(input.clientId);
    const run = this.provisioningRuns.get(`${input.clientId}:${input.runId}`);
    const subscription = [...this.subscriptions.values()]
      .filter((item) => item.clientId === input.clientId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    const blockers: string[] = [];
    if (!client) return { activated: false, error: "client_not_found" };
    const owner = [...this.memberships.values()].some((membership) =>
      membership.clientId === input.clientId &&
      membership.email === input.actorEmail.trim().toLowerCase() &&
      membership.role === "owner");
    if (!owner) return { activated: false, error: "workspace_owner_required" };
    if (client.onboardingStatus === "active" && this.operatorAudit.has(`activation_${input.runId}`)) {
      return { activated: true, client: structuredClone(client) };
    }
    if (!subscription || !["active", "trialing"].includes(subscription.status)) blockers.push("billing_inactive");
    const wizard = this.onboardingWizards.get(input.clientId);
    const websiteRun = wizard?.data.websiteRunId
      ? this.websiteExtractionRuns.get(`${input.clientId}:${wizard.data.websiteRunId}`)
      : undefined;
    const source = websiteRun
      ? this.websiteSources.get(`${input.clientId}:${websiteRun.sourceId}`)
      : undefined;
    const facts = websiteRun
      ? [...this.extractedFacts.values()].filter((item) =>
        item.clientId === input.clientId && item.extractionRunId === websiteRun.id)
      : [];
    if (
      !wizard?.submittedAt ||
      !websiteRun ||
      !facts.length ||
      facts.some((item) => item.reviewStatus === "extracted") ||
      source?.metadata.approvedRunId !== websiteRun.id
    ) blockers.push("required_facts_unconfirmed");
    if ([...this.onboardingGaps.values()].some((gap) =>
      gap.clientId === input.clientId && gap.status === "open")) blockers.push("hard_gaps_open");
    const twilio = this.twilioConnections.get(input.clientId);
    if (twilio?.status !== "active") blockers.push("twilio_inactive");
    if (
      run?.output?.phoneNumber &&
      twilio?.mode === "customer_oauth" &&
      !twilio.encryptedAccountAuthToken
    ) blockers.push("twilio_account_auth_token_missing");
    if (![...this.calendarConnections.values()].some((item) =>
      item.clientId === input.clientId && item.status === "active")) blockers.push("calendar_inactive");
    const report = run?.output?.readinessReport as { passed?: boolean } | undefined;
    const existingIntent = run?.output?.activationIntent as ProvisioningActivationIntent | undefined;
    const resumableActivation = Boolean(
      existingIntent && ["activation_pending", "activating", "paused"].includes(run?.status || ""),
    );
    if (!resumableActivation && (run?.status !== "succeeded" || run.step !== "awaiting_approval")) {
      blockers.push("provisioning_incomplete");
    }
    if (!report?.passed) blockers.push("synthetic_tests_failed");
    if (run?.output?.profileChecksum !== input.profileChecksum ||
        run?.output?.compiledPrompt !== input.prompt.compiled) blockers.push("provisioning_profile_changed");
    if (!["awaiting_approval", "needs_attention"].includes(client.onboardingStatus || "")) {
      blockers.push("not_awaiting_approval");
    }
    if (blockers.length) return { activated: false, error: "activation_requirements_not_met", blockers };
    const providerAgentId = String(run?.output?.elevenlabsAgentId || "");
    const phoneNumber = String(run?.output?.phoneNumber || "") || undefined;
    if (!providerAgentId) {
      return { activated: false, error: "activation_requirements_not_met", blockers: ["provider_agent_missing"] };
    }
    if (existingIntent?.rollbackStatus === "failed") {
      return { activated: false, error: "activation_requirements_not_met", blockers: ["provider_rollback_incomplete"] };
    }
    if (client.onboardingStatus === "needs_attention") {
      assertOnboardingTransition("needs_attention", "awaiting_approval");
      client.onboardingStatus = "awaiting_approval";
      await this.upsertClient(client);
    }
    const phoneEndpoint = phoneNumber
      ? [...this.phoneEndpoints.values()].find((endpoint) =>
        endpoint.clientId === input.clientId &&
        endpoint.e164 === phoneNumber &&
        endpoint.direction !== "outbound")
      : undefined;
    const intent: ProvisioningActivationIntent = existingIntent || {
      promptId: input.prompt.id,
      promptVersion: input.prompt.version,
      profileChecksum: input.profileChecksum,
      operationKey: `activate:${input.runId}`,
      providerAgentId,
      phoneNumber,
      phoneEndpointId: phoneEndpoint?.id,
      assignmentStatus: phoneNumber ? "pending" : "assigned",
    };
    if (intent.rollbackStatus === "deleted") {
      intent.providerPhoneNumberId = undefined;
      intent.assignmentStatus = intent.phoneNumber ? "pending" : "assigned";
      intent.rollbackStatus = undefined;
      intent.rollbackError = undefined;
    }
    run!.status = "activation_pending";
    run!.step = "activation_pending";
    run!.error = undefined;
    run!.output = { ...run!.output, activationIntent: intent };
    run!.updatedAt = input.now;
    await this.saveProvisioningRun(run!);
    return { activated: false, client: structuredClone(client), intent: structuredClone(intent) };
  }

  async recordProvisioningActivationProgress(
    clientId: string,
    runId: string,
    assignmentStatus: "imported" | "assigned",
    providerPhoneNumberId: string,
    now: string,
  ): Promise<ProvisioningActivationResult> {
    const run = this.provisioningRuns.get(`${clientId}:${runId}`);
    const intent = run?.output?.activationIntent as ProvisioningActivationIntent | undefined;
    if (!run || !intent || !["activation_pending", "activating"].includes(run.status)) {
      return { activated: false, error: "activation_intent_missing" };
    }
    intent.providerPhoneNumberId = providerPhoneNumberId;
    intent.assignmentStatus = assignmentStatus;
    run.status = "activating";
    run.step = assignmentStatus === "assigned" ? "provider_assignment_confirmed" : "provider_phone_imported";
    run.updatedAt = now;
    await this.saveProvisioningRun(run);
    return { activated: false, intent: structuredClone(intent) };
  }

  async finalizeProvisionedClientActivation(input: ProvisioningActivationInput): Promise<ProvisioningActivationResult> {
    const client = this.clients.get(input.clientId);
    const run = this.provisioningRuns.get(`${input.clientId}:${input.runId}`);
    const intent = run?.output?.activationIntent as ProvisioningActivationIntent | undefined;
    if (!client) return { activated: false, error: "client_not_found" };
    if (client.onboardingStatus === "active" && this.operatorAudit.has(`activation_${input.runId}`)) {
      return { activated: true, client: structuredClone(client), intent };
    }
    if (
      !run ||
      !["activation_pending", "activating"].includes(run.status) ||
      intent?.assignmentStatus !== "assigned" ||
      intent.profileChecksum !== input.profileChecksum ||
      input.prompt.compiled !== run.output?.compiledPrompt
    ) {
      return { activated: false, error: "activation_finalize_requirements_not_met" };
    }
    assertOnboardingTransition(client.onboardingStatus, "active");

    const draft = [...this.clientRevisions.values()].find((item) =>
      item.clientId === input.clientId && item.status === "draft");
    const activated = structuredClone(draft?.config || client);
    activated.elevenlabsAgentId = client.elevenlabsAgentId;
    activated.inboundNumbers = [...client.inboundNumbers];
    activated.published = true;
    activated.onboardingStatus = "active";
    activated.promptVersionId = input.prompt.id;
    this.clients.set(activated.id, activated);
    if (draft) {
      draft.status = "published";
      draft.publishedAt = input.now;
      draft.updatedAt = input.now;
    }
    this.prompts = this.prompts.filter((item) => item.id !== input.prompt.id);
    this.prompts.push(structuredClone(input.prompt));
    for (const agent of this.agentInstances.values()) {
      if (agent.clientId === input.clientId && agent.providerAgentId) agent.status = "active";
    }
    for (const endpoint of this.phoneEndpoints.values()) {
      if (endpoint.clientId === input.clientId && endpoint.id === intent.phoneEndpointId) {
        endpoint.status = "active";
        endpoint.providerEndpointId = intent.providerPhoneNumberId;
        endpoint.metadata = {
          ...endpoint.metadata,
          assignmentStatus: "active",
          activatedRunId: input.runId,
        };
      }
    }
    this.operatorAudit.set(`activation_${input.runId}`, {
      id: `activation_${input.runId}`,
      clientId: input.clientId,
      actorId: input.actorId,
      action: "provisioning.owner_activated",
      detail: { runId: input.runId, promptVersionId: input.prompt.id },
      createdAt: input.now,
    });
    run.status = "succeeded";
    run.step = "active";
    run.finishedAt = input.now;
    run.updatedAt = input.now;
    await this.saveProvisioningRun(run);
    return { activated: true, client: structuredClone(activated), intent: structuredClone(intent) };
  }

  async failProvisionedClientActivation(
    clientId: string,
    runId: string,
    error: string,
    now: string,
    rollback?: { status: "deleted" | "failed"; error?: string },
  ) {
    const run = this.provisioningRuns.get(`${clientId}:${runId}`);
    const client = this.clients.get(clientId);
    const intent = run?.output?.activationIntent as ProvisioningActivationIntent | undefined;
    if (run && intent) {
      intent.assignmentStatus = "needs_attention";
      intent.rollbackStatus = rollback?.status;
      intent.rollbackError = rollback?.error?.slice(0, 300);
      run.status = "paused";
      run.step = "activation_needs_attention";
      run.error = error.slice(0, 500);
      run.updatedAt = now;
      await this.saveProvisioningRun(run);
    }
    if (client && client.onboardingStatus !== "active") {
      client.onboardingStatus = "needs_attention";
      await this.upsertClient(client);
    }
    for (const endpoint of this.phoneEndpoints.values()) {
      if (endpoint.clientId !== clientId || endpoint.id !== intent?.phoneEndpointId) continue;
      endpoint.status = "pending";
      endpoint.metadata = {
        ...endpoint.metadata,
        assignmentStatus: "needs_attention",
        activationError: error.slice(0, 300),
        rollbackStatus: rollback?.status,
      };
      endpoint.updatedAt = now;
    }
  }
  async enqueueOnboardingJob(job: OnboardingJob) {
    if ([...this.onboardingJobs.values()].some((item) =>
      item.clientId === job.clientId && item.idempotencyKey === job.idempotencyKey)) return false;
    this.onboardingJobs.set(`${job.clientId}:${job.id}`, structuredClone(job));
    return true;
  }
  async claimOnboardingJobs(workerId: string, nowIso: string, leaseSeconds: number, limit: number) {
    const leaseExpiresAt = new Date(Date.parse(nowIso) + Math.max(1, leaseSeconds) * 1000).toISOString();
    const jobs = [...this.onboardingJobs.values()]
      .filter((job) => job.attemptCount < job.maxAttempts && job.availableAt <= nowIso)
      .filter((job) => job.status === "pending" || (
        job.status === "leased" && Boolean(job.leaseExpiresAt && job.leaseExpiresAt <= nowIso)
      ))
      .sort((a, b) => a.availableAt.localeCompare(b.availableAt) || a.createdAt.localeCompare(b.createdAt))
      .slice(0, Math.max(0, limit));
    for (const job of jobs) {
      job.status = "leased";
      job.leaseOwner = workerId;
      job.leaseExpiresAt = leaseExpiresAt;
      job.attemptCount += 1;
      job.updatedAt = nowIso;
    }
    return jobs.map((job) => structuredClone(job));
  }
  async extendOnboardingJobLease(
    clientId: string,
    id: string,
    workerId: string,
    nowIso: string,
    leaseSeconds: number,
  ) {
    const job = this.onboardingJobs.get(`${clientId}:${id}`);
    if (!job || job.status !== "leased" || job.leaseOwner !== workerId) return false;
    job.leaseExpiresAt = new Date(Date.parse(nowIso) + Math.max(1, leaseSeconds) * 1000).toISOString();
    job.updatedAt = nowIso;
    return true;
  }
  async completeOnboardingJob(clientId: string, id: string, workerId: string, completedAt: string) {
    const job = this.onboardingJobs.get(`${clientId}:${id}`);
    if (!job || job.status !== "leased" || job.leaseOwner !== workerId) return false;
    Object.assign(job, { status: "completed", completedAt, updatedAt: completedAt });
    delete job.leaseOwner;
    delete job.leaseExpiresAt;
    return true;
  }
  async retryOnboardingJob(clientId: string, id: string, workerId: string, error: string, availableAt: string) {
    const job = this.onboardingJobs.get(`${clientId}:${id}`);
    if (!job || job.status !== "leased" || job.leaseOwner !== workerId || job.attemptCount >= job.maxAttempts) return false;
    Object.assign(job, { status: "pending", lastError: error, availableAt, updatedAt: availableAt });
    delete job.leaseOwner;
    delete job.leaseExpiresAt;
    return true;
  }
  async deadLetterOnboardingJob(clientId: string, id: string, workerId: string, error: string, failedAt: string) {
    const job = this.onboardingJobs.get(`${clientId}:${id}`);
    if (!job || job.status !== "leased" || job.leaseOwner !== workerId) return false;
    Object.assign(job, { status: "dead_letter", lastError: error, updatedAt: failedAt });
    delete job.leaseOwner;
    delete job.leaseExpiresAt;
    return true;
  }
  async getOnboardingJob(clientId: string, id: string) {
    const job = this.onboardingJobs.get(`${clientId}:${id}`);
    return job ? structuredClone(job) : undefined;
  }
  async saveOnboardingOutbox(event: OnboardingOutboxEvent) {
    if ([...this.onboardingOutbox.values()].some((item) =>
      item.clientId === event.clientId && item.idempotencyKey === event.idempotencyKey)) return false;
    this.onboardingOutbox.set(`${event.clientId}:${event.id}`, structuredClone(event));
    return true;
  }
  async listPendingOnboardingOutbox(limit = 100) {
    return [...this.onboardingOutbox.values()].filter((event) => !event.publishedAt)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(0, limit).map((event) => structuredClone(event));
  }
  async enqueueNotification(delivery: NotificationDelivery) {
    if ([...this.notifications.values()].some((item) =>
      item.clientId === delivery.clientId && item.idempotencyKey === delivery.idempotencyKey)) return false;
    this.notifications.set(`${delivery.clientId}:${delivery.id}`, structuredClone(delivery));
    return true;
  }
  async claimNotifications(workerId: string, nowIso: string, leaseSeconds: number, limit: number) {
    const leaseExpiresAt = new Date(Date.parse(nowIso) + Math.max(1, leaseSeconds) * 1000).toISOString();
    const deliveries = [...this.notifications.values()]
      .filter((item) => item.attemptCount < item.maxAttempts && item.nextAttemptAt <= nowIso)
      .filter((item) => item.status === "pending" ||
        (item.status === "leased" && Boolean(item.leaseExpiresAt && item.leaseExpiresAt <= nowIso)))
      .sort((a, b) => a.nextAttemptAt.localeCompare(b.nextAttemptAt) || a.createdAt.localeCompare(b.createdAt))
      .slice(0, Math.max(0, limit));
    for (const item of deliveries) {
      Object.assign(item, {
        status: "leased", leaseOwner: workerId, leaseExpiresAt,
        attemptCount: item.attemptCount + 1, updatedAt: nowIso,
      });
    }
    return deliveries.map((item) => structuredClone(item));
  }
  async completeNotification(clientId: string, id: string, workerId: string, providerId: string, deliveredAt: string) {
    const item = this.notifications.get(`${clientId}:${id}`);
    if (!item || item.status !== "leased" || item.leaseOwner !== workerId) return false;
    Object.assign(item, { status: "delivered", providerId, deliveredAt, updatedAt: deliveredAt });
    delete item.leaseOwner;
    delete item.leaseExpiresAt;
    return true;
  }
  async retryNotification(clientId: string, id: string, workerId: string, error: string, nextAttemptAt: string) {
    const item = this.notifications.get(`${clientId}:${id}`);
    if (!item || item.status !== "leased" || item.leaseOwner !== workerId || item.attemptCount >= item.maxAttempts) return false;
    Object.assign(item, { status: "pending", lastError: error, nextAttemptAt, updatedAt: nextAttemptAt });
    delete item.leaseOwner;
    delete item.leaseExpiresAt;
    return true;
  }
  async deadLetterNotification(clientId: string, id: string, workerId: string, error: string, failedAt: string) {
    const item = this.notifications.get(`${clientId}:${id}`);
    if (!item || item.status !== "leased" || item.leaseOwner !== workerId) return false;
    Object.assign(item, { status: "dead_letter", lastError: error, deadLetteredAt: failedAt, updatedAt: failedAt });
    delete item.leaseOwner;
    delete item.leaseExpiresAt;
    return true;
  }
  async listNotifications(clientId: string, limit = 100) {
    return [...this.notifications.values()].filter((item) => item.clientId === clientId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit)
      .map((item) => structuredClone(item));
  }
  async notificationHealth(nowIso: string) {
    const all = [...this.notifications.values()];
    const pending = all.filter((item) => item.status === "pending");
    const yesterday = new Date(Date.parse(nowIso) - 86_400_000).toISOString();
    return {
      pending: pending.length,
      leased: all.filter((item) => item.status === "leased").length,
      deadLetter: all.filter((item) => item.status === "dead_letter").length,
      oldestPendingAt: pending.sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]?.createdAt,
      providerFailures24h: all.filter((item) => item.lastError && item.updatedAt >= yesterday).length,
    };
  }
  async saveWebsiteSource(source: WebsiteSource) {
    this.websiteSources.set(`${source.clientId}:${source.id}`, structuredClone(source));
  }
  async getWebsiteSource(clientId: string, id: string) {
    const source = this.websiteSources.get(`${clientId}:${id}`);
    return source ? structuredClone(source) : undefined;
  }
  async listWebsiteSources(clientId: string) {
    return [...this.websiteSources.values()].filter((source) => source.clientId === clientId);
  }
  async saveWebsiteExtractionRun(run: WebsiteExtractionRun) {
    if (!this.websiteSources.has(`${run.clientId}:${run.sourceId}`)) throw new Error("website_source_not_found");
    this.websiteExtractionRuns.set(`${run.clientId}:${run.id}`, structuredClone(run));
  }
  async getWebsiteExtractionRun(clientId: string, id: string) {
    const run = this.websiteExtractionRuns.get(`${clientId}:${id}`);
    return run ? structuredClone(run) : undefined;
  }
  async listWebsiteExtractionRuns(clientId: string, sourceId?: string) {
    return [...this.websiteExtractionRuns.values()]
      .filter((run) => run.clientId === clientId && (!sourceId || run.sourceId === sourceId));
  }
  async replaceExtractedFacts(clientId: string, runId: string, facts: ExtractedFact[]) {
    if (!this.websiteExtractionRuns.has(`${clientId}:${runId}`)) throw new Error("extraction_run_not_found");
    if (facts.some((fact) => fact.clientId !== clientId || fact.extractionRunId !== runId)) throw new Error("tenant_mismatch");
    for (const [key, fact] of this.extractedFacts) {
      if (fact.clientId === clientId && fact.extractionRunId === runId) this.extractedFacts.delete(key);
    }
    for (const fact of facts) this.extractedFacts.set(`${clientId}:${fact.id}`, structuredClone(fact));
  }
  async saveExtractedFact(fact: ExtractedFact) {
    const run = this.websiteExtractionRuns.get(`${fact.clientId}:${fact.extractionRunId}`);
    if (!run) throw new Error("extraction_run_not_found");
    const existing = this.extractedFacts.get(`${fact.clientId}:${fact.id}`);
    if (existing && existing.extractionRunId !== fact.extractionRunId) throw new Error("extracted_fact_conflict");
    this.extractedFacts.set(`${fact.clientId}:${fact.id}`, structuredClone(fact));
  }
  async listExtractedFacts(clientId: string, runId: string) {
    return [...this.extractedFacts.values()].filter((fact) => fact.clientId === clientId && fact.extractionRunId === runId);
  }
  async upsertOnboardingGap(gap: OnboardingGap) {
    this.onboardingGaps.set(`${gap.clientId}:${gap.id}`, structuredClone(gap));
  }
  async listOnboardingGaps(clientId: string) {
    return [...this.onboardingGaps.values()].filter((gap) => gap.clientId === clientId);
  }
  async getOnboardingWizard(clientId: string) {
    const state = this.onboardingWizards.get(clientId);
    return state ? structuredClone(state) : undefined;
  }
  async saveOnboardingWizard(state: OnboardingWizardState) {
    if (!this.clients.has(state.clientId)) throw new Error("client_not_found");
    const existing = this.onboardingWizards.get(state.clientId);
    if (existing && state.version < existing.version) throw new Error("onboarding_wizard_version_conflict");
    this.onboardingWizards.set(state.clientId, structuredClone(state));
  }
  async upsertProviderResource(resource: ProviderResource) {
    if (resource.providerResourceId) {
      for (const [key, existing] of this.providerResources) {
        if (
          existing.clientId === resource.clientId &&
          existing.provider === resource.provider &&
          existing.providerResourceId === resource.providerResourceId &&
          existing.id !== resource.id
        ) {
          this.providerResources.delete(key);
        }
      }
    }
    this.providerResources.set(`${resource.clientId}:${resource.id}`, structuredClone(resource));
  }
  async listProviderResources(clientId: string) {
    return [...this.providerResources.values()].filter((resource) => resource.clientId === clientId);
  }
  async upsertProviderDeployment(deployment: ProviderDeployment) {
    if (deployment.provider === "groq-gateway" && deployment.status !== "retired") {
      throw new Error("provider_retired");
    }
    if (deployment.status === "active") {
      for (const existing of this.providerDeployments.values()) {
        if (existing.clientId === deployment.clientId && existing.id !== deployment.id && existing.status === "active") {
          throw new Error("active_provider_deployment_conflict");
        }
      }
    }
    this.providerDeployments.set(`${deployment.clientId}:${deployment.id}`, structuredClone(deployment));
  }
  async listProviderDeployments(clientId: string) {
    return [...this.providerDeployments.values()]
      .filter((deployment) => deployment.clientId === clientId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async getActiveProviderDeployment(clientId: string) {
    return [...this.providerDeployments.values()]
      .find((deployment) => deployment.clientId === clientId && deployment.status === "active");
  }
  async claimProviderSwitchOperation(operation: ProviderSwitchOperation) {
    const duplicate = [...this.providerSwitchOperations.values()].find(
      (item) => item.clientId === operation.clientId && item.idempotencyKey === operation.idempotencyKey,
    );
    if (duplicate) return false;
    this.providerSwitchOperations.set(`${operation.clientId}:${operation.id}`, structuredClone(operation));
    return true;
  }
  async saveProviderSwitchOperation(operation: ProviderSwitchOperation) {
    const key = `${operation.clientId}:${operation.id}`;
    const existing = this.providerSwitchOperations.get(key);
    if (!existing) throw new Error("provider_switch_not_found");
    this.providerSwitchOperations.set(key, structuredClone(operation));
  }
  async getProviderSwitchOperationByIdempotency(clientId: string, key: string) {
    return [...this.providerSwitchOperations.values()].find(
      (operation) => operation.clientId === clientId && operation.idempotencyKey === key,
    );
  }
  async listProviderSwitchOperations(clientId: string) {
    return [...this.providerSwitchOperations.values()]
      .filter((operation) => operation.clientId === clientId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async saveProviderRollbackSnapshot(snapshot: ProviderRollbackSnapshot) {
    const duplicate = [...this.providerRollbackSnapshots.values()].find(
      (item) => item.clientId === snapshot.clientId && item.switchOperationId === snapshot.switchOperationId,
    );
    if (duplicate) return false;
    this.providerRollbackSnapshots.set(`${snapshot.clientId}:${snapshot.id}`, structuredClone(snapshot));
    return true;
  }
  async getProviderRollbackSnapshot(clientId: string, id: string) {
    return this.providerRollbackSnapshots.get(`${clientId}:${id}`);
  }
  async appendProviderUsageCostEvent(event: ProviderUsageCostEvent) {
    const duplicate = [...this.providerUsageCostEvents.values()].find(
      (item) => item.clientId === event.clientId &&
        (item.id === event.id || (item.provider === event.provider && item.providerEventId === event.providerEventId)),
    );
    if (duplicate) return false;
    this.providerUsageCostEvents.set(`${event.clientId}:${event.id}`, structuredClone(event));
    return true;
  }
  async listProviderUsageCostEvents(clientId: string, from?: string, to?: string) {
    return [...this.providerUsageCostEvents.values()]
      .filter((event) => event.clientId === clientId &&
        (!from || event.occurredAt >= from) && (!to || event.occurredAt <= to))
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  }
  async saveProviderAccountSnapshot(snapshot: ProviderAccountSnapshot) {
    this.providerAccountSnapshots.set(snapshot.id, structuredClone(snapshot));
  }
  async getLatestProviderAccountSnapshot(provider: ProviderAccountSnapshot["provider"]) {
    return [...this.providerAccountSnapshots.values()]
      .filter((snapshot) => snapshot.provider === provider)
      .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))[0];
  }
  async upsertProviderAlertRule(rule: ProviderAlertRule) {
    this.providerAlertRules.set(`${rule.clientId}:${rule.id}`, structuredClone(rule));
  }
  async listProviderAlertRules(clientId: string) {
    return [...this.providerAlertRules.values()].filter((rule) => rule.clientId === clientId);
  }
  async getPromptVersion(id: string) {
    return this.prompts.find((p) => p.id === id);
  }
  async latestPrompt(clientId: string) {
    return this.prompts.filter((p) => p.clientId === clientId).sort((a, b) => b.version - a.version)[0];
  }
  async listPromptVersions(clientId: string, limit = 50) {
    return this.prompts
      .filter((p) => p.clientId === clientId)
      .sort((a, b) => b.version - a.version)
      .slice(0, Math.max(1, Math.min(limit, 200)));
  }
  async savePromptVersion(p: PromptVersion) {
    this.prompts = this.prompts.filter((x) => x.id !== p.id);
    this.prompts.push(p);
  }
  async saveCall(c: CallSession) {
    const existing = this.calls.get(c.id);
    if (existing && existing.clientId !== c.clientId) {
      throw new Error("call_session_tenant_conflict");
    }
    this.calls.set(c.id, { ...c, updatedAt: new Date().toISOString() });
  }
  async getCall(id: string) {
    return this.calls.get(id);
  }
  async getCallForClient(clientId: string, id: string) {
    const call = this.calls.get(id);
    return call?.clientId === clientId ? call : undefined;
  }
  async getCallByTwilioSid(clientId: string, twilioCallSid: string) {
    const sid = twilioCallSid.trim();
    if (!sid) return undefined;
    return [...this.calls.values()]
      .filter((c) => c.clientId === clientId && c.twilioCallSid === sid)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  }
  async listCallsForClient(clientId: string, limit?: number): Promise<CallSession[]>;
  async listCallsForClient(clientId: string, options: CallListOptions): Promise<Page<CallSession>>;
  async listCallsForClient(
    clientId: string,
    options: number | CallListOptions = 50,
  ): Promise<CallSession[] | Page<CallSession>> {
    const legacy = typeof options === "number";
    const query = legacy ? { limit: options } : options;
    const limit = Math.max(1, Math.min(query.limit ?? 50, 200));
    const filtered = [...this.calls.values()]
      .filter((c) => c.clientId === clientId)
      .filter((c) => !query.direction || c.direction === query.direction)
      .filter((c) => !query.status || c.status === query.status)
      .filter((c) => !query.outcome || c.outcome === query.outcome)
      .filter((c) => !query.from || c.createdAt >= query.from)
      .filter((c) => !query.to || c.createdAt <= query.to)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id))
      .filter((c) => !query.cursor || callCursor(c) < query.cursor);
    const items = filtered.slice(0, limit);
    if (legacy) return items;
    return {
      items,
      nextCursor: filtered.length > limit && items.length ? callCursor(items[items.length - 1]!) : undefined,
    };
  }
  async getAnalyticsSummary(clientId: string, range: AnalyticsRange) {
    const calls = this.analyticsCalls(clientId, range);
    return analyticsSummary(clientId, range, calls);
  }
  async getAnalyticsTimeseries(clientId: string, range: AnalyticsRange) {
    return analyticsTimeseries(this.analyticsCalls(clientId, range));
  }
  async saveToolAction(row: ToolActionRow) {
    const index = this.tools.findIndex((tool) => tool.id === row.id);
    if (index >= 0) this.tools[index] = row;
    else this.tools.push(row);
  }
  async claimToolAction(row: ToolActionRow) {
    if (
      row.idempotencyKey &&
      this.tools.some(
        (tool) =>
          tool.clientId === row.clientId && tool.idempotencyKey === row.idempotencyKey,
      )
    ) {
      return false;
    }
    this.tools.push(row);
    return true;
  }
  async findToolByIdempotency(clientId: string, key: string) {
    return [...this.tools].reverse().find((t) => t.clientId === clientId && t.idempotencyKey === key);
  }
  async listToolActionsForCall(clientId: string, callId: string) {
    return this.tools
      .filter((tool) => tool.clientId === clientId && tool.callId === callId)
      .sort((a, b) => a.at.localeCompare(b.at));
  }
  async saveJob(j: OutboundJob) {
    this.jobs.set(j.id, j);
  }
  async getJob(id: string) {
    return this.jobs.get(id);
  }
  async getJobForClient(clientId: string, id: string) {
    const job = this.jobs.get(id);
    return job?.clientId === clientId ? job : undefined;
  }
  async listJobs(clientId?: string) {
    const jobs = [...this.jobs.values()];
    return clientId ? jobs.filter((job) => job.clientId === clientId) : jobs;
  }
  async claimJob(id: string, attemptedAt: string) {
    const job = this.jobs.get(id);
    if (!job || job.status !== "approved" || !job.approved) return false;
    job.status = "dialing";
    job.attemptCount += 1;
    job.lastAttemptAt = attemptedAt;
    this.jobs.set(id, job);
    return true;
  }
  async dueJobs(nowIso: string, limit: number) {
    return [...this.jobs.values()]
      .filter((j) => (j.status === "pending" || j.status === "approved") && j.scheduledAt <= nowIso)
      .slice(0, limit);
  }
  async cancelJob(id: string, clientId?: string) {
    const job = this.jobs.get(id);
    if (!job || (clientId && job.clientId !== clientId) || ["completed", "cancelled"].includes(job.status)) {
      return false;
    }
    job.status = "cancelled";
    job.approved = false;
    this.jobs.set(id, job);
    return true;
  }
  async addSuppression(s: Suppression) {
    this.suppressions.push(s);
  }
  async isSuppressed(clientId: string, phone: string) {
    const p = phone.replace(/\s/g, "");
    return this.suppressions.some((s) => s.clientId === clientId && s.phone.replace(/\s/g, "") === p);
  }
  async saveNote(n: CallNote) {
    this.notes.push(n);
  }
  async addUsage(clientId: string, inboundMin: number, outboundMin: number) {
    const month = monthKey();
    const k = `${clientId}:${month}`;
    const cur = this.usage.get(k) ?? { clientId, month, inboundMinutes: 0, outboundMinutes: 0 };
    cur.inboundMinutes += inboundMin;
    cur.outboundMinutes += outboundMin;
    this.usage.set(k, cur);
    return cur;
  }
  async getUsage(clientId: string, month: string) {
    return this.usage.get(`${clientId}:${month}`);
  }
  async saveKnowledgeDocument(document: KnowledgeDocument) {
    this.knowledgeDocuments.set(`${document.clientId}:${document.id}`, { ...document });
  }
  async getKnowledgeDocument(clientId: string, id: string) {
    return this.knowledgeDocuments.get(`${clientId}:${id}`);
  }
  async listKnowledgeDocuments(clientId: string, options: KnowledgeDocumentListOptions = {}) {
    const limit = Math.max(1, Math.min(options.limit ?? 50, 200));
    const filtered = [...this.knowledgeDocuments.values()]
      .filter((document) => document.clientId === clientId)
      .filter((document) => !options.status || document.status === options.status)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
      .filter((document) => !options.cursor || documentCursor(document) < options.cursor);
    const items = filtered.slice(0, limit);
    return {
      items,
      nextCursor: filtered.length > limit && items.length ? documentCursor(items[items.length - 1]!) : undefined,
    };
  }
  async deleteKnowledgeDocument(clientId: string, id: string) {
    const deleted = this.knowledgeDocuments.delete(`${clientId}:${id}`);
    for (const [key, chunk] of this.knowledgeChunks) {
      if (chunk.clientId === clientId && chunk.documentId === id) this.knowledgeChunks.delete(key);
    }
    return deleted;
  }
  async replaceKnowledgeChunks(clientId: string, documentId: string, chunks: KnowledgeChunk[]) {
    for (const [key, chunk] of this.knowledgeChunks) {
      if (chunk.clientId === clientId && chunk.documentId === documentId) this.knowledgeChunks.delete(key);
    }
    for (const chunk of chunks) {
      if (chunk.clientId !== clientId || chunk.documentId !== documentId) throw new Error("tenant_mismatch");
      if (chunk.embedding.length !== 768) throw new Error("embedding_must_have_768_dimensions");
      this.knowledgeChunks.set(`${clientId}:${chunk.id}`, { ...chunk, embedding: [...chunk.embedding] });
    }
  }
  async searchKnowledge(clientId: string, embedding: number[], options: KnowledgeSearchOptions = {}) {
    if (embedding.length !== 768) throw new Error("embedding_must_have_768_dimensions");
    const allowed = options.documentIds ? new Set(options.documentIds) : undefined;
    return [...this.knowledgeChunks.values()]
      .filter((chunk) => chunk.clientId === clientId)
      .filter((chunk) => !allowed || allowed.has(chunk.documentId))
      .map((chunk) => ({
        chunk,
        document: this.knowledgeDocuments.get(`${clientId}:${chunk.documentId}`),
        score: cosineSimilarity(embedding, chunk.embedding),
      }))
      .filter((result): result is KnowledgeSearchResult => Boolean(result.document))
      .filter((result) => result.score >= (options.minScore ?? 0))
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, Math.min(options.limit ?? 5, 20)));
  }
  async deleteCallsOlderThan(isoDate: string) {
    let n = 0;
    for (const [id, c] of this.calls) {
      if (c.createdAt < isoDate) {
        this.calls.delete(id);
        n++;
      }
    }
    return n;
  }
  async deleteLifecycleDataOlderThan(isoDate: string) {
    const counts = { websiteFacts: 0, providerResources: 0, jobs: 0, notifications: 0 };
    for (const [key, fact] of this.extractedFacts) {
      const run = this.websiteExtractionRuns.get(`${fact.clientId}:${fact.extractionRunId}`);
      const source = run && this.websiteSources.get(`${fact.clientId}:${run.sourceId}`);
      if (fact.createdAt < isoDate && source && ["disabled", "failed"].includes(source.status)) {
        this.extractedFacts.delete(key); counts.websiteFacts++;
      }
    }
    for (const [key, resource] of this.providerResources) {
      if (resource.lifecycleStatus === "deleted" && resource.updatedAt < isoDate) {
        this.providerResources.delete(key); counts.providerResources++;
      }
    }
    for (const [key, job] of this.onboardingJobs) {
      if (["completed", "dead_letter"].includes(job.status) && job.updatedAt < isoDate) {
        this.onboardingJobs.delete(key); counts.jobs++;
      }
    }
    for (const [key, delivery] of this.notifications) {
      if (["delivered", "dead_letter"].includes(delivery.status) && delivery.updatedAt < isoDate) {
        this.notifications.delete(key); counts.notifications++;
      }
    }
    return counts;
  }

  private analyticsCalls(clientId: string, range: AnalyticsRange) {
    return [...this.calls.values()].filter(
      (call) => call.clientId === clientId && call.createdAt >= range.from && call.createdAt <= range.to,
    );
  }
}

function callCursor(call: CallSession) {
  return `${call.updatedAt}|${call.id}`;
}

function documentCursor(document: KnowledgeDocument) {
  return `${document.createdAt}|${document.id}`;
}

function durationMinutes(call: CallSession) {
  const value = call.collected.durationMinutes;
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function analyticsSummary(clientId: string, range: AnalyticsRange, calls: CallSession[]): AnalyticsSummary {
  return {
    clientId,
    ...range,
    totalCalls: calls.length,
    inboundCalls: calls.filter((call) => call.direction === "inbound").length,
    outboundCalls: calls.filter((call) => call.direction === "outbound").length,
    completedCalls: calls.filter((call) => call.status === "completed").length,
    transferredCalls: calls.filter((call) => call.status === "transferred").length,
    failedCalls: calls.filter((call) => call.status === "failed").length,
    bookedCalls: calls.filter((call) => Boolean(call.appointmentId)).length,
    totalMinutes: calls.reduce((sum, call) => sum + durationMinutes(call), 0),
  };
}

function analyticsTimeseries(calls: CallSession[]): AnalyticsTimeseriesPoint[] {
  const points = new Map<string, AnalyticsTimeseriesPoint>();
  for (const call of calls) {
    const date = call.createdAt.slice(0, 10);
    const point = points.get(date) ?? { date, calls: 0, completed: 0, transferred: 0, failed: 0, booked: 0 };
    point.calls++;
    if (call.status === "completed") point.completed++;
    if (call.status === "transferred") point.transferred++;
    if (call.status === "failed") point.failed++;
    if (call.appointmentId) point.booked++;
    points.set(date, point);
  }
  return [...points.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function cosineSimilarity(a: number[], b: number[]) {
  let dot = 0;
  let aNorm = 0;
  let bNorm = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    aNorm += a[i]! * a[i]!;
    bNorm += b[i]! * b[i]!;
  }
  return aNorm && bNorm ? dot / Math.sqrt(aNorm * bNorm) : 0;
}

export function newId(prefix = ""): string {
  return prefix + randomUUID();
}
