# Cal.com CLI reference

Command reference for the **official Cal.com CLI** (`@calcom/cli`) — the local tool for checking availability, creating/rescheduling/cancelling bookings, and managing event types from a terminal or an agent. This is the *connection doc* for Cal.com in the Sturdy Ai stack — keep it current. When a command fails and you work out why, fix it here so the same mistake never happens twice.

> **Why the CLI over raw API here:** Cal.com's own [AI-agents guide](https://cal.com/docs/agents) explicitly recommends the CLI for any agent that can run commands — *"the CLI handles authentication, versioning, and common workflows automatically. Only fall back to the API if your agent cannot install or execute the CLI."* It pins the `cal-api-version` header for you (omit it on raw calls and you get a silent 404). A short **API note** at the bottom covers direct HTTP for hosted agents (e.g. a Cloudflare Worker) that can't shell out. Official docs: <https://cal.com/docs/agents> and <https://cal.com/docs/api-reference/v2/introduction>.

---

## 🟠 Safety — read before any command

Cal.com bookings create **real calendar events and email real attendees**. Treat it accordingly.

1. **Reads are free** — `slots`, `event-types`, `me`, `bookings list/get` are safe under the default policy.
2. **A booking is an outward action.** Creating, rescheduling, or cancelling a booking notifies real people. An agent may book *on behalf of an inbound caller into your own calendar* (that's the job). It must **not** cancel/reschedule someone else's existing bookings without an explicit, in-the-moment instruction.
3. **Validate the slot before booking.** Always check `slots` and confirm the desired time is free before `POST /bookings` — avoids double-books and conflict errors.
4. **`externalRef` for idempotency.** Tie every booking/charge to the conversation/thread id so a network retry can't double-book or double-charge.
5. **Credits are billable.** `POST /v2/credits/charge` spends real account credits — only meter usage deliberately, never in a retry loop.

---

## 🔑 Get your key (plain English — for the setup wizard)

⚠️ For an **AI agent**, Cal.com's own guidance is to use an **API key** (not OAuth — OAuth is only for listing in Cal's App Store / letting *other people* connect *their* calendars).

1. Go to **https://app.cal.com** and sign in.
2. Open **Settings → Security → API keys** (or Developer → API Keys).
3. Click **Add** / **Create**, name it (e.g. `axi-prod`).
4. **Toggle "Never expires" ON** — a key that expires in 30 days will silently stop your agent booking. (Or set a long expiry + a rotation reminder.)
5. Copy the key (`cal_live_…` for live, `cal_…` for test) and paste it here — I'll add it to your `.env` and verify.

---

## Install & authenticate

| Step | Command / action |
|---|---|
| **Install** (npm) | `npm install -g @calcom/cli` |
| **Install** (curl) | `curl -fsSL https://cal.com/install.sh \| bash` |
| **Verify install** | `calcom --help` |
| **Discover any command** | `calcom <command> --help` — e.g. `calcom bookings --help`, `calcom slots --help` (the CLI is self-documenting) |
| **Auth** | Provide the API key via env var (`CALCOM_API_KEY`) or the CLI's config; the CLI attaches the `Authorization: Bearer` + `cal-api-version` headers for you |

**Env vars** (in `.env`, gitignored — never commit, never put in a brain):
```
CALCOM_API_KEY=    # cal_live_… (live) or cal_… (test). Entity-prefix per your convention, e.g. STURDYAI_CALCOM_API_KEY
```
- The prefix *is* the mode switch: `cal_live_…` = live, `cal_…` = test/sandbox.
- Your Cal.com username + event slug (e.g. `joesturdy` / `identify`) are all an agent needs to book — no ID lookups.

---

## Common workflows (the agent's daily drivers)

The mental model: **check slots → confirm free → book.** Username + event slug is enough; no ID lookup.

```bash
# 1. Check availability (no auth needed for public event types)
calcom slots --username joesturdy --event-slug identify \
  --start 2026-06-20T00:00:00Z --end 2026-06-21T23:59:59Z

# 2. List the bookable event types
calcom event-types --username joesturdy

# 3. Create a booking (validate the slot is free first)
calcom bookings create \
  --username joesturdy --event-slug identify \
  --start 2026-06-20T09:00:00Z \
  --attendee-name "Jane Operator" --attendee-email jane@example.com \
  --attendee-timezone "Europe/London"

# 4. Reschedule / cancel by booking uid
calcom bookings reschedule <uid> --start 2026-06-21T10:00:00Z
calcom bookings cancel <uid> --reason "No longer needed"
```
> Flag names follow the API fields below — confirm exact spellings with `calcom bookings create --help` on your installed version.

---

## API note (for hosted agents that can't shell out — e.g. a Worker)

All v2 calls need **two headers**: `Authorization: Bearer cal_live_…` **and** `cal-api-version: <date>`. **Omit the version header and every request 404s** — the single most common Cal.com integration bug.

> ⚠️ **The version is per-endpoint, not one global constant.** Confirmed live 2026-08-25 (see Gotchas): `/v2/slots` needs `2024-09-04`; `/v2/bookings` (create) needs `2024-08-13`. A version that works for one endpoint can 404 on another — if a call fails with a bare "Cannot GET/POST" 404, sweep nearby dated versions rather than assuming the endpoint or key is wrong.

| Action | Endpoint |
|---|---|
| Check available slots | `GET /v2/slots?username=…&eventTypeSlug=…&start=…&end=…` (params are `start`/`end`, not `startTime`/`endTime`, as of the `2024-09-04` slots revision) |
| Create a booking | `POST /v2/bookings` |
| Reschedule | `POST /v2/bookings/:uid/reschedule` |
| Cancel | `POST /v2/bookings/:uid/cancel` |
| List event types | `GET /v2/event-types?username=…` |
| Get schedules | `GET /v2/schedules` |
| **Configure webhooks** | `POST /v2/webhooks` |
| Check / charge credits | `GET /v2/credits/available` · `POST /v2/credits/charge` |

**Create a booking (official shape):**
```bash
curl -X POST "https://api.cal.com/v2/bookings" \
  -H "Authorization: Bearer cal_live_xxxxxxxx" \
  -H "Content-Type: application/json" \
  -H "cal-api-version: 2024-08-13" \
  -d '{
    "eventTypeSlug": "identify",
    "username": "joesturdy",
    "start": "2026-06-20T09:00:00Z",
    "attendee": { "name": "Jane Operator", "email": "jane@example.com", "timeZone": "Europe/London" },
    "bookingFieldsResponses": { "notes": "Self-storage AI voice agent enquiry" }
  }'
```
Fetch the event type first (`bookingFields` array) to discover required custom questions.

**Webhooks — you don't hand-create them in the dashboard.** Register them with the same key once your handler URL exists:
```bash
curl -X POST "https://api.cal.com/v2/webhooks" \
  -H "Authorization: Bearer cal_live_xxxxxxxx" \
  -H "Content-Type: application/json" \
  -H "cal-api-version: 2024-08-13" \
  -d '{
    "subscriberUrl": "https://your-worker.example.com/webhooks/cal",
    "eventTriggers": ["BOOKING_CREATED", "BOOKING_RESCHEDULED", "BOOKING_CANCELLED"],
    "active": true
  }'
```
> **Webhooks are optional for booking.** An agent that books inline already knows it succeeded — it can fire the follow-up (questionnaire, payment link, CRM log) in the same turn. Webhooks only matter for catching *out-of-band* changes a customer makes later from Cal's own UI.

---

## Gotchas

- **Missing `cal-api-version` header → 404.** Not a 400, not an auth error — a confusing 404.
- **Wrong `cal-api-version` value → also a 404, same "Cannot GET/POST" shape as missing entirely.** Confirmed 2026-08-25 by sweeping dated versions against the live API with `hammad-muntazir-9zpmnb`'s key: `2024-08-13` — the version this doc and both `check_availability.json` tool configs had hardcoded — **does not route `GET /v2/slots` or `GET /v2/event-types` at all** (404 on both), while it *does* correctly route `POST /v2/bookings` (matches `create_booking.json` as-is). Working versions found: `/v2/slots` → `2024-09-04` (also renames the query params to `start`/`end`, and the response's per-slot key is `start`, not `time`); `/v2/event-types` → `2024-06-14` (flat `data: [...]` array shape — older versions like `2024-04-15`/`2023-11-08` still 200 but return a different nested `eventTypeGroups` shape). **Lesson: don't assume one `cal-api-version` covers every endpoint — verify per-endpoint with a throwaway request** (a deliberately empty/invalid body on a POST returns a 400 with the exact expected field names if the route exists, vs. a 404 if the version itself doesn't route — a safe way to probe `/v2/bookings` without risking a real booking). Both `check_availability.json` tool configs (sandbox + `smith-england-salon`) were fixed to `2024-09-04` + `start`/`end` this session; `create_booking.json` needed no change. **If you hit a fresh 404 here again, Cal.com has likely revised the version further — re-sweep rather than reusing these dates blindly.**
- **API key vs OAuth.** The v2 intro page says it "almost always recommends OAuth" — that advice is for App-Store integrations connecting *other users'* accounts. For a single-account AI agent, the dedicated [agents guide](https://cal.com/docs/agents) says **API key**. Don't be talked into OAuth for a server agent.
- **Slot then book.** Don't skip the availability check — booking a stale slot returns a conflict error.
- **Time zones explicit, always.** Pass `Europe/London` (or the caller's) on every booking; never rely on a default.
- **Credits only apply to agents hosted *on* Cal.com.** If your agent runs elsewhere (e.g. ElevenLabs + Twilio + a Worker, as in the Sturdy OS build) and only *calls* the booking API, the credit endpoints are N/A — ignore them.

---

## Limits

- **Rate limit:** 120 requests/minute on API-key auth (raisable to ~200 on request; higher needs Cal.com support, possibly paid).
- **Retry with backoff:** transient failures happen — exponential backoff on 429/5xx, capped retries.

<!-- Append fixes here as you hit and solve real errors. This doc should get smarter every time the AIOS stumbles. -->
