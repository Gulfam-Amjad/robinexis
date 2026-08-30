/**
 * Drives the live calendar through the agent's own tool executor —
 * check_availability, create_booking, cancel_booking — so a Cal.com problem is
 * caught from a terminal instead of mid-call. Creates a real booking and
 * cancels it again unless --keep is passed.
 *
 *   npm run check:calcom -- [clientId] [--keep]
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { getStore, newId, type CallSession, type ClientConfig } from "@robinexis/database";
import { createToolExecutor } from "./tools.js";
import { fetchAccountEmail } from "./calcom.js";

loadEnv({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.env") });

const args = process.argv.slice(2);
const keep = args.includes("--keep");
const clientId = args.find((arg) => !arg.startsWith("--")) ?? "robinexis-demo";

type Outcome = { ok: true; data?: unknown } | { ok: false; error: string };

function report(step: string, outcome: Outcome): unknown {
  if (!outcome.ok) {
    console.log(`[FAIL] ${step} — ${outcome.error}`);
    return undefined;
  }
  console.log(`[PASS] ${step}`);
  if (outcome.data !== undefined) {
    console.log(`       ${JSON.stringify(outcome.data).slice(0, 400)}`);
  }
  return outcome.data ?? {};
}

async function main() {
  const store = await getStore();
  const client: ClientConfig | undefined = await store.getClient(clientId);
  if (!client) throw new Error(`client_not_found: ${clientId}`);

  console.log(`Calendar check for "${client.businessName}" (${client.id})`);
  console.log(`  provider=${client.calendar.provider} username=${client.calendar.username ?? "(none)"} credentialRef=${client.calendar.credentialRef ?? "(none)"}`);

  const now = new Date().toISOString();
  const call: CallSession = {
    id: newId("call_"),
    clientId: client.id,
    direction: "inbound",
    objective: "Verify the live calendar tools.",
    promptVersionId: "calendar-check",
    transcript: [],
    collected: {},
    toolHistory: [],
    state: "live",
    status: "active",
    createdAt: now,
    updatedAt: now,
  };

  const exec = createToolExecutor({ store });
  const eventTypeSlug = process.env.CALCOM_EVENT_TYPE_SLUG || "15min";
  const from = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const to = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);

  const availability = await exec({
    name: "check_availability",
    input: { eventTypeSlug, start: from.toISOString(), end: to.toISOString() },
    call,
    client,
  });
  const availabilityData = report("check_availability", availability);
  if (!availabilityData) return;

  const slots = (availabilityData as { slots?: string[] }).slots ?? [];
  const slot = slots[0];
  if (!slot) {
    console.log("[FAIL] no free slots returned — open availability on the event type first");
    return;
  }

  let attendeeEmail = process.env.CALCOM_CHECK_EMAIL;
  if (!attendeeEmail) {
    const apiKey = client.calendar.credentialRef ? process.env[client.calendar.credentialRef] : undefined;
    attendeeEmail = apiKey
      ? await fetchAccountEmail({ apiKey, username: client.calendar.username ?? "" }).catch(() => undefined)
      : undefined;
  }
  if (!attendeeEmail) {
    console.log("[FAIL] no deliverable attendee email — set CALCOM_CHECK_EMAIL to a mailbox you own");
    return;
  }
  console.log(`  attendee=${attendeeEmail}`);

  const booking = await exec({
    name: "create_booking",
    input: {
      eventTypeSlug,
      start: slot,
      attendeeName: "Robinexis Calendar Check",
      attendeeEmail,
      attendeeTimeZone: "Europe/London",
      notes: "Automated check from npm run check:calcom — safe to ignore.",
      callerConfirmed: true,
      idempotencyKey: `${call.id}:check`,
    },
    call,
    client,
  });
  const bookingData = report(`create_booking at ${slot}`, booking);
  if (!bookingData) return;

  const uid = (bookingData as { uid?: string }).uid;
  if (!uid) {
    console.log("[WARN] booking succeeded but returned no uid — cannot clean up automatically");
    return;
  }

  if (keep) {
    console.log(`[KEEP] booking ${uid} left in the calendar for inspection`);
    return;
  }

  const cancelled = await exec({
    name: "cancel_booking",
    input: {
      bookingUid: uid,
      summaryRepeated: `Robinexis Calendar Check at ${slot}`,
      callerConfirmed: true,
      idempotencyKey: `${call.id}:cancel`,
    },
    call,
    client,
  });
  report(`cancel_booking ${uid}`, cancelled);
}

main()
  .then(() => {
    // The Postgres pool keeps the loop alive; unref rather than exit hard so
    // Windows libuv does not assert on a closing handle.
    process.exitCode = 0;
    setTimeout(() => process.exit(process.exitCode ?? 0), 250).unref();
  })
  .catch((err) => {
    console.error(`[FAIL] ${String(err)}`);
    process.exitCode = 1;
    setTimeout(() => process.exit(1), 250).unref();
  });
