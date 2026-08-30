---
created: 2026-08-17
type: reference
tags: [sandbox, voice-agent, twilio, calcom, make]
status: test-build
---

# Production-wiring sandbox — inbound calls, booking, 24h reminders

> **Not a customer deployment.** This is a test build on Robinexis's own Twilio / ElevenLabs / Cal.com / Make keys, wired to prove the pattern out. The playbook (`raw/Playbook_Robinexis_Voice_Agent_System.md`) reserves real customer production deploys for Sturdy Ai, running on **Sturdy Ai's own** Twilio/ElevenLabs accounts (Track 1 £75/hr or Track 2 50/50) — see [[concept-demo-workflow]]. When a real prospect signs, hand off to Joe instead of extending this sandbox.

There is no self-hosted server anywhere in this repo, and none is needed. Every piece below is either a dashboard setting, an ElevenLabs agent "server tool" config (JSON, version-controlled), or a Make.com scenario (visual automation, exportable as JSON). Nothing here needs deploying or hosting.

## 0 — Keys needed

Add to `.env` (see `.env.example` for the full placeholder list, added 2026-08-17):
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` — already set.
- `CALCOM_API_KEY` — **not yet set**. Get from app.cal.com → Settings → Developer → API keys, "Never expires" ON (see `os/references/calcom-cli.md`).
- `MAKE_API_KEY`, `MAKE_ZONE`, `MAKE_TEAM_ID` — **not yet set**. Needed only for step 3 (reminders).

Also store `CALCOM_API_KEY` as an **ElevenLabs workspace secret** (dashboard → Settings → Secrets, or `elevenlabs` project secrets) so the tool configs below can reference `{{CALCOM_API_KEY}}` in a header without the raw key living in a committed JSON file.

## 1 — Inbound calls: Twilio number → ElevenLabs agent (no code)

ElevenLabs Conversational AI has a native Twilio integration — the agent's phone webhook is hosted by ElevenLabs, not by us.

1. ElevenLabs dashboard → **Conversational AI → Phone Numbers → Import a number from Twilio**.
2. Paste `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` and the number (`TWILIO_PHONE_NUMBER`).
3. Assign the number to the target agent.
4. Verify: `twilio phone-numbers:list -o json | jq '.[] | {phoneNumber, voiceUrl}'` — `voiceUrl` should now point at ElevenLabs' inbound endpoint, confirming the import took the webhook over (see `os/references/twilio-cli.md` §5).

No `/api/twilio/inbound` route needed — this is the reason one was never built.

## 2 — Calendar server tools: check_availability + create_booking

Files: `agents-project/tool_configs/check_availability.json`, `agents-project/tool_configs/create_booking.json`.

These call Cal.com's own API directly — no middleware. Before pushing, scaffold-and-reconcile rather than trusting these drafts blind (the CLI's tool schema can drift — see `os/references/elevenlabs-cli.md`'s own "verify real flags before scripting" gotcha):

```bash
cd brains/robinexis/outputs/sandbox/production-test/agents-project
elevenlabs agents init            # if agents.json doesn't exist yet
elevenlabs tools add-webhook "check_availability"   # scaffolds the real file shape
elevenlabs tools add-webhook "create_booking"
# diff the scaffold against the two JSON files above, reconcile any field-name drift
elevenlabs tools push
# then reference both tools from the agent's config in agent_configs/*.json
elevenlabs agents push
```

Before wiring: confirm the business's Cal.com **username** and **event-type slug** with `calcom event-types --username <name>` — both tool configs need them.

**Verify both tools actually work against the live Cal.com API** before pushing — `agents-project/test-calcom-tools.mjs` (plain Node, no deps) reads these two JSON files directly (so it catches drift in the files themselves, not just Cal.com's API) and exercises them end to end:
```bash
cd brains/robinexis/outputs/sandbox/production-test/agents-project
node test-calcom-tools.mjs --username <cal-username> --event-slug <slug>       # dry-run: real check_availability call + prints (doesn't send) the create_booking request
node test-calcom-tools.mjs --username <cal-username> --event-slug <slug> --live # also creates a real test booking, then immediately auto-cancels it
```
2026-08-25: this caught `check_availability.json` hardcoding a stale `cal-api-version` (`2024-08-13`, which no longer routes `GET /v2/slots` at all) and the wrong query param names (`startTime`/`endTime` instead of `start`/`end`) — fixed in both this sandbox's and `smith-england-salon`'s tool configs. See `os/references/calcom-cli.md` Gotchas for the full diagnosis. `create_booking.json` needed no change. **The `smith-england-salon` live tool has since been fixed and pushed** (see that project's `README.md`) — pulled the live tool by ID first and edited on top of the real pulled schema rather than pushing this repo's simplified file, since the live tool carries ElevenLabs-native fields (`interruption_mode`, `tool_error_handling_mode`, etc.) this repo's JSON doesn't. A bare `elevenlabs tools push` from this repo's own `tool_configs/` would have silently reset those to defaults — pull-and-reconcile first, always, exactly as this section already warned above.

## 3 — 24-hour reminder calls (Make.com scenario)

Nothing in the stack does this automatically — it needs a scheduled job. Make.com is the designated automation layer (`os/references/recommended-stack.md`).

**Recipe** (build once in the Make.com visual editor — safer than hand-writing the blueprint JSON, since module IDs/versions can drift; export afterward with `make-cli scenarios get <id>` and commit it here):

1. **Scheduler** — every hour.
2. **HTTP — Get a resource** → `GET https://api.cal.com/v2/bookings` with `status=upcoming`, filtered to a window ~23–25h from now. Headers: `Authorization: Bearer {{CALCOM_API_KEY}}`, `cal-api-version: 2024-08-13`. Confirm exact filter param names with `calcom bookings list --help` first — not all of Cal.com's list-filter params are documented in this repo yet.
3. **Iterator** over the bookings array.
4. **Filter** — skip any booking already flagged `reminder_sent` (use a Make **Data Store**, keyed by booking `uid`, to avoid double-calling the same appointment on re-runs of the hourly schedule).
5. **HTTP — Get a resource** → trigger the outbound reminder call. Verify the exact current endpoint/payload in ElevenLabs' outbound-calling docs before activating (it has moved before) — as of this write-up it's a `POST` to ElevenLabs' Twilio outbound-call endpoint with `agent_id`, `agent_phone_number_id`, and the caller's `to_number`, using `ELEVENLABS_API_KEY`. Do not activate this step without confirming against current docs — outbound calls are billed.
6. **Data Store — Add record** — mark the booking's `uid` as reminded.

Once built: `make-cli scenarios get <id> -o json > automations/make-24h-reminder-scenario.json` and commit — that JSON becomes the version-controlled source of truth here, replacing hand-authored guesses.

Keep the scenario **deactivated** (`make-cli scenarios deactivate <id>`) until a human has watched at least one live run end-to-end, per the same confirm-before-billing rule as Twilio outbound calls.

## Guardrails (playbook §6 — apply even in sandbox)

- ElevenLabs: monthly spend cap set, max call duration 5–10 min.
- Twilio: spend alerts at low sandbox thresholds (e.g. £10/£25) — this is test money, cap it tighter than a real customer deployment.
- Every outbound call / booking action needs a human to have explicitly approved turning the automation on — never let a scheduled job go live unattended on the first run.
- `CALCOM_API_KEY` and any other secret: workspace secret / `.env` only, never hardcoded into a committed tool config or Make blueprint.

## Status

Sandbox only — no customer, no Twilio number in production use. See `os/decisions/log.md` (2026-08-17) for why this exists outside the normal Sturdy Ai handover path.
