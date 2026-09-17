# Robinexis project brief (for Gemini / ChatGPT / cloud)

> Snapshot date: **2026-09-02**. This is the **current** architecture.  
> Do **not** trust older docs that describe a live Groq/Whisper voice gateway, Twilio Media Streams on Railway, or “Call Me Now” outbound from Railway. Those paths were **retired on 2026-09-01**.  
> This brief contains **no secrets**. Keys live in local `.env` / Railway / Vercel, never in git.

Use this file as context when discussing product, architecture, sales demos, or next work. If something here conflicts with code, **the code wins**.

---

## 1. What this project is

**Robinexis** sells AI voice receptionists to local businesses (hair salons first). A caller phones a shop; an AI answers, uses approved facts, checks a real calendar, books / reschedules / cancels, or hands off to a human.

This repository is **two products in one folder**:

| Half | Purpose | Where |
|---|---|---|
| **AIOS vault** | Operating system for founders Will & Ed Robinson: knowledge, skills, decisions, sales demo workflow | `CLAUDE.md`, `os/`, `brains/`, `raw/`, `.claude/skills/` |
| **Production platform** | Multi-tenant TypeScript product: dashboard, APIs, booking tools, billing/retention | `apps/`, `packages/`, `deploy/`, `docker-compose.yml` |

Business motion:

1. **Sales:** paste a prospect website → `/demo-build` → shareable **ElevenLabs Conversational AI** demo in minutes.
2. **Signed client:** tenant config in Postgres + live phone on **ElevenLabs**, with **Railway REST** for calendar tools.
3. **Playbook vs reality:** Sturdy Ai’s Foundation playbook still says production phone deploys are Track 1 (£75/hr) after a paid deal. Smith England / Blades Hair was put live anyway on Robinexis’s own accounts (decision logged 2026-08-19).

---

## 2. Active production voice path (this is the truth)

```
Caller
  → Twilio number +447446868067
  → ElevenLabs Conversational AI (speech, barge-in, turn-taking, LLM, TTS)
  → authenticated Railway REST (booking tools only)
  → Cal.com (real calendar slots / bookings)
```

| Who | Owns |
|---|---|
| **Twilio** | PSTN inbound to the salon number |
| **ElevenLabs** | STT, conversation, interruption, TTS, share/widget demos |
| **Railway `@robinexis/api`** | `/health`, Blades voice-tool REST, product `/api/v1`, Stripe webhook, Twilio *status* webhook |
| **Railway `@robinexis/worker`** | Stripe reconcile + 90-day call retention. **Does not dial.** |
| **Vercel `apps/web`** | React SaaS dashboard + public marketing + Blades receptionist widget page |
| **Supabase Postgres + pgvector** | Tenants, calls, jobs, knowledge embeddings |
| **Cal.com** | Availability and bookings |

**Railway never receives live call audio.** No TwiML, no Media Stream WebSocket in the active deploy.

Public surfaces (from repo config, not secrets):

- Dashboard: `https://app.robinexis.com` (`robinexis-pink.vercel.app` redirects here; sign-in works on the canonical host only)
- API: `https://robinexisapi-production-3836.up.railway.app`
- Live salon number: `+447446868067` — **must stay on ElevenLabs, never pointed at a Railway `/twiml`**
- Widget demo page: `/demo/blades-hair` (Sophie / Blades Hair, City of London)

Git deploy source in Railway IaC: `Gulfam-Amjad/robinexis` branch `main`.

---

## 3. Retired architecture (historical only)

Retired **2026-09-01**:

- `apps/voice-gateway` (Twilio Media Streams → Groq Whisper VAD → Groq LLM → ElevenLabs TTS)
- Outbound “Call Me Now” sandbox dials from the API
- Redis live-call concurrency for that gateway
- Worker outbound *dialing*

The Railway gateway **service shell was not deleted** (rollback ID documented in `deploy/railway/RUNBOOK.md`). Ordinary rollbacks should change the **ElevenLabs agent version**, not restore audio on Railway.

If older overview files (`PROJECT-OVERVIEW.md`, some wiki pages, `os/handoff.md`) still describe Groq-on-the-phone, treat them as **stale**. `brains/robinexis/outputs/production/PLATFORM.md` and `deploy/railway/RUNBOOK.md` match the live path.

Worker behaviour today: any due outbound job is immediately marked `failed` with `outbound_voice_gateway_retired`.

New tenants created via API default to `voicePipeline: "elevenlabs-convai"`.

---

## 4. Full repository map

```
robinexis-aios/
│
├─ AIOS (knowledge)
│  CLAUDE.md          identity + routing for any AI engine
│  AGENTS.md          “read CLAUDE.md then act”
│  BRAINS.md          brain manifest (GitHub-connected engines)
│  index.md           vault map
│  raw/               drop-box for new sources (kept empty)
│  brains/_template/  seed brain — never delete
│  brains/robinexis/  company brain: raw → wiki → outputs
│  os/                connections, decisions, handoff, references, guides
│  .claude/skills/    16 skills (demo-build, sync, save, ingest, …)
│  superpowers/       third-party Superpowers plugin (not the product)
│
└─ PLATFORM (code)
   apps/api           Node HTTP API (:8081 local)
   apps/web           Vite + React 19 SaaS (Vercel; :5173 local)
   apps/worker        poll loop: Stripe + retention; outbound jobs fail-closed
   apps/demo-factory  docs stub — real demo path is the /demo-build skill
   packages/
     api-contracts    shared TS types for web ↔ API
     brain            prompt compiler + BrainSession (still used for publish/evals)
     tool-contracts   13 provider-neutral tool schemas
     integrations     Cal.com, Stripe, Twilio helpers, guarded tool executor
     database         Postgres/memory store, access control, schema, seed
     knowledge        Gemini embeddings + chunk/ingest/search (RAG)
     evaluations      vitest platform tests
   deploy/railway/    RUNBOOK.md
   .railway/railway.ts  IaC: api + worker only
   docker-compose.yml Postgres 16+pgvector :5433 + Redis 7
   vercel.json        SPA rewrites for apps/web
```

**Hard rules:** knowledge only in `brains/`. Secrets never committed. One fact, one page.

---

## 5. Technology stack (current)

| Layer | Choice |
|---|---|
| Language | TypeScript 5.9, ESM, Node **≥ 24** |
| Monorepo | npm workspaces |
| Web | React 19, Vite 7, React Router 7, TanStack Query, Zod, Recharts, `@elevenlabs/react` |
| Auth (product) | Supabase JWT on API; `ADMIN_EMAILS` allowlist. Local `SKIP_AUTH` / `VITE_SKIP_AUTH` ignored in production |
| API | Node `http` server (not Express), CORS via `WEB_ORIGIN` |
| DB | PostgreSQL 16 + **pgvector**; JSONB for most entities; HNSW on embeddings |
| Hosting | **Vercel** (web) + **Railway** (api, worker) + **Supabase** (Postgres). Redis still in compose / `.env.example` but not the live voice path |
| Voice (live) | ElevenLabs Conversational AI |
| Calendar | Cal.com API v2 |
| Billing | Stripe webhooks + reconcile (brain never sees Stripe keys) |
| RAG | Gemini `gemini-embedding-001`, 768-d, L2-normalized |
| Tests | Vitest; Playwright e2e script exists (`npm run test:e2e`) |
| Sales demos | `@elevenlabs/cli` + agent configs under `brains/robinexis/outputs/demos/` |

Build: web is a real Vite build. Backend uses `scripts/railway.mjs` (api/worker/migrate). `npm run verify` = typecheck + web build + backend build + tests.

---

## 6. End-to-end flows

### 6.1 Live inbound receptionist (Blades / Smith England lineage)

1. Caller dials `+447446868067`.
2. Twilio routes to the **ElevenLabs** agent (not Railway).
3. Agent talks using its system prompt + knowledge in ElevenLabs.
4. When the caller wants a time, the agent calls Railway:

   - `POST /api/v1/voice-tools/check-availability`
   - `POST /api/v1/voice-tools/create-booking`

   Header: `x-voice-tool-secret` must match `VOICE_TOOL_SECRET`.

5. Voice tools **only serve the Blades Hair published tenant** (`BLADES_HAIR_ID`). Other `clientId`s → 404.
6. Availability: service slug must exist on that tenant; date range must be valid and ≤ 14 days.
7. Booking: requires conversation id, explicit confirmation, still-free slot, attendee name + phone; idempotency key derived from conversation + slot. Repeat same conversation/slot → original booking UID.
8. Calendar writes go to **Cal.com** using credential *references* (env var names), not raw keys in the DB.

### 6.2 Browser demo (no phone)

`apps/web` page `/demo/blades-hair` uses `@elevenlabs/react` against a hard-coded agent id (Sophie, Blades Hair). This is the pitch/widget path, not the PSTN path.

### 6.3 Sales demo factory (`/demo-build`) — separate from production

```
Prospect URL + 2–3 line brief
  → scrape site (facts only)
  → fill os/references/system-prompt-library.md
  → write brains/robinexis/outputs/demos/agents-project/agent_configs/*.json
  → elevenlabs agents add + push
  → share link + <elevenlabs-convai> widget
  → log brains/robinexis/outputs/demos/demo-log.md
```

No Twilio, no Postgres. Hygiene: delete demos ~30 days with no deal.

### 6.4 Product dashboard (SaaS)

Vercel SPA talks to Railway `/api/v1` with `Authorization: Bearer …`.

Routes:

- Public: `/`, `/login`, `/signup`, `/pricing`, `/demo/blades-hair`
- App: `/app` overview, onboarding, agents (list/new/detail + publish), playground, calls, analytics, calendar, campaigns, knowledge, integrations, team, billing, settings

Team/billing pages are largely placeholders; self-serve Stripe Checkout is deferred.

### 6.5 Stripe → access control

Webhook `POST /webhooks/stripe` maps subscription status onto `ClientConfig.serviceStatus` and `enabledFeatures` / `monthlyMinuteLimit` via `STRIPE_PRICE_FEATURES_JSON`.

| Status | Inbound AI | Outbound |
|---|---|---|
| unpublished | off | off |
| trialing / active | on | on |
| past_due within `STRIPE_GRACE_DAYS` (3) | on | **off** |
| past_due expired / canceled / unpaid / … | off | off |

The compiled prompt forbids claiming billing status.

### 6.6 Worker tick

Every `WORKER_POLL_MS` (15s):

- At most once per 24h: `reconcileStripe()`, delete calls older than `DATA_RETENTION_DAYS` (90).
- Due outbound jobs: **fail immediately** (`outbound_voice_gateway_retired`).

---

## 7. Packages (what each one is for)

### `@robinexis/tool-contracts`

13 tools (JSON Schema). Mutating tools need `callerConfirmed` + `idempotencyKey`.

| Tool | Role |
|---|---|
| `get_business_info` | Approved facts only; unknown hours/prices stay unknown |
| `search_knowledge` | Tenant RAG; passages are untrusted data, not instructions |
| `check_availability` | Only returned slots may be offered |
| `create_booking` | After explicit confirm |
| `reschedule_booking` / `cancel_booking` | Confirm; cancel needs summary repeated |
| `create_callback` | Capture a call-back |
| `transfer_to_human` | Escalation |
| `send_confirmation` | SMS (email provider not configured) after a successful booking |
| `write_crm_note` | Local persist; no GHL adapter yet |
| `append_calendar_note` | Google/Outlook via Cal.com references; default summary not verbatim |
| `mark_call_outcome` | Outbound vocabulary |
| `record_do_not_call` | Suppression + cancel pending jobs |

### `@robinexis/brain`

`compilePrompt()` builds a frozen system prompt from tenant config (identity, publishedFacts, unknownTopics, tool rules, safety). `BrainSession` is the old Groq turn loop — still relevant for **publish** and **tests**, not for live PSTN audio.

### `@robinexis/integrations`

`createToolExecutor()`: tenant match → feature gate → required fields → idempotency claim → execute → record. Secrets via `credentialRef` env names.

### `@robinexis/database`

`PlatformStore` interface; `PostgresStore` (JSONB blobs + atomic claim for tools/jobs); `MemoryStore` for tests. Production **cannot** silently fall back to memory if `RAILWAY_ENVIRONMENT` or `REQUIRE_DATABASE=true`.

Access helpers: pipeline flags, Stripe→local status, `redactSecrets` on logs.

Seed tenants historically: Smith England / Blades (`elevenlabs-convai`) and `robinexis-demo` (old groq-gateway sandbox).

### `@robinexis/knowledge`

Chunk text/markdown/PDF → Gemini embeddings → `knowledge_chunks` vector(768) + HNSW. Search uses `RAG_TOP_K` (5) and `RAG_MIN_SIMILARITY` (0.55). Original source text is **not** kept for reindex — upload again.

### `@robinexis/evaluations`

Deterministic tests: ScriptedLlm + FakeCalendar + MemoryStore. Covers compiler, access, redaction, booking confirmation, DNC, dual-pipeline *historical* guards, etc. Re-read tests if you change booking rules.

---

## 8. Data model (Postgres)

| Table | Role |
|---|---|
| `clients` | `id`, `slug`, `config` JSONB (`ClientConfig`) |
| `prompt_versions` | Immutable compiled prompts per publish |
| `call_sessions` | JSONB payload: transcript (redacted), toolHistory, status |
| `tool_actions` | Audit; unique `(client_id, idempotency_key)` |
| `outbound_jobs` | JSONB; campaigns exist but dialing is retired |
| `suppressions` | DNC `(client_id, phone)` |
| `call_notes` | Post-call notes |
| `usage_counters` | Monthly inbound/outbound minutes |
| `knowledge_documents` | txt / markdown / pdf metadata |
| `knowledge_chunks` | `embedding vector(768)` |

`ClientConfig` highlights: `voicePipeline`, `publishedFacts`, `unknownTopics`, `enabledFeatures`, `published`, `serviceStatus`, `calendar.credentialRef`, `promptVersionId`, Stripe ids, calling window (UK 08:00–21:00, skip Sunday).

Publish: `PATCH` client → `published: false`. `POST …/publish` compiles a new version. Unpublished clients must not answer as AI.

---

## 9. HTTP API (Railway)

### Unauthenticated / special

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | `{ status, service: api, buildVersion }` |
| GET | `/demo/calendar` | Cal.com slot probe (demo tenant) |
| GET | `/demo/calls` | Recent demo calls |
| POST | `/webhooks/twilio/status` | Twilio signature; outbound job status (legacy) |
| POST | `/webhooks/stripe` | Stripe signature |
| POST | `/api/v1/voice-tools/check-availability` | `x-voice-tool-secret`; Blades only |
| POST | `/api/v1/voice-tools/create-booking` | same |

### Product `/api/v1` (admin: Bearer key or Supabase JWT + `ADMIN_EMAILS`)

- `GET /bootstrap`
- `GET/POST /clients`, `GET/PATCH /clients/:id`, `POST /clients/:id/publish`, `GET /clients/:id/prompt-versions`
- `GET /calls`, `GET /calls/:id`
- `GET /analytics/summary`, `GET /analytics/timeseries`, `GET /usage`
- `GET /calendar/slots`, `GET /calendar/bookings`, `POST …/reschedule|cancel` (needs `confirmed: true`)
- `GET/POST /jobs`, `POST /jobs/:id/approve|cancel`
- `GET /integrations/status`
- `GET/POST /knowledge/documents`, `DELETE /knowledge/documents/:id`, `POST …/reindex` (409 unless source re-uploaded), `POST /knowledge/search`

CORS: `WEB_ORIGIN`. Errors: `{ error: "internal" }` — no stack traces.

Web app **does not** serve from the API in the current Vercel split (older notes about API serving Vite on `/` are outdated for production).

---

## 10. Environment variable *names* (no values)

Copy `.env.example` → `.env`.

**Web (Vercel, `VITE_`):** `VITE_API_BASE_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SKIP_AUTH` (local/test only).

**API / worker:** `DATABASE_URL` (Supabase **session pooler** port 5432 — direct `db.*` is IPv6-only and Railway hobby often cannot reach it), `DATABASE_SSL`, `DATABASE_SSL_REJECT_UNAUTHORIZED`, `REQUIRE_DATABASE`, `GEMINI_API_KEY`, `GEMINI_EMBEDDING_MODEL`, `RAG_*`, `WEB_ORIGIN`, `ADMIN_EMAILS`, `SUPABASE_URL`, `SUPABASE_JWT_SECRET`, `SUPABASE_JWT_KEY_ID`, `API_PUBLIC_BASE_URL`, `VOICE_TOOL_SECRET`, `CALCOM_API_KEY`, `CALCOM_USERNAME`, `TWILIO_*`, `STRIPE_*`, `ADMIN_API_KEY`, `SKIP_AUTH`, `ALLOW_INSECURE_SKIP_AUTH`, `WORKER_POLL_MS`, `DATA_RETENTION_DAYS`.

**Legacy / unused on live audio path but still in example:** `GROQ_*`, `ELEVENLABS_*` (still needed for `/demo-build` and TTS experiments), `REDIS_URL`, `PUBLIC_BASE_URL`, `FRONT_DESK_PHONE_NUMBER`, `MAKE_*`.

Never paste real keys into Gemini chats.

---

## 11. Local development

```bash
cp .env.example .env
docker compose up -d          # Postgres+pgvector :5433, Redis :6379
npm install
npm run db:migrate
npm run db:seed
npm run verify

npm run dev:api               # :8081
npm run dev:web               # :5173
npm run dev:worker            # optional
```

`DATABASE_URL` for Docker is typically `postgresql://robinexis:robinexis@127.0.0.1:5433/robinexis`.  
Leave `VITE_API_BASE_URL` empty locally to proxy `/api` through Vite.

---

## 12. Deploy

**Railway** (`node scripts/railway-vars.mjs` then `railway-setup.mjs`, review plan, `--apply`):

- api: migrate then start; health `/health`
- worker: no public domain
- Node 24, `REQUIRE_DATABASE=true`

**Vercel:** `installCommand: npm ci`, `buildCommand: npm run build:web`, `outputDirectory: dist`, SPA rewrite.

**CI:** `.github/workflows/platform-ci.yml` — Node 22 historically; engines now say Node 24. Check workflow if CI fails.

Pre-deploy: never point `+447446868067` at Railway. Verify voice-tool secret 401/200. Confirm Cal.com account ownership before treating bookings as salon-owned.

---

## 13. AIOS vault (how the founders work)

Karpathy-style wiki: `brains/robinexis/{raw,wiki,outputs,index.md,log.md}`.

Skills (`.claude/skills/`):

| Skill | Job |
|---|---|
| `/demo-build` | Prospect URL → ElevenLabs demo |
| `/sync` `/save` `/session-handoff` | Git + knowledge capture |
| `/ingest` `/lint` `/brain-compact` | Grow / diagnose / tighten wiki |
| `/onboard` `/connect` `/update` | Setup, wire tools, pull template logic |
| `/audit` `/level-up` `/insights` | 4Cs score, 3Ms automation, synthesis |
| Obsidian markdown / bases / json-canvas | Vault authoring |

Frameworks: **3Ms** (Mindset → Method → Machine), **4Cs** (Context → Connections → Capabilities → Cadence).

Connections registry (`os/connections.md`): Stripe, Twilio, Cal.com, Google Calendar wired via `.env`. Slack, Notion, GitHub Issues, Fireflies, Drive **not** connected. GoHighLevel listed, **not** wired.

---

## 14. Safety rails (product-defining)

1. Only `publishedFacts` may be asserted; `unknownTopics` force handoff.
2. No invented slots, prices, hours, or tool success.
3. Mutations need confirmation + idempotency.
4. Card/SSN-shaped strings redacted before transcripts.
5. Credential refs, never raw keys in client JSON.
6. Twilio/Stripe webhooks signed; voice tools HMAC-compared secret.
7. Fail toward a human on the **phone** side (ElevenLabs transfer / front desk) — not a dead air gateway.

UK PECR: calling window + DNC designed for outbound; outbound **dialer is off**.

---

## 15. Known gaps and open risks

1. **Cal.com identity unverified.** Key has authenticated as a personal account (`hammadmuntazir512@gmail.com` / `hammad-muntazir-9zpmnb`). Flagged twice; work continued. If wrong, **real bookings may sit on a stranger’s calendar.** Confirm with Will/Ed and rotate if needed.
2. **No CRM adapter** — `write_crm_note` is local only.
3. **Salon hours/prices** often unpublished — agent must not invent them.
4. **Outbound voice campaigns** are not live (gateway retired).
5. **Auth / Stripe Checkout** for self-serve SaaS still incomplete.
6. **Wiki drift:** `brains/robinexis/index.md` still describes Groq production; PLATFORM.md is current.
7. **Email confirmations** not implemented.
8. This working folder name is often `robinexis-aios-main - Copy` — treat as a local copy; sync/push depends on whether `.git` exists.

---

## 16. Decision timeline (why it looks like this)

| Date | What |
|---|---|
| 2026-08-17 | Sandbox wiring on Robinexis accounts, not Sturdy Ai production handover |
| 2026-08-19 | Smith England live on `+447446868067`; Cal.com risk logged |
| 2026-08-26 | Custom gateway STT/LLM → Groq (cost) |
| 2026-08-29 | Multi-tenant platform brief; Groq confirmed as *custom* brain; ElevenLabs kept as live fallback |
| 2026-09-01 | **Cutover:** live path = Twilio → ElevenLabs → Railway REST → Cal.com. Gateway + Call Me Now retired |

Publishing constraints: say Groq/custom-gateway only if describing **history**. Current public story: **ElevenLabs hears and speaks; Robinexis owns tenant state, tools, dashboard; Cal.com is the calendar.** Do not claim “production-ready / 80% savings / GDPR complete” without evidence.

---

## 17. Glossary

| Term | Meaning |
|---|---|
| AIOS | Vault half: skills + brains |
| Tenant / client | One business = one `ClientConfig` |
| Blades / Sophie | Current receptionist demo + live number lineage |
| Voice tools | Railway REST called by ElevenLabs |
| Frozen prompt | Immutable `PromptVersion` after publish |
| Credential ref | Env var *name* stored in config |
| Option 1 / ConvAI | ElevenLabs managed conversation (**live**) |
| Option 2 / groq-gateway | Retired custom audio stack |
| Track 1 | Sturdy Ai paid production work |

---

## 18. How to discuss this with Gemini

Good prompts:

- “Given this brief, propose how to onboard a second salon without mixing Cal.com accounts.”
- “Design a CRM adapter for `write_crm_note` that doesn’t break idempotency.”
- “What would a safe outbound reminder look like *without* restoring the Groq gateway?”
- “Draft a cutover checklist to verify Cal.com ownership.”

Do not ask it to invent API keys, exploit Twilio, or reconstruct secrets from this file (there are none).

---

*End. Source of truth: `deploy/railway/RUNBOOK.md`, `brains/robinexis/outputs/production/PLATFORM.md`, and the TypeScript in `apps/` + `packages/` as of 2026-09-02.*
