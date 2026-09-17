import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { calcom } from "@robinexis/integrations";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnv({ path: path.join(root, ".env"), quiet: true });

const api = "https://robinexisapi-production-3836.up.railway.app";
const secret = process.env.VOICE_TOOL_SECRET || "";
const calApiKey = process.env.CALCOM_API_KEY || "";
const calUsername = process.env.CALCOM_USERNAME || "";
if (!secret || !calApiKey || !calUsername) {
  throw new Error("VOICE_TOOL_SECRET, CALCOM_API_KEY and CALCOM_USERNAME are required");
}

const headers = {
  "content-type": "application/json",
  "x-voice-tool-secret": secret,
};
const conversationId = `conv_verification_${Date.now()}`;
const from = new Date(Date.now() + 24 * 60 * 60 * 1000);
from.setUTCHours(0, 0, 0, 0);
const to = new Date(from.getTime() + 7 * 24 * 60 * 60 * 1000);

async function post(pathname: string, body: Record<string, unknown>) {
  const response = await fetch(`${api}${pathname}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const result = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(`${pathname} failed: ${JSON.stringify(result)}`);
  return result;
}

let bookingUid = "";
try {
  const availability = await post("/api/v1/voice-tools/check-availability", {
    eventTypeSlug: "15min",
    start: from.toISOString(),
    end: to.toISOString(),
    conversationId,
  });
  const slot = (availability.slots as string[] | undefined)?.[0];
  if (!slot) throw new Error("No 15-minute Cal.com slot available in the next seven days");

  const bookingInput = {
    eventTypeSlug: "15min",
    start: slot,
    attendeeName: "Robinexis Verification",
    attendeePhone: "+447700900000",
    attendeeEmail: process.env.CALCOM_CHECK_EMAIL || undefined,
    attendeeTimeZone: "Europe/London",
    notes: "Blades consultation, any stylist — automated verification; cancel immediately",
    callerConfirmed: true,
    conversationId,
  };
  const first = await post("/api/v1/voice-tools/create-booking", bookingInput);
  const second = await post("/api/v1/voice-tools/create-booking", bookingInput);
  bookingUid = String(first.bookingUid || "");
  if (!bookingUid || second.bookingUid !== bookingUid) {
    throw new Error("Live booking did not return one stable idempotent UID");
  }
  console.log(JSON.stringify({ ok: true, slot, bookingUid, idempotent: true }, null, 2));
} finally {
  if (bookingUid) {
    const cancelled = await calcom.cancelBooking(
      { apiKey: calApiKey, username: calUsername },
      bookingUid,
    );
    console.log(JSON.stringify({ bookingUid, cancelled: cancelled.status === "cancelled" }, null, 2));
  }
}
