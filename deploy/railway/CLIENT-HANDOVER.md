# Client handover release gate

This repository is handover-ready only when the automated gate below is green
and the live-provider checklist is signed off separately. Automated tests do
not prove credentials, provider dashboards, phone routing, or card settlement.

Latest run: [[HANDOVER-EVIDENCE-2026-09-18]]. Its controlled Blades phone-call
gate remains open; do not describe the release as fully handed over until that
evidence note is changed from `blocked` to `ready`.

## Automated gate

Run from a clean, committed revision on Node 24:

```sh
npm ci
npm run handover:gate
```

Production builds must set `VITE_API_BASE_URL`, `VITE_SUPABASE_URL`, and
`VITE_SUPABASE_ANON_KEY`; `VITE_SKIP_AUTH` must be false or unset.

## Release gates

- Demo tenants never auto-seed on hosted environments. Seed local fixtures only
  with `npm run db:seed`.
- Railway owns migrations through its release/start command.
  `RUN_MIGRATIONS_ON_START=false` prevents each API replica racing migrations.
- Redis is mandatory when `RATE_LIMIT_REDIS_REQUIRED=true`; `/health` remains
  non-green until the shared limiter is available.
- Provisioning, provider routing, outbound, WhatsApp, and cheap voice remain
  explicit flags. A flag is enabled only after all of its required variables
  and tenant resources pass readiness checks.
- Outbound requires `OUTBOUND_AUTOMATION_ENABLED=true`, a matching
  `OUTBOUND_ELEVENLABS_TWIML_URL` or `OUTBOUND_LIVEKIT_TWIML_URL` (the common
  `OUTBOUND_TWIML_URL` is only a fallback), `API_PUBLIC_BASE_URL`, worker
  Twilio credentials, and a tenant `outboundCallerId`. Suppression and
  calling-window checks run before every dial.
- WhatsApp requires both global flags, an entitled tenant, a unique managed
  sender, approved Twilio templates, and worker delivery credentials.
- LiveKit requires the voice-runtime service variables and a staged/active
  `livekit-cascade` deployment. Routing writes stay off until a rollback canary.

## Live-provider sign-off still required

In isolated staging, verify: Supabase login and tenant isolation; Stripe test
checkout/webhook/portal; one inbound ElevenLabs call; one LiveKit call and
rollback; one approved outbound call including status callback; WhatsApp
STOP/START plus one reminder; Cal.com booking; Redis across two API replicas;
and a database backup restore. Record provider resource IDs and results without
copying credentials into this repository.
