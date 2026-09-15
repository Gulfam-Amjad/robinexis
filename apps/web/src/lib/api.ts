import type {
  AdminControlPlane,
  AnalyticsSummary,
  ApiErrorBody,
  Booking,
  BootstrapResponse,
  CalendarSlot,
  Call,
  Client,
  ClientSummary,
  IntegrationStatus,
  Job,
  KnowledgeDocument,
  ListResponse,
  OnboardingWizardData,
  OnboardingWizardResponse,
  OnboardingWizardState,
  OnboardingWizardStep,
  PublicPromptVersion,
  PublicCalendarConnection,
  PublicTwilioConnection,
  SessionActor,
  TimeseriesPoint,
  Usage,
  WorkspaceMembership,
  WorkspaceRole,
} from "@robinexis/api-contracts";

export const API_KEY_STORAGE = "robinexis_admin_api_key";
export const CLIENT_STORAGE = "robinexis_active_client";

function apiUrl(path: string) {
  const base = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
  return `${base}${path}`;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: ApiErrorBody,
  ) {
    super(message);
  }
}

function query(params: Record<string, string | number | boolean | undefined>) {
  const result = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== "") result.set(key, String(value));
  });
  const value = result.toString();
  return value ? `?${value}` : "";
}

async function request<T>(path: string, init: RequestInit = {}, accessKey?: string): Promise<T> {
  const key = accessKey ?? sessionStorage.getItem(API_KEY_STORAGE);
  const response = await fetch(apiUrl(path), {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
      ...init.headers,
    },
  });
  const body = (await response.json().catch(() => undefined)) as T | ApiErrorBody | undefined;
  if (!response.ok) {
    const error = body as ApiErrorBody | undefined;
    if (response.status === 401 && accessKey === undefined) {
      window.dispatchEvent(new Event("robinexis:unauthorized"));
    }
    throw new ApiError(error?.message || error?.error || `Request failed (${response.status})`, response.status, error);
  }
  return body as T;
}

function list<T>(value: T[] | ListResponse<T> | { data?: T[] } | undefined): T[] {
  if (Array.isArray(value)) return value;
  if (value && "items" in value && Array.isArray(value.items)) return value.items;
  if (value && "data" in value && Array.isArray(value.data)) return value.data;
  return [];
}

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunkSize = 32_768;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export const api = {
  plans: () => request<{
    items: Array<{
      tier: "starter" | "pro" | "enterprise";
      name: string;
      monthlyPricePence: number | null;
      trialDays: number;
      includedMinutes: number;
      features: Array<{ id: string; operational: boolean }>;
    }>;
    currency: "GBP";
  }>("/api/v1/plans"),
  validateKey: (key: string) => request<BootstrapResponse>("/api/v1/bootstrap", {}, key),
  session: (accessKey?: string) => request<SessionActor>("/api/v1/session", {}, accessKey),
  acceptLegal: (accessKey?: string) =>
    request<{ acceptedAt: string }>("/api/v1/account/legal-consent", { method: "POST" }, accessKey),
  acceptInvitations: (accessKey?: string) =>
    request<{ clientIds: string[] }>("/api/v1/invitations/accept", { method: "POST" }, accessKey),
  requests: (clientId?: string) => request<{ items: Array<{ id: string; type: string; status: string; email?: string; payload: Record<string, unknown>; createdAt: string }> }>(
    `/api/v1/requests${query({ clientId })}`,
  ).then((result) => result.items),
  createRequest: (input: { type: "team_invite" | "data_export" | "workspace_deletion" | "support"; email?: string; role?: string; subject?: string; message?: string }) =>
    request<{ request: { id: string; type: string; status: string } }>("/api/v1/requests", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  manageInvitation: (id: string, action: "resend" | "revoke") =>
    request<{ request: { id: string; status: string } }>(`/api/v1/requests/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ action }),
    }),
  bootstrap: (clientId?: string) =>
    request<BootstrapResponse>(`/api/v1/bootstrap${query({ clientId })}`),
  clients: async () => list(await request<ClientSummary[] | ListResponse<ClientSummary>>("/api/v1/clients")),
  adminSummary: () => request<{
    month: string;
    mrrPence: number;
    totalUsedMinutes: number;
    totalFailedCalls: number;
    setupQueueCount?: number;
    failedBillingEvents?: Array<{
      id: string;
      clientId?: string;
      eventType: string;
      error?: string;
      receivedAt: string;
    }>;
    clients: Array<{
      clientId: string;
      plan: "starter" | "pro" | "enterprise";
      subscriptionStatus: string;
      usedMinutes: number;
      remainingMinutes: number;
      failedCalls: number;
    }>;
  }>("/api/v1/admin/summary"),
  adminControlPlane: () => request<AdminControlPlane>("/api/v1/admin/control-plane"),
  notificationStatus: (clientId: string) =>
    request<{ pending: number; failed: number; lastDeliveryAt?: string }>(
      `/api/v1/clients/${encodeURIComponent(clientId)}/notifications/status`,
    ),
  replayBillingEvent: (eventId: string) =>
    request<{ ok: boolean; status?: string }>(
      `/api/v1/admin/billing-events/${encodeURIComponent(eventId)}/replay`,
      { method: "POST" },
    ),
  adminAudit: (clientId?: string) =>
    request<{ items: Array<{ id: string; clientId?: string; actorId: string; action: string; detail: Record<string, unknown>; createdAt: string }> }>(
      `/api/v1/admin/audit${clientId ? `?clientId=${encodeURIComponent(clientId)}` : ""}`,
    ).then((result) => result.items),
  workspaceAudit: (clientId: string) =>
    request<{ items: Array<{ id: string; action: string; createdAt: string }> }>(
      `/api/v1/audit?clientId=${encodeURIComponent(clientId)}`,
    ).then((result) => result.items),
  transitionSetup: (
    clientId: string,
    input: { status: "setup_queued" | "setup_in_progress" | "needs_attention" | "active"; note?: string; eta?: string },
  ) =>
    request<{ client: Client }>(`/api/v1/admin/setup/${encodeURIComponent(clientId)}/transition`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  client: (id: string) => request<Client>(`/api/v1/clients/${encodeURIComponent(id)}`),
  createClient: (input: Partial<Client> & {
    planTier?: "starter" | "pro" | "enterprise";
    calendar?: Client["calendar"] & { credentialRef?: string };
  }) =>
    request<Client>("/api/v1/clients", { method: "POST", body: JSON.stringify(input) }),
  updateClient: (id: string, input: Partial<Client>) =>
    request<{ client?: Client; republishRequired?: boolean } | Client>(`/api/v1/clients/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  publishClient: (id: string) =>
    request<{ client?: Client; promptVersion?: PublicPromptVersion }>(`/api/v1/clients/${encodeURIComponent(id)}/publish`, {
      method: "POST",
    }),
  provisionClient: (id: string, operationKey: string, twilioNumber?: string) =>
    request<{
      runId: string;
      elevenlabsAgentId: string;
      phoneNumberId?: string;
    }>(`/api/v1/clients/${encodeURIComponent(id)}/provision`, {
      method: "POST",
      body: JSON.stringify({ operationKey, twilioNumber }),
    }),
  provisioningRuns: (id: string) =>
    request<{ items: Array<{
      id: string;
      status: "pending" | "running" | "paused" | "succeeded" | "failed" | "cancelled";
      step?: string;
      error?: string;
      updatedAt: string;
      output?: { readinessReport?: import("@robinexis/api-contracts").ProvisioningReadinessReport };
    }> }>(`/api/v1/clients/${encodeURIComponent(id)}/provisioning`),
  approveProvisioning: (id: string, runId: string) =>
    request<{ client: Client; runId: string; activated: true }>(
      `/api/v1/clients/${encodeURIComponent(id)}/provisioning/${encodeURIComponent(runId)}/approve`,
      { method: "POST" },
    ),
  provisioningAction: (id: string, runId: string, action: "pause" | "retry" | "review", note?: string) =>
    request<{ run: import("@robinexis/api-contracts").ProvisioningStatus }>(
      `/api/v1/clients/${encodeURIComponent(id)}/provisioning/${encodeURIComponent(runId)}/action`,
      { method: "POST", body: JSON.stringify({ action, note }) },
    ),
  twilioConnection: (id: string) =>
    request<PublicTwilioConnection>(`/api/v1/clients/${encodeURIComponent(id)}/twilio-connection`),
  startTwilioConnection: (id: string) =>
    request<{ url: string }>(`/api/v1/clients/${encodeURIComponent(id)}/twilio-connection/start`, {
      method: "POST",
    }),
  saveTwilioCredentials: (id: string, input: {
    apiKeySid: string;
    apiKeySecret: string;
    accountAuthToken: string;
    twilioNumber: string;
  }) =>
    request<PublicTwilioConnection>(`/api/v1/clients/${encodeURIComponent(id)}/twilio-connection/credentials`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  twilioOwnedNumbers: (id: string) =>
    request<{ items: Array<{ phoneNumber: string; selected: boolean }> }>(
      `/api/v1/clients/${encodeURIComponent(id)}/twilio-connection/numbers`,
    ).then((result) => result.items),
  disconnectTwilio: (id: string) =>
    request<{ ok: boolean; status: "revoked" }>(`/api/v1/clients/${encodeURIComponent(id)}/twilio-connection`, {
      method: "DELETE",
    }),
  onboarding: (id: string) =>
    request<{ client: Client; provisioning: import("@robinexis/api-contracts").ProvisioningStatus | null }>(
      `/api/v1/clients/${encodeURIComponent(id)}/onboarding`,
    ),
  saveOnboarding: (id: string, input: Partial<Client>) =>
    request<{ client: Client }>(`/api/v1/clients/${encodeURIComponent(id)}/onboarding`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  onboardingWizard: (id: string) =>
    request<OnboardingWizardResponse>(`/api/v1/clients/${encodeURIComponent(id)}/onboarding/wizard`),
  saveOnboardingWizard: (id: string, input: {
    currentStep?: OnboardingWizardStep;
    completedStep?: OnboardingWizardStep;
    data?: Partial<OnboardingWizardData>;
    expectedVersion?: number;
  }) =>
    request<{ wizard: OnboardingWizardState; readiness: OnboardingWizardResponse["readiness"] }>(
      `/api/v1/clients/${encodeURIComponent(id)}/onboarding/wizard`,
      { method: "PATCH", body: JSON.stringify(input) },
    ),
  submitOnboardingWizard: (id: string) =>
    request<{ wizard: OnboardingWizardState; onboardingStatus: "ready_to_provision"; automationEnabled: boolean; message: string }>(
      `/api/v1/clients/${encodeURIComponent(id)}/onboarding/wizard/submit`,
      { method: "POST" },
    ),
  websiteIntelligence: (id: string, runId?: string) =>
    request<import("@robinexis/api-contracts").WebsiteIntelligenceState>(
      `/api/v1/clients/${encodeURIComponent(id)}/website-intelligence${query({ runId })}`,
    ),
  scanWebsite: (id: string, url: string) =>
    request<import("@robinexis/api-contracts").WebsiteIntelligenceState>(
      `/api/v1/clients/${encodeURIComponent(id)}/website-intelligence`,
      { method: "POST", body: JSON.stringify({ url }) },
    ),
  reviewWebsiteFact: (id: string, runId: string, factId: string, input: { action: "confirm" | "edit"; value?: unknown }) =>
    request<{ fact: import("@robinexis/api-contracts").WebsiteIntelligenceFact }>(
      `/api/v1/clients/${encodeURIComponent(id)}/website-intelligence/runs/${encodeURIComponent(runId)}/facts/${encodeURIComponent(factId)}`,
      { method: "PATCH", body: JSON.stringify(input) },
    ),
  approveWebsiteFacts: (id: string, runId: string) =>
    request<{ approved: true; published: false }>(
      `/api/v1/clients/${encodeURIComponent(id)}/website-intelligence/runs/${encodeURIComponent(runId)}/approve-indexing`,
      { method: "POST", body: JSON.stringify({ indexKnowledge: false }) },
    ),
  finalizeOnboarding: (id: string, input: {
    businessName: string;
    greeting?: string;
    tone?: string;
    location?: string;
    phone?: string;
    transferNumber: string;
    hours?: string;
    prices?: string;
    policies?: string[];
    publishedFacts?: string[];
    services: Array<{ title: string; slug: string; durationMinutes: number }>;
    phoneMode: "robinexis_account" | "customer_oauth";
    twilioNumber?: string;
  }) =>
    request<{ client: Client; onboardingStatus: "setup_queued"; message: string }>(
      `/api/v1/clients/${encodeURIComponent(id)}/onboarding/finalize`,
      { method: "POST", body: JSON.stringify(input) },
    ),
  setServiceStatus: (id: string, action: "suspend" | "reactivate") =>
    request<{ clientId: string; serviceStatus: string }>(
      `/api/v1/clients/${encodeURIComponent(id)}/service-status`,
      { method: "POST", body: JSON.stringify({ action }) },
    ),
  adjustCredits: (id: string, minutes: number, reason: string, idempotencyKey: string) =>
    request<{ appended: boolean; remainingMinutes: number }>(
      `/api/v1/clients/${encodeURIComponent(id)}/credit-adjustments`,
      { method: "POST", body: JSON.stringify({ minutes, reason, idempotencyKey }) },
    ),
  promptVersions: async (id: string) =>
    list(await request<PublicPromptVersion[] | ListResponse<PublicPromptVersion>>(`/api/v1/clients/${encodeURIComponent(id)}/prompt-versions`)),
  calls: async (clientId: string, filters: Record<string, string | undefined> = {}) =>
    list(await request<Call[] | ListResponse<Call>>(`/api/v1/calls${query({ clientId, ...filters })}`)),
  call: (id: string, clientId: string) =>
    request<Call>(`/api/v1/calls/${encodeURIComponent(id)}${query({ clientId })}`),
  analyticsSummary: (clientId: string, range: { from?: string; to?: string } = {}) =>
    request<AnalyticsSummary>(`/api/v1/analytics/summary${query({ clientId, ...range })}`),
  analyticsTimeseries: async (clientId: string, range: { from?: string; to?: string } = {}) =>
    list(await request<TimeseriesPoint[] | ListResponse<TimeseriesPoint>>(`/api/v1/analytics/timeseries${query({ clientId, ...range })}`)),
  usage: (clientId: string, month?: string) =>
    request<Usage>(`/api/v1/usage${query({ clientId, month })}`),
  createCheckout: (plan: "starter" | "pro", clientId?: string) =>
    request<{ checkoutSessionId: string; url: string | null; clientId?: string }>("/api/v1/billing/checkout", {
      method: "POST",
      body: JSON.stringify(clientId ? { clientId, plan } : { plan }),
    }),
  createBillingPortal: (clientId?: string) =>
    request<{ portalSessionId: string; url: string }>("/api/v1/billing/portal", {
      method: "POST",
      body: JSON.stringify(clientId ? { clientId } : {}),
    }),
  billingStatus: (clientId?: string) =>
    request<{
      configured: boolean;
      canManagePortal?: boolean;
      plan?: "starter" | "pro" | "enterprise";
      status: string;
      trialEndsAt?: string;
      currentPeriodEnd?: string;
      cancelAtPeriodEnd?: boolean;
    }>(`/api/v1/billing/status${clientId ? `?clientId=${encodeURIComponent(clientId)}` : ""}`),
  slots: async (clientId: string, eventTypeSlug: string) =>
    list(await request<CalendarSlot[] | ListResponse<CalendarSlot>>(`/api/v1/calendar/slots${query({ clientId, eventTypeSlug })}`)),
  bookings: async (clientId: string) =>
    list(await request<Booking[] | ListResponse<Booking>>(`/api/v1/calendar/bookings${query({ clientId })}`)),
  rescheduleBooking: (uid: string, clientId: string, newStart: string) =>
    request<Booking>(`/api/v1/calendar/bookings/${encodeURIComponent(uid)}/reschedule`, {
      method: "POST",
      body: JSON.stringify({ clientId, newStart, confirmed: true }),
    }),
  cancelBooking: (uid: string, clientId: string) =>
    request<{ ok: boolean }>(`/api/v1/calendar/bookings/${encodeURIComponent(uid)}/cancel`, {
      method: "POST",
      body: JSON.stringify({ clientId, confirmed: true }),
    }),
  jobs: async (clientId: string) =>
    list(await request<Job[] | ListResponse<Job>>(`/api/v1/jobs${query({ clientId })}`)),
  createJob: (input: Partial<Job>) =>
    request<Job>("/api/v1/jobs", { method: "POST", body: JSON.stringify(input) }),
  jobAction: (id: string, action: "approve" | "cancel") =>
    request<Job>(`/api/v1/jobs/${encodeURIComponent(id)}/${action}`, { method: "POST" }),
  memberships: async (clientId: string) =>
    list(await request<WorkspaceMembership[] | ListResponse<WorkspaceMembership>>(`/api/v1/memberships${query({ clientId })}`)),
  addMembership: (clientId: string, email: string, role: WorkspaceRole) =>
    request<WorkspaceMembership>("/api/v1/memberships", {
      method: "POST",
      body: JSON.stringify({ clientId, email, role }),
    }),
  updateMembershipRole: (clientId: string, id: string, role: "manager" | "viewer") =>
    request<WorkspaceMembership>(`/api/v1/memberships/${encodeURIComponent(id)}${query({ clientId })}`, {
      method: "PATCH",
      body: JSON.stringify({ role }),
    }),
  transferOwnership: (clientId: string, id: string) =>
    request<WorkspaceMembership>(`/api/v1/memberships/${encodeURIComponent(id)}/transfer-ownership${query({ clientId })}`, {
      method: "POST",
    }),
  deleteMembership: (clientId: string, id: string) =>
    request<{ ok: boolean }>(`/api/v1/memberships/${encodeURIComponent(id)}${query({ clientId })}`, {
      method: "DELETE",
    }),
  integrations: async (clientId: string) =>
    list(await request<IntegrationStatus[] | ListResponse<IntegrationStatus>>(`/api/v1/integrations/status${query({ clientId })}`)),
  calendarConnection: (clientId: string) =>
    request<PublicCalendarConnection>(`/api/v1/clients/${encodeURIComponent(clientId)}/calendar-connection`),
  startCalcomOAuth: (clientId: string) =>
    request<{ url: string }>(`/api/v1/clients/${encodeURIComponent(clientId)}/calendar-connection/oauth/start`, { method: "POST" }),
  createManagedCalcom: (clientId: string) =>
    request<{ status: string; mode: "managed"; idempotent?: boolean }>(
      `/api/v1/clients/${encodeURIComponent(clientId)}/calendar-connection/managed`,
      { method: "POST" },
    ),
  selectCalendarDestination: (clientId: string, calendarId: string, provider?: string) =>
    request<PublicCalendarConnection>(`/api/v1/clients/${encodeURIComponent(clientId)}/calendar-connection/destination`, {
      method: "PATCH",
      body: JSON.stringify({ calendarId, provider }),
    }),
  disconnectCalcom: (clientId: string) =>
    request<{ status: "disabled"; providerRevoked: boolean }>(
      `/api/v1/clients/${encodeURIComponent(clientId)}/calendar-connection`,
      { method: "DELETE" },
    ),
  documents: async (clientId: string) =>
    list(await request<KnowledgeDocument[] | ListResponse<KnowledgeDocument>>(`/api/v1/knowledge/documents${query({ clientId })}`)),
  createDocument: async (input: { clientId: string; title: string; source?: string; content?: string; file?: File }) => {
    const file = input.file;
    const sourceType = file
      ? file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
        ? "pdf"
        : file.name.toLowerCase().match(/\.md(?:own)?$/)
          ? "markdown"
          : "txt"
      : undefined;
    return request<KnowledgeDocument>("/api/v1/knowledge/documents", {
      method: "POST",
      body: JSON.stringify({
        clientId: input.clientId,
        title: input.title,
        source: input.source || file?.name,
        sourceType,
        content: file ? undefined : input.content,
        contentBase64: file ? await fileToBase64(file) : undefined,
      }),
    });
  },
  deleteDocument: (id: string, clientId: string) =>
    request<{ ok: boolean }>(`/api/v1/knowledge/documents/${encodeURIComponent(id)}${query({ clientId })}`, { method: "DELETE" }),
  reindexDocument: (id: string, clientId: string) =>
    request<KnowledgeDocument>(`/api/v1/knowledge/documents/${encodeURIComponent(id)}/reindex`, {
      method: "POST",
      body: JSON.stringify({ clientId }),
    }),
  searchKnowledge: (clientId: string, searchQuery: string) =>
    request<{ results: Array<{ text: string; score?: number; documentId?: string }> }>("/api/v1/knowledge/search", {
      method: "POST",
      body: JSON.stringify({ clientId, query: searchQuery }),
    }),
};

export function formatDate(value?: string, options?: Intl.DateTimeFormatOptions) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat("en-GB", options || { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function initials(value: string) {
  return value
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}
