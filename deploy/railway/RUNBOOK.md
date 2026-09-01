# Railway REST API runbook

Twilio and ElevenLabs communicate directly for live speech. Railway never receives raw audio and has no WebSocket or TwiML role.

```text
Caller → Twilio → ElevenLabs → authenticated Railway REST → Cal.com
```

## Active services

| Service | Purpose | Build | Start |
|---|---|---|---|
| `@robinexis/api` | `/health`, authenticated Blades tools, product/Stripe APIs | `node scripts/railway.mjs api` | `node scripts/railway.mjs migrate && node scripts/railway.mjs start` |
| `@robinexis/worker` | Stripe reconciliation and data retention only | `node scripts/railway.mjs worker` | `npm run start -w @robinexis/worker` |

The public API is `https://robinexisapi-production-3836.up.railway.app`.

- `GET /health`
- `POST /api/v1/voice-tools/check-availability`
- `POST /api/v1/voice-tools/create-booking`

Both booking routes require `x-voice-tool-secret`. Keep `VOICE_TOOL_SECRET`, `CALCOM_API_KEY`, `CALCOM_USERNAME` and database credentials on Railway only.

## Deploy

```bash
node scripts/railway-vars.mjs
node scripts/railway-setup.mjs
node scripts/railway-setup.mjs --apply
```

Review the IaC plan before applying it. `.railway/railway.ts` now describes only the active API and worker. The retired gateway service is intentionally retained outside IaC as a rollback shell; do not let a config apply delete it.

## Verify

1. `GET /health` returns `status: ok`, `service: api` and a build version.
2. An invalid `x-voice-tool-secret` receives `401`.
3. Availability returns only Cal.com slots.
4. Booking requires the system conversation ID, explicit confirmation and a still-free slot.
5. Repeating the same conversation/slot returns the original booking UID.
6. Twilio `+447446868067` remains assigned to ElevenLabs, not Railway.

## Retired gateway rollback

Retired 1 September 2026:

- Railway service: `@robinexis/voice-gateway`
- Service ID: `652fb60c-b080-4129-a2f8-806ed68046a0`
- Last deployment: `c752a7dc-e207-46c1-b501-6a339499f317`
- Last domain: `https://robinexisvoice-gateway-production.up.railway.app`
- Retirement action: scaled region `us-west2` from one replica to zero; service was not deleted.

Do not restore this during an ordinary API rollback. If an emergency audio rollback is explicitly approved:

1. Restore the removed `apps/voice-gateway` code from git history.
2. Restore its old Railway source/build/start variables and secrets from Railway history.
3. Scale `us-west2` back to one and verify its `/health`.
4. Only then change a sandbox Twilio number. Never move `+447446868067` without a separate controlled cutover.

The current voice rollback is safer: select the previous ElevenLabs agent version and leave Twilio routing unchanged.
