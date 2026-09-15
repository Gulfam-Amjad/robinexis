import type { CallOutcome } from "@robinexis/tool-contracts";

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

/** elevenlabs-convai = live Option 1 (do not answer on the gateway). groq-gateway = Option 2. */
export type VoicePipeline = "elevenlabs-convai" | "groq-gateway";

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

export interface WorkspaceMembership {
  id: string;
  clientId: string;
  email: string;
  role: WorkspaceRole;
  createdAt: string;
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

export interface CalendarConnectionConfig {
  provider: "calcom" | "google" | "outlook" | "fresha";
  username?: string;
  apiKeyEnv?: string;
  /** Encrypted-at-rest in production; local seed may hold a ref only. */
  credentialRef?: string;
  destinationCalendarId?: string;
  destinationProvider?: string;
  schedule?: CalendarScheduleSettings;
}

export interface CalendarNoteConnection {
  provider: "google" | "outlook";
  credentialRef: string;
  calendarId?: string;
}

export interface ClientConfig {
  id: string;
  slug: string;
  businessName: string;
  role: string;
  greeting?: string;
  tone: string;
  location: string;
  phone: string;
  email: string;
  transferNumber: string;
  voiceId: string;
  elevenlabsAgentId?: string;
  voicePipeline: VoicePipeline;
  services: ClientService[];
  staff: string[];
  hours?: string;
  prices?: string;
  policies: string[];
  publishedFacts: string[];
  unknownTopics: string[];
  calendar: CalendarConnectionConfig;
  calendarNotes?: CalendarNoteConnection;
  calendarNoteMode: "summary" | "verbatim";
  enabledFeatures: string[];
  inboundNumbers: string[];
  outboundCallerId?: string;
  callingWindow: { tz: string; startHour: number; endHour: number; skipSunday: boolean };
  maxConcurrentCalls: number;
  outboundRatePerHour: number;
  firstCampaignRequiresApproval: boolean;
  published: boolean;
  serviceStatus: ServiceStatus;
  subscribedProduct?: string;
  monthlyMinuteLimit?: number;
  pastDueAt?: string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  promptVersionId?: string;
  onboardingStatus?: OnboardingStatus;
  onboardingNotes?: string;
  onboardingEta?: string;
  phoneAcquisitionMode?: PhoneAcquisitionMode;
  requestedPhoneNumber?: string;
}

export interface PromptVersion {
  id: string;
  clientId: string;
  version: number;
  compiled: string;
  createdAt: string;
}

export interface ClientConfigRevision {
  id: string;
  clientId: string;
  status: "draft" | "published" | "superseded";
  config: ClientConfig;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
}

export interface TranscriptTurn {
  role: "caller" | "agent" | "system";
  text: string;
  at: string;
}

export interface ToolHistoryEntry {
  name: string;
  input: unknown;
  result: unknown;
  error?: string;
  idempotencyKey?: string;
  at: string;
}

export interface CallSession {
  id: string;
  clientId: string;
  direction: CallDirection;
  objective: string;
  twilioCallSid?: string;
  contactPhone?: string;
  contactId?: string;
  appointmentId?: string;
  outboundJobId?: string;
  promptVersionId: string;
  transcript: TranscriptTurn[];
  collected: Record<string, unknown>;
  toolHistory: ToolHistoryEntry[];
  state: string;
  status: "active" | "completed" | "transferred" | "failed";
  outcome?: CallOutcome;
  durationSeconds?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ToolActionRow {
  id: string;
  callId: string;
  clientId: string;
  name: string;
  input: unknown;
  result: unknown;
  error?: string;
  idempotencyKey?: string;
  at: string;
}

export type OutboundCampaign =
  | "appointment-reminder"
  | "rebooking"
  | "missed-callback"
  | "waitlist-slot"
  | "disruption-reschedule";

export interface OutboundJob {
  id: string;
  clientId: string;
  campaign: OutboundCampaign;
  contactPhone: string;
  contactName?: string;
  sourceRecordId?: string;
  purpose: string;
  scheduledAt: string;
  attemptCount: number;
  lastAttemptAt?: string;
  maxAttempts: number;
  status: "pending" | "approved" | "dialing" | "completed" | "suppressed" | "failed" | "cancelled";
  approved: boolean;
  lastError?: string;
  disposition?: CallOutcome;
}

export interface Suppression {
  clientId: string;
  phone: string;
  reason: string;
  createdAt: string;
}

export interface CallNote {
  id: string;
  callId: string;
  clientId: string;
  crmSummary: string;
  calendarSummary: string;
  fullTranscriptHeld: boolean;
}

export interface UsageCounters {
  clientId: string;
  inboundMinutes: number;
  outboundMinutes: number;
  month: string;
}

export interface Page<T> {
  items: T[];
  nextCursor?: string;
}

export interface CallListOptions {
  limit?: number;
  cursor?: string;
  direction?: CallDirection;
  status?: CallSession["status"];
  outcome?: CallOutcome;
  from?: string;
  to?: string;
}

export interface AnalyticsRange {
  from: string;
  to: string;
}

export interface AnalyticsSummary {
  clientId: string;
  from: string;
  to: string;
  totalCalls: number;
  inboundCalls: number;
  outboundCalls: number;
  completedCalls: number;
  transferredCalls: number;
  failedCalls: number;
  bookedCalls: number;
  totalMinutes: number;
}

export interface AnalyticsTimeseriesPoint {
  date: string;
  calls: number;
  completed: number;
  transferred: number;
  failed: number;
  booked: number;
}

export type KnowledgeDocumentStatus = "pending" | "indexed" | "failed";
export type KnowledgeSourceType = "txt" | "markdown" | "pdf";

export interface KnowledgeDocument {
  id: string;
  clientId: string;
  title: string;
  sourceType: KnowledgeSourceType;
  sourceUri?: string;
  mimeType?: string;
  checksum?: string;
  status: KnowledgeDocumentStatus;
  metadata?: Record<string, unknown>;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeChunk {
  id: string;
  clientId: string;
  documentId: string;
  chunkIndex: number;
  content: string;
  tokenCount: number;
  embedding: number[];
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface KnowledgeDocumentListOptions {
  limit?: number;
  cursor?: string;
  status?: KnowledgeDocumentStatus;
}

export interface KnowledgeSearchOptions {
  limit?: number;
  minScore?: number;
  documentIds?: string[];
}

export interface KnowledgeSearchResult {
  chunk: KnowledgeChunk;
  document: KnowledgeDocument;
  score: number;
}

export type LifecycleStatus = "pending" | "active" | "disabled" | "failed";

export interface UserProfile {
  id: string;
  clientId?: string;
  authUserId: string;
  email: string;
  displayName?: string;
  platformRole: "admin" | "client";
  workspaceRole?: WorkspaceRole;
  termsAcceptedAt?: string;
  privacyAcceptedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TenantRequest {
  id: string;
  clientId: string;
  type: "team_invite" | "data_export" | "workspace_deletion" | "support";
  status: "pending" | "in_progress" | "completed" | "rejected" | "revoked";
  requestedBy: string;
  email?: string;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface Location {
  id: string;
  clientId: string;
  slug: string;
  name: string;
  timezone: string;
  phone?: string;
  address?: Record<string, unknown>;
  isPrimary: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AgentInstance {
  id: string;
  clientId: string;
  locationId?: string;
  provider: "elevenlabs";
  providerAgentId?: string;
  voiceCredentialHash?: string;
  providerSecretId?: string;
  name: string;
  status: LifecycleStatus;
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface PhoneEndpoint {
  id: string;
  clientId: string;
  locationId?: string;
  agentInstanceId?: string;
  provider: "twilio" | "elevenlabs";
  e164: string;
  providerEndpointId?: string;
  direction: "inbound" | "outbound" | "both";
  status: LifecycleStatus;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface TwilioConnection {
  id: string;
  clientId: string;
  mode: PhoneAcquisitionMode;
  accountSid?: string;
  encryptedAccessToken?: string;
  encryptedRefreshToken?: string;
  accessTokenExpiresAt?: string;
  apiKeySid?: string;
  encryptedApiKeySecret?: string;
  encryptedAccountAuthToken?: string;
  selectedPhoneNumber?: string;
  regulatoryBundleSid?: string;
  emergencyAddressSid?: string;
  monthlySpendCapPence?: number;
  purchaseConfirmedBy?: string;
  purchaseConfirmedAt?: string;
  status: "pending" | "credentials_required" | "active" | "expired" | "revoked" | "failed";
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CalendarConnection {
  id: string;
  clientId: string;
  locationId?: string;
  provider: CalendarConnectionConfig["provider"];
  externalAccountId?: string;
  credentialRef?: string;
  mode?: "oauth" | "managed" | "legacy" | "shared";
  encryptedAccessToken?: string;
  encryptedRefreshToken?: string;
  accessTokenExpiresAt?: string;
  scopes?: string[];
  calendarId?: string;
  destinationProvider?: string;
  status: LifecycleStatus;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CalendarEventType {
  id: string;
  clientId: string;
  calendarConnectionId: string;
  serviceSlug: string;
  providerEventTypeId: string;
  providerSlug: string;
  title: string;
  durationMinutes: number;
  status: LifecycleStatus;
  readinessOnly?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Subscription {
  id: string;
  clientId: string;
  provider: "internal" | "stripe";
  providerCustomerId?: string;
  providerSubscriptionId?: string;
  planTier: "starter" | "pro" | "enterprise";
  status: ServiceStatus;
  priceId?: string;
  trialEndsAt?: string;
  currentPeriodStart?: string;
  currentPeriodEnd?: string;
  cancelAtPeriodEnd: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface StripeEvent {
  id: string;
  clientId?: string;
  eventType: string;
  livemode: boolean;
  payload: unknown;
  status: "processing" | "processed" | "failed";
  error?: string;
  receivedAt: string;
  processedAt?: string;
}

export interface BookingRecord {
  id: string;
  clientId: string;
  locationId?: string;
  calendarConnectionId?: string;
  callId?: string;
  provider: CalendarConnectionConfig["provider"];
  providerBookingId?: string;
  idempotencyKey?: string;
  status: "pending" | "confirmed" | "cancelled" | "failed";
  startsAt: string;
  endsAt: string;
  attendeeName?: string;
  attendeePhone?: string;
  attendeeEmail?: string;
  serviceSlug?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreditLedgerEntry {
  id: string;
  clientId: string;
  minutes: number;
  kind: "grant" | "purchase" | "usage" | "adjustment" | "refund" | "expiry";
  direction?: CallDirection;
  referenceType?: string;
  referenceId?: string;
  description?: string;
  createdAt: string;
}

export interface OperatorAuditRecord {
  id: string;
  clientId?: string;
  actorId: string;
  action: string;
  detail: Record<string, unknown>;
  createdAt: string;
}

export interface ProvisioningRun {
  id: string;
  clientId: string;
  idempotencyKey: string;
  status:
    | "pending"
    | "running"
    | "paused"
    | "succeeded"
    | "activation_pending"
    | "activating"
    | "failed"
    | "cancelled";
  step?: string;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
  claimToken?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProvisioningReadinessCheck {
  key: string;
  status: "passed" | "failed";
  detail: string;
}

export interface ProvisioningReadinessReport {
  generatedAt: string;
  passed: boolean;
  hardGaps: string[];
  checks: ProvisioningReadinessCheck[];
  syntheticBooking?: {
    providerBookingId?: string;
    created: boolean;
    cancelled: boolean;
  };
  testCallLink?: string;
}

export interface ProvisioningActivationInput {
  clientId: string;
  runId: string;
  actorId: string;
  actorEmail: string;
  prompt: PromptVersion;
  profileChecksum: string;
  now: string;
}

export interface ProvisioningActivationIntent {
  promptId: string;
  promptVersion: number;
  profileChecksum: string;
  operationKey: string;
  providerAgentId: string;
  phoneNumber?: string;
  phoneEndpointId?: string;
  providerPhoneNumberId?: string;
  assignmentStatus: "pending" | "imported" | "assigned" | "needs_attention";
  rollbackStatus?: "deleted" | "failed";
  rollbackError?: string;
}

export interface ProvisioningActivationResult {
  activated: boolean;
  client?: ClientConfig;
  error?: string;
  blockers?: string[];
  intent?: ProvisioningActivationIntent;
}

export type OnboardingJobStatus = "pending" | "leased" | "paused" | "completed" | "dead_letter";

export interface OnboardingJob {
  id: string;
  clientId: string;
  kind: string;
  idempotencyKey: string;
  status: OnboardingJobStatus;
  payload: Record<string, unknown>;
  attemptCount: number;
  maxAttempts: number;
  availableAt: string;
  leaseOwner?: string;
  leaseExpiresAt?: string;
  lastError?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OnboardingOutboxEvent {
  id: string;
  clientId: string;
  topic: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  publishedAt?: string;
  attemptCount: number;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export type NotificationDeliveryStatus = "pending" | "leased" | "delivered" | "dead_letter";

export interface NotificationDelivery {
  id: string;
  clientId: string;
  operationId: string;
  idempotencyKey: string;
  channel: "email";
  recipient: string;
  template: string;
  status: NotificationDeliveryStatus;
  providerId?: string;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: string;
  leaseOwner?: string;
  leaseExpiresAt?: string;
  lastError?: string;
  deliveredAt?: string;
  deadLetteredAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationHealth {
  pending: number;
  leased: number;
  deadLetter: number;
  oldestPendingAt?: string;
  providerFailures24h: number;
}

export interface WebsiteSource {
  id: string;
  clientId: string;
  url: string;
  status: "pending" | "active" | "disabled" | "failed";
  checksum?: string;
  lastFetchedAt?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface WebsiteExtractionRun {
  id: string;
  clientId: string;
  sourceId: string;
  status: "pending" | "running" | "succeeded" | "failed";
  extractorVersion: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export type ExtractedFactReviewStatus = "extracted" | "confirmed" | "edited";

export interface ExtractedFact {
  id: string;
  clientId: string;
  extractionRunId: string;
  key: string;
  value: unknown;
  confidence?: number;
  sourceEvidence?: string;
  reviewStatus: ExtractedFactReviewStatus;
  reviewedBy?: string;
  reviewedAt?: string;
  createdAt: string;
}

export interface OnboardingGap {
  id: string;
  clientId: string;
  key: string;
  status: "open" | "resolved" | "waived";
  detail?: string;
  resolvedAt?: string;
  createdAt: string;
  updatedAt: string;
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

export interface ProviderResource {
  id: string;
  clientId: string;
  provider: "elevenlabs" | "twilio" | "calcom" | "google" | "outlook" | "fresha";
  resourceType: string;
  providerResourceId?: string;
  lifecycleStatus: "pending" | "provisioning" | "active" | "deleting" | "deleted" | "failed";
  credentialRef?: string;
  encryptedCredential?: string;
  metadata: Record<string, unknown>;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}
