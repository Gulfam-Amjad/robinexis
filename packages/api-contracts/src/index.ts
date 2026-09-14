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
  | "setup_queued"
  | "setup_in_progress"
  | "needs_attention"
  | "ready_to_provision"
  | "provisioning"
  | "active"
  | "failed";
export type PhoneAcquisitionMode = "robinexis_account" | "customer_oauth";

export interface PublicTwilioConnection {
  mode: PhoneAcquisitionMode;
  status: "not_connected" | "pending" | "credentials_required" | "active" | "expired" | "revoked" | "failed";
  accountSidMasked?: string;
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
  access?: { enabled?: boolean; inbound?: boolean; outbound?: boolean; reason?: string };
}

export interface ClientService {
  slug: string;
  title: string;
  durationMinutes: number;
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
  calendar?: { provider: "calcom" | "google" | "outlook" | "fresha"; username?: string };
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
  phoneAcquisitionMode?: PhoneAcquisitionMode;
  requestedPhoneNumber?: string;
}

export interface ProvisioningStatus {
  status: "not_started" | "pending" | "running" | "succeeded" | "failed";
  step?: string;
  error?: string;
  updatedAt?: string;
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
