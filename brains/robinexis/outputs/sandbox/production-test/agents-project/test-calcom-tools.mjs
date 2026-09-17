#!/usr/bin/env node
// Verifies the check_availability / create_booking ElevenLabs tool configs
// (./tool_configs/*.json) against the real Cal.com API — using the exact
// url/method/headers/schema each JSON file declares, not a hand-rolled
// reimplementation, so schema drift between the file and Cal.com gets caught.
//
// Usage:
//   node test-calcom-tools.mjs --username <cal-username> --event-slug <slug> [options]
//
// Options:
//   --username        Cal.com username to query (required)
//   --event-slug      Event type slug to query (required)
//   --days N          Availability search window in days from --start (default 7)
//   --start ISO8601   Window start (default: now)
//   --timezone TZ     Attendee IANA timezone for the booking test (default Europe/London)
//   --attendee-name   Attendee name for the booking test (default "AIOS Test Booking")
//   --attendee-email  Attendee email for the booking test (default admin@robinexis.com)
//   --config-dir DIR  Directory holding check_availability.json/create_booking.json
//                      (default: ./tool_configs next to this script)
//   --live            Actually create a real booking, then immediately cancel it.
//                      Default is dry-run: builds and prints the create_booking
//                      request but sends nothing. A booking is a real outward
//                      action (real calendar event, real email) — see
//                      os/references/calcom-cli.md "Safety" — so this is opt-in.
//   --help            Show this help
//
// Reads CALCOM_API_KEY (repo convention — see .env.example) or CAL_API_KEY
// from the environment, or from the nearest .env found walking up from this
// script's directory.

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadDotEnv(startDir) {
  let dir = startDir;
  for (let i = 0; i < 12; i++) {
    const envPath = path.join(dir, ".env");
    if (existsSync(envPath)) {
      for (const line of readFileSync(envPath, "utf8").split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq === -1) continue;
        const key = trimmed.slice(0, eq).trim();
        let val = trimmed.slice(eq + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!(key in process.env)) process.env[key] = val;
      }
      return envPath;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function parseArgs(argv) {
  const args = {
    live: false,
    days: 7,
    timezone: "Europe/London",
    attendeeName: "AIOS Test Booking",
    attendeeEmail: process.env.CALCOM_TEST_ATTENDEE_EMAIL || "admin@robinexis.com",
    configDir: path.join(__dirname, "tool_configs"),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`Missing value for ${a}`);
      return argv[++i];
    };
    switch (a) {
      case "--username": args.username = next(); break;
      case "--event-slug": args.eventSlug = next(); break;
      case "--days": args.days = Number(next()); break;
      case "--start": args.start = next(); break;
      case "--timezone": args.timezone = next(); break;
      case "--attendee-name": args.attendeeName = next(); break;
      case "--attendee-email": args.attendeeEmail = next(); break;
      case "--config-dir": args.configDir = path.resolve(next()); break;
      case "--live": args.live = true; break;
      case "--help": case "-h": args.help = true; break;
      default: throw new Error(`Unknown argument "${a}" (--help for usage)`);
    }
  }
  return args;
}

function loadToolConfig(dir, filename) {
  const p = path.join(dir, filename);
  if (!existsSync(p)) throw new Error(`Tool config not found: ${p}`);
  return JSON.parse(readFileSync(p, "utf8"));
}

// Resolves a tool config's request_headers into real header values.
// Sandbox-style configs inline "Bearer {{CALCOM_API_KEY}}"; the live
// smith-england-salon configs instead point at an ElevenLabs workspace
// secret_id (see outputs/production/smith-england-salon/README.md), which
// this local script can't read — that secret is known to hold
// "Bearer <CALCOM_API_KEY>", so we substitute the local key for the test.
function resolveHeaders(rawHeaders, apiKey) {
  const out = {};
  for (const [key, val] of Object.entries(rawHeaders)) {
    if (typeof val === "string") {
      out[key] = val
        .replace(/\{\{\s*CALCOM_API_KEY\s*\}\}/g, apiKey)
        .replace(/\{\{\s*CAL_API_KEY\s*\}\}/g, apiKey);
    } else if (val && typeof val === "object" && "secret_id" in val) {
      console.warn(`  note: header "${key}" references ElevenLabs secret_id "${val.secret_id}" — substituting local API key for this test run`);
      out[key] = `Bearer ${apiKey}`;
    } else {
      throw new Error(`Unrecognized header value shape for "${key}": ${JSON.stringify(val)}`);
    }
  }
  return out;
}

function redactHeaders(headers) {
  const out = { ...headers };
  if (out.Authorization) out.Authorization = out.Authorization.replace(/Bearer .+/, "Bearer ***redacted***");
  return out;
}

function buildQuery(schema, values) {
  for (const req of schema.required || []) {
    if (values[req] === undefined || values[req] === null || values[req] === "") {
      throw new Error(`Missing required query param "${req}" (declared in tool config schema)`);
    }
  }
  const params = new URLSearchParams();
  for (const key of Object.keys(schema.properties || {})) {
    if (values[key] !== undefined && values[key] !== null) params.set(key, String(values[key]));
  }
  return params;
}

function buildBookingBody(schema, values) {
  for (const req of schema.required || []) {
    if (values[req] === undefined) throw new Error(`Missing required body field "${req}" (declared in tool config schema)`);
  }
  const attendeeSchema = schema.properties.attendee;
  for (const req of attendeeSchema.required || []) {
    if (!values.attendee || values.attendee[req] === undefined) {
      throw new Error(`Missing required attendee field "${req}" (declared in tool config schema)`);
    }
  }
  const body = {};
  for (const key of Object.keys(schema.properties)) {
    if (values[key] !== undefined) body[key] = values[key];
  }
  return body;
}

async function callApi(url, method, headers, body) {
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
  if (!res.ok) {
    const hint = res.status === 404 ? " (404 on a Cal.com v2 call is almost always a missing/wrong cal-api-version header, not a bad URL — see os/references/calcom-cli.md gotchas)" : "";
    throw new Error(`${method} ${url} -> HTTP ${res.status}${hint}\n${text}`);
  }
  return json ?? text;
}

// Cal.com v2 wraps responses as { status, data }; be defensive since this
// repo's docs don't pin the exact slots shape — fall back to printing raw
// JSON rather than asserting a field name that might be wrong.
function extractSlotTimes(json) {
  const data = json?.data ?? json;
  const times = [];
  if (data && typeof data === "object" && !Array.isArray(data)) {
    for (const val of Object.values(data)) {
      if (Array.isArray(val)) {
        for (const slot of val) {
          if (typeof slot === "string") times.push(slot);
          else if (slot && typeof slot === "object") times.push(slot.start ?? slot.time);
        }
      }
    }
  } else if (Array.isArray(data)) {
    for (const slot of data) {
      if (typeof slot === "string") times.push(slot);
      else if (slot && typeof slot === "object") times.push(slot.start ?? slot.time);
    }
  }
  return times.sort();
}

const USAGE = `Usage: node test-calcom-tools.mjs --username <cal-username> --event-slug <slug> [options]

Options:
  --username        Cal.com username to query (required)
  --event-slug      Event type slug to query (required)
  --days N          Availability search window in days from --start (default 7)
  --start ISO8601   Window start (default: now)
  --timezone TZ     Attendee IANA timezone for the booking test (default Europe/London)
  --attendee-name   Attendee name for the booking test (default "AIOS Test Booking")
  --attendee-email  Attendee email for the booking test (default admin@robinexis.com)
  --config-dir DIR  Directory holding check_availability.json/create_booking.json
                     (default: ./tool_configs next to this script)
  --live            Actually create a real booking, then immediately cancel it.
                     Default is dry-run (builds + prints the request, sends nothing).
  --help            Show this help

Env: CALCOM_API_KEY (or CAL_API_KEY), read from the environment or the nearest .env.`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(USAGE); return 0; }
  if (!args.username || !args.eventSlug) {
    console.error("Missing --username and/or --event-slug.\n");
    console.error(USAGE);
    return 1;
  }

  const envPath = loadDotEnv(__dirname);
  const apiKey = process.env.CALCOM_API_KEY || process.env.CAL_API_KEY;
  if (!apiKey) {
    console.error(`No CALCOM_API_KEY (or CAL_API_KEY) found${envPath ? ` in ${envPath}` : ""} or in the environment.`);
    return 1;
  }

  const checkAvailabilityConfig = loadToolConfig(args.configDir, "check_availability.json");
  const createBookingConfig = loadToolConfig(args.configDir, "create_booking.json");

  const start = args.start ? new Date(args.start) : new Date();
  const end = new Date(start.getTime() + args.days * 24 * 60 * 60 * 1000);

  let overallOk = true;

  // ---------- check_availability ----------
  console.log("=== check_availability ===");
  const slotsHeaders = resolveHeaders(checkAvailabilityConfig.api_schema.request_headers, apiKey);
  const slotsQuery = buildQuery(checkAvailabilityConfig.api_schema.query_params_schema, {
    username: args.username,
    eventTypeSlug: args.eventSlug,
    start: start.toISOString(),
    end: end.toISOString(),
  });
  const slotsUrl = `${checkAvailabilityConfig.api_schema.url}?${slotsQuery.toString()}`;
  console.log(`GET ${slotsUrl}`);

  let firstSlot;
  try {
    const slotsJson = await callApi(slotsUrl, checkAvailabilityConfig.api_schema.method, slotsHeaders);
    const times = extractSlotTimes(slotsJson);
    if (times.length) {
      firstSlot = times[0];
      console.log(`✅ ${times.length} slot(s) returned. First free: ${firstSlot}`);
    } else {
      console.warn("⚠️  0 slots parsed from the response. Raw response for inspection:");
      console.warn(JSON.stringify(slotsJson, null, 2));
    }
  } catch (err) {
    overallOk = false;
    console.error(`❌ check_availability failed: ${err.message}`);
  }

  // ---------- create_booking ----------
  console.log("\n=== create_booking ===");
  const bookingHeaders = resolveHeaders(createBookingConfig.api_schema.request_headers, apiKey);
  const bookingValues = {
    eventTypeSlug: args.eventSlug,
    username: args.username,
    start: firstSlot,
    attendee: { name: args.attendeeName, email: args.attendeeEmail, timeZone: args.timezone },
    bookingFieldsResponses: { notes: "AIOS test booking (test-calcom-tools.mjs) — safe to ignore or cancel" },
    metadata: { conversationId: `aios-test-${new Date().toISOString()}` },
  };

  if (!firstSlot) {
    console.warn("⚠️  Skipping create_booking — no free slot found by check_availability to book against.");
    overallOk = false;
  } else {
    let bookingBody;
    try {
      bookingBody = buildBookingBody(createBookingConfig.api_schema.request_body_schema, bookingValues);
    } catch (err) {
      overallOk = false;
      console.error(`❌ create_booking request is invalid against its own schema: ${err.message}`);
    }

    if (bookingBody) {
      console.log(`${createBookingConfig.api_schema.method} ${createBookingConfig.api_schema.url}`);
      console.log(`Headers: ${JSON.stringify(redactHeaders(bookingHeaders))}`);
      console.log(`Body: ${JSON.stringify(bookingBody, null, 2)}`);

      if (!args.live) {
        console.log("ℹ️  Dry run only — nothing was sent. Re-run with --live to actually create + auto-cancel a real test booking.");
      } else {
        try {
          const created = await callApi(createBookingConfig.api_schema.url, createBookingConfig.api_schema.method, bookingHeaders, bookingBody);
          const uid = created?.data?.uid ?? created?.uid;
          if (!uid) {
            overallOk = false;
            console.error("❌ create_booking returned no uid to confirm/clean up. Raw response:");
            console.error(JSON.stringify(created, null, 2));
          } else {
            console.log(`✅ Booking created: uid=${uid}`);
            console.log(`Cleaning up — cancelling test booking ${uid}...`);
            try {
              await callApi(`${createBookingConfig.api_schema.url}/${uid}/cancel`, "POST", bookingHeaders, { cancellationReason: "Automated test booking (test-calcom-tools.mjs) — auto-cancelled" });
              console.log(`✅ Booking ${uid} cancelled.`);
            } catch (cancelErr) {
              overallOk = false;
              console.error(`❌ Auto-cancel failed — booking ${uid} is still live on the calendar, cancel it manually: ${cancelErr.message}`);
            }
          }
        } catch (err) {
          overallOk = false;
          console.error(`❌ create_booking failed: ${err.message}`);
        }
      }
    }
  }

  console.log("\n=== SUMMARY ===");
  console.log(`check_availability: ${firstSlot ? "PASS" : "FAIL"}`);
  console.log(`create_booking:     ${!firstSlot ? "SKIPPED" : args.live ? (overallOk ? "PASS (live create + auto-cancel)" : "FAIL") : "DRY-RUN OK (use --live to fully verify)"}`);

  return overallOk ? 0 : 1;
}

main().then((code) => { process.exitCode = code; }, (err) => {
  console.error(`❌ ${err.message}`);
  process.exitCode = 1;
});
