---
created: 2026-09-20
type: handoff
status: complete
---

# Handoff — legal and £199 Pro release

## Done

- Published ROBINEXIS LTD company details and the Privacy, Terms, GDPR, Cookie
  and DPA routes in the SaaS; support uses `info@robinexis.com` and privacy uses
  `privacy@robinexis.com`.
- Changed Pro from £249 to £199 GBP/month throughout code, UI, docs and Stripe.
- Created the live £199 recurring Stripe Price, made it the Pro product default,
  updated API/worker mappings and archived the old £249 Price.
- The migration found no existing Pro subscriptions, so no customer proration
  invoice was created.
- Deployed Railway API `64787ea4-fcdf-4415-8def-2bfa274dfda2`, worker
  `3ef2a431-3e44-4891-b1a2-8f96821ff994`, and Vercel
  `dpl_5pnZXyPbEXH3eQ7RY3kJXrTX4Znj`.
- Live checks confirmed API `19900` GBP, Checkout `19900` GBP, the marketing
  site £199 headline, production legal content and correct footer links.
- Passed 327 backend tests, 50 web tests, seven new browser tests, typecheck,
  backend builds, secret scan, dependency audit and lint.

## In flight

- None for this release.

## Next actions

1. Ask a solicitor to review the published service terms and privacy wording.
2. Keep Stripe price mappings on API and worker aligned if another plan price changes.
3. Continue the separate Cost Saver launch gate using a non-Blades sandbox number.

## Open threads / blockers

- No blocker for legal pages or £199 checkout.
- Existing Cost Saver telephony constraints remain separate from this release.

## Watch-outs

- The migration script is dry-run by default. Live changes require the exact
  `IMMEDIATE_PRORATED_199_GBP` confirmation.
- Do not reactivate the archived £249 Stripe Price or point
  `STRIPE_PRICE_IDS_JSON.pro` back to it.
