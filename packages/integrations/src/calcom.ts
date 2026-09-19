import { calcomApiBase } from "./calcomAuth.js";

export interface CalcomTenant {
  apiKey: string;
  username: string;
  mode?: "oauth" | "managed" | "legacy" | "shared";
  clientId?: string;
}

export interface CalcomEventType {
  id: number;
  slug: string;
  title: string;
  lengthInMinutes: number;
}

/** Public display only — never reverse this to recover the full handle. */
export function maskCalcomUsername(username: string): string {
  const value = username.trim();
  if (!value) return "";
  const at = value.indexOf("@");
  if (at > 0) {
    const local = value.slice(0, at);
    const domain = value.slice(at + 1);
    return `${local.slice(0, 1)}***@${domain}`;
  }
  if (value.length <= 3) return `${value.slice(0, 1)}***`;
  return `${value.slice(0, 3)}***`;
}

async function calcomFetch(tenant: CalcomTenant, path: string, calApiVersion: string, init?: RequestInit) {
  const method = init?.method ?? "GET";
  const attempts = method === "GET" ? 2 : 1;
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const timeout = AbortSignal.timeout(Number(process.env.CALCOM_TIMEOUT_MS) || 8_000);
      const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
      const res = await fetch(`${calcomApiBase()}${path}`, {
        ...init,
        signal,
        headers: {
          ...init?.headers,
          Authorization: `Bearer ${tenant.apiKey}`,
          "cal-api-version": calApiVersion,
          ...(tenant.mode === "managed" && tenant.clientId
            ? { "x-cal-client-id": tenant.clientId, "x-cal-user-mode": "managed" }
            : {}),
        },
      });
      const text = await res.text();
      let json: unknown;
      try {
        json = text ? JSON.parse(text) : undefined;
      } catch {
        json = text;
      }
      if (res.ok) return json;
      lastError = new Error(`Cal.com ${method} ${path} -> HTTP ${res.status}: ${text}`);
      if (res.status < 500 || attempt === attempts - 1) throw lastError;
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw lastError;
}

/**
 * The connected account's own email. Cal.com rejects attendee addresses whose
 * domain cannot receive mail, so verification bookings need a deliverable one.
 */
export async function fetchAccountEmail(tenant: CalcomTenant): Promise<string | undefined> {
  const json = (await calcomFetch(tenant, "/me", "2024-06-11")) as { data?: { email?: string } };
  return json.data?.email;
}

export async function listEventTypes(tenant: CalcomTenant): Promise<CalcomEventType[]> {
  const json = (await calcomFetch(tenant, "/event-types", "2024-06-14")) as {
    data?: Array<Record<string, unknown>>;
  };
  return (json.data || []).map((item) => ({
    id: Number(item.id),
    slug: String(item.slug || ""),
    title: String(item.title || ""),
    lengthInMinutes: Number(item.lengthInMinutes || item.length || 30),
  }));
}

export async function createEventType(
  tenant: CalcomTenant,
  input: {
    title: string; slug: string; durationMinutes: number;
    bufferBeforeMinutes?: number; bufferAfterMinutes?: number; minimumNoticeMinutes?: number;
  },
): Promise<CalcomEventType> {
  const json = (await calcomFetch(tenant, "/event-types", "2024-06-14", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: input.title,
      slug: input.slug,
      lengthInMinutes: input.durationMinutes,
      length: input.durationMinutes,
      hidden: true,
      beforeEventBuffer: input.bufferBeforeMinutes || 0,
      afterEventBuffer: input.bufferAfterMinutes || 0,
      minimumBookingNotice: input.minimumNoticeMinutes || 0,
    }),
  })) as { data?: Record<string, unknown> };
  const item = json.data || {};
  return {
    id: Number(item.id),
    slug: String(item.slug || input.slug),
    title: String(item.title || input.title),
    lengthInMinutes: Number(item.lengthInMinutes || item.length || input.durationMinutes),
  };
}

export async function updateEventType(
  tenant: CalcomTenant,
  eventTypeId: string | number,
  input: {
    title: string; slug: string; durationMinutes: number;
    bufferBeforeMinutes?: number; bufferAfterMinutes?: number; minimumNoticeMinutes?: number;
  },
): Promise<CalcomEventType> {
  const json = (await calcomFetch(tenant, `/event-types/${encodeURIComponent(String(eventTypeId))}`, "2024-06-14", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: input.title,
      slug: input.slug,
      lengthInMinutes: input.durationMinutes,
      length: input.durationMinutes,
      hidden: true,
      beforeEventBuffer: input.bufferBeforeMinutes || 0,
      afterEventBuffer: input.bufferAfterMinutes || 0,
      minimumBookingNotice: input.minimumNoticeMinutes || 0,
    }),
  })) as { data?: Record<string, unknown> };
  const item = json.data || {};
  return {
    id: Number(item.id || eventTypeId),
    slug: String(item.slug || input.slug),
    title: String(item.title || input.title),
    lengthInMinutes: Number(item.lengthInMinutes || item.length || input.durationMinutes),
  };
}

/**
 * Prefer the numeric event type id. Slug lookups resolve through the public
 * `username` handle, which silently stops resolving when an account moves into
 * a Cal.com organisation; ids survive that migration.
 */
export async function checkAvailability(
  tenant: CalcomTenant,
  input: { eventTypeSlug: string; eventTypeId?: string | number; start: string; end: string },
): Promise<{ slots: string[] }> {
  const params = new URLSearchParams(
    input.eventTypeId
      ? { eventTypeId: String(input.eventTypeId), start: input.start, end: input.end }
      : {
          username: tenant.username,
          eventTypeSlug: input.eventTypeSlug,
          start: input.start,
          end: input.end,
        },
  );
  const json = (await calcomFetch(tenant, `/slots?${params.toString()}`, "2024-09-04")) as {
    data?: Record<string, Array<{ start: string }>>;
  };
  const slots: string[] = [];
  for (const day of Object.values(json.data ?? {})) {
    for (const slot of day) slots.push(slot.start);
  }
  return { slots: slots.sort() };
}

export async function createBooking(
  tenant: CalcomTenant,
  input: {
    eventTypeSlug: string;
    eventTypeId?: string | number;
    start: string;
    attendeeName: string;
    attendeeEmail: string;
    attendeeTimeZone?: string;
    notes?: string;
    conversationId: string;
  },
): Promise<{ uid?: string; status: string }> {
  const body = {
    ...(input.eventTypeId
      ? { eventTypeId: Number(input.eventTypeId) }
      : { eventTypeSlug: input.eventTypeSlug, username: tenant.username }),
    start: input.start,
    attendee: {
      name: input.attendeeName,
      email: input.attendeeEmail,
      timeZone: input.attendeeTimeZone || "Europe/London",
    },
    ...(input.notes ? { bookingFieldsResponses: { notes: input.notes } } : {}),
    metadata: { conversationId: input.conversationId },
  };
  const json = (await calcomFetch(tenant, "/bookings", "2024-08-13", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })) as { data?: { uid?: string; status?: string } };
  return { uid: json.data?.uid, status: json.data?.status ?? "unknown" };
}

export async function rescheduleBooking(
  tenant: CalcomTenant,
  input: { bookingUid: string; start: string },
): Promise<{ uid?: string; status: string }> {
  const json = (await calcomFetch(tenant, `/bookings/${encodeURIComponent(input.bookingUid)}/reschedule`, "2026-02-25", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ start: input.start }),
  })) as { data?: { uid?: string; status?: string } };
  return { uid: json.data?.uid ?? input.bookingUid, status: json.data?.status ?? "rescheduled" };
}

export async function cancelBooking(tenant: CalcomTenant, bookingUid: string): Promise<{ status: string }> {
  await calcomFetch(tenant, `/bookings/${encodeURIComponent(bookingUid)}/cancel`, "2026-02-25", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cancellationReason: "Caller requested cancellation" }),
  });
  return { status: "cancelled" };
}

export interface CalcomBooking {
  uid: string;
  title?: string;
  status?: string;
  start?: string;
  end?: string;
  eventTypeId?: string;
  eventTypeSlug?: string;
  attendees?: Array<{ name?: string; email?: string; timeZone?: string }>;
  metadata?: Record<string, unknown>;
}

export interface TenantCalendarEventTypeRef {
  providerEventTypeId: string;
  providerSlug: string;
}

function nestedRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

export function normalizeCalcomBooking(raw: unknown): CalcomBooking | undefined {
  const item = nestedRecord(raw);
  if (!item) return undefined;
  const eventType = nestedRecord(item.eventType);
  const uid = firstString(item.uid, item.id);
  if (!uid) return undefined;
  const attendees = Array.isArray(item.attendees)
    ? item.attendees.map((attendee) => {
        const row = nestedRecord(attendee) || {};
        return {
          name: firstString(row.name),
          email: firstString(row.email),
          timeZone: firstString(row.timeZone, row.timezone),
        };
      })
    : undefined;
  return {
    uid,
    title: firstString(item.title),
    status: firstString(item.status),
    start: firstString(item.start, item.startTime),
    end: firstString(item.end, item.endTime),
    eventTypeId: firstString(item.eventTypeId, eventType?.id),
    eventTypeSlug: firstString(item.eventTypeSlug, eventType?.slug),
    attendees,
    metadata: nestedRecord(item.metadata),
  };
}

/**
 * Shared-account Cal.com lists every workspace's bookings. Keep a tenant
 * diary to mapped event types plus booking UIDs this workspace already stored.
 */
export function bookingBelongsToTenant(
  booking: Pick<CalcomBooking, "uid" | "eventTypeId" | "eventTypeSlug">,
  input: {
    eventTypes: TenantCalendarEventTypeRef[];
    knownBookingUids?: Iterable<string>;
  },
): boolean {
  if (booking.uid && input.knownBookingUids) {
    for (const uid of input.knownBookingUids) {
      if (uid && uid === booking.uid) return true;
    }
  }
  for (const eventType of input.eventTypes) {
    if (booking.eventTypeId && String(eventType.providerEventTypeId) === String(booking.eventTypeId)) {
      return true;
    }
    if (booking.eventTypeSlug && eventType.providerSlug === booking.eventTypeSlug) return true;
  }
  return false;
}

function bookingsFromListPayload(data: unknown): CalcomBooking[] {
  const rows = Array.isArray(data)
    ? data
    : Array.isArray(nestedRecord(data)?.bookings)
      ? nestedRecord(data)!.bookings as unknown[]
      : [];
  return rows.map(normalizeCalcomBooking).filter((booking): booking is CalcomBooking => Boolean(booking));
}

export async function listBookings(
  tenant: CalcomTenant,
  input: {
    status?: "upcoming" | "recurring" | "past" | "cancelled" | "unconfirmed";
    afterStart?: string;
    beforeEnd?: string;
    attendeeEmail?: string;
    take?: number;
    skip?: number;
  } = {},
): Promise<{ bookings: CalcomBooking[]; status?: string }> {
  const params = new URLSearchParams();
  if (input.status) params.set("status", input.status);
  if (input.afterStart) params.set("afterStart", input.afterStart);
  if (input.beforeEnd) params.set("beforeEnd", input.beforeEnd);
  if (input.attendeeEmail) params.set("attendeeEmail", input.attendeeEmail);
  params.set("take", String(Math.max(1, Math.min(input.take ?? 50, 100))));
  if (input.skip) params.set("skip", String(Math.max(0, input.skip)));
  const json = (await calcomFetch(
    tenant,
    `/bookings?${params.toString()}`,
    "2024-08-13",
  )) as {
    status?: string;
    data?: unknown;
  };
  return {
    bookings: bookingsFromListPayload(json.data),
    status: json.status,
  };
}

export async function getBooking(tenant: CalcomTenant, bookingUid: string): Promise<CalcomBooking> {
  const json = (await calcomFetch(
    tenant,
    `/bookings/${encodeURIComponent(bookingUid)}`,
    "2024-08-13",
  )) as { data?: unknown };
  const booking = normalizeCalcomBooking(nestedRecord(json.data) ?? json.data);
  if (!booking) throw new Error("calcom_booking_not_found");
  return booking;
}

export async function getBookingReferences(
  tenant: CalcomTenant,
  bookingUid: string,
): Promise<Array<{
  type: "google_calendar" | "office365_calendar" | string;
  eventUid: string;
  destinationCalendarId: string;
}>> {
  const json = (await calcomFetch(
    tenant,
    `/bookings/${encodeURIComponent(bookingUid)}/references`,
    "2026-02-25",
  )) as {
    data?: Array<{
      type: string;
      eventUid: string;
      destinationCalendarId: string;
    }>;
  };
  return json.data ?? [];
}
