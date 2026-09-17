---
created: 2026-09-17
type: handoff
status: in-progress
---

# Handoff — Cost Saver voice runtime

## Done

- Added the parallel Cost Saver pipeline: Deepgram Nova-3 STT, Groq brain and
  ElevenLabs Flash TTS. Premium ElevenLabs ConvAI is unchanged.
- Added staged-runtime config, tenant-derived tool credentials, signed post-call
  ingestion, estimated component cost events, Twilio-signed SIP TwiML, and
  idempotent LiveKit trunk/unique-room dispatch provisioning.
- Deployed API, Vercel admin labels, migration 025, and the LiveKit runtime.
  Railway's free two-resource limit is handled by supervising voice-runtime
  inside `@robinexis/worker`.
- Live checks passed: Groq completion, ElevenLabs synthesis, Deepgram
  transcription, LiveKit registration, dark room agent join/greeting,
  authenticated config/tool boundary, completed post-call and usage telemetry.
- Full verify passed (252 unit/integration tests + 42 web tests), dedicated
  runtime tests passed, and 63 Playwright E2E tests passed.

## In flight

- Cost Saver is dark but connected. `PROVIDER_SWITCH_ROUTING_ENABLED=false` and
  `CHEAP_VOICE_DEFAULT_ENABLED=false`.
- Blades remains on `https://api.elevenlabs.io/twilio/inbound_call`.

## Next actions

1. Add a non-Blades Twilio sandbox number and active phone endpoint.
2. Connect that tenant's Cal.com credential; Flourish currently returns
   `tenant_calendar_credential_required`.
3. Prepare Cost Saver in Admin, run a supervised booking call, store a passing
   launch gate, then enable routing only for that non-protected tenant.
4. Upgrade Railway before splitting voice-runtime into a dedicated service.

## Open threads / blockers

- Twilio owns only the protected Blades number; no safe telephony canary exists.
- Flourish lacks a tenant calendar credential, so its production booking tool
  correctly fails closed.

## Watch-outs

- Never use Blades for an unsupervised canary or enable cheap defaults yet.
- Rotate any LiveKit key previously pasted into chat; worker currently uses the
  credential set that successfully registered.
