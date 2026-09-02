import { poolSsl } from "./env.js";
import pg from "pg";
import type { PlatformStore } from "./memory.js";
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
  OutboundJob,
  Page,
  PromptVersion,
  Suppression,
  ToolActionRow,
  UsageCounters,
  WorkspaceMembership,
} from "./types.js";

export class PostgresStore implements PlatformStore {
  constructor(private pool: pg.Pool) {}

  async getClient(id: string) {
    const r = await this.pool.query("SELECT config FROM clients WHERE id = $1", [id]);
    return r.rows[0]?.config as ClientConfig | undefined;
  }
  async getClientBySlug(slug: string) {
    const r = await this.pool.query("SELECT config FROM clients WHERE slug = $1", [slug]);
    return r.rows[0]?.config as ClientConfig | undefined;
  }
  async getClientByInboundNumber(e164: string) {
    const r = await this.pool.query(`SELECT config FROM clients`);
    const n = e164.replace(/\s/g, "");
    for (const row of r.rows) {
      const c = row.config as ClientConfig;
      if (c.inboundNumbers?.some((x) => x.replace(/\s/g, "") === n)) return c;
    }
    return undefined;
  }
  async getClientByElevenLabsAgentId(agentId: string) {
    const r = await this.pool.query(
      "SELECT config FROM clients WHERE config->>'elevenlabsAgentId' = $1 LIMIT 1",
      [agentId],
    );
    return r.rows[0]?.config as ClientConfig | undefined;
  }
  async listClients() {
    const r = await this.pool.query("SELECT config FROM clients");
    return r.rows.map((row) => row.config as ClientConfig);
  }
  async upsertClient(c: ClientConfig) {
    await this.pool.query(
      `INSERT INTO clients (id, slug, config) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET slug = EXCLUDED.slug, config = EXCLUDED.config`,
      [c.id, c.slug, c],
    );
  }
  async getPublishedClient(idOrSlug: string) {
    const c = (await this.getClient(idOrSlug)) ?? (await this.getClientBySlug(idOrSlug));
    return c?.published ? c : undefined;
  }
  async listMembershipsForEmail(email: string) {
    const r = await this.pool.query(
      `SELECT id, client_id, email, role, created_at
       FROM workspace_memberships WHERE email = lower($1) ORDER BY created_at`,
      [email.trim()],
    );
    return r.rows.map(membershipFromRow);
  }
  async listMembershipsForClient(clientId: string) {
    const r = await this.pool.query(
      `SELECT id, client_id, email, role, created_at
       FROM workspace_memberships WHERE client_id = $1 ORDER BY created_at`,
      [clientId],
    );
    return r.rows.map(membershipFromRow);
  }
  async upsertMembership(membership: WorkspaceMembership) {
    await this.pool.query(
      `INSERT INTO workspace_memberships (id, client_id, email, role, created_at)
       VALUES ($1, $2, lower($3), $4, $5)
       ON CONFLICT (client_id, email) DO UPDATE SET role = EXCLUDED.role`,
      [
        membership.id,
        membership.clientId,
        membership.email.trim(),
        membership.role,
        membership.createdAt,
      ],
    );
  }
  async deleteMembership(clientId: string, membershipId: string) {
    const r = await this.pool.query(
      "DELETE FROM workspace_memberships WHERE client_id = $1 AND id = $2",
      [clientId, membershipId],
    );
    return Boolean(r.rowCount);
  }
  async getPromptVersion(id: string) {
    const r = await this.pool.query(
      "SELECT id, client_id, version, compiled, created_at FROM prompt_versions WHERE id = $1",
      [id],
    );
    const row = r.rows[0];
    if (!row) return undefined;
    return {
      id: row.id,
      clientId: row.client_id,
      version: row.version,
      compiled: row.compiled,
      createdAt: row.created_at.toISOString?.() ?? String(row.created_at),
    } as PromptVersion;
  }
  async latestPrompt(clientId: string) {
    const r = await this.pool.query(
      "SELECT id, client_id, version, compiled, created_at FROM prompt_versions WHERE client_id = $1 ORDER BY version DESC LIMIT 1",
      [clientId],
    );
    const row = r.rows[0];
    if (!row) return undefined;
    return {
      id: row.id,
      clientId: row.client_id,
      version: row.version,
      compiled: row.compiled,
      createdAt: row.created_at.toISOString?.() ?? String(row.created_at),
    } as PromptVersion;
  }
  async listPromptVersions(clientId: string, limit = 50) {
    const r = await this.pool.query(
      `SELECT id, client_id, version, compiled, created_at
       FROM prompt_versions WHERE client_id = $1 ORDER BY version DESC LIMIT $2`,
      [clientId, Math.max(1, Math.min(limit, 200))],
    );
    return r.rows.map(promptFromRow);
  }
  async savePromptVersion(p: PromptVersion) {
    await this.pool.query(
      `INSERT INTO prompt_versions (id, client_id, version, compiled) VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET compiled = EXCLUDED.compiled, version = EXCLUDED.version`,
      [p.id, p.clientId, p.version, p.compiled],
    );
  }
  async saveCall(c: CallSession) {
    await this.pool.query(
      `INSERT INTO call_sessions (id, client_id, payload, updated_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()`,
      [c.id, c.clientId, c],
    );
  }
  async getCall(id: string) {
    const r = await this.pool.query("SELECT payload FROM call_sessions WHERE id = $1", [id]);
    return r.rows[0]?.payload as CallSession | undefined;
  }
  async getCallByTwilioSid(clientId: string, twilioCallSid: string) {
    const sid = twilioCallSid.trim();
    if (!sid) return undefined;
    const r = await this.pool.query(
      `SELECT payload FROM call_sessions
       WHERE client_id = $1 AND payload->>'twilioCallSid' = $2
       ORDER BY updated_at DESC LIMIT 1`,
      [clientId, sid],
    );
    return r.rows[0]?.payload as CallSession | undefined;
  }
  async listCallsForClient(clientId: string, limit?: number): Promise<CallSession[]>;
  async listCallsForClient(clientId: string, options: CallListOptions): Promise<Page<CallSession>>;
  async listCallsForClient(
    clientId: string,
    options: number | CallListOptions = 50,
  ): Promise<CallSession[] | Page<CallSession>> {
    if (typeof options === "number") {
      const r = await this.pool.query(
        "SELECT payload FROM call_sessions WHERE client_id = $1 ORDER BY updated_at DESC, id DESC LIMIT $2",
        [clientId, options],
      );
      return r.rows.map((row) => row.payload as CallSession);
    }
    const limit = Math.max(1, Math.min(options.limit ?? 50, 200));
    const values: unknown[] = [clientId];
    const where = ["client_id = $1"];
    const add = (sql: string, value: unknown) => {
      values.push(value);
      where.push(sql.replace("?", `$${values.length}`));
    };
    if (options.direction) add("payload->>'direction' = ?", options.direction);
    if (options.status) add("payload->>'status' = ?", options.status);
    if (options.outcome) add("payload->>'outcome' = ?", options.outcome);
    if (options.from) add("created_at >= ?::timestamptz", options.from);
    if (options.to) add("created_at <= ?::timestamptz", options.to);
    if (options.cursor) {
      const separator = options.cursor.lastIndexOf("|");
      const updatedAt = separator > 0 ? options.cursor.slice(0, separator) : options.cursor;
      const id = separator > 0 ? options.cursor.slice(separator + 1) : "";
      values.push(updatedAt, id);
      where.push(`(updated_at, id) < ($${values.length - 1}::timestamptz, $${values.length})`);
    }
    values.push(limit + 1);
    const r = await this.pool.query(
      `SELECT id, payload, updated_at FROM call_sessions
       WHERE ${where.join(" AND ")}
       ORDER BY updated_at DESC, id DESC LIMIT $${values.length}`,
      values,
    );
    const items = r.rows.slice(0, limit).map((row) => row.payload as CallSession);
    const last = r.rows[Math.min(limit, r.rows.length) - 1];
    return {
      items,
      nextCursor:
        r.rows.length > limit && last
          ? `${toIso(last.updated_at)}|${last.id}`
          : undefined,
    };
  }
  async getAnalyticsSummary(clientId: string, range: AnalyticsRange) {
    const calls = await this.analyticsCalls(clientId, range);
    return analyticsSummary(clientId, range, calls);
  }
  async getAnalyticsTimeseries(clientId: string, range: AnalyticsRange) {
    return analyticsTimeseries(await this.analyticsCalls(clientId, range));
  }
  async saveToolAction(row: ToolActionRow) {
    await this.pool.query(
      `INSERT INTO tool_actions (id, call_id, client_id, name, input, result, error, idempotency_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO UPDATE SET
         result = EXCLUDED.result,
         error = EXCLUDED.error`,
      [row.id, row.callId, row.clientId, row.name, row.input, row.result, row.error ?? null, row.idempotencyKey ?? null],
    );
  }
  async claimToolAction(row: ToolActionRow) {
    const r = await this.pool.query(
      `INSERT INTO tool_actions (id, call_id, client_id, name, input, result, error, idempotency_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (client_id, idempotency_key) WHERE idempotency_key IS NOT NULL
       DO NOTHING
       RETURNING id`,
      [row.id, row.callId, row.clientId, row.name, row.input, row.result, row.error ?? null, row.idempotencyKey],
    );
    return r.rowCount === 1;
  }
  async findToolByIdempotency(clientId: string, key: string) {
    const r = await this.pool.query(
      "SELECT * FROM tool_actions WHERE client_id = $1 AND idempotency_key = $2 ORDER BY at DESC LIMIT 1",
      [clientId, key],
    );
    const row = r.rows[0];
    if (!row) return undefined;
    return {
      id: row.id,
      callId: row.call_id,
      clientId: row.client_id,
      name: row.name,
      input: row.input,
      result: row.result,
      error: row.error,
      idempotencyKey: row.idempotency_key,
      at: row.at?.toISOString?.() ?? new Date().toISOString(),
    } as ToolActionRow;
  }
  async listToolActionsForCall(clientId: string, callId: string) {
    const r = await this.pool.query(
      `SELECT id, call_id, client_id, name, input, result, error, idempotency_key, at
       FROM tool_actions WHERE client_id = $1 AND call_id = $2 ORDER BY at, id`,
      [clientId, callId],
    );
    return r.rows.map((row) => ({
      id: row.id,
      callId: row.call_id,
      clientId: row.client_id,
      name: row.name,
      input: row.input,
      result: row.result,
      error: row.error ?? undefined,
      idempotencyKey: row.idempotency_key ?? undefined,
      at: toIso(row.at),
    }));
  }
  async saveJob(j: OutboundJob) {
    await this.pool.query(
      `INSERT INTO outbound_jobs (id, payload) VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload`,
      [j.id, j],
    );
  }
  async getJob(id: string) {
    const r = await this.pool.query("SELECT payload FROM outbound_jobs WHERE id = $1", [id]);
    return r.rows[0]?.payload as OutboundJob | undefined;
  }
  async listJobs(clientId?: string) {
    const r = await this.pool.query("SELECT payload FROM outbound_jobs");
    const jobs = r.rows.map((row) => row.payload as OutboundJob);
    return clientId ? jobs.filter((job) => job.clientId === clientId) : jobs;
  }
  async claimJob(id: string, attemptedAt: string) {
    const r = await this.pool.query(
      `UPDATE outbound_jobs
       SET payload = jsonb_set(
         jsonb_set(
           jsonb_set(payload, '{status}', '"dialing"'::jsonb),
           '{attemptCount}', to_jsonb(COALESCE((payload->>'attemptCount')::int, 0) + 1)
         ),
         '{lastAttemptAt}', to_jsonb($2::text)
       )
       WHERE id = $1 AND payload->>'status' = 'approved' AND payload->>'approved' = 'true'
       RETURNING id`,
      [id, attemptedAt],
    );
    return r.rowCount === 1;
  }
  async dueJobs(nowIso: string, limit: number) {
    const r = await this.pool.query("SELECT payload FROM outbound_jobs");
    return (r.rows.map((row) => row.payload as OutboundJob) as OutboundJob[])
      .filter((j) => (j.status === "pending" || j.status === "approved") && j.scheduledAt <= nowIso)
      .slice(0, limit);
  }
  async cancelJob(id: string, clientId?: string) {
    const values: unknown[] = [id];
    const tenantClause = clientId ? "AND payload->>'clientId' = $2" : "";
    if (clientId) values.push(clientId);
    const r = await this.pool.query(
      `UPDATE outbound_jobs
       SET payload = jsonb_set(jsonb_set(payload, '{status}', '"cancelled"'::jsonb), '{approved}', 'false'::jsonb)
       WHERE id = $1 ${tenantClause}
         AND payload->>'status' NOT IN ('completed', 'cancelled')
       RETURNING id`,
      values,
    );
    return r.rowCount === 1;
  }
  async addSuppression(s: Suppression) {
    await this.pool.query(
      `INSERT INTO suppressions (client_id, phone, reason) VALUES ($1, $2, $3)
       ON CONFLICT (client_id, phone) DO UPDATE SET reason = EXCLUDED.reason`,
      [s.clientId, s.phone, s.reason],
    );
  }
  async isSuppressed(clientId: string, phone: string) {
    const r = await this.pool.query("SELECT 1 FROM suppressions WHERE client_id = $1 AND phone = $2", [
      clientId,
      phone,
    ]);
    return r.rowCount !== 0;
  }
  async saveNote(n: CallNote) {
    await this.pool.query(
      `INSERT INTO call_notes (id, payload) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload`,
      [n.id, n],
    );
  }
  async addUsage(clientId: string, inboundMin: number, outboundMin: number) {
    const month = `${new Date().getUTCFullYear()}-${String(new Date().getUTCMonth() + 1).padStart(2, "0")}`;
    await this.pool.query(
      `INSERT INTO usage_counters (client_id, month, inbound_minutes, outbound_minutes)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (client_id, month) DO UPDATE SET
         inbound_minutes = usage_counters.inbound_minutes + EXCLUDED.inbound_minutes,
         outbound_minutes = usage_counters.outbound_minutes + EXCLUDED.outbound_minutes`,
      [clientId, month, inboundMin, outboundMin],
    );
    return (await this.getUsage(clientId, month))!;
  }
  async getUsage(clientId: string, month: string) {
    const r = await this.pool.query("SELECT * FROM usage_counters WHERE client_id = $1 AND month = $2", [
      clientId,
      month,
    ]);
    const row = r.rows[0];
    if (!row) return undefined;
    return {
      clientId: row.client_id,
      month: row.month,
      inboundMinutes: row.inbound_minutes,
      outboundMinutes: row.outbound_minutes,
    } as UsageCounters;
  }
  async saveKnowledgeDocument(document: KnowledgeDocument) {
    await this.pool.query(
      `INSERT INTO knowledge_documents
       (id, client_id, title, source_type, source_uri, mime_type, checksum, status, metadata, error, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (id) DO UPDATE SET
         title = EXCLUDED.title, source_type = EXCLUDED.source_type, source_uri = EXCLUDED.source_uri,
         mime_type = EXCLUDED.mime_type, checksum = EXCLUDED.checksum, status = EXCLUDED.status,
         metadata = EXCLUDED.metadata, error = EXCLUDED.error, updated_at = EXCLUDED.updated_at
       WHERE knowledge_documents.client_id = EXCLUDED.client_id`,
      [
        document.id, document.clientId, document.title, document.sourceType,
        document.sourceUri ?? null, document.mimeType ?? null, document.checksum ?? null,
        document.status, document.metadata ?? {}, document.error ?? null,
        document.createdAt, document.updatedAt,
      ],
    );
  }
  async getKnowledgeDocument(clientId: string, id: string) {
    const r = await this.pool.query(
      "SELECT * FROM knowledge_documents WHERE client_id = $1 AND id = $2",
      [clientId, id],
    );
    return r.rows[0] ? knowledgeDocumentFromRow(r.rows[0]) : undefined;
  }
  async listKnowledgeDocuments(clientId: string, options: KnowledgeDocumentListOptions = {}) {
    const limit = Math.max(1, Math.min(options.limit ?? 50, 200));
    const values: unknown[] = [clientId];
    const where = ["client_id = $1"];
    if (options.status) {
      values.push(options.status);
      where.push(`status = $${values.length}`);
    }
    if (options.cursor) {
      const separator = options.cursor.lastIndexOf("|");
      values.push(
        separator > 0 ? options.cursor.slice(0, separator) : options.cursor,
        separator > 0 ? options.cursor.slice(separator + 1) : "",
      );
      where.push(`(created_at, id) < ($${values.length - 1}::timestamptz, $${values.length})`);
    }
    values.push(limit + 1);
    const r = await this.pool.query(
      `SELECT * FROM knowledge_documents WHERE ${where.join(" AND ")}
       ORDER BY created_at DESC, id DESC LIMIT $${values.length}`,
      values,
    );
    const items = r.rows.slice(0, limit).map(knowledgeDocumentFromRow);
    const last = r.rows[Math.min(limit, r.rows.length) - 1];
    return {
      items,
      nextCursor: r.rows.length > limit && last ? `${toIso(last.created_at)}|${last.id}` : undefined,
    };
  }
  async deleteKnowledgeDocument(clientId: string, id: string) {
    const r = await this.pool.query(
      "DELETE FROM knowledge_documents WHERE client_id = $1 AND id = $2",
      [clientId, id],
    );
    return (r.rowCount ?? 0) > 0;
  }
  async replaceKnowledgeChunks(clientId: string, documentId: string, chunks: KnowledgeChunk[]) {
    if (chunks.some((chunk) => chunk.clientId !== clientId || chunk.documentId !== documentId)) {
      throw new Error("tenant_mismatch");
    }
    if (chunks.some((chunk) => chunk.embedding.length !== 768)) {
      throw new Error("embedding_must_have_768_dimensions");
    }
    const connection = await this.pool.connect();
    try {
      await connection.query("BEGIN");
      await connection.query(
        "DELETE FROM knowledge_chunks WHERE client_id = $1 AND document_id = $2",
        [clientId, documentId],
      );
      for (const chunk of chunks) {
        await connection.query(
          `INSERT INTO knowledge_chunks
           (id, client_id, document_id, chunk_index, content, token_count, embedding, metadata, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7::vector,$8,$9)`,
          [
            chunk.id, clientId, documentId, chunk.chunkIndex, chunk.content, chunk.tokenCount,
            vectorLiteral(chunk.embedding), chunk.metadata ?? {}, chunk.createdAt,
          ],
        );
      }
      await connection.query("COMMIT");
    } catch (error) {
      await connection.query("ROLLBACK");
      throw error;
    } finally {
      connection.release();
    }
  }
  async searchKnowledge(clientId: string, embedding: number[], options: KnowledgeSearchOptions = {}) {
    if (embedding.length !== 768) throw new Error("embedding_must_have_768_dimensions");
    const limit = Math.max(1, Math.min(options.limit ?? 5, 20));
    const values: unknown[] = [clientId, vectorLiteral(embedding)];
    const where = ["c.client_id = $1"];
    if (options.documentIds?.length) {
      values.push(options.documentIds);
      where.push(`c.document_id = ANY($${values.length}::text[])`);
    }
    if (options.minScore !== undefined) {
      values.push(options.minScore);
      where.push(`1 - (c.embedding <=> $2::vector) >= $${values.length}`);
    }
    values.push(limit);
    const r = await this.pool.query(
      `SELECT c.*, 1 - (c.embedding <=> $2::vector) AS score,
              d.title AS document_title, d.source_type AS document_source_type,
              d.source_uri AS document_source_uri, d.mime_type AS document_mime_type,
              d.checksum AS document_checksum, d.status AS document_status,
              d.metadata AS document_metadata, d.error AS document_error,
              d.created_at AS document_created_at, d.updated_at AS document_updated_at
       FROM knowledge_chunks c
       JOIN knowledge_documents d ON d.id = c.document_id AND d.client_id = c.client_id
       WHERE ${where.join(" AND ")}
       ORDER BY c.embedding <=> $2::vector LIMIT $${values.length}`,
      values,
    );
    return r.rows.map((row) => ({
      chunk: knowledgeChunkFromRow(row),
      document: knowledgeDocumentFromRow({
        id: row.document_id,
        client_id: row.client_id,
        title: row.document_title,
        source_type: row.document_source_type,
        source_uri: row.document_source_uri,
        mime_type: row.document_mime_type,
        checksum: row.document_checksum,
        status: row.document_status,
        metadata: row.document_metadata,
        error: row.document_error,
        created_at: row.document_created_at,
        updated_at: row.document_updated_at,
      }),
      score: Number(row.score),
    }));
  }
  async deleteCallsOlderThan(isoDate: string) {
    const r = await this.pool.query("DELETE FROM call_sessions WHERE created_at < $1", [isoDate]);
    return r.rowCount ?? 0;
  }

  private async analyticsCalls(clientId: string, range: AnalyticsRange) {
    const r = await this.pool.query(
      `SELECT payload FROM call_sessions
       WHERE client_id = $1 AND created_at >= $2::timestamptz AND created_at <= $3::timestamptz`,
      [clientId, range.from, range.to],
    );
    return r.rows.map((row) => row.payload as CallSession);
  }
}

function toIso(value: unknown) {
  return value instanceof Date ? value.toISOString() : String(value);
}

function promptFromRow(row: Record<string, any>): PromptVersion {
  return {
    id: row.id,
    clientId: row.client_id,
    version: row.version,
    compiled: row.compiled,
    createdAt: toIso(row.created_at),
  };
}

function membershipFromRow(row: Record<string, any>): WorkspaceMembership {
  return {
    id: row.id,
    clientId: row.client_id,
    email: row.email,
    role: row.role,
    createdAt: toIso(row.created_at),
  };
}

function knowledgeDocumentFromRow(row: Record<string, any>): KnowledgeDocument {
  return {
    id: row.id,
    clientId: row.client_id,
    title: row.title,
    sourceType: row.source_type,
    sourceUri: row.source_uri ?? undefined,
    mimeType: row.mime_type ?? undefined,
    checksum: row.checksum ?? undefined,
    status: row.status,
    metadata: row.metadata ?? {},
    error: row.error ?? undefined,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function knowledgeChunkFromRow(row: Record<string, any>): KnowledgeChunk {
  const embedding = Array.isArray(row.embedding)
    ? row.embedding.map(Number)
    : String(row.embedding).replace(/^\[|\]$/g, "").split(",").filter(Boolean).map(Number);
  return {
    id: row.id,
    clientId: row.client_id,
    documentId: row.document_id,
    chunkIndex: row.chunk_index,
    content: row.content,
    tokenCount: row.token_count,
    embedding,
    metadata: row.metadata ?? {},
    createdAt: toIso(row.created_at),
  };
}

function vectorLiteral(embedding: number[]) {
  return `[${embedding.join(",")}]`;
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

export function createPool(databaseUrl: string) {
  return new pg.Pool({
    connectionString: databaseUrl,
    max: 10,
    connectionTimeoutMillis: 8_000,
    ssl: poolSsl(databaseUrl),
  });
}
