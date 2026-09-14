# SaaS operations runbook

## Current runtime constraints

- API rate limits are process-local. Keep the API at exactly one replica until a shared Redis-compatible
  limiter is configured and tested.
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
- `stripe_webhook_failed`, `worker_iteration_failed` or `schema_migration_failed` appears once.
- Worker has no successful reconciliation log for 10 minutes.
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
