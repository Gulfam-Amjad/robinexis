# SaaS operations runbook

## Current runtime constraints

- Production API rate limits require Railway Redis (`REDIS_URL`, `RATE_LIMIT_REDIS_REQUIRED=true`).
  `/health` returns 503 when the shared limiter is unavailable. Keep exactly one API replica until the
  shared limiter passes a multi-instance load test.
- `SAAS_PROVISIONING_ENABLED=false` is a release lock, not a normal configuration toggle.
- Customer onboarding queues work for an operator; they do not create Twilio, ElevenLabs or calendar resources.

## Dependency posture

- Production dependencies carry no known advisories.
- `@railway/cli` was removed as a dependency because its bundled `tar` carried a critical advisory.
  Railway scripts now invoke `npx --yes @railway/cli@latest`, so they still work without a pinned copy.
- Remaining advisories are development-only (`vitest`/`esbuild`, moderate and low). Upgrading `vitest`
  to v4 is a major bump and is deferred to a dedicated change.

## Alerts to configure

Railway:

- API health or database health is non-200 for 2 minutes.
- API 5xx rate exceeds 2% for 5 minutes.
- `stripe_reconcile_error` or `worker_tick_error` appears once.
- `notification_dead_lettered` appears once, or `notification_provider_call_failed` repeats for one
  `tenantId` + `operationId`; inspect queue age and provider failure totals in `/api/v1/admin/control-plane`.
- `retention_deleted_lifecycle_data` is absent for longer than the configured retention interval while
  terminal website facts, provider resources, jobs, or notifications exist.
- Worker `/health` is non-200 or its `lastSuccessAgeMs` exceeds `WORKER_HEALTH_STALE_MS`.
- Sentry reports a new API/worker error, elevated error rate, or provider-call regression.
- The newest verified encrypted offsite backup is older than 24 hours.
- API replica count differs from one while the local limiter is in use.

Vercel:

- Frontend deployment fails or `app.robinexis.com` returns non-200.
- Client error rate increases after a production deployment.

Stripe:

- Webhook delivery fails repeatedly.
- Subscription enters `past_due`, `unpaid` or `incomplete_expired`.

## Triage

1. Do not enable provisioning and do not mutate Blades resources.
2. Check `/health` and `/health/database`.
3. Review failed Stripe event IDs and replay only after identifying the cause; event claims are idempotent.
4. Review `/api/v1/admin/audit` and setup queue before retrying an operator action.
5. Roll back the application deployment if health regressed. Database migrations are additive and are not rolled back.
6. Re-run `node scripts/verify-production-baseline.mjs` and the read-only Blades canary.

## Releases

1. Capture the read-only Blades baseline and store only its hash/report, never credentials.
2. Run typecheck, unit tests, Postgres migrations/integration tests, Playwright accessibility/E2E, secret
   scanning, and the production-dependency audit.
3. Apply additive migrations to isolated staging, deploy API/worker/web there, and complete the synthetic
   signup, Stripe-test webhook, setup-queue, cross-tenant-denial, and billing-replay checks.
4. Promote application code only when staging, production health, and the post-release Blades hash are green.
5. Roll back application code on regression. Never reverse an additive migration in production.

## Billing recovery

1. Find the failed event in Operations and inspect its tenant, event type, and stored error.
2. Correct configuration or tenant metadata without editing the event record.
3. Use **Safe replay** once. The API retrieves the canonical event from Stripe, accepts only the billing
   lifecycle allowlist, applies tenant/subscription/credit/audit/event changes transactionally, and remains
   idempotent.
4. Escalate repeated `tenant_unmatched` events; never attach them to a guessed workspace.

## Setup and customer requests

- Move setup only through queue → in progress → needs attention. Customer notes and ETA are audited.
- Activation remains blocked while `SAAS_PROVISIONING_ENABLED=false` or provider prerequisites are absent.
- Team invites, exports, deletion, and support are pending tenant requests. Complete them only after identity,
  ownership, retention, and destination checks. A deletion request never deletes data automatically.

## Backup and restore

- Target RPO: 24 hours until Supabase PITR is purchased and verified; target RTO: 4 hours.
- Enable daily Supabase backups now. Before production scale, enable PITR and set the final RPO from the
  purchased retention window.
- Until Supabase Pro is enabled, run `npm run backup:postgres` from a locked-down scheduler with `pg_dump`
  and `age` installed. Set `BACKUP_ENVIRONMENT`, an absolute `BACKUP_OUTPUT_PATH` outside the repository
  ending in `.dump.age`, and a `BACKUP_AGE_RECIPIENT` whose private key is held separately. Production
  additionally requires `BACKUP_CONFIRM_PRODUCTION=I_UNDERSTAND_THIS_READS_PRODUCTION`.
- The script streams `pg_dump --format=custom` directly through `age`; it never writes a plaintext dump
  and never overwrites an existing artifact. Transfer the encrypted artifact to approved offsite storage,
  apply retention controls, record its checksum/timestamp, and alert if upload or freshness verification fails.
- Test decryption and restore only in isolated staging. Never place the age private key, database URL, dump,
  or decrypted output in this repository or CI artifacts.
- Quarterly staging drill: create an isolated restore project, restore the latest backup, use staging-only
  provider credentials, run migrations, tenant-isolation tests, and synthetic smoke tests, then destroy it.
- Never restore over production and never copy Blades provider credentials into a drill.

## Provisioning approval gate

Do not change the flag until staging has isolated Cal.com, Twilio, and ElevenLabs resources; a second synthetic
tenant passes provisioning and rollback; per-tenant credential references are verified; the first production
provision is supervised; and an owner explicitly approves the change.
