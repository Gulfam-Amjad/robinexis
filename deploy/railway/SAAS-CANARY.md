# SaaS conversion canary

Run this checklist at each production release gate. Do not change the Twilio routing for
`+447446868067` as part of an API or dashboard rollback.

## Before deploy

1. Run `npm run verify`.
2. Run `node scripts/verify-production-baseline.mjs`.
3. Confirm Railway reports the API and worker online. The retired voice gateway may remain failed.
4. Confirm the database migration list and export the `client_blades_hair` client row and latest
   prompt version to an encrypted/local-only backup.
5. Export the current Blades ElevenLabs agent configuration and record its version in the release
   notes. Never use that export as the template for another tenant.
6. Confirm the Cal.com credential belongs to Robinexis or the client before making a real booking.

## After additive schema or API deploy

1. `GET /health` reports the database as `ok`.
2. Anonymous `/api/v1/session` and an invalid voice-tool secret both return `401`.
3. The current admin can load the Blades workspace and only sees the expected tenant.
4. Blades remains published, `trialing` or `active`, mapped to its existing ElevenLabs agent, and
   mapped to its existing inbound number.
5. Run availability using the existing agent tool without creating a booking.
6. Confirm a signed post-call fixture is idempotent: replaying it does not add minutes or credits.

## Controlled live call gate

Run once per release candidate, during an agreed test window:

1. Call the live Blades number and verify the correct greeting and business facts.
2. Ask for availability, but create a booking only in a pre-agreed disposable slot.
3. Confirm the call appears only in the Blades dashboard and usage changes once.
4. If transfer is enabled for Blades, use only the pre-approved destination and confirm the owner
   message does not contain another tenant's data.

## Second-tenant isolation gate

1. Use a dedicated test Cal.com calendar, Twilio number, ElevenLabs agent, and transfer destination.
2. Record all external IDs before provisioning.
3. Provision twice with the same operation key; the second run must return the same resources.
4. Complete one booking and one conference transfer.
5. Verify both client views return `404` for the other tenant's call, booking, agent, and integration
   identifiers.
6. Verify Blades external IDs and config are byte-for-byte unchanged.

## Stop and rollback

Stop on mapping ambiguity, unknown calendar ownership, failed webhook verification, duplicated usage,
or any Blades drift. Disable the new read/provisioning feature flag or roll back the code deployment.
Leave additive tables in place and leave Twilio routing unchanged.
