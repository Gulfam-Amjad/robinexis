import type { ToolExecutor } from "@robinexis/brain";
import type { PlatformStore } from "@robinexis/database";
import { newId } from "@robinexis/database";
import { requiredFieldsFor, type CallOutcome, type ToolName } from "@robinexis/tool-contracts";
import { guestEmailFromPhone, normalizeSpokenPhone } from "./phone.js";
import * as calcom from "./calcom.js";
import { resolveCalcomTenantConnection } from "./calcomAuth.js";
import { appendVerifiedCalendarNote } from "./calendarNotes.js";
import type { FakeCalendar } from "./fakeCalendar.js";

function tenantFromClient(
  client: { calendar: { username?: string; credentialRef?: string } },
  resolveSecret: (reference: string) => string | undefined,
): calcom.CalcomTenant {
  const apiKey = client.calendar.credentialRef
    ? resolveSecret(client.calendar.credentialRef) ?? ""
    : "";
  return { apiKey, username: client.calendar.username || process.env.CALCOM_USERNAME || "" };
}

export function createToolExecutor(opts: {
  store: PlatformStore;
  calendar?: FakeCalendar;
  confirmations?: { sms?: string[] };
  resolveSecret?: (reference: string) => string | undefined;
  resolveCalendarTenant?: (
    client: Parameters<ToolExecutor>[0]["client"],
  ) => Promise<calcom.CalcomTenant>;
  notify?: (input: {
    channel: "sms" | "email";
    to: string;
    template: string;
    bookingUid?: string;
  }) => Promise<{ providerId: string }>;
  writeCrmNote?: (input: {
    clientId: string;
    contactId?: string;
    summary: string;
    outcome: string;
  }) => Promise<{ providerId: string }>;
  searchKnowledge?: (input: {
    clientId: string;
    query: string;
    limit?: number;
    minScore?: number;
  }) => Promise<Array<{
    chunk: { id: string; documentId: string; content: string };
    document: { id: string; title: string; sourceUri?: string };
    score: number;
  }>>;
}): ToolExecutor {
  const resolveSecret = opts.resolveSecret ?? ((reference: string) => process.env[reference]);

  return async ({ name, input, call, client }) => {
    if (call.clientId !== client.id) return { ok: false, error: "tenant_mismatch" };
    const requiredFeature = featureForTool(name);
    if (requiredFeature && !client.enabledFeatures.includes(requiredFeature)) {
      return { ok: false, error: `feature_not_enabled:${requiredFeature}` };
    }

    const missing = requiredFieldsFor(name).filter((k) => input[k] === undefined || input[k] === "");
    if (missing.length) return { ok: false, error: `missing_fields:${missing.join(",")}` };

    const idem = typeof input.idempotencyKey === "string" ? input.idempotencyKey : undefined;
    const actionId = newId("ta_");
    if (idem) {
      const prior = await opts.store.findToolByIdempotency(client.id, idem);
      if (prior && !prior.error) return { ok: true, data: prior.result };
      if (prior) {
        return {
          ok: false,
          error:
            prior.error === "pending"
              ? "idempotent_action_in_progress"
              : prior.error || "idempotent_action_failed",
        };
      }
      const claimed = await opts.store.claimToolAction({
        id: actionId,
        callId: call.id,
        clientId: client.id,
        name,
        input,
        result: null,
        error: "pending",
        idempotencyKey: idem,
        at: new Date().toISOString(),
      });
      if (!claimed) return { ok: false, error: "idempotent_action_in_progress" };
    }

    try {
      const data = await execute(name, input, call, client);
      await opts.store.saveToolAction({
        id: actionId,
        callId: call.id,
        clientId: client.id,
        name,
        input,
        result: data,
        idempotencyKey: idem,
        at: new Date().toISOString(),
      });
      return { ok: true, data };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      await opts.store.saveToolAction({
        id: actionId,
        callId: call.id,
        clientId: client.id,
        name,
        input,
        result: null,
        error,
        idempotencyKey: idem,
        at: new Date().toISOString(),
      });
      return { ok: false, error };
    }
  };

  async function execute(
    name: ToolName,
    input: Record<string, unknown>,
    call: Parameters<ToolExecutor>[0]["call"],
    client: Parameters<ToolExecutor>[0]["client"],
  ): Promise<unknown> {
    const cal = opts.calendar;
    const live = opts.resolveCalendarTenant
      ? await opts.resolveCalendarTenant(client)
      : opts.calendar
        ? tenantFromClient(client, resolveSecret)
        : (await resolveCalcomTenantConnection(opts.store, client)).tenant;

    switch (name) {
      case "get_business_info": {
        const topic = String(input.topic ?? "").toLowerCase();
        if (topic.includes("hour") && !client.hours) return { unknown: true, message: "Hours are not published. A human will confirm." };
        if (topic.includes("price") && !client.prices) return { unknown: true, message: "Prices are not published. A human will confirm." };
        return {
          businessName: client.businessName,
          location: client.location,
          phone: client.phone,
          email: client.email,
          services: client.services,
          facts: client.publishedFacts,
          unknownTopics: client.unknownTopics,
        };
      }
      case "search_knowledge": {
        if (!opts.searchKnowledge) throw new Error("knowledge_search_not_configured");
        const query = String(input.query ?? "").trim();
        if (!query) throw new Error("knowledge_query_required");
        const requestedLimit = Number(input.limit ?? 5);
        const limit = Number.isFinite(requestedLimit)
          ? Math.max(1, Math.min(Math.floor(requestedLimit), 8))
          : 5;
        const results = await opts.searchKnowledge({
          clientId: client.id,
          query,
          limit,
          minScore: 0.35,
        });
        return {
          query,
          passages: results.map((result) => ({
            chunkId: result.chunk.id,
            documentId: result.document.id,
            title: result.document.title,
            sourceUri: result.document.sourceUri,
            content: result.chunk.content,
            score: result.score,
          })),
          lowConfidence: !results.length || results[0]!.score < 0.55,
        };
      }
      case "check_availability": {
        if (cal) return cal.check(String(input.eventTypeSlug));
        if (!live.apiKey || !live.username) throw new Error("calendar_not_configured");
        return calcom.checkAvailability(live, {
          eventTypeSlug: String(input.eventTypeSlug),
          start: String(input.start),
          end: String(input.end),
        });
      }
      case "create_booking": {
        if (input.callerConfirmed !== true) throw new Error("caller_confirmation_required");
        const phone = normalizeSpokenPhone(String(input.attendeePhone || call.contactPhone || ""));
        let attendeeEmail = String(input.attendeeEmail || "").trim();
        if (!attendeeEmail) {
          if (!opts.calendar && live.apiKey) {
            const account = await calcom.fetchAccountEmail(live).catch(() => undefined);
            if (account?.includes("@")) {
              const [local, domain] = account.split("@");
              const digits = phone.replace(/\D/g, "") || "unknown";
              attendeeEmail = `${local}+${digits}@${domain}`;
            }
          }
          if (!attendeeEmail) attendeeEmail = guestEmailFromPhone(phone);
        }
        const notesParts = [
          input.notes ? String(input.notes) : "",
          phone ? `Mobile: ${phone}` : "",
        ].filter(Boolean);
        const payload = {
          eventTypeSlug: String(input.eventTypeSlug),
          start: String(input.start),
          attendeeName: String(input.attendeeName),
          attendeeEmail,
          attendeeTimeZone: input.attendeeTimeZone ? String(input.attendeeTimeZone) : undefined,
          notes: notesParts.length ? notesParts.join("\n") : undefined,
          conversationId: call.id,
        };
        if (!cal && (!live.apiKey || !live.username)) throw new Error("calendar_not_configured");
        const result = cal
          ? cal.create({ ...payload, attendeeName: payload.attendeeName })
          : await calcom.createBooking(live, payload);
        if (result.uid) call.appointmentId = result.uid;
        if (phone) call.collected.attendeePhone = phone;
        if (attendeeEmail) call.collected.attendeeEmail = attendeeEmail;
        return result;
      }
      case "reschedule_booking": {
        if (input.callerConfirmed !== true) throw new Error("caller_confirmation_required");
        if (client.calendar.schedule?.rescheduleAllowed === false) throw new Error("rescheduling_not_allowed");
        if (!cal && (!live.apiKey || !live.username)) throw new Error("calendar_not_configured");
        if (cal) return cal.reschedule(String(input.bookingUid), String(input.newStart));
        return calcom.rescheduleBooking(live, { bookingUid: String(input.bookingUid), start: String(input.newStart) });
      }
      case "cancel_booking": {
        if (input.callerConfirmed !== true) throw new Error("caller_confirmation_required");
        if (client.calendar.schedule?.cancellationAllowed === false) throw new Error("cancellation_not_allowed");
        if (!cal && (!live.apiKey || !live.username)) throw new Error("calendar_not_configured");
        if (cal) return cal.cancel(String(input.bookingUid));
        return calcom.cancelBooking(live, String(input.bookingUid));
      }
      case "create_callback":
        call.collected.callback = input;
        return { stored: true };
      case "transfer_to_human":
        return { transfer: true, reason: input.reason };
      case "send_confirmation": {
        if (!call.appointmentId && !input.bookingUid) throw new Error("no_successful_action");
        if (opts.notify) {
          const result = await opts.notify({
            channel: input.channel as "sms" | "email",
            to: String(input.to),
            template: String(input.template),
            bookingUid: input.bookingUid ? String(input.bookingUid) : call.appointmentId,
          });
          return { sent: true, channel: input.channel, providerId: result.providerId };
        }
        if (opts.confirmations?.sms) {
          opts.confirmations.sms.push(String(input.to));
          return { sent: true, channel: input.channel, adapter: "test" };
        }
        throw new Error("notification_provider_not_configured");
      }
      case "write_crm_note": {
        call.collected.crm = input;
        if (!opts.writeCrmNote) return { savedLocally: true, externalSaved: false };
        const result = await opts.writeCrmNote({
          clientId: client.id,
          contactId: call.contactId,
          summary: String(input.summary),
          outcome: String(input.outcome),
        });
        return { savedLocally: true, externalSaved: true, providerId: result.providerId };
      }
      case "append_calendar_note": {
        const uid = String(input.bookingUid);
        const note = String(input.calendarSummary);
        if (client.calendarNoteMode !== "verbatim" && input.includeFullTranscript) {
          return { appended: false, reason: "verbatim_disabled" };
        }
        if (!cal && (!live.apiKey || !live.username)) throw new Error("calendar_not_configured");
        if (cal) return cal.appendNote(uid, note);
        if (!client.calendarNotes) throw new Error("calendar_note_connection_not_configured");
        const accessToken = resolveSecret(client.calendarNotes.credentialRef);
        if (!accessToken) throw new Error("calendar_note_credential_not_configured");
        return appendVerifiedCalendarNote({
          calcom: live,
          bookingUid: uid,
          note,
          connection: client.calendarNotes,
          accessToken,
        });
      }
      case "mark_call_outcome":
        call.outcome = input.outcome as CallOutcome;
        return { recorded: input.outcome };
      case "record_do_not_call": {
        const phone = String(input.phone);
        await opts.store.addSuppression({
          clientId: client.id,
          phone,
          reason: String(input.reason ?? "opt-out"),
          createdAt: new Date().toISOString(),
        });
        const jobs = await opts.store.dueJobs("9999-12-31T00:00:00.000Z", 500);
        for (const j of jobs) {
          if (j.clientId === client.id && j.contactPhone === phone && j.status !== "completed") {
            j.status = "suppressed";
            await opts.store.saveJob(j);
          }
        }
        return { suppressed: true, phone };
      }
      default:
        return { error: `unknown_tool:${name}` };
    }
  }
}

function featureForTool(name: ToolName): string | undefined {
  if (["check_availability", "create_booking", "reschedule_booking", "cancel_booking", "append_calendar_note"].includes(name)) {
    return "booking";
  }
  if (name === "transfer_to_human") return "transfer";
  if (name === "send_confirmation") return "notifications";
  if (name === "mark_call_outcome") return "outbound";
  return undefined;
}
