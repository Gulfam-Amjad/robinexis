# Robinexis SaaS readiness

Updated: 2026-09-18

## Shipped in the launch candidate

- Isolated staging: separate Supabase/Postgres, Railway API/worker, Vercel web, and Stripe sandbox.
- Verified synthetic flow: account → Stripe test-card trial → signed webhook → trialing subscription →
  assisted setup queue. A second synthetic tenant receives `404` for the first tenant.
- Tenant isolation: no inherited Cal.com credential, tenant-scoped provider event slugs, immutable call-session
  ownership, and real Postgres integration coverage.
- Billing: transactional Postgres transition, period-idempotent credits, failed/unmatched event retention,
  admin safe replay, Portal access, recovery states, and card-backed trial copy.
- Assisted setup: audited queue/in-progress/needs-attention transitions, customer note/ETA, and activation
  prerequisites. Every retry route respects `SAAS_PROVISIONING_ENABLED`.
- Identity/data: pending invitations, verified-email acceptance, resend/revoke, manager/viewer role changes,
  ownership transfer, export/deletion review requests, and immutable audit records.
- Product: API-driven operational entitlements, legal consent timestamps, support requests, security headers,
  responsive flows, and automated desktop/mobile accessibility checks.
- Communications: provider-backed email delivery with capture-only staging mode for invites, setup, payment,
  trial, and activation events. Stripe remains responsible for receipts.
- Operations: database health, Redis-backed distributed limiter with safe local fallback, structured failure
  events, scheduled public uptime checks, production dependency audit, secret scanning, migration/Postgres
  tests, staging smoke gate, and build artifacts.
- Automatic provisioning foundation: resumable onboarding jobs, reviewed website extraction, hybrid Twilio,
  connected/managed Cal.com, isolated ElevenLabs builds, readiness-only synthetic booking checks, owner-only
  two-phase activation, provider compensation, durable lifecycle mail, and client/operator control planes.
- Handover hardening: hosted environments cannot auto-seed demo tenants, API replicas do not own production
  migrations, production web builds fail closed on auth/API/Supabase configuration, browser voice CSP and
  microphone policy are explicit, and Sentry SDKs are wired without default PII.
- Outbound jobs use an explicit, feature-gated Twilio dispatcher with suppression, calling-window, idempotent
  claim, retry, and readiness checks instead of silently failing through the retired gateway path.

## Safety state

- Production revision `6647d49e4c3f` is live on Railway API/worker and the `robinexis`
  Vercel production project.
- Blades provider identity and routing were preserved. Its internal Starter trial was reconciled
  from `paused` to `trialing`, onboarding is `active`, and a fresh local-only baseline was captured.
- Blades Cal.com mappings are live for both 15- and 30-minute services. A disposable booking was
  accepted and cancelled successfully.
- The cheap LiveKit runtime is registered in production. The isolated staging room/audio canary,
  quality gate, ElevenLabs → LiveKit switch, post-call usage persistence, and rollback all passed.
- `SAAS_PROVISIONING_ENABLED=false` remains unchanged in API and worker.
- No live Stripe charge was created. Checkout verification used Stripe's `4242` test card in an isolated sandbox.
- Stripe staging checkout, portal, signed webhook, replay idempotency, subscription, and one allowance
  grant passed in test mode. Production remained in live mode and its keys were not changed.
- Production and staging remain single-replica because Redis is not provisioned.
- See `CLIENT-HANDOVER.md` for the automated gate and the separate live-provider sign-off.

## Release-gated limitations

- Automatic activation remains disabled. Paid production users continue through operator-assisted setup.
- Invitation and lifecycle requests are workflows, not destructive automation. An operator approves exports,
  ownership changes, and deletion.
- Redis code is ready, but Railway refused another resource on the current free-plan resource limit. Keep one
  API replica until Redis is provisioned and multi-instance tested.
- Supabase reports WAL archiving available but no listed backups and PITR disabled for staging and production.
  Purchase/enable the required backup tier before claiming a stronger RPO than 24 hours.

## Manual owner inputs still required

1. Rotate the staging Stripe test secret because it was shared in chat; production live keys are unaffected.
2. Upgrade Railway or provide a Redis/Upstash URL before increasing API replicas.
3. Enable Supabase backups/PITR and approve a staging restore drill.
4. Provide legal company/address/company-number/VAT/privacy/refund facts and solicitor approval.
5. Add the exact protected Blades Twilio provider resource IDs to `TWILIO_PROTECTED_RESOURCE_IDS`.
6. Repair or replace the malformed legacy Twilio verified caller ID, then complete the controlled
   inbound Blades call gate. Routing and agent probes are green, but this call must not be reported as passed yet.
7. Replace Railway's inaccessible `Gulfam-Amjad/robinexis` source with the client release branch after acceptance.
8. Apply the Framer links: Starter `/signup?plan=starter`, Pro `/signup?plan=pro`, Enterprise
   `/enterprise-contact` on `https://app.robinexis.com`.

## Future provisioning approval

Approval requires isolated provider resources, a second-tenant provision and rollback canary, verified per-tenant
credential references, idempotent retries, no Blades drift, a supervised first production provision, green health
and billing checks, and explicit owner approval before changing the flag.
