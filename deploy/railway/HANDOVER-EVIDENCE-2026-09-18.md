---
created: 2026-09-18
type: handover-evidence
tags:
  - release
  - saas
  - production
status: blocked
---

# SaaS handover evidence — 2026-09-18

## Deployed release

- Runtime revision: `6647d49e4c3f`.
- Production API: healthy at `https://api.robinexis.com/health`.
- Production web: Vercel deployment `dpl_3twYm7nj5NkgBzumGGcvayTqkmxZ`, target `production`.
- API and worker remain at one replica. `RATE_LIMIT_REDIS_REQUIRED=false`; Redis is required before scaling out.

## Passed gates

- Locked install, secret scan, production environment checks, builds, 310 backend tests, 46 web tests,
  and 7 voice-runtime tests passed.
- Production dependency audit reported zero vulnerabilities.
- Browser suite passed 63/66 in the parallel run; all three infrastructure-related failures passed
  when rerun serially.
- Staging contains one synthetic tenant and zero protected Blades identifiers.
- Twilio, ElevenLabs, Cal.com, and Stripe test credentials passed live staging probes.
- Stripe test checkout, portal, signed webhook, duplicate replay, subscription transition, and one
  allowance grant passed.
- Cal.com synthetic and Blades production bookings were accepted and cancelled.
- ElevenLabs synthetic simulation returned tool calls and availability.
- LiveKit registered a worker, returned audio in a real room, persisted post-call/cost events, switched
  the isolated phone route, and restored the original ElevenLabs route.
- The production comparison page is enabled. Its Cost Saver browser canary created a session,
  connected the agent, received 11 audio frames, and wrote four component cost events without changing
  phone routing.
- Blades remains mapped to agent `agent_6101m1c3n4wnfsgskgzr13w2gt9s` and number `+447446868067`.
  Its internal Starter trial is `trialing`, onboarding is `active`, and live Cal.com availability is green.

## Feature flags

- `SAAS_PROVISIONING_ENABLED=false`.
- `PROVIDER_SWITCH_ENABLED=true`.
- `PROVIDER_SWITCH_ROUTING_ENABLED=false`.
- `CHEAP_VOICE_DEFAULT_ENABLED=false`.
- Production LiveKit runtime enabled; Blades remains on `elevenlabs-convai`.
- Outbound and WhatsApp automations remain off until their tenant-specific launch gates pass.

## Open release blockers

> [!warning] Controlled phone call not yet passed
> Twilio has only the protected Blades number plus a malformed legacy verified caller ID. The self-call
> returned busy and Twilio rejected the legacy caller ID. A manual inbound call must produce exactly one
> Blades call record and one ElevenLabs usage event before status can change to `ready`.

> [!warning] Owner operations
> Rotate the staging Stripe test secret shared in chat. Provision Redis before adding replicas. Enable
> Supabase PITR/backups and complete a restore drill.

## Rollback points

- Railway API deployment before release: retain in Railway deployment history.
- Railway worker deployment before release: retain in Railway deployment history.
- Vercel production rollback: previous production deployment in project `robinexis`.
- Voice rollback: `PROVIDER_SWITCH_ROUTING_ENABLED=false`; Blades Twilio route and ElevenLabs assignment
  were not changed by the deployment.
