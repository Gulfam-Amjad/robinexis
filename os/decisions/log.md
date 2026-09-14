# Decisions Log

Append-only record of meaningful decisions and why they were made. `/level-up` Phase 2 (Method interview) writes scoped automation specs here. You can also append manually whenever you decide something worth remembering.

**Format per entry:**

```
## YYYY-MM-DD — Short title

**Decision:** what was decided.

**Why:** the reasoning, constraints, and what would change your mind.

**Alternatives considered:** what else was on the table.

**Owner:** who's accountable.
```

Keep it terse. Future-you will thank present-you for capturing the *why*, not just the *what*.

---

## 2026-08-17 — Build production-wiring sandbox outside the Sturdy Ai handover path

**Decision:** Wired inbound-call, calendar-booking, and 24h-reminder patterns on Robinexis's own Twilio/ElevenLabs/Cal.com/Make keys as a test build (`brains/robinexis/outputs/sandbox/production-test/`), rather than treating it as a customer production deploy.

**Why:** Asked for server endpoints to handle real inbound calls, calendar booking, and reminders. The playbook (`brains/robinexis/raw/Playbook_Robinexis_Voice_Agent_System.md`) reserves that work for Sturdy Ai — production agents run on Sturdy Ai's own Twilio/ElevenLabs accounts, gated on a signed-and-paid deal ("no work before payment... no exceptions"). No signed customer exists yet, so this is explicitly a sandbox/prototype, not a deployment.

**Alternatives considered:** Stop and route straight to a Sturdy Ai handover message (declined — no signed customer to hand off yet).

**Owner:** Will/Ed Robinson (sandbox build); production deploys stay Sturdy Ai's per the playbook.

---

## 2026-08-19 — Smith England Salon deployed live, outside the Sturdy Ai handover path

**Decision:** Built and deployed a production ElevenLabs voice agent for Smith England Salon (Salisbury hair salon) directly on Robinexis's own ElevenLabs/Twilio/Cal.com accounts, and reassigned Robinexis's live number `+447446868067` from the "Robinexis - AI Receptionist" agent to this new salon agent. See `brains/robinexis/outputs/production/smith-england-salon/README.md` for the full technical record.

**Why:** Asked to build this directly for a stated signed client. Confirmed explicitly with Will/Ed, twice, that this deviates from the playbook's normal path (production deploys reserved for Sturdy Ai, on Sturdy Ai's own infrastructure, gated on payment — see 2026-08-17 entry above) — they chose to proceed anyway rather than route to a Sturdy Ai handover. Payment status with Sturdy Ai was not verified and is not confirmed as settled.

**Open risk flagged, not resolved:** The Cal.com API key in `.env` authenticates as a third party's personal account (`hammadmuntazir512@gmail.com`, "Hammad Muntazir") with no prior connection found to Robinexis or the salon. Flagged twice; Will/Ed confirmed twice to proceed anyway. Five event types were created on that account to make bookings usable (see README). If this was confirmed in error, real customer bookings are landing on a stranger's calendar — needs Will/Ed to double check with a clear head, not mid-build.

**Alternatives considered:** Stop and route to a Sturdy Ai handover message (declined — explicit instruction to build now). Pause on the Cal.com issue and ship without booking tools (offered, declined in favour of creating fresh event types on the flagged account).

**Owner:** Will/Ed Robinson — explicit, repeated go-ahead on both deviations captured in this session.

---

## 2026-08-26 — voice-gateway STT + LLM moved from Deepgram/Claude to Groq

**Decision:** `apps/voice-gateway`'s STT (`deepgram.ts`) and LLM brain (`claude.ts`) now run on Groq (`groq-sdk`, one API key for both `whisper-large-v3-turbo` transcription and `llama-3.3-70b-versatile` tool-calling chat) instead of Deepgram's realtime STT and Anthropic Claude. Filenames kept as-is for continuity; both files now carry a header comment saying so. `FRONT_DESK_PHONE_NUMBER` is now a dynamic config var defaulting to a fake placeholder (`+15555550100`) instead of failing closed when unset.

**Why:** Asked explicitly to cut this gateway's running costs to zero extra monthly tooling beyond what's already paid for (Twilio/ElevenLabs/Cal.com). Groq's free tier covers both STT and LLM under one key. Note `@groq/sdk` (as typed in the request) doesn't exist on npm — the real package is `groq-sdk`; used that instead.

**Known tradeoff, not fully resolved:** Groq's transcription API is REST/file-based only (confirmed against its docs and the installed SDK's .d.ts) — there's no realtime streaming socket like Deepgram's. So STT now runs on a hand-rolled energy-based VAD (in `deepgram.ts`) that buffers each utterance locally and transcribes it in one shot on a silence timeout, rather than getting words as they're spoken. This adds latency (one extra full round trip per utterance vs. word-level streaming) and the VAD's energy threshold is an untested default — expected to need tuning against real phone-line audio during the first live-call test. Barge-in detection stays local/instant (no API round trip), so that shouldn't regress.

**Alternatives considered:** OpenRouter free-tier keys for the LLM half only (mentioned as a fallback option) — not used since no existing OpenRouter key was found in `.env` and Groq's SDK covers both STT and LLM under one account.

**Owner:** Will/Ed Robinson.

---

## 2026-08-29 — Production platform follows the 25 Aug brief; live ElevenLabs agent stays fallback

**Decision:** Build one multi-client Claude brain (Groq Whisper STT, ElevenLabs TTS only) in this repo (`apps/` + `packages/`). Keep the existing Smith England ElevenLabs Conversational AI agent on `+447446868067` as the live fallback until a sandbox Twilio number proves the Claude gateway. Do not cut that number over in this change. Cal.com account `hammad-muntazir-9zpmnb` remains **unverified** — tenant credentials must be confirmed in writing before treating bookings as salon-owned.

**Why:** The Developer Implementation Brief (25 Aug 2026) is the product contract. The Foundation playbook still describes Sturdy Ai handover; this build follows the brief. Groq stays for STT only; Claude is the reasoning agent.

**Alternatives considered:** Keep Groq Llama as the brain (declined). Cut over the live salon number immediately (declined — no verified live call on the new stack).

**Owner:** Contractor wrap-up; Will/Ed must confirm Cal.com identity, number forwarding, and first outbound campaign.

---

## 2026-08-29 — Groq is the production conversational brain

**Decision:** The production pipeline is Twilio → Groq Whisper STT → Groq
Llama conversational brain → Robinexis tools → ElevenLabs TTS. Preserve the
Railway hostname and migrate it incrementally from its older deployed build.
The two earlier entries on this date that selected Claude are superseded.

**Why:** The contractor confirmed this architecture after supplying the
Robinexis website and deployment description. It matches the cost and latency
strategy in the 2026-08-26 decision while retaining provider-neutral internal
interfaces.

**Alternatives considered:** Claude as the production brain (declined);
ElevenLabs managed conversation for production (kept only as the existing
salon fallback until the custom gateway passes sandbox tests).

**Owner:** Robinexis.

---

## 2026-08-29 — Production platform follows the 25 Aug brief; live ElevenLabs agent stays fallback

**Decision:** Build one multi-client Claude brain (Groq Whisper STT, ElevenLabs TTS only) in this repo (`apps/` + `packages/`). Keep the existing Smith England ElevenLabs Conversational AI agent on `+447446868067` as the live fallback until a sandbox Twilio number proves the Claude gateway. Do not cut that number over in this change. Cal.com account `hammad-muntazir-9zpmnb` remains **unverified** — tenant credentials must be confirmed in writing before treating bookings as salon-owned.

**Why:** The Developer Implementation Brief (25 Aug 2026) is the product contract. The Foundation playbook still describes Sturdy Ai handover; this build follows the brief. Groq stays for STT only; Claude is the reasoning agent.

**Alternatives considered:** Keep Groq Llama as the brain (declined). Cut over the live salon number immediately (declined — no verified live call on the new stack).

**Owner:** Contractor wrap-up; Will/Ed must confirm Cal.com identity, number forwarding, and first outbound campaign.

---

## 2026-09-07 — New customers buy Twilio; Cal.com stays on the Robinexis account

**Decision:** Phone ownership **A** — the customer purchases the Twilio number and pastes the E.164 value. Calendar ownership **B** — bookings use the shared Robinexis Cal.com API key (`CALCOM_API_KEY`), with a per-workspace calendar connection row. Do not ask each salon for a Cal.com key.

**Why:** The self-serve promise is that the only customer-owned purchase is the phone number. ElevenLabs, Cal.com, and Stripe stay on Robinexis accounts. Plan default for phone was A until chosen; “everything else automatic” selects calendar B.

**Alternatives considered:** Robinexis auto-buys Twilio numbers (needs extra purchase code). Each salon connects their own Cal.com (safer diary isolation, more onboarding friction).

**Owner:** Gulfam (implementation); Will/Ed if they want to reverse isolation later.

---

## 2026-09-14 — New tenants require isolated calendar connections

**Decision:** Supersede the 2026-09-07 shared-Cal.com default for all new tenants. New workspaces start
with `CONNECTION_REQUIRED` and never inherit the production `CALCOM_API_KEY`. Blades remains unchanged.

**Why:** A shared production credential breaks tenant isolation and could place one salon's bookings in
another account. Operator-assisted setup remains safer until dedicated staging and per-tenant connections pass.

**Alternatives considered:** Continue assigning the platform credential automatically (rejected as unsafe).

**Owner:** Robinexis launch plan; future automatic provisioning still requires explicit owner approval.

---

