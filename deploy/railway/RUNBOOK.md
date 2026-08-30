# Railway + Vercel + Supabase runbook

Create **three Railway services** from this repository (API, voice gateway, worker). Prefer **Root Directory = `/`** (repo root).

Because there is only one root `railway.toml`, **each service must set `RAILWAY_BUILD_TARGET`**:

| Service | `RAILWAY_BUILD_TARGET` |
|---|---|
| `@robinexis/api` | `api` |
| `@robinexis/voice-gateway` | `gateway` |
| `@robinexis/worker` | `worker` |
| `@robinexis/web` (optional fallback) | `web` |

Do **not** leave the dashboard Build Command as `node scripts/railway.mjs gateway` on every service. Either clear the override so the repo `railway.toml` is used, or set the command to `node scripts/railway.mjs` and rely on `RAILWAY_BUILD_TARGET`.

If Railway imported npm workspaces and set Root Directory to `apps/api` (and similar), leave that: each app has its own `railway.toml` that installs from the monorepo root.

Do **not** put the dashboard on Railway unless you need a fallback. Prefer Vercel for `@robinexis/web`.

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

The API service also runs `db:migrate` as `preDeployCommand`.

## Bulk-loading variables (no manual typing)

```bash
node scripts/railway-vars.mjs
```

Reads the local gitignored `.env` and writes `.railway-vars/{api,gateway,worker,vercel}.env` (also gitignored). For each Railway service open **Variables → Raw Editor → ENV**, paste the matching file, and press **Update Variables**. Vercel's **Import .env** accepts `vercel.env` the same way.

Anything the script cannot know is written as `TODO_…` so a half-configured service fails loudly. Replace before deploying:

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
