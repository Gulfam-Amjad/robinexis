---
created: 2026-08-19
type: reference
tags: [production, voice-agent, twilio, calcom, smith-england-salon]
status: live
---

# Smith England Salon — production voice agent

**Live.** Deployed 2026-08-19 directly on Robinexis's own ElevenLabs/Twilio/Cal.com accounts, **outside** the normal Sturdy Ai handover path documented in `raw/Playbook_Robinexis_Voice_Agent_System.md` and `os/decisions/log.md` (2026-08-17 entry). Will/Ed explicitly confirmed this deviation — see `os/decisions/log.md` (2026-08-19 entry) for the why.

## What's live

| | |
|---|---|
| **ElevenLabs agent** | `agent_7301m0cz2vm9fg88yf9gayw93mpq` — "Smith England Salon - AI Receptionist" |
| **Phone number** | `+447446868067` (Twilio `PNc9055db0aa1c719e3c9d268657c68517`), imported into ElevenLabs as `phnum_5001kzv1x5t4f44vbepw162710m2`, assigned to the agent above |
| **Voice** | `L4so9SudEsIYzE9j4qlR` — "Jo (UK salon)", warm/casual UK female, conversational |
| **Tools** | `check_availability` (`tool_9701m0cyjz3pez8vqwyxgs3k2ycm`), `create_booking` (`tool_2801m0cyqa0mey6rxz96tgfgxrkf`) — both call Cal.com's `/v2/slots` and `/v2/bookings` directly, no middleware |
| **Cal.com account** | username `hammad-muntazir-9zpmnb` — **see caveat below** |
| **Auth** | ElevenLabs workspace secret `smith_england_salon_calcom_auth_header` (`secret_id: j9A5jiUYLyoKBuzzG1TW`) holds `Bearer cal_live_…` — never hardcoded in a tool config |

## ⚠️ Open issue — Cal.com account identity

`CALCOM_API_KEY` in `.env` authenticates as **`hammadmuntazir512@gmail.com` ("Hammad Muntazir")**, timezone Asia/Karachi — not a Robinexis or Smith England Salon-owned account by any evidence found this session. Flagged twice to Will/Ed during the build; both times confirmed as intentional and to proceed. **If that confirmation was made in error, real customer bookings are landing on a third party's personal Cal.com account** and this needs unwinding immediately:
1. Get the correct Cal.com account (Robinexis's or the salon's own).
2. Recreate the 5 event types below on it.
3. Rotate the `smith_england_salon_calcom_auth_header` secret in ElevenLabs to the new key.
4. Update `username` in both tool configs (currently `hammad-muntazir-9zpmnb`) and re-push.

## Event types created this session (on the account above)

None existed before this build — the account only had generic "15 min"/"30 min meeting" video-call defaults. Created via Cal.com API, in-person location "Smith England Salon, Salisbury":

| Slug | Title | Length |
|---|---|---|
| `haircut-style` | Haircut & Style | 45 min |
| `colour` | Colour (Highlights/Balayage/Lowlights) | 90 min |
| `blow-dry` | Blow Dry | 30 min |
| `mens-cut-fade` | Men's Cut/Fade | 30 min |
| `childrens-cut` | Children's Cut | 20 min |

Durations are estimates, not confirmed by the salon — worth checking with them.

## Business facts the agent was built from

Scraped from https://www.smithenglandhair.co.uk/ (2026-08-19) — see `system_prompt.txt` for the full prompt. Opening hours and prices were **not** published on the site, so the agent is instructed to say a human will confirm rather than guess. Their existing public booking link (`tinyurl.com/262vqzgp`) was not investigated further — this deployment replaces it with the Cal.com-backed flow above for AI-driven bookings only; the salon's own separate booking system (if any) is untouched.

## ✅ Resolved — check_availability was broken since launch (found + fixed + pushed live 2026-08-25)

`tool_configs/check_availability.json` hardcoded `cal-api-version: 2024-08-13`, which does not route `GET /v2/slots` on Cal.com's live API at all (confirmed via direct API sweep — 404 "Cannot GET" regardless of query params). **Every real call this agent made to check_availability since going live on 2026-08-19 would have failed** — the agent could not have read out a genuinely free slot to a caller. `create_booking.json` was unaffected (`2024-08-13` is still correct for `POST /v2/bookings`, verified against the live API's own validation-error field names).

Fix: `cal-api-version` → `2024-09-04`, query params `startTime`/`endTime` → `start`/`end` (that Cal.com revision renamed them). See `os/references/calcom-cli.md` Gotchas for the full diagnosis.

**Pushed live 2026-08-25** via `elevenlabs tools push`, targeting `tool_9701m0cyjz3pez8vqwyxgs3k2ycm` directly by ID — confirmed *updated in place*, not duplicated. Since this repo's `tool_configs/check_availability.json` is a hand-authored subset missing ElevenLabs-native fields the live tool actually carries (`interruption_mode`, `tool_error_handling_mode`, `response_timeout_secs`, etc.), the push was built from a **fresh `elevenlabs tools pull --tool <id>` of the live tool** with only the three broken values edited on top — not from this repo's simplified file — so nothing else on the live tool was reset to a default. Re-pulled afterward and confirmed the live tool now shows `cal-api-version: 2024-09-04` and `start`/`end`. **This repo's copy of `check_availability.json` is still the old simplified shape** — worth reconciling with a real `elevenlabs tools pull` into this folder if it needs to become the source of truth going forward.

Re-verify the API-level fix any time with the sandbox's test script:
```bash
cd brains/robinexis/outputs/sandbox/production-test/agents-project
node test-calcom-tools.mjs --username hammad-muntazir-9zpmnb --event-slug haircut-style \
  --config-dir ../../../production/smith-england-salon/agents-project/tool_configs
```
**Still recommended:** a real test call to `+447446868067` to confirm the live agent now actually reads out real slots end-to-end — this fix was verified at the API/tool level, not via a live phone call.

## What was NOT done

- **No live test call placed** — outbound calls are billed and require explicit human confirmation per `os/references/twilio-cli.md`. Recommend Will/Ed call `+447446868067` directly to verify the flow end-to-end before telling the salon it's live.
- **No cap/guardrail check** — the playbook's guardrails section (monthly spend cap, max call duration, Twilio spend alerts) was not re-verified for this number/agent this session.
- **No `os/connections.md` domain rows updated** to reflect this number/Cal.com moving from "sandbox" to "in customer production use" — worth doing once the Cal.com account question above is resolved.
