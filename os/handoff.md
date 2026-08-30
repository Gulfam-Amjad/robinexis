---
created: 2026-08-29
type: handoff
status: in-progress
---

# Handoff — production platform wrap-up

## Done

- Inventoried demo factory vs 25 Aug brief; live Smith England agent left as fallback.
- Scaffolded monorepo: `apps/api`, `apps/worker`, `apps/demo-factory`, `apps/voice-gateway`; packages `brain`, `tool-contracts`, `integrations`, `database`, `evaluations`.
- Production voice path: Groq Whisper STT, Groq Llama reasoning, ElevenLabs TTS.
- Text evaluations with fake calendar (no live audio required).
- Stripe webhook handler updates local `serviceStatus` (the conversational brain never sees Stripe keys).
- Operator console at `http://localhost:8081/dashboard` (and `/demo` for Test Lab): live systems, Cal.com slot probe, Call Me Now, demo call activity, clients/jobs.
- React SaaS product added at `/` and `/app`: onboarding, agent editing/publishing, playground, calls, analytics, calendar, campaigns, Gemini RAG knowledge, integrations, team/billing placeholders, and settings.
- Product APIs live under authenticated `/api/v1`; the API service serves the production Vite build on the same origin.
- Local Docker now uses Postgres 16 + pgvector with a separate `robinexis_pgvector` volume so older database volumes are not deleted.

## In flight

- Cal.com account identity still unverified (`hammadmuntazir512@gmail.com`). Do not treat as salon-owned until Will/Ed confirm.
- Live number `+447446868067` still on ElevenLabs ConvAI — do not point it at `/twiml` until sandbox calls pass.
- Hosted Postgres/Redis/Stripe are local `.env` / Docker — not production-provisioned.
- Authentication and self-serve Stripe Checkout remain intentionally deferred; deployed `/api/v1` access must keep `ADMIN_API_KEY` set.
- `GEMINI_API_KEY` is required before indexing/searching knowledge. Production needs Railway Postgres + pgvector.
- Current local `DATABASE_URL` still targets a PostgreSQL instance without the vector extension; point it at the new `docker-compose` pgvector service, then run `npm run db:migrate` and `npm run db:seed`.

## Next actions

1. Open `http://localhost:8081/dashboard` after `npm run dev:api`. Calendar/Systems work without ngrok. Call Me Now needs gateway + `PUBLIC_BASE_URL`.
2. Add `GROQ_API_KEY`, `DATABASE_URL`, `REDIS_URL`, Stripe keys to Railway Variables (see `.env.example`).
3. `docker compose up -d` then `npm run db:migrate` and `npm run db:seed`.
4. Run `npm run verify`. Point a **sandbox** Twilio number at `apps/voice-gateway` `/twiml` (ngrok/wss).
5. Confirm Cal.com ownership; rotate tenant credentials if needed.
6. First outbound campaign: human approval flag must be true.

## Blockers

- Unverified Cal.com account.
- No CRM product connected (GHL listed, not wired) — `write_crm_note` persists locally until an adapter is added.
- Salon hours/prices still unpublished; agent must not invent them.
