# Railway REST API runbook

Twilio and ElevenLabs communicate directly for live speech. Railway never receives raw audio and has no WebSocket or TwiML role.

```text
Caller → Twilio → ElevenLabs → authenticated Railway REST → Cal.com
```

## Active services

| Service | Purpose | Build | Start |
|---|---|---|---|
| `@robinexis/api` | `/health`, tenant-bound booking tools, product APIs, signed provider webhooks | `node scripts/railway.mjs api` | `node scripts/railway.mjs migrate && node scripts/railway.mjs start` |
| `@robinexis/worker` | Stripe reconciliation, retention, and gated provisioning retries | `node scripts/railway.mjs worker` | `npm run start -w @robinexis/worker` |

The public API is `https://robinexisapi-production-3836.up.railway.app`.

- `GET /health`
- `POST /api/v1/voice-tools/check-availability`
- `POST /api/v1/voice-tools/create-booking`
- `POST /webhooks/elevenlabs/post-call`
- `POST /webhooks/stripe`

Register the Stripe **test-mode** webhook at:

`https://robinexisapi-production-3836.up.railway.app/webhooks/stripe`

That URL is not pre-registered in Stripe. After deploy, a POST without a valid `Stripe-Signature` should return 400. Then add the endpoint in the Stripe Dashboard (test) for `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, and `invoice.payment_failed`. Paste the signing secret into Railway `STRIPE_WEBHOOK_SECRET`. Create Starter (£99/mo) and Pro (£249/mo) Prices in the test product catalog and set `STRIPE_PRICE_IDS_JSON`. Copy the same `STRIPE_SECRET_KEY` onto the worker. Operator launch steps live in [OPERATOR-LAUNCH.md](./OPERATOR-LAUNCH.md).

Both booking routes require `x-voice-tool-secret`. `VOICE_TOOL_SECRET` remains bound to Blades for compatibility. New tenants use one unique secret each in `VOICE_TOOL_SECRETS_JSON`, shaped as `{"client_id":"long-unique-secret"}`; the request body cannot choose its tenant. ElevenLabs post-call events require a valid `ElevenLabs-Signature` generated with `ELEVENLABS_WEBHOOK_SECRET`.

Keep all webhook, calendar, Supabase and database credentials on Railway only. Product JWTs are resolved into either a Robinexis operator or tenant-scoped salon membership. Database tables are API-only: browser Supabase roles have no direct table grants. Migration `007` also locks `schema_migrations` (no anon/authenticated grants).

## Deploy

```bash
node scripts/railway-vars.mjs
node scripts/railway-setup.mjs
node scripts/railway-setup.mjs --apply
```

Review the IaC plan before applying it. `.railway/railway.ts` now describes only the active API and worker. The retired gateway service is intentionally retained outside IaC as a rollback shell; do not let a config apply delete it.

Before applying, create a paid Railway Redis resource and expose its private `REDIS_URL` to both services.
The API has `RATE_LIMIT_REDIS_REQUIRED=true`: `/health` intentionally returns 503 if Redis is absent or
unhealthy. Do not add API replicas until a shared-rate-limit load test passes. Paid Railway provisioning,
Redis creation, variables, alert rules, and replica settings remain manual operations.

Paste secrets through Railway Variables, never into IaC. Required safety contracts are `DATABASE_URL`,
`REDIS_URL`, `SENTRY_DSN`, Resend (`RESEND_API_KEY`, `NOTIFICATION_FROM_EMAIL`), Firecrawl
(`FIRECRAWL_API_KEY`), and the Cal.com existing-account and Platform OAuth variables documented in
`.env.example`. Keep `SAAS_PROVISIONING_ENABLED=false`.

## Verify

1. `GET /health` returns `status: ok`, `service: api`, a build version and `checks.database: ok`.
2. The worker `GET /health` returns `status: ok` after its first successful tick; Railway marks a stale loop unhealthy.
3. An invalid `x-voice-tool-secret` receives `401`.
4. Availability returns only Cal.com slots.
5. Booking requires the system conversation ID, explicit confirmation and a still-free slot.
6. Repeating the same conversation/slot returns the original booking UID.
7. A signed ElevenLabs transcription webhook creates or updates the call under the tenant mapped by `agent_id`; an unknown agent is ignored.
8. A salon user can only list workspaces in `workspace_memberships`; operators can switch across all tenants.
9. Twilio `+447446868067` remains assigned to ElevenLabs, not Railway.

## Retired gateway rollback

Retired 1 September 2026:

- Former Railway service: `@robinexis/voice-gateway`
- Service ID: `652fb60c-b080-4129-a2f8-806ed68046a0`
- Last successful deployment: `c752a7dc-e207-46c1-b501-6a339499f317`
- Final stopped deployment: `d1424787-a954-4972-8c80-947b2277b412` (`FAILED`, stopped)
- Last domain: `https://robinexisvoice-gateway-production.up.railway.app`
- Retirement action: stopped and disconnected on 1 September, then deleted on
  16 September 2026 after confirming the source had been removed and the live
  path remained Twilio → ElevenLabs → Railway API tools.

The redundant `@robinexis/web` Railway service was also deleted on 16 September
2026. Production web hosting remains Vercel at `app.robinexis.com`. These
deletions attempted to free a Railway resource slot for Redis; the free-plan
resource limit still blocked Redis creation, so a Railway plan upgrade remains
required.

Do not restore this during an ordinary API rollback. If an emergency audio rollback is explicitly approved:

1. Restore the removed `apps/voice-gateway` code from git history.
2. Reconnect `Gulfam-Amjad/robinexis` only after restoring the gateway code at a rollback commit.
3. Restore its old Railway build/start variables and secrets from Railway history, redeploy, and verify `/health`.
4. Only then change a sandbox Twilio number. Never move `+447446868067` without a separate controlled cutover.

The current voice rollback is safer: select the previous ElevenLabs agent version and leave Twilio routing unchanged.

## Alternate LiveKit runtime (disabled until gated)

`apps/voice-runtime` is an isolated LiveKit Agents worker for the `livekit-cascade`
provider. On the free two-resource Railway plan it runs as a separately
supervised process inside the existing `@robinexis/worker` service. The normal
worker remains independent; if either process fails Railway restarts the
service. It does not change Twilio, ElevenLabs, or production dispatch merely by
starting, and it exits before connecting unless `VOICE_RUNTIME_ENABLED=true`.

For local verification use:

```bash
npm install
npm run typecheck -w @robinexis/voice-runtime
npm test -w @robinexis/voice-runtime
npm run start -w @robinexis/voice-runtime
```

Copy only the alternate-runtime variables documented in `.env.example` to the
Railway worker service (or a future dedicated runtime service). Set
`VOICE_RUNTIME_API_BASE_URL` to the authenticated API origin. The
API and runtime share `VOICE_RUNTIME_INTERNAL_SECRET` for published-config reads
and `VOICE_RUNTIME_SIGNING_SECRET` for timestamped HMAC-SHA256 post-call events.
Tenant voice-tool credentials remain server-bound in `VOICE_TOOL_SECRETS_JSON`;
they are never accepted in job metadata or audio.

Dispatch metadata must be trusted control-plane JSON with exactly the operational
identity needed by the worker:

```json
{
  "tenantId": "tenant-id",
  "providerJobId": "provider-job-id",
  "direction": "inbound",
  "objective": "Receptionist call"
}
```

`clientId` is rejected. The runtime derives a stable provider-neutral call ID
from the provider, tenant, and provider job ID. It loads only published config
from `GET /internal/voice-runtime/config/:tenantId`, calls the existing
tenant-authenticated `/api/v1/voice-tools/*` routes, and sends normalized usage,
latency, transcript, and tool history to
`POST /internal/voice-runtime/post-call`. LiveKit session recording and framework
log/transcript upload are disabled; application logs redact secrets and call
content.

Preparing a LiveKit deployment creates/reuses a tenant-bound SIP inbound trunk
and unique-room dispatch rule but does not change Twilio. Before any phone test,
run a LiveKit room dispatch with no production number attached. Roll back the
runtime by setting `VOICE_RUNTIME_ENABLED=false`; production routing remains
Twilio → ElevenLabs until the audited provider switch is explicitly confirmed.

## Dual-provider quality rollout

Keep `PROVIDER_SWITCH_ROUTING_ENABLED=false` throughout benchmark evaluation.
The quality endpoint only calculates and stores evidence; it must not provision,
dispatch, attach a number, or call a provider adapter.

1. **Local/mock:** set `PROVIDER_SWITCH_ENABLED=true` and
   `PROVIDER_QUALITY_EVALUATION_ENABLED=true`; keep runtime and routing false.
   Run deterministic evaluator, API authorization, idempotency and scenario tests.
2. **Sandbox:** run the UK salon fixtures against isolated provider deployments.
   Import baseline/candidate metrics and confirm every check passes. Keep all
   production and protected numbers detached.
3. **Demos:** repeat blind voice and booking scenarios on internal demo tenants.
   Re-evaluate before `PROVIDER_LAUNCH_GATE_MAX_AGE_HOURS` expires.
4. **One canary:** obtain operator approval, verify rollback snapshot/confirmation,
   then enable `PROVIDER_SWITCH_ROUTING_ENABLED=true` only for the controlled
   switch window. Preview must show a recent stored passing gate.
5. **Broader:** review canary failed-call, booking and latency telemetry before
   each expansion. Evaluate and store a fresh gate for every staged deployment.

Any missing, failed, malformed, future-dated or stale LiveKit gate blocks preview
and start even when provider health is green. Disable routing first to stop the
rollout; rollback via the recorded source snapshot when required.
