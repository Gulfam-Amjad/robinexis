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
  probeCalcomForClient,
  publicClientView,
} from "@robinexis/integrations";
import { GeminiEmbeddingProvider, KnowledgeService } from "@robinexis/knowledge";

export type ProductSend = (
  res: http.ServerResponse,
  status: number,
  body: unknown,
  type?: string,
) => void;

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

function analytics(calls: CallSession[]) {
  const outcomeCounts: Record<string, number> = {};
  let bookings = 0;
  let transfers = 0;
  let toolErrors = 0;
  let inbound = 0;
  let outbound = 0;
  for (const call of calls) {
    if (call.direction === "inbound") inbound += 1;
    else outbound += 1;
    if (call.outcome) outcomeCounts[call.outcome] = (outcomeCounts[call.outcome] || 0) + 1;
    if (call.outcome === "transferred") transfers += 1;
    if (call.toolHistory.some((tool) => tool.name === "create_booking" && !tool.error)) bookings += 1;
    toolErrors += call.toolHistory.filter((tool) => tool.error).length;
  }
  const completed = calls.filter((call) => call.status === "completed" || call.status === "transferred").length;
  const minutesUsed = Math.round(
    calls.reduce((total, call) => {
      const start = new Date(call.createdAt).getTime();
      const finish = new Date(call.updatedAt).getTime();
      return total + Math.max(0, finish - start) / 60_000;
    }, 0),
  );
  const bookingRate = calls.length ? (bookings / calls.length) * 100 : 0;
  return {
    totalCalls: calls.length,
    answeredCalls: completed,
    bookedAppointments: bookings,
    transferredCalls: transfers,
    minutesUsed,
    completedCalls: completed,
    completionRate: calls.length ? completed / calls.length : 0,
    bookings,
    bookingRate,
    transfers,
    transferRate: calls.length ? transfers / calls.length : 0,
    toolErrors,
    inbound,
    outbound,
    outcomeCounts,
  };
}

function integrationList(client: ClientConfig, calendar: Record<string, unknown>) {
  const now = new Date().toISOString();
  return [
    { id: "twilio", name: "Twilio", connected: Boolean(client.phone), detail: "Inbound calls route directly to ElevenLabs", lastCheckedAt: now },
    { id: "elevenlabs", name: "ElevenLabs", connected: client.voicePipeline === "elevenlabs-convai", detail: "Realtime speech, barge-in and agent conversation", lastCheckedAt: now },
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
    enabledFeatures: body.enabledFeatures || ["inbound"],
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
    serviceStatus: body.serviceStatus || "incomplete",
    monthlyMinuteLimit: body.monthlyMinuteLimit,
  };
}

async function requireClient(ctx: ProductRouteContext, id: string): Promise<ClientConfig | undefined> {
  const client = id ? await ctx.store.getClient(id) : undefined;
  if (!client) ctx.send(ctx.res, 404, { error: "client_not_found" });
  return client;
}

export async function handleProductRoute(ctx: ProductRouteContext): Promise<boolean> {
  const { req, res, url, store, send } = ctx;
  const route = url.pathname.slice("/api/v1".length) || "/";

  if (route === "/bootstrap" && req.method === "GET") {
    const clients = await store.listClients();
    const selected = clients.find((item) => item.id === clientId(url)) || clients[0];
    const calls = selected ? await store.listCallsForClient(selected.id, 8) : [];
    const calendar = selected ? await probeCalcomForClient({ client: selected }) : {};
    send(res, 200, {
      clients: clients.map((item) => safeEditableClient(item)),
      client: selected ? safeEditableClient(selected) : null,
      access: selected ? isAiServiceEnabled(selected) : null,
      features: selected?.enabledFeatures || [],
      summary: analytics(calls),
      recentCalls: calls,
      integrations: selected ? integrationList(selected, calendar) : [],
    });
    return true;
  }

  if (route === "/clients" && req.method === "GET") {
    send(res, 200, { items: (await store.listClients()).map(safeEditableClient) });
    return true;
  }
  if (route === "/clients" && req.method === "POST") {
    try {
      const body = await readJson<Partial<ClientConfig>>(ctx);
      const created = createClient(body);
      await store.upsertClient(created);
      send(res, 201, safeEditableClient(created));
    } catch (err) {
      send(res, 400, { error: err instanceof Error ? err.message : "invalid_client" });
    }
    return true;
  }

  const clientMatch = route.match(/^\/clients\/([^/]+)$/);
  if (clientMatch && req.method === "GET") {
    const client = await requireClient(ctx, clientMatch[1]);
    if (client) send(res, 200, safeEditableClient(client));
    return true;
  }
  if (clientMatch && req.method === "PATCH") {
    const client = await requireClient(ctx, clientMatch[1]);
    if (!client) return true;
    const body = await readJson<Partial<ClientConfig> & { calendar?: Record<string, unknown> }>(ctx);
    if (body.calendar && ("apiKey" in body.calendar || "token" in body.calendar || "secret" in body.calendar)) {
      send(res, 400, { error: "raw_credentials_forbidden" });
      return true;
    }
    const immutable = new Set(["id", "serviceStatus", "stripeCustomerId", "stripeSubscriptionId"]);
    for (const [key, value] of Object.entries(body)) {
      if (!immutable.has(key) && value !== undefined) {
        (client as unknown as Record<string, unknown>)[key] = value;
      }
    }
    client.published = false;
    await store.upsertClient(client);
    send(res, 200, safeEditableClient(client));
    return true;
  }

  const publishMatch = route.match(/^\/clients\/([^/]+)\/publish$/);
  if (publishMatch && req.method === "POST") {
    const client = await requireClient(ctx, publishMatch[1]);
    if (!client) return true;
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
      createdAt: new Date().toISOString(),
    };
    await store.savePromptVersion(prompt);
    client.promptVersionId = prompt.id;
    client.published = true;
    await store.upsertClient(client);
    send(res, 200, { client: safeEditableClient(client), promptVersion: prompt });
    return true;
  }

  const versionsMatch = route.match(/^\/clients\/([^/]+)\/prompt-versions$/);
  if (versionsMatch && req.method === "GET") {
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
    const call = await store.getCall(callMatch[1]);
    if (!call || (clientId(url) && call.clientId !== clientId(url))) {
      send(res, 404, { error: "call_not_found" });
    } else {
      send(res, 200, call);
    }
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
    if (!(await requireClient(ctx, id))) return true;
    const month = url.searchParams.get("month") || new Date().toISOString().slice(0, 7);
    const usage = await store.getUsage(id, month);
    send(res, 200, usage || {
      clientId: id,
      month,
      inboundMinutes: 0,
      outboundMinutes: 0,
    });
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
    const tenant = {
      apiKey: client.calendar.credentialRef
        ? process.env[client.calendar.credentialRef] || ""
        : process.env.CALCOM_API_KEY || "",
      username: client.calendar.username || process.env.CALCOM_USERNAME || "",
    };
    if (!tenant.apiKey || !tenant.username) {
      send(res, 200, { items: [], configured: Boolean(tenant.apiKey && tenant.username) });
    } else {
      const result = await calcom.listBookings(tenant, { status: "upcoming" });
      send(res, 200, {
        items: result.bookings.map((booking) => ({
          uid: booking.uid,
          title: booking.title,
          start: booking.start,
          end: booking.end,
          status: booking.status,
          attendeeName: booking.attendees?.[0]?.name,
          attendeeEmail: booking.attendees?.[0]?.email,
        })),
      });
    }
    return true;
  }

  const calendarAction = route.match(/^\/calendar\/bookings\/([^/]+)\/(reschedule|cancel)$/);
  if (calendarAction && req.method === "POST") {
    const body = await readJson<{ clientId?: string; start?: string; newStart?: string; confirmed?: boolean }>(ctx);
    const client = await requireClient(ctx, body.clientId || clientId(url));
    if (!client) return true;
    if (body.confirmed !== true) {
      send(res, 400, { error: "explicit_confirmation_required" });
      return true;
    }
    const tenant = {
      apiKey: client.calendar.credentialRef
        ? process.env[client.calendar.credentialRef] || ""
        : process.env.CALCOM_API_KEY || "",
      username: client.calendar.username || process.env.CALCOM_USERNAME || "",
    };
    const result = calendarAction[2] === "cancel"
      ? await calcom.cancelBooking(tenant, calendarAction[1])
      : await calcom.rescheduleBooking(tenant, {
          bookingUid: calendarAction[1],
          start: String(body.newStart || body.start || ""),
        });
    send(res, 200, result);
    return true;
  }

  if (route === "/jobs" && req.method === "GET") {
    const id = clientId(url);
    if (id && !(await requireClient(ctx, id))) return true;
    send(res, 200, { items: await store.listJobs(id || undefined) });
    return true;
  }
  if (route === "/jobs" && req.method === "POST") {
    const body = await readJson<Partial<OutboundJob> & { clientId?: string; contactPhone?: string }>(ctx);
    if (!body.clientId || !body.contactPhone || !(await store.getClient(body.clientId))) {
      send(res, 400, { error: "valid_clientId_and_contactPhone_required" });
      return true;
    }
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
    const job = await store.getJob(jobAction[1]);
    const expectedClient = clientId(url);
    if (!job || (expectedClient && job.clientId !== expectedClient)) {
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
    if (!body.clientId || !(await requireClient(ctx, body.clientId))) return true;
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
    if (!(await requireClient(ctx, id))) return true;
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
