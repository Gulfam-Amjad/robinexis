# Robinexis SaaS readiness

Updated: 2026-09-14

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

## Safety state

- Production Blades resources were not mutated. The read-only baseline is green.
- `SAAS_PROVISIONING_ENABLED=false` remains unchanged in API and worker.
- No live Stripe charge was created. Checkout verification used Stripe's `4242` test card in an isolated sandbox.
- Production was not promoted automatically; this candidate remains on `feat/multi-tenant-saas-conversion`.

## Operator-assisted limitations

- Twilio, ElevenLabs, and Cal.com creation remains disabled. Paid users enter the setup queue.
- Invitation and lifecycle requests are workflows, not destructive automation. An operator approves exports,
  ownership changes, and deletion.
- Redis code is ready, but Railway refused another resource on the current free-plan resource limit. Keep one
  API replica until Redis is provisioned and multi-instance tested.
- Supabase reports WAL archiving available but no listed backups and PITR disabled for staging and production.
  Purchase/enable the required backup tier before claiming a stronger RPO than 24 hours.

## Manual owner inputs still required

1. Claim the local Stripe staging sandbox before 2026-09-21 using the local claim command; its keys are not in git.
2. Upgrade Railway or provide a Redis/Upstash URL.
3. Provide Resend/SMTP access, sending-domain DNS, support address, alert destination, support hours, and setup SLA.
4. Enable Supabase backups/PITR and approve a staging restore drill.
5. Provide legal company/address/company-number/VAT/privacy/refund facts and solicitor approval.
6. Provide disposable staging Cal.com, Twilio, and ElevenLabs resources before automatic provisioning work.
7. Authenticate GitHub CLI or approve the normal git credential prompt so the branch and PR can be published.
8. Apply the Framer links: Starter `/signup?plan=starter`, Pro `/signup?plan=pro`, Enterprise
   `/enterprise-contact` on `https://app.robinexis.com`.

## Future provisioning approval

Approval requires isolated provider resources, a second-tenant provision and rollback canary, verified per-tenant
credential references, idempotent retries, no Blades drift, a supervised first production provision, green health
and billing checks, and explicit owner approval before changing the flag.
