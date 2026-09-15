export type ServiceStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "incomplete"
  | "incomplete_expired"
  | "paused";

export type CallDirection = "inbound" | "outbound";
export type CallStatus = "active" | "completed" | "transferred" | "failed";
export type JobStatus = "pending" | "approved" | "dialing" | "completed" | "suppressed" | "failed" | "cancelled";
export type WorkspaceRole = "owner" | "manager" | "viewer";
export type OnboardingStatus =
  | "payment_required"
  | "details_required"
  | "integrations_required"
  | "setup_queued"
  | "setup_in_progress"
  | "needs_attention"
  | "ready_to_provision"
  | "provisioning"
  | "testing"
  | "awaiting_approval"
  | "active"
  | "failed";
export type PhoneAcquisitionMode = "robinexis_account" | "customer_oauth";

export interface PublicTwilioConnection {
  mode: PhoneAcquisitionMode;
  status: "not_connected" | "pending" | "credentials_required" | "active" | "expired" | "revoked" | "failed";
  accountSidMasked?: string;
  selectedPhoneNumber?: string;
  verifiedPhoneNumber?: string;
  canReconnect: boolean;
}

export interface SessionActor {
  email: string;
  role: "operator" | "salon" | "pending";
  clientRoles: Record<string, WorkspaceRole | "operator">;
  clientId?: string;
  subscriptionStatus?: ServiceStatus;
  capabilities?: {
    administerPlatform?: boolean;
    createClients?: boolean;
  };
  onboardingStatus?: OnboardingStatus;
}

export interface WorkspaceMembership {
  id: string;
  clientId: string;
  email: string;
  role: WorkspaceRole;
  createdAt: string;
}

export interface ClientSummary {
  id: string;
  slug: string;
  businessName: string;
  published: boolean;
  serviceStatus: ServiceStatus;
  onboardingStatus?: OnboardingStatus;
  onboardingNotes?: string;
  onboardingEta?: string;
  access?: { enabled?: boolean; inbound?: boolean; outbound?: boolean; reason?: string };
}

export interface ClientService {
  slug: string;
  title: string;
  durationMinutes: number;
}

export interface CalendarScheduleSettings {
  timezone: string;
  weeklyHours: Record<string, Array<{ start: string; end: string }>>;
  overrides: Array<{ date: string; available: boolean; start?: string; end?: string }>;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  minimumNoticeMinutes: number;
  cancellationAllowed: boolean;
  rescheduleAllowed: boolean;
}

export interface Client extends ClientSummary {
  hasUnpublishedChanges?: boolean;
  role?: string;
  greeting?: string;
  tone?: string;
  location?: string;
  phone?: string;
  email?: string;
  transferNumber?: string;
  voiceId?: string;
  elevenlabsAgentId?: string;
  voicePipeline?: "elevenlabs-convai" | "groq-gateway";
  services?: ClientService[];
  staff?: string[];
  hours?: string;
  prices?: string;
  policies?: string[];
  publishedFacts?: string[];
  unknownTopics?: string[];
  calendar?: {
    provider: "calcom" | "google" | "outlook" | "fresha";
    username?: string;
    destinationCalendarId?: string;
    destinationProvider?: string;
    schedule?: CalendarScheduleSettings;
  };
  enabledFeatures?: string[];
  inboundNumbers?: string[];
  outboundCallerId?: string;
  maxConcurrentCalls?: number;
  outboundRatePerHour?: number;
  firstCampaignRequiresApproval?: boolean;
  subscribedProduct?: string;
  monthlyMinuteLimit?: number;
  promptVersionId?: string;
  onboardingStatus?: OnboardingStatus;
  onboardingNotes?: string;
  onboardingEta?: string;
  phoneAcquisitionMode?: PhoneAcquisitionMode;
  requestedPhoneNumber?: string;
}

export interface ProvisioningStatus {
  id?: string;
  status: "not_started" | "pending" | "running" | "paused" | "succeeded" | "failed";
  step?: string;
  error?: string;
  updatedAt?: string;
  output?: {
    readinessReport?: ProvisioningReadinessReport;
  };
}

export interface ProvisioningReadinessReport {
  generatedAt: string;
  passed: boolean;
  hardGaps: string[];
  checks: Array<{ key: string; status: "passed" | "failed"; detail: string }>;
  syntheticBooking?: { providerBookingId?: string; created: boolean; cancelled: boolean };
  testCallLink?: string;
}

export interface AdminControlPlane {
  generatedAt: string;
  health: {
    status: "ok" | "degraded";
    notificationQueue: {
      pending: number;
      leased: number;
      deadLetter: number;
      oldestPendingAgeSeconds?: number;
      providerFailures24h: number;
    };
    spend: { status: "configured" | "needs_attention"; configuredCapCount: number; uncappedConnectionCount: number };
    backup: { status: "configured" | "not_configured"; freshness: "unknown" };
  };
  provisioning: Array<{
    clientId: string;
    businessName: string;
    onboardingStatus?: OnboardingStatus;
    runId?: string;
    runStatus?: ProvisioningStatus["status"];
    step?: string;
    readinessPassed?: boolean;
    blockers: string[];
    updatedAt?: string;
  }>;
  resources: Array<{
    clientId: string;
    businessName: string;
    provider: string;
    resourceType: string;
    lifecycleStatus: string;
    healthy: boolean;
    updatedAt: string;
  }>;
  requests: Array<{
    id: string;
    clientId: string;
    businessName: string;
    type: string;
    status: string;
    createdAt: string;
  }>;
  spendAlarms: Array<{
    clientId: string;
    businessName: string;
    monthlySpendCapPence: number;
    status: "configured";
  }>;
  blades: {
    present: boolean;
    published: boolean;
    serviceStatus?: ServiceStatus;
    inboundActive: boolean;
  };
}

export interface OnboardingJob {
  id: string;
  clientId: string;
  kind: string;
  idempotencyKey: string;
  status: "pending" | "leased" | "paused" | "completed" | "dead_letter";
  attemptCount: number;
  maxAttempts: number;
  availableAt: string;
  leaseExpiresAt?: string;
  lastError?: string;
}

export interface WebsiteSource {
  id: string;
  clientId: string;
  url: string;
  status: "pending" | "active" | "disabled" | "failed";
  lastFetchedAt?: string;
}

export interface OnboardingGap {
  id: string;
  clientId: string;
  key: string;
  status: "open" | "resolved" | "waived";
  detail?: string;
}

export type OnboardingWizardStep =
  | "website"
  | "facts"
  | "behavior"
  | "operations"
  | "phone"
  | "calendar"
  | "review";

export interface OnboardingWizardData {
  websiteUrl?: string;
  websiteRunId?: string;
  websiteApproved?: boolean;
  businessName?: string;
  location?: string;
  greeting?: string;
  tone?: string;
  transferNumber?: string;
  recordingConsent?: "always_ask" | "announcement" | "not_recording";
  services?: ClientService[];
  hours?: string;
  timezone?: string;
  bookingRules?: string;
  phoneMode?: "managed" | "customer_twilio";
  customerPhoneNumber?: string;
  calendarMode?: "managed_calcom" | "connect_existing";
  existingCalendarProvider?: "calcom" | "google" | "outlook" | "fresha";
  calendarSchedule?: CalendarScheduleSettings;
}

export interface PublicCalendarConnection {
  mode?: "oauth" | "managed" | "legacy" | "shared";
  status: "not_connected" | "pending" | "active" | "disabled" | "failed";
  accountMasked?: string;
  destinationCalendarId?: string;
  destinationProvider?: string;
  availableCalendars: Array<{ id: string; name: string; provider?: string }>;
  canReconnect: boolean;
  /** Cal.com gates OAuth and managed users behind its Platform plan. */
  availableModes?: { oauth: boolean; managed: boolean; shared: boolean };
}

export interface OnboardingReadinessBlocker {
  key: string;
  step: OnboardingWizardStep;
  message: string;
}

export interface OnboardingWizardState {
  clientId: string;
  currentStep: OnboardingWizardStep;
  completedSteps: OnboardingWizardStep[];
  data: OnboardingWizardData;
  version: number;
  createdAt: string;
  updatedAt: string;
  submittedAt?: string;
}

export interface WebsiteIntelligenceFact {
  id: string;
  key: string;
  value: unknown;
  confidence?: number;
  evidence?: unknown;
  reviewStatus: "extracted" | "confirmed" | "edited";
  reviewedAt?: string;
}

export interface WebsiteIntelligenceState {
  sources: Array<{ id: string; url: string; status: string; lastFetchedAt?: string; indexingStatus?: string }>;
  run: { id: string; status: string; error?: string } | null;
  facts: WebsiteIntelligenceFact[];
  gaps: OnboardingGap[];
}

export interface OnboardingWizardResponse {
  client: Client;
  wizard: OnboardingWizardState;
  readiness: { ready: boolean; blockers: OnboardingReadinessBlocker[] };
  provisioning: ProvisioningStatus | null;
}

export interface ProviderResource {
  id: string;
  clientId: string;
  provider: "elevenlabs" | "twilio" | "calcom" | "google" | "outlook" | "fresha";
  resourceType: string;
  providerResourceId?: string;
  lifecycleStatus: "pending" | "provisioning" | "active" | "deleting" | "deleted" | "failed";
}

export interface TranscriptTurn {
  role: "caller" | "agent" | "system";
  text: string;
  at: string;
}

export interface ToolHistoryEntry {
  name: string;
  input?: unknown;
  result?: unknown;
  error?: string;
  at: string;
}

export interface Call {
  id: string;
  clientId: string;
  direction: CallDirection;
  objective?: string;
  contactPhone?: string;
  status: CallStatus;
  outcome?: string;
  transcript?: TranscriptTurn[];
  toolHistory?: ToolHistoryEntry[];
  createdAt: string;
  updatedAt?: string;
  durationSeconds?: number;
}

export interface AnalyticsSummary {
  totalCalls: number;
  answeredCalls: number;
  bookedAppointments: number;
  transferredCalls: number;
  minutesUsed: number;
  bookingRate: number;
  comparison?: Partial<Record<"calls" | "bookings" | "minutes", number>>;
}

export interface Usage {
  clientId: string;
  month: string;
  inboundMinutes: number;
  outboundMinutes: number;
  plan?: "starter" | "pro" | "enterprise";
  allocatedMinutes?: number;
  usedMinutes?: number;
  remainingMinutes?: number;
}

export interface TimeseriesPoint {
  date: string;
  calls: number;
  bookings: number;
  minutes?: number;
}

export interface Booking {
  uid: string;
  title?: string;
  start: string;
  end?: string;
  attendeeName?: string;
  attendeeEmail?: string;
  status?: string;
  sourceCallId?: string;
}

export interface CalendarSlot {
  start: string;
  end?: string;
}

export type Campaign =
  | "appointment-reminder"
  | "rebooking"
  | "missed-callback"
  | "waitlist-slot"
  | "disruption-reschedule";

export interface Job {
  id: string;
  clientId: string;
  campaign: Campaign;
  contactPhone: string;
  contactName?: string;
  purpose: string;
  scheduledAt: string;
  attemptCount: number;
  maxAttempts: number;
  status: JobStatus;
  approved: boolean;
  disposition?: string;
  lastError?: string;
}

export interface KnowledgeDocument {
  id: string;
  clientId: string;
  title: string;
  source?: string;
  status?: "ready" | "indexing" | "failed";
  chunkCount?: number;
  updatedAt?: string;
}

export interface IntegrationStatus {
  id: string;
  name: string;
  connected: boolean;
  detail?: string;
  lastCheckedAt?: string;
}

export interface PromptVersion {
  id: string;
  clientId: string;
  version: number;
  compiled: string;
  createdAt: string;
}

export type PublicPromptVersion = Omit<PromptVersion, "compiled">;

export interface BootstrapResponse {
  clients: ClientSummary[];
  client?: Client;
  actor?: SessionActor;
  summary?: AnalyticsSummary;
  recentCalls?: Call[];
  integrations?: IntegrationStatus[];
}

export interface ListResponse<T> {
  items: T[];
  nextCursor?: string;
  total?: number;
}

export interface ApiErrorBody {
  error: string;
  message?: string;
  details?: unknown;
}
