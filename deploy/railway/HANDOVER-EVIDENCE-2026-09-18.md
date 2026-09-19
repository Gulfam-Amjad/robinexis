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

## Cost Saver quality and memory release — 2026-09-19

- Production API deployment `01efb147-38e6-4f9a-baed-7543f00f7842` and final worker/runtime
  deployment `4fd79c8b-4ac0-48a9-bffa-18c0a7cc0b49` are healthy.
- The runtime now uses explicit Deepgram STT turn completion, fixed endpointing, and VAD interruption.
  Partial-transcript preemptive generation is disabled. This removes the LiveKit semantic inference
  subprocess that produced `ERR_IPC_CHANNEL_CLOSED` and caused silent or partial replies.
- Groq uses low reasoning, bounded completions, sequential tool calls, and an eight-step recovery
  budget. Prompts require one missing field and one question per turn, stop after the question,
  retain confirmed booking fields, and offer at most three availability choices.
- Call/tool records now load and merge by tenant plus conversation ID. Successful tool inputs and
  booking UIDs are returned as a compact in-call ledger; later corrections replace old values without
  sharing state with another call. Long LiveKit histories retain the system message and latest 28 items.
- Latency evidence now records count, latest, p50, and p95 rather than the misleading minimum.
- Automated checks passed: 326 backend tests, 50 web tests, 10 voice-runtime tests, root/web typechecks,
  and the rolling nine-stage Groq conversation evaluation. The evaluation passed unfinished speech,
  retained day/service/time/name, incomplete and corrected phone, confirmation, booking intent, and
  close at 1.887 seconds with 2,033 input and 589 output tokens. Groq scored 9/9 and remained
  selected over Gemini, which scored 8/9 at 8.220 seconds.
- Staging uses agent name `robinexis-alternate-runtime-staging`, preventing production workers from
  claiming staging jobs in the shared LiveKit project. The final spoken canary heard the complete
  interrupted request, stopped with a measured 330 ms audio gap, used one concise question, offered
  one time, and persisted call `call_06f2fbb1cb1f6b93110a891a5bd14b50`. No IPC crash occurred.
- The staging synthetic phone route was restored to ElevenLabs after the canary.
- The final production spoken canary passed on call `call_b1ce29451bea8ce08800a7db66186747`:
  full service/date/time comprehension, 391 ms interruption gap, one concise question, no long slot
  list, and no runtime provider or IPC errors.
- A separate production Cal.com canary found availability, created an accepted `15min` booking, and
  immediately cancelled it.
- The production API health endpoint returned HTTP 200 after deployment.
- Web code hides interim transcription fragments, but Vercel deployment is blocked: the signed-in
  `gulfam-amjad` account cannot access linked team `team_nmuAc2M4T93kxpePQ5to8Nst`. The live URL
  correctly redirects unauthenticated verification to `/login`; the production room/runtime was
  verified directly by the canary above.

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
