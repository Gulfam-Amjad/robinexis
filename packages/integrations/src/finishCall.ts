import { noteFromCall } from "@robinexis/brain";
import { newId, type PlatformStore, type CallSession, type ClientConfig } from "@robinexis/database";
import { createToolExecutor } from "./tools.js";
import type { FakeCalendar } from "./fakeCalendar.js";

export async function finishCall(opts: {
  store: PlatformStore;
  call: CallSession;
  client: ClientConfig;
  calendar?: FakeCalendar;
}) {
  opts.call.status = opts.call.status === "active" ? "completed" : opts.call.status;
  const note = noteFromCall(opts.call);
  await opts.store.saveNote({
    id: newId("note_"),
    callId: opts.call.id,
    clientId: opts.client.id,
    crmSummary: note.crmSummary,
    calendarSummary: note.calendarSummary,
    fullTranscriptHeld: true,
  });
  const exec = createToolExecutor({ store: opts.store, calendar: opts.calendar });
  await exec({
    name: "write_crm_note",
    input: { summary: note.crmSummary, outcome: opts.call.outcome ?? opts.call.status },
    call: opts.call,
    client: opts.client,
  });
  if (opts.call.appointmentId) {
    await exec({
      name: "append_calendar_note",
      input: {
        bookingUid: opts.call.appointmentId,
        calendarSummary: note.calendarSummary,
        includeFullTranscript: opts.client.calendarNoteMode === "verbatim",
        idempotencyKey: `${opts.call.id}:calendar-note`,
      },
      call: opts.call,
      client: opts.client,
    });
  }
  if (opts.call.outboundJobId) {
    const job = await opts.store.getJob(opts.call.outboundJobId);
    if (job) {
      job.status = opts.call.status === "failed" ? "failed" : "completed";
      job.disposition =
        opts.call.outcome ?? (opts.call.status === "failed" ? "failed" : "answered-completed");
      await opts.store.saveJob(job);
    }
  }
  const elapsedMs = Math.max(0, Date.now() - Date.parse(opts.call.createdAt));
  const minutes = Math.max(1, Math.ceil(elapsedMs / 60_000));
  await opts.store.addUsage(
    opts.client.id,
    opts.call.direction === "inbound" ? minutes : 0,
    opts.call.direction === "outbound" ? minutes : 0,
  );
  await opts.store.saveCall(opts.call);
  return note;
}
