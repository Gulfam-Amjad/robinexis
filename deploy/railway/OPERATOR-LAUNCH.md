# Operator-assisted SaaS launch checklist

Use this after the code/test gates in this repo are green. Do **not** paste secret values into git, chat, or tickets.

## What Cursor already shipped in code

- Migration `007_lock_schema_migrations.sql` revokes `anon` / `authenticated` on `schema_migrations`.
- Unsigned Stripe webhooks return `{ ok: false }` (API status **400**), not 500.
- Worker logs `worker_misconfigured` / `stripe_reconcile_skipped` when `STRIPE_SECRET_KEY` is missing; retention still runs.
- Blades repair is a **dry-run** script until you set `CONFIRM_REPAIR_BLADES_TENANT=true`.

## You must do in dashboards (Cursor cannot)

### 1. Apply the migration

Railway API start already runs migrate. After this commit is deployed:

`GET https://robinexisapi-production-3836.up.railway.app/health` should stay `checks.database: ok`.

Then confirm the anon key can no longer read migrations (expect 401/403):

`GET {SUPABASE_URL}/rest/v1/schema_migrations?select=id`

### 2. Stripe (test mode first)

1. Dashboard → Product catalog: Starter **£99/mo** and Pro **£249/mo**.
2. Copy the Price IDs (`price_…`) into Railway **API**:

```json
{"starter":"price_REPLACE_STARTER","pro":"price_REPLACE_PRO"}
```

Variable name: `STRIPE_PRICE_IDS_JSON`

3. Register webhook: `POST https://robinexisapi-production-3836.up.railway.app/webhooks/stripe`  
   Events: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`.
4. Paste signing secret into Railway API `STRIPE_WEBHOOK_SECRET`.
5. Paste the **same** `STRIPE_SECRET_KEY` onto Railway **worker** (IaC already lists the name; the live worker was empty).

A POST with no `Stripe-Signature` must return **400**.

### 3. Blades live booking (only if you want the salon answering + booking)

Today production is `published` but `serviceStatus: paused`, so availability returns `403 service_unavailable`.

Dry-run (no writes):

```bash
DEDUPE_SERVICES=true BLADES_SERVICE_STATUS=active node scripts/repair-blades-tenant.mjs
```

Apply only after you read the JSON plan:

```bash
CONFIRM_REPAIR_BLADES_TENANT=true DEDUPE_SERVICES=true BLADES_SERVICE_STATUS=active node scripts/repair-blades-tenant.mjs
```

Then probe availability with the live `VOICE_TOOL_SECRET` (do not commit it). Do not change Twilio routing for `+447446868067`.

### 4. Staging (required before self-serve)

Create a **second** Supabase project, Railway environment (or project), Vercel Preview, Stripe **test** webhook, Cal.com test calendar, ElevenLabs test agent. There is only production today; do not run signup/checkout/booking write tests against live Blades.

### 5. First paying client (operator path)

Keep `SAAS_PROVISIONING_ENABLED=false` until staging checkout works.

1. Sign in as an `ADMIN_EMAILS` operator.
2. `/admin/clients/new` — create the salon tenant.
3. Publish prompt, connect Cal.com credential **ref** (env name, not raw key).
4. When you are ready for auto ElevenLabs/Twilio: set `SAAS_PROVISIONING_ENABLED=true` on the API, then provision from admin.

### 6. Optional ops

- Supabase: enable PITR / confirm backups.
- Vercel / Framer: add CSP and `X-Frame-Options`.
- `gh auth login` if you want CI on `main` inspected from this machine.

## Env names (no values)

| Where | Names |
|---|---|
| Vercel | `VITE_API_BASE_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SKIP_AUTH=false` |
| Railway API | `DATABASE_URL`, `REQUIRE_DATABASE`, `WEB_ORIGIN`, `ADMIN_EMAILS`, `SUPABASE_*`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_IDS_JSON`, `VOICE_TOOL_SECRET`, `ELEVENLABS_WEBHOOK_SECRET`, `CALCOM_*` |
| Railway worker | `DATABASE_URL`, `STRIPE_SECRET_KEY`, `WORKER_POLL_MS`, `DATA_RETENTION_DAYS` |
