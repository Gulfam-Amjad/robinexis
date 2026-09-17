# Robinexis production platform

The dashboard (`apps/web`) deploys to **Vercel**. The API, voice gateway, and worker deploy to **Railway**. Tenant data lives in **Supabase Postgres** (pgvector). Live call slots use **Redis**.

Do **not** point `+447446868067` at this gateway.

## Local

```bash
cp .env.example .env
docker compose up -d
npm install
npm run db:migrate
npm run db:seed
npm run dev:api
npm run dev:gateway
npm run dev:web
```

| Process | Command | Port |
|---|---|---|
| Dashboard | `npm run dev:web` | 5173 |
| API | `npm run dev:api` | 8081 |
| Voice gateway | `npm run dev:gateway` | 8080 |
| Worker | `npm run dev:worker` | — |

Set `VITE_API_BASE_URL=http://localhost:8081` when the Vite proxy is not used. Leave it empty in local Vite to use `/api` and `/demo` proxies.

`SKIP_AUTH=true` and `VITE_SKIP_AUTH=true` open the product locally. They are ignored in production (`RAILWAY_ENVIRONMENT` or `NODE_ENV=production`). Production API verifies Supabase JWTs and allowlists `ADMIN_EMAILS`.

## Production

See [deploy/railway/RUNBOOK.md](deploy/railway/RUNBOOK.md).

```bash
npm run verify
```
