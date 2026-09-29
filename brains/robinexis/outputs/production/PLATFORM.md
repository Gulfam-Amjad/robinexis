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
scale-up prerequisite. A real external Blades call and staging Stripe key
rotation remain owner actions before unsupervised pilot use. See
`deploy/railway/CLIENT-HANDOVER.md`.

## Railway hosting as of 27 September 2026

The 20 September note that deploys stay manual until a GitHub App is authorized
is superseded for the live project. `pleasing-dedication` (production) is live,
with `@robinexis/api` and `@robinexis/worker` active. The redundant
`@robinexis/web` service is sleeping because Vercel hosts production. The
unused alternate LiveKit `@robinexis/voice-runtime` service was deleted on
27 September after crash-looping without its required runtime variables. Its
gated code remains available, while live calls stay on ElevenLabs. On
29 September a corrected dedicated service was added to Railway IaC for
browser-only Cost Saver sessions; it remains a deployment candidate until both
Cost Saver canaries pass and does not alter phone routing.

> [!warning] Trial workspace
> That project is on a personal Trial workspace, not a teammate Pro workspace. The banner that
> day gave 27 days or $5.00 before Railway shuts the services down. Moving the
> project, or adding a payment method, is still undecided. Full record:
> [[brains/robinexis/wiki/concept-railway-live-deployment|Railway live deployment]].
