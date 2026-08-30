---
created: 2026-08-29
type: reference
tags: [production, platform, groq, twilio]
status: scaffolding
---

# Robinexis production platform (self-hosted)

The 25 August 2026 Developer Implementation Brief is the contract. Smith England is **tenant config**, not a second codebase.

## Two stacks — do not mix on the live number

| Path | Brain | Number | Role now |
|---|---|---|---|
| Option 1 — ElevenLabs Conversational AI | ElevenLabs STT + brain + TTS | `+447446868067` | **Live — do not change routing** |
| Option 2 — `apps/voice-gateway` | Groq Whisper STT + Groq Llama + ElevenLabs TTS | `TWILIO_SANDBOX_PHONE_NUMBER` + tenant `robinexis-demo` | Local Demo Call at API `GET /demo` |

Pointing the live salon/Robinexis number at custom `/twiml` while ElevenLabs still owns the webhook will drop or split calls.

Local test: `GET /demo` on the API (`:8081`) posts to `POST /demo/call`, which places an outbound call from the sandbox number only. Embedding on robinexis.com is deferred until that site’s source is available.

## Cal.com

The **demo** tenant uses sandbox `CALCOM_USERNAME` / `CALCOM_API_KEY` via credential refs. Do not attach the live salon calendar to `robinexis-demo`. Smith England live Cal.com remains on the ElevenLabs agent tools, not this seed.

## Local run

See repo root `README-PLATFORM.md`.
