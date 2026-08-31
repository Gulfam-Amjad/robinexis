# Railway + Vercel + Supabase runbook

`railway.toml` is **deprecated**. New Railway services ignore it. Project shape lives in `.railway/railway.ts`.

```bash
npx @railway/cli login
npx @railway/cli link
npx @railway/cli config plan
npx @railway/cli config apply
```

That creates **Redis + API + voice gateway + worker** from `Gulfam-Amjad/robinexis` (Root Directory `/`). Do **not** add `@robinexis/web` on Railway — that is Vercel.

Until `config apply` has run, you can still click **Deploy** on a service created in the dashboard, but you **must** set Build Command and `RAILWAY_BUILD_TARGET` yourself — git will not apply the old toml files.

| Service | Build | Start | `RAILWAY_BUILD_TARGET` |
|---|---|---|---|
| `@robinexis/api` | `node scripts/railway.mjs api` | `node scripts/railway.mjs migrate && npm run start -w @robinexis/api` | `api` |
| `@robinexis/voice-gateway` | `node scripts/railway.mjs gateway` | `npm run start -w @robinexis/voice-gateway` | `gateway` |
| `@robinexis/worker` | `node scripts/railway.mjs worker` | `npm run start -w @robinexis/worker` | `worker` |

## Services

1. **gateway** (`@robinexis/voice-gateway`) — public domain, `$PORT`. Twilio Voice webhook: `{PUBLIC_BASE_URL}/twiml`. Media stream: `wss://{PUBLIC_HOST}/media-stream`.
2. **api** (`@robinexis/api`) — public domain. Set `API_PORT=$PORT`. Stripe/Twilio status: `{API_PUBLIC_BASE_URL}`.
3. **worker** (`@robinexis/worker`) — no public domain.

**Vercel** — Root Directory empty (repo root). Build uses `vercel.json`. Set `VITE_API_BASE_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. Do not put `DATABASE_URL` or service secrets on Vercel.

## Data

- **Supabase Postgres** with the `vector` extension enabled. Share `DATABASE_URL` (session/direct URI, typically port 5432) with all Railway services. Enable SSL (`DATABASE_SSL=true` is implied for supabase hosts).
- **Railway Redis** shared as `REDIS_URL`. The voice gateway requires Redis in production.

Run once after the database is reachable:

```bash
npm run db:migrate
npm run db:seed
```

The API start command runs `node scripts/railway.mjs migrate` before the server.

## Bulk-loading variables (no manual typing)

```bash
node scripts/railway-vars.mjs
```

Reads the local gitignored `.env` and writes `.railway-vars/{api,gateway,worker,vercel}.env` (also gitignored). For each Railway service open **Variables → Raw Editor → ENV**, paste the matching file, and press **Update Variables**. Vercel's **Import .env** accepts `vercel.env` the same way.

Anything the script cannot know is left empty and listed in the command output. Fill it before deploying:

- `SUPABASE_JWT_SECRET` — Supabase → Project Settings → API → JWT Secret (API service only)
- `VITE_SUPABASE_ANON_KEY` — Supabase → Project Settings → API → anon public key (Vercel only)
- `WEB_ORIGIN` / `VITE_API_BASE_URL` / `PUBLIC_BASE_URL` / `API_PUBLIC_BASE_URL` — the Vercel and Railway public URLs, once the domains exist
- `TWILIO_SANDBOX_PHONE_NUMBER`, `TWILIO_SMS_NUMBER`, `FRONT_DESK_PHONE_NUMBER` — a Twilio **test** number, never the live salon line `+447446868067`

`REDIS_URL` is emitted as `${{Redis.REDIS_URL}}`; rename if the Redis service is not called `Redis`. `PORT` is injected by Railway, so no port variable is set (local fallbacks: API 8081, gateway 8080).

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
