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

## Commercial and legal state

As of 20 September 2026, Starter is £99 GBP/month and Pro is £199 GBP/month. Stripe, the
public plans API, checkout and both billing UIs use the same catalog. The former £249 Pro
Price is archived; no existing Pro subscriptions required migration when the new price went live.

The app publishes ROBINEXIS LTD company number 16468366 and its registered office at
71-75 Shelton Street, Covent Garden, London, WC2H 9JQ. General and support enquiries use
`info@robinexis.com`; privacy and data-rights requests use `privacy@robinexis.com`.

## Controlled pilot state

As of 20 September 2026, revision `cc21223` passed the clean handover gate and
the production Cost Saver audio/conversation canaries. The pilot is frozen to
one API replica: Blades remains on ElevenLabs, while Cost Saver is browser-only.
Provisioning, provider-routing writes, outbound and WhatsApp remain off. Redis
is required before adding API replicas.

An encrypted logical snapshot was taken and verified. Supabase PITR remains a
scale-up prerequisite. Railway and Vercel GitHub Apps still need repository
authorization; until then deployments remain manual. A real external Blades
call and staging Stripe key rotation remain owner actions before unsupervised
pilot use. See `deploy/railway/CLIENT-HANDOVER.md`.
