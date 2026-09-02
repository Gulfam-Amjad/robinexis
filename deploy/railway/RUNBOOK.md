# Railway REST API runbook

Twilio and ElevenLabs communicate directly for live speech. Railway never receives raw audio and has no WebSocket or TwiML role.

```text
Caller → Twilio → ElevenLabs → authenticated Railway REST → Cal.com
```

## Active services

| Service | Purpose | Build | Start |
|---|---|---|---|
| `@robinexis/api` | `/health`, tenant-bound booking tools, product APIs, signed provider webhooks | `node scripts/railway.mjs api` | `node scripts/railway.mjs migrate && node scripts/railway.mjs start` |
| `@robinexis/worker` | Stripe reconciliation and data retention only | `node scripts/railway.mjs worker` | `npm run start -w @robinexis/worker` |

The public API is `https://robinexisapi-production-3836.up.railway.app`.

- `GET /health`
- `POST /api/v1/voice-tools/check-availability`
- `POST /api/v1/voice-tools/create-booking`
- `POST /webhooks/elevenlabs/post-call`

Both booking routes require `x-voice-tool-secret`. `VOICE_TOOL_SECRET` remains bound to Blades for compatibility. New tenants use one unique secret each in `VOICE_TOOL_SECRETS_JSON`, shaped as `{"client_id":"long-unique-secret"}`; the request body cannot choose its tenant. ElevenLabs post-call events require a valid `ElevenLabs-Signature` generated with `ELEVENLABS_WEBHOOK_SECRET`.

Keep all webhook, calendar, Supabase and database credentials on Railway only. Product JWTs are resolved into either a Robinexis operator or tenant-scoped salon membership. Database tables are API-only: browser Supabase roles have no direct table grants.

## Deploy

```bash
node scripts/railway-vars.mjs
node scripts/railway-setup.mjs
node scripts/railway-setup.mjs --apply
```

Review the IaC plan before applying it. `.railway/railway.ts` now describes only the active API and worker. The retired gateway service is intentionally retained outside IaC as a rollback shell; do not let a config apply delete it.

## Verify

1. `GET /health` returns `status: ok`, `service: api`, a build version and `checks.database: ok`.
2. An invalid `x-voice-tool-secret` receives `401`.
3. Availability returns only Cal.com slots.
4. Booking requires the system conversation ID, explicit confirmation and a still-free slot.
5. Repeating the same conversation/slot returns the original booking UID.
6. A signed ElevenLabs transcription webhook creates or updates the call under the tenant mapped by `agent_id`; an unknown agent is ignored.
7. A salon user can only list workspaces in `workspace_memberships`; operators can switch across all tenants.
8. Twilio `+447446868067` remains assigned to ElevenLabs, not Railway.

## Retired gateway rollback

Retired 1 September 2026:

- Railway service: `@robinexis/voice-gateway`
- Service ID: `652fb60c-b080-4129-a2f8-806ed68046a0`
- Last successful deployment: `c752a7dc-e207-46c1-b501-6a339499f317`
- Final stopped deployment: `d1424787-a954-4972-8c80-947b2277b412` (`FAILED`, stopped)
- Last domain: `https://robinexisvoice-gateway-production.up.railway.app`
- Retirement action: stopped the deployment and disconnected its GitHub source; service was not deleted.

Do not restore this during an ordinary API rollback. If an emergency audio rollback is explicitly approved:

1. Restore the removed `apps/voice-gateway` code from git history.
2. Reconnect `Gulfam-Amjad/robinexis` only after restoring the gateway code at a rollback commit.
3. Restore its old Railway build/start variables and secrets from Railway history, redeploy, and verify `/health`.
4. Only then change a sandbox Twilio number. Never move `+447446868067` without a separate controlled cutover.

The current voice rollback is safer: select the previous ElevenLabs agent version and leave Twilio routing unchanged.
