---
created: 2026-08-29
type: reference
tags: [production, platform, elevenlabs, twilio, railway, calcom]
status: active
---

# Robinexis production voice platform

The 25 August 2026 Developer Implementation Brief is the contract. Smith England is **tenant config**, not a second codebase.

## Active Blades architecture

`Caller → Twilio +447446868067 → ElevenLabs agent → authenticated Railway REST → Cal.com`

ElevenLabs owns speech, interruption, turn taking and the agent response. Railway has no audio, TwiML or WebSocket path. It keeps `/health`, the two Blades booking endpoints, product/admin APIs and non-voice background jobs.

The old Groq/Whisper voice gateway and outbound “Call Me Now” route were retired on 1 September 2026. The Railway service remains scaled to zero solely for rollback.

## Cal.com

The live ElevenLabs tools call:

- `POST /api/v1/voice-tools/check-availability`
- `POST /api/v1/voice-tools/create-booking`

Both require `x-voice-tool-secret`. Booking revalidates the slot and requires explicit confirmation, a stable ElevenLabs conversation ID and an idempotency key derived from conversation plus slot.

## Operations

See `deploy/railway/RUNBOOK.md`. Test the receptionist through the ElevenLabs widget/share link, not an outbound Railway call.
