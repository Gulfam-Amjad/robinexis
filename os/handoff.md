---
created: 2026-09-20
type: handoff
status: complete
---

# Handoff — controlled pilot closeout

## Done

- Promoted the verified release and pilot closeout commits to `client/main`;
  final validated revision is `cc21223`.
- Froze one-replica production flags: self-serve provisioning, cheap-default
  routing, provider-routing writes, outbound and WhatsApp are off.
- Confirmed Blades stays on ElevenLabs; Cost Saver remains browser-only.
- Passed production Cost Saver browser and spoken canaries, including audio,
  interruption, concise response, transcript and clean disconnect.
- Created and decrypted an encrypted pre-handover logical snapshot outside the
  repository. Supabase currently has no PITR.
- Live Pro Checkout resolved to £199 GBP and was expired. Health, legal routes,
  worker startup/reconciliation and live CSP passed.
- Clean Node 24 gate passed: 327 backend, 50 web, 11 voice-runtime and 73
  browser tests; zero production dependency vulnerabilities.
- Updated [[deploy/railway/CLIENT-HANDOVER]] and
  [[deploy/railway/HANDOVER-EVIDENCE-2026-09-18]].

## In flight

- None that an agent can complete without account-owner or external-phone
  access.

## Next actions

1. From an external phone, call `+447446868067`, complete a short conversation,
   then verify exactly one Blades call record and one ElevenLabs usage event.
2. Rotate the staging Stripe test secret in Stripe and update staging API and
   worker only.
3. Grant Railway and Vercel GitHub Apps access to
   `robinexisbackend-sys/robinexis_code`, then connect both projects to `main`.
4. Store the encrypted snapshot and age identity in separate approved storage.

## Open threads / blockers

- Railway and Vercel reject Git source linking until their GitHub Apps receive
  private-repository access.
- Twilio has no valid separate verified caller ID for an automated inbound
  Blades call.
- Stripe standard secret-key rotation requires the account-owner dashboard.

## Watch-outs

- Do not add API replicas until shared Redis is configured and tested.
- Do not route the protected Blades number to Cost Saver during acceptance.
- Do not commit the backup, its age identity, or any provider credential.
- Wider launch still requires Supabase PITR/restore drill, solicitor review,
  outbound/WhatsApp gates and a dedicated telephony sandbox.
