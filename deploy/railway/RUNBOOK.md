# Railway + Vercel + Supabase runbook

Create **three Railway services** from this repository (service root = repo root) and one **Vercel** project for the dashboard.

## Services

1. **gateway** — config `/railway.toml`, public domain, `$PORT`. Twilio Voice webhook: `{PUBLIC_BASE_URL}/twiml`. Media stream: `wss://{PUBLIC_HOST}/media-stream`.
2. **api** — config `/deploy/railway/api.toml`, public domain. Set `API_PORT=$PORT`. Stripe/Twilio status: `{API_PUBLIC_BASE_URL}`.
3. **worker** — config `/deploy/railway/worker.toml`, no public domain.

**Vercel** — Root Directory empty (repo root). Build uses `vercel.json`. Set `VITE_API_BASE_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. Do not put `DATABASE_URL` or service secrets on Vercel.

## Data

- **Supabase Postgres** with the `vector` extension enabled. Share `DATABASE_URL` (session/direct URI, typically port 5432) with all Railway services. Enable SSL (`DATABASE_SSL=true` is implied for supabase hosts).
- **Railway Redis** shared as `REDIS_URL`. The voice gateway requires Redis in production.

Run once after the database is reachable:

```bash
npm run db:migrate
npm run db:seed
```

The API service also runs `db:migrate` as `preDeployCommand`.

## Required Railway variables

Shared: `DATABASE_URL`, `REDIS_URL`, `GROQ_API_KEY`, `ELEVENLABS_API_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_SANDBOX_PHONE_NUMBER`, `TWILIO_SMS_NUMBER`, `GEMINI_API_KEY`.

Gateway: `PUBLIC_BASE_URL`, `FRONT_DESK_PHONE_NUMBER`, `FALLBACK_VOICEMAIL_URL`.

API: `API_PUBLIC_BASE_URL`, `WEB_ORIGIN` (Vercel origin), `SUPABASE_URL`, `SUPABASE_JWT_SECRET`, `ADMIN_EMAILS=gulfamamjad633@gmail.com`.

Worker: `PUBLIC_BASE_URL`, `API_PUBLIC_BASE_URL`, `DATA_RETENTION_DAYS`.

Never set `SKIP_AUTH=true` on Railway. Do not point the live salon number `+447446868067` at this gateway.

## Verification

Gateway `/health` must include `service`, `buildVersion`, and `architecture`. API `/health` must include `service` and `buildVersion`.

## Rollback

Use Railway’s previous successful deployment. Do not change customer Twilio routing during a code rollback.
