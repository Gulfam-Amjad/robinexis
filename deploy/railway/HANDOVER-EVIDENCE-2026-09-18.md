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
- Cost Saver quality source revision: `3afab8c`.
- Production API: healthy at `https://api.robinexis.com/health`.
- Production API deployment: `3720ac64-e6b1-446e-ab3a-c9538c6a468d`.
- Production worker/runtime deployment: `cf7d316f-0525-48a2-9aa3-dfdd5e728a7e`.
- Production web: Vercel deployment `dpl_6D3jKnUQLhXdfrPTbf1RtLBBXFTe`, target `production`.
- API and worker remain at one replica. `RATE_LIMIT_REDIS_REQUIRED=false`; Redis is required before scaling out.

## Passed gates

- Locked install, secret scan, production environment checks, builds, 312 backend tests, 49 web tests,
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
- The comparison page now uses a synchronous exclusive microphone lease. A second provider start is
  rejected before permission/session creation, and disabling either card forces its connecting or live
  session to release microphone and audio.
- The compact Cost Saver prompt and voice-only tool schemas reduced the measured Groq input from the
  observed 2,800–3,000 tokens per turn to 1,805 tokens. The live five-case Blades evaluation passed
  availability, silence recovery, incomplete-phone handling, confirmed booking intent, and clean close;
  Groq remained selected at 1.4 seconds model latency and no additional provider cost.
- The stale Google fallback model was updated from unavailable `gemini-2.5-flash` to
  `gemini-3.6-flash`. It was not selected because its benchmark endpoint reported temporary high demand.
- Booking tools now reject incomplete UK/Pakistan numbers before Cal.com, return structured validation
  errors to the voice model, preserve service/time across unclear speech, and forbid claiming success
  until a booking UID exists.
- The staging switch/room/rollback canary connected the agent, received 25 audio frames, and restored
  the synthetic ElevenLabs route. A stale ElevenLabs phone identifier exposed a rollback replay gap;
  provider-resource upserts and failed rollback retries are now idempotent, and the rerun passed.
- The production comparison page is enabled. Its Cost Saver browser canary created a session,
  connected the agent, received 10 audio frames, and wrote four component cost events without changing
  phone routing.
- Cost Saver calls initially failed in the browser with `Client initiated disconnect`: the web CSP
  allowed ElevenLabs but not LiveKit, so the signal socket was blocked. `connect-src` now allows
  `https://*.livekit.cloud` and `wss://*.livekit.cloud`. Verified on `https://app.robinexis.com`: a
  WebSocket to `robin-rq64w99n.livekit.cloud` raises no policy violation, while a control host still
  reports a `connect-src` violation. `npm run check:live-csp` guards the deployed header and
  `npm run check:csp-api-origin` guards `vercel.json` at build time.
- Blades remains mapped to agent `agent_6101m1c3n4wnfsgskgzr13w2gt9s` and number `+447446868067`.
  Its internal Starter trial is `trialing`, onboarding is `active`, and live Cal.com availability is green.
  A post-release disposable booking was accepted and immediately cancelled.

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

> [!note] Signed-in Cost Saver click-through
> The CSP block is fixed and proven from the production origin, but the final signed-in conversation on
> `/admin/provider-comparison` needs an operator session with microphone permission.

> [!warning] Owner operations
> Rotate the staging Stripe test secret shared in chat. Provision Redis before adding replicas. Enable
> Supabase PITR/backups and complete a restore drill.

## Rollback points

- Railway API deployment before release: retain in Railway deployment history.
- Railway worker deployment before release: retain in Railway deployment history.
- Vercel production rollback: previous production deployment in project `robinexis`.
- Voice rollback: `PROVIDER_SWITCH_ROUTING_ENABLED=false`; Blades Twilio route and ElevenLabs assignment
  were not changed by the deployment.
