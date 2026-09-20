# Client pilot handover

Status on 20 September 2026: **ready for a controlled, limited-user pilot**,
subject to the two owner actions in [[HANDOVER-EVIDENCE-2026-09-18]]. This is
not approval for a multi-replica or unsupervised general-availability launch.

## Production entry points

- Web: https://app.robinexis.com
- API health: https://api.robinexis.com/health
- Admin provider comparison: https://app.robinexis.com/admin/provider-comparison
- Support and billing: info@robinexis.com
- Privacy requests: privacy@robinexis.com

## Frozen pilot configuration

- One API replica and one worker replica.
- `RATE_LIMIT_REDIS_REQUIRED=false`; Redis is intentionally absent for this
  single-replica pilot and is mandatory before adding API replicas.
- `SAAS_PROVISIONING_ENABLED=false`.
- `CHEAP_VOICE_DEFAULT_ENABLED=false`.
- `PROVIDER_SWITCH_ROUTING_ENABLED=false`.
- `OUTBOUND_AUTOMATION_ENABLED=false`.
- `WHATSAPP_ENABLED=false` and `WHATSAPP_BRAIN_PROCESSOR_ENABLED=false`.
- Blades stays on ElevenLabs Premium. Cost Saver is available only through the
  signed-in comparison/browser flow; no telephone route points to Cost Saver.
- Pro is £199 GBP/month. Legal and support links use ROBINEXIS LTD details.

## Daily operator checks

1. Open the API health URL and require `"status":"ok"`.
2. Confirm the Railway API and worker each show one healthy replica.
3. Review worker logs for `worker_start`, `stripe_reconcile`, provider errors,
   and repeated voice-runtime restarts.
4. Review Sentry for new API, worker, web, or voice-runtime errors.
5. Before a client demonstration, test the comparison page with a headset and
   confirm only one voice card can own the microphone.

## Release and rollback

Run the release gate from a clean Node 24 checkout:

```sh
npm ci
npm run handover:gate
```

Current rollback identifiers:

- Source revision: `cc21223`.
- Railway API: `64787ea4-fcdf-4415-8def-2bfa274dfda2`.
- Railway worker: `3ef2a431-3e44-4891-b1a2-8f96821ff994`.
- Vercel web: `dpl_5pnZXyPbEXH3eQ7RY3kJXrTX4Znj`.
- Previous Vercel production URL:
  `https://robinexis-a3f0aljzg-web-services2.vercel.app`.

For application rollback, redeploy the retained Railway deployment for the
affected service and promote the retained Vercel deployment. Do not alter
database data or phone routing during an application rollback. Voice rollback
is the frozen state above: provider-routing writes off, Blades on
`elevenlabs-convai`.

Railway and Vercel are currently healthy but source-less. Their GitHub Apps
must be granted access to `robinexisbackend-sys/robinexis_code`, then connected
to `main`; CLI linking was denied until that organization authorization exists.
Until then, releases are manual and must record the deployed revision.

## Recovery

- Encrypted pre-handover logical snapshot:
  `C:\Users\Gulfam\Documents\robinexis-production-pre-handover-2026-09-20.jsonl.age`.
- Decryption identity:
  `C:\Users\Gulfam\.robinexis-backup-age-key.txt`.
- Store the encrypted snapshot and identity in separate approved locations.
  Never commit either file.
- Snapshot SHA-256:
  `db4ef578bb2f0d174255d136333407338ac96cd302a68d00071bc81f21c01633`.
- Supabase reports PITR disabled. Enabling PITR and completing a timed restore
  drill is required before production-scale launch.

## Credential ownership checklist

Record named human owners in the client's password manager; never copy secret
values into this repository.

- [ ] GitHub organization and repository — Robinexis owner
- [ ] Railway production and staging projects — Robinexis owner
- [ ] Vercel `WebServices/robinexis` project — Robinexis owner
- [ ] Supabase production and staging projects — Robinexis owner
- [ ] Stripe live and test accounts — Robinexis finance owner
- [ ] Twilio account and phone numbers — Robinexis telephony owner
- [ ] ElevenLabs account and agents — Robinexis voice owner
- [ ] Cal.com account and event types — Robinexis scheduling owner
- [ ] LiveKit project — Robinexis voice owner
- [ ] Deepgram project — Robinexis voice owner
- [ ] Groq project — Robinexis voice owner
- [ ] Resend domain and API access — Robinexis communications owner
- [ ] Sentry organization and alert recipients — Robinexis technical owner

Each owner must have MFA, recovery codes, billing access, and one named backup
owner. Rotate access immediately when an operator leaves.

## Scale-up prerequisites

These are not blockers for the controlled pilot, but are blockers for broader
launch:

- Shared Redis and a two-replica rate-limit/failover test.
- Supabase PITR plus a documented restore drill.
- Solicitor review of Terms, Privacy, DPA, GDPR and Cookie wording.
- Separate launch gates for outbound calling and WhatsApp.
- A dedicated non-Blades telephony sandbox for automated call acceptance.
- GitHub App authorization and automatic deployment ownership.
