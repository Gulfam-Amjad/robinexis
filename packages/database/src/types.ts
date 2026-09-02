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

export interface CalendarConnection {
  provider: "calcom" | "google" | "outlook" | "fresha";
  username?: string;
  apiKeyEnv?: string;
  /** Encrypted-at-rest in production; local seed may hold a ref only. */
  credentialRef?: string;
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
  calendar: CalendarConnection;
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
}

export interface PromptVersion {
  id: string;
  clientId: string;
  version: number;
  compiled: string;
  createdAt: string;
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
