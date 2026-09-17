# Robinexis isolated staging

Staging must use separate Supabase, Stripe test-mode, Twilio, ElevenLabs, and Cal.com resources.
Never clone production variables into a staging environment.

Required release path:

1. Create a separate Supabase project and database.
2. Create Railway `staging` API and worker variables from `env.example`.
3. Use Stripe `sk_test_` prices and a staging-only webhook endpoint.
4. Use only synthetic tenant IDs beginning `client_stage_`.
5. Run `node scripts/verify-staging-env.mjs deploy/staging/env.local`.
6. Run migrations, tests, checkout, webhooks, and assisted onboarding.
7. Compare the production Blades baseline before any production promotion.

Automatic SaaS provisioning stays disabled in staging until the second-tenant isolation checklist
in `deploy/railway/SAAS-CANARY.md` passes with dedicated external resources.
