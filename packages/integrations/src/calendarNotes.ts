import type { CalendarNoteConnection } from "@robinexis/database";
import { getBookingReferences, type CalcomTenant } from "./calcom.js";

export async function appendVerifiedCalendarNote(input: {
  calcom: CalcomTenant;
  bookingUid: string;
  note: string;
  connection: CalendarNoteConnection;
  accessToken: string;
}): Promise<{ appended: true; provider: "google" | "outlook" }> {
  const refs = await getBookingReferences(input.calcom, input.bookingUid);
  const type = input.connection.provider === "google" ? "google_calendar" : "office365_calendar";
  const ref = refs.find((item) => item.type === type);
  if (!ref) throw new Error(`calendar_reference_not_found:${type}`);

  if (input.connection.provider === "google") {
    const calendarId =
      input.connection.calendarId || ref.destinationCalendarId || "primary";
    const base =
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}` +
      `/events/${encodeURIComponent(ref.eventUid)}`;
    const event = await jsonFetch(base, input.accessToken) as { description?: string };
    const description = append(event.description, input.note);
    await jsonFetch(base, input.accessToken, {
      method: "PATCH",
      body: JSON.stringify({ description }),
    });
    return { appended: true, provider: "google" };
  }

  const base = `https://graph.microsoft.com/v1.0/me/events/${encodeURIComponent(ref.eventUid)}`;
  const event = await jsonFetch(base, input.accessToken) as {
    body?: { contentType?: "text" | "html"; content?: string };
  };
  const contentType = event.body?.contentType ?? "html";
  const separator = contentType === "html" ? "<hr/>" : "\n---\n";
  const note = contentType === "html" ? escapeHtml(input.note).replace(/\n/g, "<br/>") : input.note;
  await jsonFetch(base, input.accessToken, {
    method: "PATCH",
    body: JSON.stringify({
      body: {
        contentType,
        content: event.body?.content ? `${event.body.content}${separator}${note}` : note,
      },
    }),
  });
  return { appended: true, provider: "outlook" };
}

async function jsonFetch(url: string, token: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, {
    ...init,
    headers: {
      ...init?.headers,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`calendar_note_http_${res.status}:${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : {};
}

function append(existing: string | undefined, note: string) {
  return existing ? `${existing}\n---\n${note}` : note;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
