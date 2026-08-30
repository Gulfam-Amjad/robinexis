import { randomUUID } from "node:crypto";
import type {
  AnalyticsRange,
  AnalyticsSummary,
  AnalyticsTimeseriesPoint,
  CallListOptions,
  CallNote,
  CallSession,
  ClientConfig,
  KnowledgeChunk,
  KnowledgeDocument,
  KnowledgeDocumentListOptions,
  KnowledgeSearchOptions,
  KnowledgeSearchResult,
  OutboundJob,
  Page,
  PromptVersion,
  Suppression,
  ToolActionRow,
  UsageCounters,
} from "./types.js";

export interface PlatformStore {
  getClient(id: string): Promise<ClientConfig | undefined>;
  getClientBySlug(slug: string): Promise<ClientConfig | undefined>;
  getClientByInboundNumber(e164: string): Promise<ClientConfig | undefined>;
  listClients(): Promise<ClientConfig[]>;
  upsertClient(c: ClientConfig): Promise<void>;
  getPublishedClient(id: string): Promise<ClientConfig | undefined>;

  getPromptVersion(id: string): Promise<PromptVersion | undefined>;
  latestPrompt(clientId: string): Promise<PromptVersion | undefined>;
  listPromptVersions(clientId: string, limit?: number): Promise<PromptVersion[]>;
  savePromptVersion(p: PromptVersion): Promise<void>;

  saveCall(c: CallSession): Promise<void>;
  getCall(id: string): Promise<CallSession | undefined>;
  getCallByTwilioSid(clientId: string, twilioCallSid: string): Promise<CallSession | undefined>;
  listCallsForClient(clientId: string, limit?: number): Promise<CallSession[]>;
  listCallsForClient(clientId: string, options: CallListOptions): Promise<Page<CallSession>>;
  getAnalyticsSummary(clientId: string, range: AnalyticsRange): Promise<AnalyticsSummary>;
  getAnalyticsTimeseries(clientId: string, range: AnalyticsRange): Promise<AnalyticsTimeseriesPoint[]>;

  saveToolAction(row: ToolActionRow): Promise<void>;
  claimToolAction(row: ToolActionRow): Promise<boolean>;
  findToolByIdempotency(clientId: string, key: string): Promise<ToolActionRow | undefined>;

  saveJob(j: OutboundJob): Promise<void>;
  getJob(id: string): Promise<OutboundJob | undefined>;
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
}

function monthKey(d = new Date()) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export class MemoryStore implements PlatformStore {
  clients = new Map<string, ClientConfig>();
  prompts: PromptVersion[] = [];
  calls = new Map<string, CallSession>();
  tools: ToolActionRow[] = [];
  jobs = new Map<string, OutboundJob>();
  suppressions: Suppression[] = [];
  notes: CallNote[] = [];
  usage = new Map<string, UsageCounters>();
  knowledgeDocuments = new Map<string, KnowledgeDocument>();
  knowledgeChunks = new Map<string, KnowledgeChunk>();

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
  async listClients() {
    return [...this.clients.values()];
  }
  async upsertClient(c: ClientConfig) {
    this.clients.set(c.id, c);
  }
  async getPublishedClient(idOrSlug: string) {
    const c = this.clients.get(idOrSlug) ?? (await this.getClientBySlug(idOrSlug));
    return c?.published ? c : undefined;
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
    this.calls.set(c.id, { ...c, updatedAt: new Date().toISOString() });
  }
  async getCall(id: string) {
    return this.calls.get(id);
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
  async saveJob(j: OutboundJob) {
    this.jobs.set(j.id, j);
  }
  async getJob(id: string) {
    return this.jobs.get(id);
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
