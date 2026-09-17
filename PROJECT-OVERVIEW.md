# Robinexis AIOS + Voice Platform — Complete Project Documentation

> Generated: 2026-08-29 · Scope: every folder, file, flow, contract, env var, and known gap in this repository.
> This is a **reference document**. Nothing here changes behaviour — it describes what already exists in the code.

> [!warning] Architecture changed on 2026-09-01
> The voice-gateway, Groq/Whisper audio path, outbound “Call Me Now” path and Redis session runtime described below are retired historical architecture. The active Blades path is `Caller → Twilio → ElevenLabs → Railway REST → Cal.com`. Railway keeps `/health`, authenticated booking tools, product APIs, Stripe reconciliation and retention. See `deploy/railway/RUNBOOK.md` for the current deployment source of truth.

---

## Table of contents

1. [What this project actually is](#1-what-this-project-actually-is)
2. [The two halves of the repo](#2-the-two-halves-of-the-repo)
3. [Full repository map](#3-full-repository-map)
4. [Technology stack](#4-technology-stack)
5. [Architecture — the two voice pipelines](#5-architecture--the-two-voice-pipelines)
6. [End-to-end flows](#6-end-to-end-flows)
   - [6.1 Inbound call](#61-inbound-call-groq-gateway-pipeline)
   - [6.2 One conversational turn](#62-one-conversational-turn-inside-brainsession)
   - [6.3 Outbound campaign](#63-outbound-campaign-worker--twilio--gateway)
   - [6.4 "Call Me Now" demo call](#64-call-me-now-demo-call)
   - [6.5 Post-call finish sequence](#65-post-call-finish-sequence)
   - [6.6 Stripe billing → access control](#66-stripe-billing--access-control)
   - [6.7 Sales demo build (`/demo-build`)](#67-sales-demo-build-demo-build)
7. [Monorepo reference — package by package](#7-monorepo-reference--package-by-package)
8. [Data model](#8-data-model)
9. [Tool contracts (the 12 agent tools)](#9-tool-contracts-the-12-agent-tools)
10. [Prompt compilation](#10-prompt-compilation)
11. [HTTP API reference](#11-http-api-reference)
12. [Configuration and environment variables](#12-configuration-and-environment-variables)
13. [Local development — step by step](#13-local-development--step-by-step)
14. [Deployment (Railway) and CI](#14-deployment-railway-and-ci)
15. [Testing and evaluations](#15-testing-and-evaluations)
16. [Security, safety rails, and compliance](#16-security-safety-rails-and-compliance)
17. [The AIOS vault (knowledge layer)](#17-the-aios-vault-knowledge-layer)
18. [Decision history and why the stack looks like this](#18-decision-history-and-why-the-stack-looks-like-this)
19. [Known gaps, risks and open items](#19-known-gaps-risks-and-open-items)
20. [Glossary](#20-glossary)

---

## 1. What this project actually is

Robinexis sells **AI voice receptionists to local businesses** (hair salons first). A caller phones a business, an AI answers, understands them, checks a real calendar, books/reschedules/cancels a real appointment, or hands off to a human — and everything is logged.

This repository holds **two things in one git repo**:

| Half | What it is | Lives in |
|---|---|---|
| **The AIOS vault** | An Obsidian-compatible knowledge + workflow system ("operating system" for the two founders, Will and Ed Robinson). Holds skills, brains (wikis), references, decisions. | Root `.md` files, `os/`, `brains/`, `raw/`, `.claude/`, `.obsidian/` |
| **The production platform** | A TypeScript monorepo that runs the actual telephone voice agent — a multi-tenant Node.js system. | `apps/`, `packages/`, `deploy/`, `docker-compose.yml`, `.railway/railway.ts` |

They coexist on purpose: the vault is the sales/knowledge brain, the monorepo is the product. One repo = one backup = both halves in context every session.

### The business model in one paragraph

A prospect's website URL goes into the `/demo-build` skill → a tailored **ElevenLabs Conversational AI demo agent** comes out in 2–5 minutes with a shareable link. That demo is the sales weapon. When a prospect signs, their approved facts become a published `ClientConfig` row in the production platform, and their phone number is served by the **custom Groq gateway** instead. Demos and production are deliberately different systems.

---

## 2. The two halves of the repo

```
robinexis-aios/
│
├─ AIOS VAULT  (knowledge + sales workflow)
│   CLAUDE.md          identity + operating manual for any AI agent
│   AGENTS.md          engine-neutral bootstrap ("read CLAUDE.md")
│   BRAINS.md          machine-readable manifest of brains
│   index.md           human/AI map of the vault
│   .claude/skills/    17 skills: /demo-build, /sync, /save, /ingest, /audit, …
│   brains/robinexis/  the company brain (raw → wiki → outputs)
│   brains/_template/  seed for a new brain — never delete
│   os/                references, guides, context, decisions, connections
│   raw/               the single front door for new material (kept empty)
│
└─ PRODUCTION PLATFORM  (the actual product)
    apps/voice-gateway  Twilio Media Streams ↔ STT ↔ brain ↔ TTS   (:8080)
    apps/api            admin/dashboard/webhooks/demo page          (:8081)
    apps/worker         outbound dialer, Stripe reconcile, retention
    apps/demo-factory   docs only — the sales demo path
    packages/brain            prompt compiler + conversation state machine
    packages/tool-contracts   the 12 provider-neutral tool JSON schemas
    packages/integrations     Cal.com, Twilio, Stripe, notifications, tools
    packages/database         types, Postgres store, memory store, Redis
    packages/evaluations      the vitest test suite
```

**The hard rule that separates them:** knowledge only ever lives in `brains/`. Secrets never live in the repo at all — only in a local, gitignored `.env` or in Railway Variables.

---

## 3. Full repository map

### 3.1 Root files

| File | Purpose |
|---|---|
| `CLAUDE.md` | The AIOS operating manual: identity, routing table, secrets policy, rituals, skill list. Read first by any agent. |
| `AGENTS.md` | Engine bootstrap. Says: read `CLAUDE.md`, read `BRAINS.md`, never commit secrets, knowledge lives in brains. |
| `BRAINS.md` | Machine-readable manifest of brains so a GitHub-connected engine can write to the right folder. |
| `index.md` | The vault map — shape, brains table, key pointers. |
| `README-PLATFORM.md` | Short operator guide for running the telephone platform locally. |
| `PROJECT-OVERVIEW.md` | **This document.** |
| `package.json` | npm workspaces root; all scripts (`dev:*`, `db:*`, `verify`). |
| `tsconfig.json` | Single strict TS config for the whole monorepo, `noEmit: true`, NodeNext modules. |
| `vitest.config.ts` | Test runner config — only picks up `packages/evaluations/**/*.test.ts`. |
| `docker-compose.yml` | Local Postgres 16 + Redis 7 with healthchecks. |
| `.railway/railway.ts` | Railway Infrastructure as Code for API, voice gateway, worker, and Redis. |
| `.env.example` | Every env var with placeholders. Copy to `.env`. |
| `.gitignore` | Blocks `.env*`, keys, PEMs, service accounts, `node_modules/`, `dist/`, heavy media in brains. |

### 3.2 `apps/`

```
apps/
├─ voice-gateway/                   the real-time call runtime
│   package.json                    deps: ws, twilio, groq-sdk, dotenv + workspace pkgs
│   src/server.ts                   HTTP /health + POST /twiml; WS upgrade → /media-stream
│   src/config.ts                   env loading, model defaults, warnOnMissingConfig()
│   src/mediaStream.ts              Twilio Media Streams wire protocol (parse/send/clear/mark)
│   src/callSession.ts              orchestrates STT ⇄ brain ⇄ TTS for one live call
│   src/groqWhisperStt.ts           energy-VAD + µ-law→PCM WAV + Groq Whisper transcription
│   src/stt.ts                      the STT interface (SttSession / SttFactory)
│   src/elevenlabsTts.ts            ElevenLabs streaming TTS over WebSocket → µ-law 8k
│   src/twilioControl.ts            live-call redirect to the front desk (<Dial>)
│   src/types.ts                    Twilio inbound message + media format types
│
├─ api/
│   package.json
│   src/server.ts                   admin REST, Stripe + Twilio-status webhooks, /demo
│   src/demo.html                   "Call Me Now" test page
│
├─ worker/
│   package.json
│   src/index.ts                    poll loop: outbound jobs, Stripe reconcile, retention
│
└─ demo-factory/
    package.json                    docs-only stub package
    README.md                       how the sales demo path works + smoke checklist
```

### 3.3 `packages/`

```
packages/
├─ brain/
│   src/index.ts        public exports
│   src/compiler.ts     compilePrompt() + greetingFor()
│   src/session.ts      BrainSession — the turn loop + tool loop
│   src/llm.ts          LlmDriver interface + ScriptedLlm (for tests)
│   src/groq.ts         GroqDriver + message/tool-call mapping both ways
│   src/notes.ts        noteFromCall() + redactSensitiveText()
│
├─ tool-contracts/
│   src/index.ts        TOOL_NAMES, OUTCOME_STATUSES, TOOL_DEFINITIONS, requiredFieldsFor()
│
├─ integrations/
│   src/index.ts             barrel exports
│   src/tools.ts             createToolExecutor() — the guarded tool dispatcher
│   src/calcom.ts            Cal.com v2 API client (slots, book, reschedule, cancel, refs)
│   src/calendarNotes.ts     append verified notes to Google Calendar / MS Graph events
│   src/fakeCalendar.ts      in-memory calendar for tests
│   src/twilioOutbound.ts    twilioClient(), placeOutboundCall(), validateTwilioWebhook()
│   src/demoCall.ts          E.164 validation, rate limit, demo-tenant guard, sandbox dial
│   src/outboundStatus.ts    Twilio status → job status/disposition state machine
│   src/notifications.ts     Twilio SMS sender
│   src/stripe.ts            webhook handler, reconcile, price→feature plan mapping
│   src/compliance.ts        UK calling-window check + compliance notes
│   src/finishCall.ts        end-of-call: notes, CRM, calendar note, usage, job close
│
├─ database/
│   src/index.ts        barrel exports
│   src/types.ts        every domain type (ClientConfig, CallSession, OutboundJob, …)
│   src/memory.ts       PlatformStore interface + MemoryStore + newId()
│   src/postgres.ts     PostgresStore (JSONB-backed) + createPool()
│   src/redis.ts        RedisSessionCache — call cache + Lua concurrency reservations
│   src/store.ts        getStore() / getRedis() singletons with fallback logic
│   src/schema.sql      the 7 tables + indexes
│   src/migrate.ts      applies schema.sql
│   src/seed.ts         Smith England + Robinexis Demo tenants
│   src/access.ts       billing gate, pipeline check, secret redaction, structured logs
│   src/env.ts          repo-root .env loader
│
└─ evaluations/
    src/index.ts            empty barrel
    src/platform.test.ts    the entire test suite (16 assertions groups)
```

### 3.4 `os/`, `brains/`, `.claude/`

```
os/
├─ connections.md          registry of every wired tool (never credentials)
├─ handoff.md              current session handoff: Done / In flight / Next / Blockers
├─ aios-intake.md          the 7-question onboarding intake
├─ ROUTINES.md             cadence
├─ EXPANSIONS.md           optional add-ons
├─ bin/template-safety-check.sh
├─ context/                00-context.md, about-me, about-business, priorities
├─ decisions/log.md        append-only decision record (the "why")
├─ guides/                 human-readable guides (3Ms, 4Cs, onboarding, routines…)
└─ references/             researched-once API/CLI guides:
                           elevenlabs-cli, twilio-cli, calcom-cli, stripe-cli,
                           google-workspace-cli, github-cli, cloudflare-cli,
                           make-cli, heygen-cli, canva-api, monday-api, xero-api,
                           system-prompt-library, brain-conventions,
                           3ms-framework, 4cs-framework, recommended-stack,
                           cadence-and-routines, sturdy-ai-app, voice

brains/
├─ _template/              the seed brain (README, index, log, wiki examples)
└─ robinexis/
    ├─ README.md           what this brain is / scope
    ├─ index.md            catalogue of every page
    ├─ log.md              append-only event timeline
    ├─ raw/                Playbook_Robinexis_Voice_Agent_System.md,
    │                      2026-08-29-production-architecture.md
    ├─ wiki/               entity-smith-england-salon, concept-demo-workflow,
    │                      source-2026-08-29-production-architecture
    └─ outputs/
        ├─ demos/          demo-log.md (+ agents-project workspace)
        ├─ production/     PLATFORM.md, smith-england-salon/ (agent + tool configs)
        └─ sandbox/        production-test/ RUNBOOK + agents-project

.claude/skills/            17 skills, each a SKILL.md:
  demo-build ⭐ · onboard · audit · level-up · connect · sync · save ·
  session-handoff · insights · ingest · lint · brain-compact · update ·
  obsidian-markdown · obsidian-bases · json-canvas
```

### 3.5 `deploy/` and `.github/`

```
deploy/railway/
├─ api.toml      Railway service config for @robinexis/api
├─ worker.toml   Railway service config for @robinexis/worker
└─ RUNBOOK.md    the deployment runbook: services, vars, pre-deploy checks, rollback

.github/workflows/platform-ci.yml
└─ On PR and push to main: Node 22 → npm ci → npm run build → npm test
```

---

## 4. Technology stack

| Layer | Choice | Where |
|---|---|---|
| Language | TypeScript 5.9.3, ES2022, NodeNext ESM | everywhere |
| Runtime | Node.js ≥ 18 (CI uses 22), run via `tsx` (no build output) | all apps |
| Package manager | npm workspaces (9 workspaces) | root `package.json` |
| Telephony | Twilio — Voice, Media Streams (WebSocket), SMS, machine detection | `twilio@^6.1.0` |
| Speech-to-text | **Groq Whisper** `whisper-large-v3-turbo` (REST, utterance-based) | `groq-sdk@^1.6.0` |
| Reasoning / LLM | **Groq** `openai/gpt-oss-120b` with function calling | `groq-sdk` |
| Text-to-speech | **ElevenLabs** streaming WS, `eleven_flash_v2_5`, `ulaw_8000` output | raw `ws` |
| Calendar | Cal.com API v2 (slots, bookings, references) → bridges to Google / Outlook | `fetch` |
| Calendar notes | Google Calendar v3 + Microsoft Graph v1.0 | `fetch` |
| Billing | Stripe (`stripe@^18.5.0`) — webhooks + subscription reconcile |
| Database | PostgreSQL 16, JSONB-heavy schema (`pg@^8.16.3`) |
| Cache / coordination | Redis 7 (`redis@^5.8.2`) — live call cache + concurrency reservations |
| WebSockets | `ws@8.21.3` (both Twilio media and ElevenLabs TTS) |
| Config | `dotenv@^17.4.2`, repo-root `.env` |
| Tests | Vitest 3 |
| Hosting | Railway (NIXPACKS), 3 services + Postgres + Redis |
| Sales demos | ElevenLabs Conversational AI + `@elevenlabs/cli` (separate from production) |
| Vault | Obsidian (`.obsidian/`), wikilinks, YAML frontmatter |

**Notable:** there is **no build artifact**. `npm run build` is `tsc --noEmit` — pure type checking. All services start with `tsx src/…ts` directly. This was deliberate: the Railway host was previously serving a stale `apps/voice-gateway/dist/` build, and running from source removed that class of bug.

---

## 5. Architecture — the two voice pipelines

This is the single most important thing to understand about the repo. **Two entirely separate voice stacks exist, and they must never be mixed on the same phone number.**

| | **Option 1 — ElevenLabs ConvAI** | **Option 2 — Robinexis Gateway** |
|---|---|---|
| Who hears | ElevenLabs STT | Groq Whisper |
| Who thinks | ElevenLabs managed agent | Groq Llama 3.3 70B |
| Who speaks | ElevenLabs TTS | ElevenLabs TTS |
| Who orchestrates | ElevenLabs dashboard | `apps/voice-gateway` (this repo) |
| Number | `+447446868067` (Smith England, **live**) | `TWILIO_SANDBOX_PHONE_NUMBER` |
| Tenant | `client_smith_england` (`voicePipeline: "elevenlabs-convai"`) | `robinexis-demo` (`voicePipeline: "groq-gateway"`) |
| Status | Live production fallback — **do not re-route** | Sandbox / proving ground |

The `voicePipeline` field on `ClientConfig` is the enforcement point. Three places check it:

1. `apps/voice-gateway/src/server.ts` → `/twiml` refuses to open a media stream for a non-gateway tenant and returns fallback TwiML instead.
2. The WebSocket `start` handler → closes the socket and releases the reservation if the tenant isn't gateway-pipeline.
3. `apps/worker/src/index.ts` → refuses to dial outbound for a non-gateway tenant.

Plus `demoCall.ts` hard-codes `LIVE_SALON_NUMBER = "+447446868067"` and refuses to dial *from* it.

### The production runtime path (Option 2)

```
   Caller                Twilio               voice-gateway (:8080)              Providers
     │                     │                          │                              │
     │──── dials ─────────▶│                          │                              │
     │                     │── POST /twiml ──────────▶│                              │
     │                     │                          │ signature check              │
     │                     │                          │ tenant lookup                │
     │                     │                          │ pipeline / billing / usage    │
     │                     │                          │ Redis reserve slot           │
     │                     │◀── <Connect><Stream> ────│  (+ HMAC stream token)       │
     │                     │                          │                              │
     │◀═══ audio ═════════▶│═══ WS /media-stream ════▶│                              │
     │                     │   (µ-law 8k base64)      │── WAV ──▶ Groq Whisper ──────▶│
     │                     │                          │◀─ text ──                    │
     │                     │                          │── msgs+tools ▶ Groq Llama ───▶│
     │                     │                          │◀─ tool calls / reply ─       │
     │                     │                          │── tool exec ▶ Cal.com etc ───▶│
     │                     │                          │── text ─▶ ElevenLabs TTS WS ─▶│
     │◀═══ µ-law audio ════│◀══ media frames ═════════│◀─ audio chunks ──            │
```

### Component responsibilities

- **Twilio** — PSTN in/out, bidirectional media, signed webhooks, answering-machine detection, `<Dial>` transfers.
- **voice-gateway** — the only component that touches live audio. Auth, tenant routing, capacity, session lifecycle.
- **brain** — provider-neutral. Owns the frozen system prompt, message history, the tool-call loop, abort/barge-in.
- **integrations** — every outward call (Cal.com, Twilio, Stripe, Google/Microsoft), plus the guard layer around tools.
- **database** — the only place that knows about Postgres/Redis. Everything else takes a `PlatformStore`.
- **api** — no audio. Admin CRUD, publish, transcripts, usage, Stripe + Twilio-status webhooks, the demo page.
- **worker** — no audio. Time-driven work: outbound dialing, Stripe reconcile, data retention.

---

## 6. End-to-end flows

### 6.1 Inbound call (groq-gateway pipeline)

**Step 1 — Twilio posts to `/twiml`** (`apps/voice-gateway/src/server.ts`)

1. Ensure the store is seeded if empty.
2. Read the form body; validate `X-Twilio-Signature` against `PUBLIC_BASE_URL + path + query`. Invalid → `403`.
   - In local dev with no `TWILIO_AUTH_TOKEN`, validation passes (it only fails open when `RAILWAY_ENVIRONMENT` is unset).
3. Resolve the tenant: `?clientId=` (published only) → else by inbound number (`To`/`Called`) → else `DEFAULT_CLIENT_SLUG` (`robinexis-demo`).
4. No tenant → fallback TwiML (`<Say>` + `<Dial>` front desk, or `<Redirect>` to voicemail URL, or apologise and hang up).
5. Not `groq-gateway` → log `pipeline_not_gateway`, fallback TwiML. **This is the live-number guard.**
6. Outbound + `AnsweredBy` starts with `machine` → mark the job `completed/voicemail`, speak a short non-sensitive message, hang up.
7. **Access gate:** `isAiServiceEnabled(client)` for the direction, `enabledFeatures` contains `inbound`/`outbound`, `GROQ_API_KEY` present, and monthly usage under `monthlyMinuteLimit`. Any failure → fallback TwiML with a structured `inbound_fallback` log.
8. **Capacity gate:** `redis.reserveCallSlot(clientId, reservationId, maxConcurrentCalls)` — an atomic Lua script over a sorted set. Rejected → "All lines are busy" + `<Dial>`.
9. Emit `<Connect><Stream url="wss://host/media-stream">` with `<Parameter>`s: `clientId`, `direction`, `objective`, `fromPhone`, `reservationId`, `streamExpires` (now + 5 min), `streamToken` (HMAC-SHA256 of `clientId:reservationId:expires` keyed by `TWILIO_AUTH_TOKEN`), and `jobId` when outbound.

**Step 2 — Twilio opens the WebSocket**

1. Only `/media-stream` upgrades; anything else destroys the socket.
2. On the `start` frame, `validStreamToken()` checks expiry and does a `timingSafeEqual` comparison. Fail → release the reservation, close.
3. Re-fetch the published client; re-check the pipeline. Fail → release, close.
4. `createCallSession(...)` builds the live session.

**Step 3 — session boot** (`callSession.ts`)

1. Build a `CallSession` row (`state: "live"`, `status: "active"`).
2. Load the **frozen system prompt**: the client's `promptVersionId`, else the latest prompt. If it doesn't contain `"Approved facts:"` it's treated as a stub — a fresh prompt is compiled, saved as a new version, and attached to the client.
3. Construct `BrainSession(GroqDriver, toolExecutor, client, dbCall, greeting, frozenPrompt)`.
4. Persist the call to Postgres and Redis; refresh the capacity reservation every 60 s.
5. If any of this throws → release the slot and **transfer the live call to the front desk** via the Twilio call-update API.
6. Immediately `speak(greeting)`.

**Step 4 — the audio loop**

- Every `media` frame → `stt.sendAudio(chunk)`.
- **VAD** (`groqWhisperStt.ts`): each 20 ms µ-law chunk is decoded to PCM16 and RMS'd. RMS > `VAD_ENERGY_THRESHOLD` (default 500) for 2 consecutive chunks ⇒ speech started (with 5 chunks of pre-roll retained so the first syllable isn't clipped). `onSpeechStarted` fires **barge-in** instantly and locally — no API round trip.
- Silence for `VAD_SILENCE_MS` (default 500 ms) ⇒ finalize. Buffers under 800 bytes are discarded as noise. The utterance is wrapped in a 44-byte WAV header (8 kHz, mono, 16-bit) and sent to Groq Whisper with `language: "en"`.
- **Barge-in** aborts the in-flight LLM turn, closes only the active ElevenLabs TTS context, and sends Twilio a `clear` event to flush queued playback. The per-call TTS WebSocket remains connected for the next turn.

**Step 5 — speaking**

`streamTts()` opens `wss://api.elevenlabs.io/v1/text-to-speech/{voiceId}/stream-input?model_id=…&output_format=ulaw_8000`, sends a priming frame with voice settings, the text with `try_trigger_generation`, then an empty terminator. Audio chunks arrive base64 and go straight out as Twilio `media` frames — **no transcoding**, because both sides speak µ-law 8 kHz.

If TTS fails (and it wasn't an intentional abort), the call is transferred to the front desk.

### 6.2 One conversational turn (inside `BrainSession`)

```
handleUserTurn(transcript)
  ├─ abort any previous turn, create a new AbortController
  ├─ push redactSensitiveText(transcript) to the persisted transcript
  ├─ push the raw text to the LLM message history
  └─ loop up to MAX_TOOL_ITERATIONS (8):
       ├─ llm.complete({ system: frozenPrompt, messages, tools, signal })
       ├─ aborted?               → { type: "aborted" }
       ├─ no tool calls?         → push assistant text, log it, { type: "speak", text }
       ├─ transfer_to_human?     → { type: "transfer", reason }   (short-circuits)
       └─ otherwise: execute every tool call, append each result as a `tool` message,
                     record it in call.toolHistory, and loop again
  └─ loop exhausted → speak the safe fallback:
       "Sorry, I'm having trouble with that — let me get someone from the team to call you back."
```

Key properties:
- The **system prompt is frozen for the whole call** — republishing config mid-call cannot change a live conversation.
- Only `transfer_to_human` escapes the loop early; every other tool feeds its JSON result back to the model.
- Failed tools are still recorded (with `error`) and their error is handed to the model so it can recover verbally.
- Card numbers (13–19 digits) and SSN-shaped strings are redacted **before** anything is written to the transcript.

### 6.3 Outbound campaign (worker → Twilio → gateway)

A job is created by `POST /jobs` on the API (`campaign`, `contactPhone`, `scheduledAt`, `maxAttempts`, `approved`). Duplicate active jobs for the same phone + campaign (+ optional `sourceRecordId`) are rejected with `409`.

The worker ticks every `WORKER_POLL_MS` (default 15 s) and for each due job runs this gauntlet **in order**:

| # | Check | Fail behaviour |
|---|---|---|
| 1 | Published client exists | `failed` / `client_missing` |
| 2 | `isGroqGatewayPipeline` | skip + log (never dial the live ElevenLabs number) |
| 3 | Billing allows outbound + `enabledFeatures` includes `outbound` | skip + log |
| 4 | Monthly minute limit not exceeded | skip + log |
| 5 | No other job already `dialing` for the same phone + campaign | `cancelled` / `duplicate_of:…` |
| 6 | Number not on the suppression list | `suppressed` |
| 7 | Approval if `firstCampaignRequiresApproval` | skip + log |
| 8 | Inside the UK calling window (08:00–21:00 Europe/London, skip Sunday) | silent skip |
| 9 | `attemptCount < maxAttempts` | `failed` / `max_attempts` |
| 10 | Dials in the last hour < `outboundRatePerHour` | skip + log |
| 11 | `store.claimJob()` — an atomic conditional UPDATE | skip (another worker won) |
| 12 | `PUBLIC_BASE_URL`, caller ID and `API_PUBLIC_BASE_URL` all set | `failed` / `not_configured` |

Then `placeOutboundCall()` with `machineDetection: "Enable"`, a TwiML URL pointing at the gateway with `direction=outbound&clientId=…&jobId=…`, and a `statusCallback` to the API.

**Status callback → `applyOutboundStatus()`:**

| Twilio result | Job status | Disposition |
|---|---|---|
| `AnsweredBy` starts `machine*` | `completed` | `voicemail` |
| `completed` | `completed` | `answered-completed` (unless already set) |
| `busy` / `no-answer`, attempts left | `approved`, rescheduled **+1 hour** | `busy` / `no-answer` |
| `busy` / `no-answer`, attempts exhausted | `failed` | `busy` / `no-answer` |
| anything else | `failed` | `failed` (+ `lastError`) |

The worker also runs, at most once every 24 h: `reconcileStripe()` (re-pull every subscription) and retention deletion of calls older than `DATA_RETENTION_DAYS` (default 90, minimum 1).

### 6.4 "Call Me Now" demo call

`GET http://localhost:8081/demo` serves `demo.html` — a single-field form. `POST /demo/call` then:

1. Seeds the store if empty.
2. Rate limits on `ip:phone` — **5 calls per 10 minutes** (in-memory bucket) → `429`.
3. Loads the `robinexis-demo` tenant (published, else by slug) → `503 demo_tenant_missing`.
4. `startSandboxDemoCall()`:
   - Normalises and validates E.164 (`^\+[1-9]\d{7,14}$`) → `400 invalid_phone`.
   - `assertDemoTenant()` — must be the demo id/slug, groq-gateway, and published → `503 demo_tenant_not_ready`.
   - Billing + `outbound` feature → `403 demo_outbound_disabled`.
   - `TWILIO_SANDBOX_PHONE_NUMBER` set → `503 sandbox_number_not_configured`.
   - **Sandbox number must not be `+447446868067`** → `503 live_salon_number_forbidden`.
   - `PUBLIC_BASE_URL` set → `503 public_base_url_not_configured`.
   - Dials `{PUBLIC_BASE_URL}/twiml?direction=outbound&clientId=robinexis-demo`.
5. Returns `{ ok: true, callSid }`.

`PUBLIC_BASE_URL` must point at the **gateway** (`:8080` / its ngrok tunnel), not the API — this is the single most common local-setup mistake.

### 6.5 Post-call finish sequence

When the WebSocket stops or closes, `close()` runs: barge-in, close STT, clear the reservation-refresh interval, then `finishCall()`:

1. `status: "active"` → `"completed"` (a `transferred`/`failed` status is preserved).
2. `noteFromCall()` builds two summaries from **verified data only** — successful tool results plus redacted caller lines. The calendar summary is capped at 500 characters.
3. Save a `CallNote` with `fullTranscriptHeld: true` (the full transcript stays in the DB, never on the calendar).
4. Execute `write_crm_note` through the normal tool executor (persists locally; external CRM only if an adapter is injected).
5. If the call produced a booking, execute `append_calendar_note` with idempotency key `{callId}:calendar-note`. Verbatim transcript only if `calendarNoteMode === "verbatim"`.
6. If the call came from an outbound job, close that job with the right disposition.
7. Add usage: elapsed time ceiling'd to whole minutes, minimum 1, attributed to inbound or outbound.
8. Save the call.
9. **Finally** — always — release the Redis capacity slot.

### 6.6 Stripe billing → access control

```
Stripe event ──▶ POST /webhooks/stripe ──▶ constructEvent (signature verified)
                                            │
                    handled: customer.subscription.{created,updated,deleted},
                             invoice.paid, invoice.payment_failed
                                            │
                    resolve subscription (retrieve it for invoice.* events)
                                            │
                    match client by stripeCustomerId or stripeSubscriptionId
                                            │
                    serviceStatus = stripeStatusToLocal(sub.status)
                    past_due  → stamp pastDueAt
                    active/trialing → clear pastDueAt
                    applyPlanMapping(price.id → enabledFeatures + monthlyMinuteLimit)
```

`isAiServiceEnabled()` then decides, per call:

| Condition | enabled | inbound | outbound | reason |
|---|---|---|---|---|
| not published | ✗ | ✗ | ✗ | `config_not_published` |
| `trialing` / `active` | ✓ | ✓ | ✓ | status |
| `past_due` within `STRIPE_GRACE_DAYS` (3) | ✓ | ✓ | **✗** | `past_due_grace` |
| `past_due` beyond grace | ✗ | ✗ | ✗ | `past_due_expired` |
| `canceled`/`unpaid`/`paused`/`incomplete`/`incomplete_expired` | ✗ | ✗ | ✗ | status |

Grace period logic: inbound keeps working (a real customer's phone shouldn't die over a failed card) but outbound campaigns stop immediately.

`STRIPE_PRICE_FEATURES_JSON` maps a Stripe Price ID to features and a minute cap, e.g.:
```json
{"price_abc":{"enabledFeatures":["inbound","booking","transfer"],"monthlyMinuteLimit":500}}
```

**The conversational brain never receives Stripe keys.** Billing is a separate service boundary, stated in the compiled prompt as a hard rule ("Never claim Stripe or billing status").

### 6.7 Sales demo build (`/demo-build`)

Completely separate from the phone platform — no Twilio, no Postgres, no gateway.

```
"build a demo for {url}"
   │
   ├─ Step 0  preflight: elevenlabs --version · auth whoami · agents.json exists
   ├─ Step 1  gather: prospect URL + 2–3 line brief (industry · job · tone)
   │            default if absent: after-hours capture + booking, warm-professional
   ├─ Step 2  scrape homepage + about/services/pricing/contact/FAQ → fact sheet
   │            ONLY facts on the site. Unknowns → "a human will confirm."
   ├─ Step 3  fill a template from os/references/system-prompt-library.md
   ├─ Step 4  write agent_configs/*.json, `elevenlabs agents add` + `push`
   │            name: "Demo — {Business} — {YYYY-MM-DD}"
   ├─ Step 5  return: test link + <elevenlabs-convai> widget snippet + pitch line
   └─ Step 6  log one row in brains/robinexis/outputs/demos/demo-log.md
              and one line in brains/robinexis/log.md
```

Fallback without a CLI: create the agent by hand in the ElevenLabs dashboard — same result, slower. Housekeeping rule: demos older than ~30 days with no live deal get deleted.

---

## 7. Monorepo reference — package by package

### 7.1 `@robinexis/tool-contracts`

Zero dependencies. The contract every other package agrees on.

- `TOOL_NAMES` — 12 names as a const tuple, giving the `ToolName` union.
- `OUTCOME_STATUSES` — 9 dispositions → the `CallOutcome` union.
- `TOOL_DEFINITIONS` — provider-neutral JSON Schema definitions (mapped into Groq `function` tools by `GroqDriver`, and into prompt text by `compilePrompt`).
- `requiredFieldsFor(name)` — used by the executor to reject incomplete calls before any network I/O.

Keeping this package dependency-free is what makes the LLM provider swappable.

### 7.2 `@robinexis/brain`

**`compiler.ts`** — `compilePrompt({ client, direction, objective })` produces the full system prompt (see §10). `greetingFor(client)` produces the opening line.

**`llm.ts`** — the provider boundary:
```ts
interface LlmDriver {
  complete(args: { system, messages, tools, signal? }): Promise<LlmTurn>
}
```
`LlmMessage` covers user/assistant text, assistant-with-tool-calls, and tool results. `ScriptedLlm` replays a fixed script for tests — this is why the whole conversation engine is testable without an API key.

**`groq.ts`** — `GroqDriver` (throws immediately if `GROQ_API_KEY` is missing), `toGroqMessages()` prepends the system message and maps each message shape, `turnFromGroqMessage()` maps back and safely `JSON.parse`s tool arguments (returning `{}` on malformed JSON rather than throwing). `max_completion_tokens: 1024`, `tool_choice: "auto"`.

**`session.ts`** — `BrainSession`, described in §6.2.

**`notes.ts`** — `noteFromCall()` and `redactSensitiveText()` (card numbers `\b(?:\d[ -]*?){13,19}\b` → `[card redacted]`, `\d{3}-\d{2}-\d{4}` → `[id redacted]`).

### 7.3 `@robinexis/database`

**`memory.ts`** — defines `PlatformStore`, the ~25-method interface everything codes against, and `MemoryStore`, a complete in-memory implementation used by tests and local fallback.

**`postgres.ts`** — `PostgresStore`. Design choice: **entities are stored as JSONB blobs** (`clients.config`, `call_sessions.payload`, `outbound_jobs.payload`, `call_notes.payload`) with only routing columns promoted (`id`, `slug`, `client_id`, `updated_at`). Two operations are genuinely atomic and matter under concurrency:
- `claimToolAction()` — `INSERT … ON CONFLICT (client_id, idempotency_key) DO NOTHING RETURNING id`, so only one caller can claim an idempotency key.
- `claimJob()` — a conditional `UPDATE` with nested `jsonb_set` that only fires when the job is still `approved` + `approved:true`, and atomically bumps `attemptCount` and `lastAttemptAt`.

**`redis.ts`** — `RedisSessionCache`. Two jobs:
- Live call cache: `call:{clientId}:{callId}`, 4-hour TTL.
- **Concurrency reservations** via a sorted set `active-calls:{clientId}` scored by expiry, manipulated by a single Lua script (prune expired → check `ZCARD` against the limit → `ZADD` → `PEXPIRE`). Atomic across processes.
- Degrades gracefully: with no `REDIS_URL` it uses an equivalent in-process `Map`, so single-instance local dev still enforces limits.

**`store.ts`** — `getStore()` singleton: if `DATABASE_URL` exists and isn't a placeholder containing `example`, try Postgres with a `SELECT 1` probe. On failure, throw if `REQUIRE_DATABASE=true` or `RAILWAY_ENVIRONMENT` is set, otherwise warn and fall back to `MemoryStore`. **Production can never silently run on memory.**

**`access.ts`** — `voicePipelineOf` / `isGroqGatewayPipeline` (defaults to `groq-gateway` for anything not explicitly `elevenlabs-convai`), `isAiServiceEnabled`, `stripeStatusToLocal` (allow-list, unknown → `incomplete`), `redactSecrets` (recursive: strips `sk_live_*`, `sk_test_*`, `Bearer …`, `cal_live_*`, `xi-*`, and any key matching `/key|token|secret|password|authorization/i`), and `structuredLog(event, fields)` which emits redacted single-line JSON.

**`seed.ts`** — two tenants:
- `client_smith_england` / `smith-england-salon` — `elevenlabs-convai`, no inbound numbers, 5 services, real awards as `publishedFacts`, `unknownTopics: ["opening hours", "prices", "specific stylist availability"]`. In production it seeds **unpublished + `incomplete`** so it can never accidentally answer.
- `robinexis-demo` — `groq-gateway`, published, `trialing`, outbound enabled, bound to the sandbox number.

### 7.4 `@robinexis/integrations`

**`tools.ts` — `createToolExecutor()`**, the security-critical layer. Order of operations for every single tool call:

1. **Tenant check** — `call.clientId === client.id`, else `tenant_mismatch`.
2. **Feature gate** — booking tools need `booking`, `transfer_to_human` needs `transfer`, `send_confirmation` needs `notifications`, `mark_call_outcome` needs `outbound`.
3. **Schema check** — every `required` field present and non-empty, else `missing_fields:a,b`.
4. **Idempotency** — if a key is supplied: a prior success replays its result; a prior `pending` returns `idempotent_action_in_progress`; a prior failure returns its error; otherwise atomically claim the key.
5. **Execute** — the tool body.
6. **Record** — success or failure is always written to `tool_actions`.

Secrets are resolved by **reference**, not value: `client.calendar.credentialRef` is an env var *name* (e.g. `CALCOM_API_KEY`) that `resolveSecret` looks up. Raw credentials in a client payload are rejected at the API layer.

**`calcom.ts`** — Cal.com v2 with per-endpoint API versions (`2024-09-04` slots, `2024-08-13` create, `2026-02-25` reschedule/cancel/references). Availability flattens the day-keyed response into a sorted `slots[]`. Bookings carry `metadata.conversationId` so a booking traces back to a call.

**`calendarNotes.ts`** — reads Cal.com booking *references* to find the underlying Google/Outlook event, then appends (never overwrites): Google gets `description` + `\n---\n`, Outlook gets a `<hr/>` or `\n---\n` depending on `contentType`, with HTML escaping.

**`compliance.ts`** — `inCallingWindow()` uses `Intl.DateTimeFormat` with the tenant's IANA timezone so DST is handled correctly. `COMPLIANCE_NOTES` records the UK PECR position and the 90-day retention default.

**`stripe.ts`, `twilioOutbound.ts`, `demoCall.ts`, `notifications.ts`, `outboundStatus.ts`, `finishCall.ts`, `fakeCalendar.ts`** — covered in §6.

### 7.5 `@robinexis/api`, `@robinexis/voice-gateway`, `@robinexis/worker`

Covered in §6 and §11. All three load the repo-root `.env`, seed on boot if the store is empty, and exit non-zero on a failed start with a structured log.

---

## 8. Data model

### 8.1 SQL schema (`packages/database/src/schema.sql`)

| Table | Columns | Notes |
|---|---|---|
| `clients` | `id` PK, `slug` UNIQUE, `config` JSONB, `created_at` | the whole `ClientConfig` lives in `config` |
| `prompt_versions` | `id` PK, `client_id` FK, `version`, `compiled`, `created_at` | unique on `(client_id, version)` |
| `call_sessions` | `id` PK, `client_id` FK, `payload` JSONB, `created_at`, `updated_at` | index on `client_id` |
| `tool_actions` | `id` PK, `call_id`, `client_id`, `name`, `input`, `result`, `error`, `idempotency_key`, `at` | **partial unique index** on `(client_id, idempotency_key)` where the key is not null |
| `outbound_jobs` | `id` PK, `payload` JSONB | |
| `suppressions` | PK `(client_id, phone)`, `reason`, `created_at` | do-not-call list |
| `call_notes` | `id` PK, `payload` JSONB | |
| `usage_counters` | PK `(client_id, month)`, `inbound_minutes`, `outbound_minutes` | month is `YYYY-MM` |

### 8.2 `ClientConfig` — the tenant record

```ts
{
  id, slug, businessName, role, tone, location, phone, email, transferNumber,
  voiceId,                    // ElevenLabs voice
  voicePipeline,              // "elevenlabs-convai" | "groq-gateway"  ← the routing switch
  services: [{ slug, title, durationMinutes }],
  staff: string[],
  hours?, prices?,            // optional ON PURPOSE — absent means "not published"
  policies: string[],
  publishedFacts: string[],   // the ONLY facts the agent may state
  unknownTopics: string[],    // must hand off, never guess
  calendar: { provider: "calcom"|"google"|"outlook"|"fresha", username?, credentialRef? },
  calendarNotes?: { provider: "google"|"outlook", credentialRef, calendarId? },
  calendarNoteMode: "summary" | "verbatim",
  enabledFeatures: string[],  // inbound, outbound, booking, transfer, notifications
  inboundNumbers: string[],   // E.164; globally unique across tenants
  outboundCallerId?,
  callingWindow: { tz, startHour, endHour, skipSunday },
  maxConcurrentCalls, outboundRatePerHour, firstCampaignRequiresApproval,
  published: boolean,         // false after every edit — must re-publish
  serviceStatus: ServiceStatus,
  subscribedProduct?, monthlyMinuteLimit?, pastDueAt?,
  stripeCustomerId?, stripeSubscriptionId?,
  promptVersionId?            // the frozen prompt this tenant answers with
}
```

`ServiceStatus` = `trialing | active | past_due | canceled | unpaid | incomplete | incomplete_expired | paused` (mirrors Stripe).

### 8.3 `CallSession`

`id, clientId, direction, objective, twilioCallSid?, contactPhone?, contactId?, appointmentId?, outboundJobId?, promptVersionId, transcript[], collected{}, toolHistory[], state, status, outcome?, createdAt, updatedAt`

- `transcript[]` = `{ role: "caller"|"agent"|"system", text, at }` — **already redacted**.
- `toolHistory[]` = `{ name, input, result, error?, idempotencyKey?, at }` — the audit trail.
- `status` = `active | completed | transferred | failed`.

### 8.4 `OutboundJob`

`id, clientId, campaign, contactPhone, contactName?, sourceRecordId?, purpose, scheduledAt, attemptCount, lastAttemptAt?, maxAttempts, status, approved, lastError?, disposition?`

- `campaign` = `appointment-reminder | rebooking | missed-callback | waitlist-slot | disruption-reschedule`
- `status` = `pending | approved | dialing | completed | suppressed | failed | cancelled`

### 8.5 Redis keys

| Key | Type | TTL | Purpose |
|---|---|---|---|
| `call:{clientId}:{callId}` | string (JSON) | 4 h | live call snapshot |
| `active-calls:{clientId}` | sorted set | reservation TTL + 60 s | concurrency reservations, scored by expiry |

---

## 9. Tool contracts (the 12 agent tools)

| # | Tool | Required fields | Feature gate | Guard |
|---|---|---|---|---|
| 1 | `get_business_info` | — | — | unknown hours/prices return an honest "not published" |
| 2 | `check_availability` | `eventTypeSlug`, `start`, `end` | `booking` | **only returned slots may be offered** |
| 3 | `create_booking` | `eventTypeSlug`, `start`, `attendeeName`, `attendeeEmail`, `idempotencyKey`, `callerConfirmed` | `booking` | `callerConfirmed !== true` → `caller_confirmation_required` |
| 4 | `reschedule_booking` | `bookingUid`, `newStart`, `callerConfirmed`, `idempotencyKey` | `booking` | same confirmation gate |
| 5 | `cancel_booking` | `bookingUid`, `summaryRepeated`, `callerConfirmed`, `idempotencyKey` | `booking` | must repeat the appointment back before cancelling |
| 6 | `create_callback` | `name`, `phone`, `reason` | — | stored on the call |
| 7 | `transfer_to_human` | `reason` | `transfer` | short-circuits the brain loop |
| 8 | `send_confirmation` | `channel`, `to`, `template` | `notifications` | requires a prior successful booking (`no_successful_action`) |
| 9 | `write_crm_note` | `summary`, `outcome` | — | local persist; external only with an adapter |
| 10 | `append_calendar_note` | `bookingUid`, `calendarSummary`, `idempotencyKey` | `booking` | verbatim blocked unless `calendarNoteMode === "verbatim"` |
| 11 | `mark_call_outcome` | `outcome` (enum) | `outbound` | controlled vocabulary only |
| 12 | `record_do_not_call` | `phone` | — | adds suppression **and** cancels every pending job for that number |

Every mutating tool requires an `idempotencyKey`. That is what makes a retried or duplicated LLM tool call safe: the second attempt replays the first result instead of double-booking.

---

## 10. Prompt compilation

`compilePrompt()` assembles a deterministic system prompt from the tenant config. Structure:

1. **Identity** — role, business name, location, phone, email.
2. **Tone** — from `client.tone`.
3. **Definition of success** — "a confirmed booking, a human transfer, a captured callback, or a completed outbound objective — without inventing facts."
4. **Approved facts** — bulleted `publishedFacts`. Nothing else may be asserted.
5. **Services** — `Title (slug: x, N min)` so the model can pass a valid `eventTypeSlug`.
6. **Staff / Hours / Prices** — literally `"not listed — do not invent names"` / `"not published"` when absent.
7. **Policies** — bulleted.
8. **Unknown** — the explicit hand-off list.
9. **Conversation phases** — greeting → discovery (one useful question) → action (tools) → confirmation → closing.
10. **Tool rules** — every tool name + description, plus the three hard rules (availability before offering, confirmation + idempotency before mutating, transfer when asked/distressed/tool-down).
11. **Safety** — never invent availability, prices, policies, actions, or tool success; never claim Stripe/billing status; never speak secrets.
12. **Human handoff** — the escalation triggers.
13. **Direction block** — INBOUND objective, or OUTBOUND with explicit human-vs-voicemail detection and "do not leave sensitive information in voicemail."

### Prompt versioning

Prompts are **immutable versions**, not live config:

```
POST /clients/:id/publish
  → compilePrompt(...)
  → save PromptVersion { version: latest + 1 }
  → client.promptVersionId = new id
  → client.published = true
```

Any `PATCH /clients/:id` sets `published: false` and returns `republishRequired: true`. An unpublished client cannot answer calls (`config_not_published`). A live call keeps the prompt it started with.

---

## 11. HTTP API reference

### `apps/voice-gateway` (port 8080, `PORT`)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` · `/health` | none | `{status, service, buildVersion, architecture, dependencies:{postgres,redis}, liveNumberCutover:false}`. Returns **503** if `RAILWAY_ENVIRONMENT` is set and Postgres or Redis is missing. |
| POST | `/twiml` | Twilio signature | Returns `<Connect><Stream>` or fallback TwiML |
| WS | `/media-stream` | HMAC stream token | The audio socket |

A bare `{"status":"ok"}` from `/health` means an old build is still serving — the runbook calls this out explicitly.

### `apps/api` (port 8081, `API_PORT` or `PORT`)

**Public:**

| Method | Path | Description |
|---|---|---|
| GET | `/health` | `{status, service, buildVersion}` |
| GET | `/` · `/dashboard` | operator console (HTML) |
| GET | `/ui/dashboard.css` · `/ui/dashboard.js` | console assets |
| GET | `/demo` | same console, Test Lab tab |
| GET | `/demo/status` | integration flags + gateway health |
| GET | `/demo/calendar` | live Cal.com slot probe (username masked; no bookings) |
| GET | `/demo/twilio-check` | Twilio probe, no call placed |
| GET | `/demo/calls` | recent demo-tenant calls; `?sid=` for one |
| POST | `/demo/call` | `{phone}` → sandbox outbound demo call. Rate limited 5 / 10 min. |
| POST | `/webhooks/twilio/status` | signed; drives `applyOutboundStatus` |
| POST | `/webhooks/stripe` | signed; drives access control |

**Admin** (`Authorization: Bearer $ADMIN_API_KEY`; when `ADMIN_API_KEY` is unset, allowed only outside Railway):

| Method | Path | Description |
|---|---|---|
| GET | `/clients` | id, slug, businessName, serviceStatus, published, access |
| POST | `/clients` | create. Requires `slug`, `businessName`, `calendar.provider`. Rejects raw `apiKey`/`token`/`secret` (`400`), rejects a duplicate inbound number (`409`). Always created **unpublished**. |
| PATCH | `/clients/:id` | update. Immutable: `id`, `serviceStatus`, `stripeCustomerId`, `stripeSubscriptionId`. Sets `published: false`. |
| POST | `/clients/:id/publish` | compile + save a new prompt version, set `published: true` |
| GET | `/clients/:id` | one client, calendar username only — no `credentialRef` |
| GET | `/clients/:id/calls` | recent call sessions |
| GET | `/clients/:id/usage?month=YYYY-MM` | usage counters |
| GET | `/calls/:id` | one full call session |
| GET | `/jobs` | outbound jobs (`?clientId=` optional) |
| POST | `/jobs` | create an outbound job; `409` on duplicate |
| POST | `/jobs/:id/approve` | flip to `approved` |

Every response sets `Cache-Control: no-store`. Unhandled errors log `api_error` and return a bare `{error:"internal"}` — no stack traces leak.

### React SaaS + `/api/v1`

The production React application is built from `apps/web` and served by the API
on `/`, `/login`, `/signup`, `/pricing`, and `/app/*`. The former HTML console
remains at `/operator-legacy`.

Product routes require `Authorization: Bearer $ADMIN_API_KEY` until user
authentication is connected:

- `/api/v1/bootstrap`, `/clients`, `/clients/:id`, and prompt publishing/history
- `/api/v1/calls`, `/analytics/summary`, `/analytics/timeseries`, and `/usage`
- `/api/v1/calendar/slots`, `/calendar/bookings`, reschedule, and cancel
- `/api/v1/jobs`, approve, and cancel
- `/api/v1/integrations/status`
- `/api/v1/knowledge/documents` and `/knowledge/search`

Knowledge sources are tenant-scoped, embedded with Gemini
`gemini-embedding-001` at 768 dimensions, L2-normalized, and stored in
PostgreSQL pgvector. `search_knowledge` is available to live voice calls when
`GEMINI_API_KEY` is configured.

---

## 12. Configuration and environment variables

Copy `.env.example` → `.env` (gitignored). Every service loads the **repo-root** `.env`.

### ElevenLabs
| Var | Default | Used by |
|---|---|---|
| `ELEVENLABS_API_KEY` | — | TTS + `/demo-build` |
| `ELEVENLABS_VOICE_ID` | `L4so9SudEsIYzE9j4qlR` | per-tenant override via `client.voiceId` |
| `ELEVENLABS_MODEL_ID` | `eleven_flash_v2_5` | low-latency model |
| `ELEVENLABS_CHUNK_SCHEDULE` | `50,90,120,150` | persistent TTS generation thresholds |

### Twilio
| Var | Notes |
|---|---|
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` | auth token doubles as the HMAC key for stream tokens |
| `TWILIO_PHONE_NUMBER` | generic fallback caller ID |
| `TWILIO_SANDBOX_PHONE_NUMBER` | the demo tenant's number — **must not** be `+447446868067` |
| `TWILIO_SMS_NUMBER` | SMS sender |

### Groq
| Var | Default |
|---|---|
| `GROQ_API_KEY` | — (absence disables the gateway → fallback TwiML) |
| `GROQ_STT_MODEL` | `whisper-large-v3-turbo` |
| `GROQ_LLM_MODEL` | `openai/gpt-oss-120b` (was `llama-3.3-70b-versatile`, decommissioned 2026-08-16) |
| `GROQ_REASONING_EFFORT` | `low` (voice-optimized) |

### Calendar
`CALCOM_API_KEY`, `CALCOM_USERNAME` — local fallbacks; prefer per-tenant `credentialRef`.

### Handoff
`FRONT_DESK_PHONE_NUMBER` (placeholder `+15555550100` triggers a startup warning), `FALLBACK_VOICEMAIL_URL`.

### Data
`DATABASE_URL`, `REDIS_URL`, `REQUIRE_DATABASE` (`true` forces Postgres; also implied by `RAILWAY_ENVIRONMENT`).

### Stripe
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_GRACE_DAYS` (3), `STRIPE_PRICE_FEATURES_JSON`.

### Networking & ops
| Var | Default | Notes |
|---|---|---|
| `PUBLIC_BASE_URL` | — | **the gateway's** public URL (ngrok) — used for signatures and TwiML URLs |
| `API_PUBLIC_BASE_URL` | — | the API's public URL — used for status callbacks |
| `STRUCTURED_LOG_FILE` | — | mirrors `structuredLog` JSON lines to a file (relative paths resolve to the app's folder) |
| `PORT` | 8080 | gateway |
| `API_PORT` | 8081 | API |
| `WORKER_POLL_MS` | 15000 | worker tick |
| `DATA_RETENTION_DAYS` | 90 | minimum 1 |
| `ADMIN_API_KEY` | — | required for admin routes in production |
| `DEFAULT_CLIENT_SLUG` | `robinexis-demo` | last-resort tenant |
| `STT_PROVIDER` | `groq` | provider boundary for a later realtime STT adapter |
| `VAD_ENERGY_THRESHOLD` | 500 | RMS speech threshold — expect to tune on real phone audio |
| `VAD_SILENCE_MS` | 500 | end-of-utterance hangover |
| `BUILD_VERSION` / `RAILWAY_GIT_COMMIT_SHA` | `local` | surfaced on `/health` |

### Legacy
`MAKE_API_KEY`, `MAKE_ZONE`, `MAKE_TEAM_ID` — the old Make.com 24 h reminder recipe, superseded by the worker.

---

## 13. Local development — step by step

```bash
# 1. Secrets
cp .env.example .env
#    Fill at minimum: GROQ_API_KEY, ELEVENLABS_API_KEY,
#    TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_SANDBOX_PHONE_NUMBER

# 2. Infrastructure
docker compose up -d          # Postgres 16 + pgvector :5433, Redis 7 :6379

# 3. Dependencies + schema + tenants
npm install
npm run db:migrate
npm run db:seed

# 4. Prove it
npm run verify                # tsc --noEmit && vitest run
```

Then, in three terminals:

```bash
npm run dev:api        # :8081  admin + webhooks + /demo
npm run dev:gateway    # :8080  TwiML + media stream
npm run dev:worker     #        outbound + reconcile + retention
```

**Exposing the gateway** (required for any real call):

```bash
ngrok http 8080
# Put that HTTPS URL in .env as PUBLIC_BASE_URL      ← the GATEWAY, not the API
# Point the SANDBOX Twilio number's Voice webhook at: POST {PUBLIC_BASE_URL}/twiml
# If you also need status callbacks, tunnel :8081 and set API_PUBLIC_BASE_URL
```

Then open `http://localhost:8081/demo`, enter an E.164 number, and press **Call Me Now**.

### Common failure modes

| Symptom | Cause |
|---|---|
| `Invalid Twilio signature` (403) | `PUBLIC_BASE_URL` doesn't exactly match the URL Twilio signed (http vs https, trailing slash, wrong tunnel) |
| Caller hears Twilio's own "an application error has occurred" | `PUBLIC_BASE_URL` is a stale or placeholder tunnel, so Twilio cannot fetch TwiML at all. Compare `.env` against `curl http://127.0.0.1:4040/api/tunnels`, then restart `dev:api` and `dev:gateway` |
| Caller is transcribed but the agent never replies, then the call transfers or ends | `brain_failed` — the Groq chat model rejected the request. Usually a retired model ID: check `GROQ_LLM_MODEL` against [Groq's deprecations](https://console.groq.com/docs/deprecations). Set `STRUCTURED_LOG_FILE` and read the `brain_failed` line for the status code |
| Fallback TwiML instead of the agent | tenant is unpublished, wrong pipeline, billing blocked, `GROQ_API_KEY` missing, or over the minute limit — check the `inbound_fallback` log line's `reason` |
| `demo_tenant_missing` | store not seeded — run `npm run db:seed` |
| `live_salon_number_forbidden` | `TWILIO_SANDBOX_PHONE_NUMBER` is set to the live salon number |
| `public_base_url_not_configured` | `PUBLIC_BASE_URL` empty |
| Agent talks over the caller | tune `VAD_ENERGY_THRESHOLD` / `VAD_SILENCE_MS` |
| `[database] Postgres unavailable, using memory store` | Docker isn't up — fine locally, fatal in production |

---

## 14. Deployment (Railway) and CI

### Services

| Service | Config | Start command | Public domain | Healthcheck |
|---|---|---|---|---|
| gateway | `.railway/railway.ts` | `npm run start -w @robinexis/voice-gateway` | yes | `/health` (30 s) |
| api | `.railway/railway.ts` | `node scripts/railway.mjs migrate && npm run start -w @robinexis/api` | yes (`PORT` from Railway) | `/health` (30 s) |
| worker | `.railway/railway.ts` | `npm run start -w @robinexis/worker` | no | — |

All three: NIXPACKS, `buildCommand = "node scripts/railway.mjs <api|gateway|worker>"`. Restart policy is set in the dashboard / IaC apply. Postgres is **Supabase**, not Railway Postgres; Redis is a Railway plugin referenced as `Redis`.

The production hostname `robinexis-aios-production.up.railway.app` must be preserved.

### Pre-deploy checklist (from the runbook)

- Record the current deployment ID/commit and start command for rollback.
- Railway service root = repository root.
- **No service uses `node apps/voice-gateway/dist/server.js`** (the stale-build trap).
- The **sandbox** Twilio number — not `+447446868067` — posts to `{host}/twiml`.
- Secret *values* only in Railway Variables.
- `CALCOM_USERNAME` + key confirmed as belonging to the salon before any live booking.

### Post-deploy verification

`/health` must include `service`, `buildVersion` and `architecture`. Then run sandbox calls covering: greeting, interruption (barge-in), availability, a confirmed booking, transfer, a forced provider failure, two concurrent tenants, and one approved outbound reminder. **Do not move a customer number until all pass.**

### Rollback

Use Railway's previous successful deployment. **Never change the customer's Twilio routing during a code rollback** — if the gateway is down, TwiML must still route to a human or voicemail.

### CI

`.github/workflows/platform-ci.yml` — on PR and push to `main`: checkout → Node 22 with npm cache → `npm ci` → `npm run build` → `npm test`. 15-minute timeout.

---

## 15. Testing and evaluations

`packages/evaluations/src/platform.test.ts` is the whole suite, and it runs **without any API key, phone line, or audio** — the `ScriptedLlm` + `FakeCalendar` + `MemoryStore` trio makes the conversation engine fully deterministic.

| Group | What it proves |
|---|---|
| prompt compiler | identity, tool list, "never invent", and INBOUND vs OUTBOUND blocks all appear |
| access control | Stripe status mapping; `canceled` kills inbound; `past_due` keeps inbound but kills outbound |
| secret redaction | `Authorization: Bearer cal_live_abc` → `[redacted]`, ordinary fields untouched |
| no invented slots | the agent offers 10am (a real tool result) and never 3pm |
| booking confirmation | `callerConfirmed: false` is rejected; the same idempotency key twice returns the identical result |
| honest unknowns | asking about prices produces a hand-off, not a number |
| transfer | `transfer_to_human` returns `{ type: "transfer", reason }` |
| reschedule/cancel/DNC | confirmation required; DNC suppresses the number **and** flips pending jobs to `suppressed` |
| post-call notes | a card number in the transcript never reaches the CRM summary or the calendar note |
| tenant isolation | `call.clientId ≠ client.id` is rejected |
| calling window | Sunday is skipped |
| Groq mapping | tool calls survive the round trip in both directions |
| prompt freezing + abort | the frozen prompt is what reaches the LLM; `abortTurn()` yields `{type:"aborted"}`; the transcript shows `[card redacted]` |
| Redis reservations | limit enforced, per-tenant isolated, capacity released |
| outbound status machine | retry / voicemail / final-failure transitions |
| Twilio signature | an invalid signature is rejected when a token is configured |
| dual pipeline | Smith England stays `elevenlabs-convai` with no inbound numbers; the demo tenant is `groq-gateway`; `assertDemoTenant` accepts only the demo |
| demo call guards | bad E.164, the live salon number, and a missing base URL are all rejected |

Run: `npm test` · type check: `npm run typecheck` · both: `npm run verify`.

---

## 16. Security, safety rails, and compliance

### Authentication and integrity

| Surface | Mechanism |
|---|---|
| Twilio → `/twiml`, `/webhooks/twilio/status` | `twilio.validateRequest` HMAC signature. Fails **closed** in production, open only when no token is configured outside Railway. |
| Twilio → `/media-stream` | Custom HMAC-SHA256 token over `clientId:reservationId:expires`, 5-minute expiry, `timingSafeEqual` comparison |
| Stripe → `/webhooks/stripe` | `stripe.webhooks.constructEvent` signature verification |
| Admin API | `Bearer $ADMIN_API_KEY`; in production a missing key denies everything |
| `/demo/call` | E.164 validation + 5-per-10-minute rate limit per `ip:phone` |

### Secret handling

- `.gitignore` blocks `.env*` (except the example), `*.key`, `*.pem`, service accounts, `credentials.json`, `token.json`.
- Client records store **credential references** (env var names), never values. The API rejects any `calendar` object containing `apiKey`/`token`/`secret` with `400 raw_credentials_forbidden_use_credentialRef`.
- `redactSecrets()` scrubs every structured log line, recursively, both by value pattern and by key name.
- The compiled prompt forbids the agent from ever speaking a secret or claiming billing status.

### Anti-hallucination (the product-defining rails)

1. `publishedFacts` is a closed set — nothing else may be asserted.
2. `unknownTopics` forces an explicit hand-off.
3. Absent `hours`/`prices` render as "not published", and `get_business_info` returns `{unknown: true, message: "…A human will confirm."}`.
4. Slots may only come from `check_availability`.
5. Mutations need `callerConfirmed: true` **and** an idempotency key.
6. `cancel_booking` needs `summaryRepeated` — the agent must read the appointment back.
7. The system prompt is frozen per call and versioned per publish.
8. Tool failures surface as errors to the model, never as silent success.

### PII and data protection

- Card numbers and SSN-shaped strings are redacted **before** persistence.
- CRM/calendar notes derive only from **successful** tool results plus redacted caller lines.
- Full transcripts stay in the database (`fullTranscriptHeld: true`) and never go onto a shared calendar unless the tenant explicitly opts into `verbatim`.
- Retention: calls older than `DATA_RETENTION_DAYS` (default 90) are hard-deleted daily by the worker.

### Outbound compliance (UK PECR)

Calling window 08:00–21:00 `Europe/London`, Sunday skipped, timezone-aware via `Intl`. Per-tenant hourly rate cap, max attempts, mandatory suppression check before every dial, `record_do_not_call` takes effect immediately across pending jobs, first campaign requires human approval, and voicemail messages are explicitly non-sensitive.

### Failure behaviour — always toward a human

Every failure path (init error, TTS error, brain error, transfer error, tool unavailable, over capacity, over limit, billing lapsed, unknown tenant) ends in a `<Dial>` to the front desk, a voicemail redirect, or a spoken apology with the business's real number. A capacity reservation is released in a `finally` on every path. The system is designed so that a broken AI still produces an answered phone.

---

## 17. The AIOS vault (knowledge layer)

### The routing rule

Knowledge lives in **brains** under `brains/`. Each brain is a Karpathy-style LLM wiki with the same three-folder vocabulary as everything else:

```
brains/<name>/
  raw/       source material, dropped in verbatim
  wiki/      interpreted pages with [[wikilinks]] + YAML frontmatter
  outputs/   things produced (demos, production records, sandboxes)
  index.md   the catalogue — read first, update on every change
  log.md     append-only timeline
```

**Each fact lives in exactly one place.** Check `index.md` before writing a new page. Nothing personal goes in this repo — it's shared between two people; a personal brain belongs in a separate private repo.

### Skills

Seventeen skills in `.claude/skills/`, each a `SKILL.md` with YAML frontmatter that lets it auto-fire from a plain-English description:

| Skill | When |
|---|---|
| `/demo-build` ⭐ | a prospect URL appears → build the voice-agent demo |
| `/sync` | session start (pull first) and end (push) |
| `/save` | something worth keeping just happened |
| `/session-handoff` | wrapping up — writes `os/handoff.md` |
| `/ingest` | a source landed in `raw/` → route it into a brain |
| `/onboard` | day one — 7-question intake + scaffolding |
| `/audit` | Four-Cs scoreboard + top 3 fixes |
| `/level-up` | weekly — 3Ms interview → ship one automation |
| `/insights` | read-only synthesis → ranked actions with citations |
| `/lint` | diagnose a brain (contradictions, orphans, stale claims) |
| `/brain-compact` | the fix to lint's diagnosis — merge, supersede, digest |
| `/connect` | wire a new tool: research → `.env` → verify → register |
| `/update` | pull upstream template improvements (logic only, never data) |
| `obsidian-markdown`, `obsidian-bases`, `json-canvas` | Obsidian-native authoring |

### Frameworks

- **The 3Ms — operator brain:** Mindset → Method → Machine. Used by `/level-up`. (`os/references/3ms-framework.md`)
- **The 4Cs — architecture:** Context → Connections → Capabilities → Cadence. Scored by `/audit`. (`os/references/4cs-framework.md`)

### Rituals

Session start → `/sync`. Prospect with a website → `/demo-build`. Decision made → log it in `os/decisions/log.md` and `/save`. Source dropped → `raw/` then `/ingest`. Wrapping up → `/session-handoff` + `/save`. Weekly → `/audit`, `/level-up`, `/insights`.

### Connections registry

`os/connections.md` records *that* a tool is wired and by what mechanism (`mcp` / `script` / `export` / `key+ref` / not connected) — **never the credential**. Current state: Stripe, Twilio, Cal.com and Google Calendar wired via `.env`; Slack, Notion, GitHub Issues, Fireflies and Drive listed but not connected.

---

## 18. Decision history and why the stack looks like this

Read `os/decisions/log.md` for the full record. The short version:

| Date | Decision |
|---|---|
| **2026-08-17** | Production wiring built as a *sandbox*, not a customer deploy — the Foundation playbook reserves production for Sturdy Ai, gated on a signed-and-paid deal. |
| **2026-08-19** | Smith England Salon deployed live anyway, on explicit repeated instruction from Will/Ed, on Robinexis's own accounts. `+447446868067` reassigned from the Robinexis receptionist to the salon agent. **Open risk logged, not resolved:** the Cal.com key authenticates as an unrelated personal account. |
| **2026-08-26** | STT and LLM moved from Deepgram + Claude to **Groq** — one free-tier key covers both `whisper-large-v3-turbo` and `llama-3.3-70b-versatile`. `FRONT_DESK_PHONE_NUMBER` became a config var with a loud placeholder. **Known tradeoff:** Groq transcription is REST/file-based, so streaming word-level STT was replaced by a local energy VAD that buffers each utterance — one extra round trip of latency, but barge-in stays instant because it's detected locally. |
| **2026-08-29 (a)** | Multi-client platform per the 25 Aug Developer Implementation Brief; live ElevenLabs agent stays as fallback; Cal.com identity unverified. This entry named Claude as the brain. |
| **2026-08-29 (b)** | **Supersedes the above:** the production pipeline is Twilio → Groq Whisper → Groq Llama → Robinexis tools → ElevenLabs TTS. Railway hostname preserved and migrated incrementally. Internal LLM/STT boundaries stay provider-neutral. |

That last entry is why you'll still find the word "Claude" in a few vault documents (`brains/robinexis/log.md`, an older `os/decisions/log.md` entry, `apps/demo-factory/README.md`'s framing). **The code is unambiguous: Groq is the brain.** The wiki page `source-2026-08-29-production-architecture.md` records the supersession explicitly.

### Publishing constraints (from the same wiki page)

Website copy must say **Groq hears and reasons, ElevenLabs voices, Robinexis controls tenant state and tools**. Claims like "production-ready", "no delay", "80% savings", "full GDPR compliance", customer counts or recovery figures require business evidence before publication.

---

## 19. Known gaps, risks and open items

### Blockers (from `os/handoff.md`)

1. **Unverified Cal.com account.** The API key authenticates as `hammadmuntazir512@gmail.com` / `hammad-muntazir-9zpmnb`, with no established connection to Robinexis or the salon. Five event types were created there to make bookings work. If this was confirmed in error, **real customer bookings are landing on a stranger's calendar.** Flagged twice, confirmed twice to proceed. Needs Will/Ed to verify with a clear head.
2. **No CRM connected.** GoHighLevel is listed in `connections.md` but not wired — `write_crm_note` persists locally only until an adapter exists.
3. **Salon hours and prices are unpublished** — the agent must keep handing those off.

### Technical debt and rough edges

| Area | Issue |
|---|---|
| STT latency | Utterance-buffered Whisper adds a full round trip vs streaming. `VAD_ENERGY_THRESHOLD = 500` is an **untested default** — expect tuning against real phone-line audio. |
| `dueJobs` on Postgres | Selects **all** `outbound_jobs` and filters in Node. Fine at current volume; needs a JSONB index or promoted columns as jobs grow. |
| `getClientByInboundNumber` | Same pattern — full table scan then filter in Node. |
| `listJobs` | Also full-table; the worker calls it twice per job for duplicate and rate checks. |
| Demo rate limiting | In-process `Map` — resets on restart and doesn't work across replicas. Should move to Redis. |
| `packages/evaluations/src/index.ts` | Empty (`export {}`) — the package exists only to host the test file. |
| Email confirmations | `sendNotification` throws `email_provider_not_configured`; only SMS works. |
| `apps/demo-factory` | A docs-only package with no runtime — the real work happens in the `/demo-build` skill. |
| `node_modules/@robinexis/*` | npm workspace symlinks back to `apps/`/`packages/` — not duplicate source. |
| Cal.com API versions | Three different `cal-api-version` values are pinned per endpoint; Cal.com's v2 is still moving. |
| Git | This working copy is **not a git repository** (no `.git`), so `/sync` and `/save` can't run here as-is. |

### Explicitly out of scope right now

- Cutting `+447446868067` over to the custom gateway. **Not until the full sandbox call matrix passes.**
- Embedding the demo widget on robinexis.com — deferred until that site's source is available.
- Attaching the live salon calendar to the `robinexis-demo` tenant.

---

## 20. Glossary

| Term | Meaning |
|---|---|
| **AIOS** | AI Operating System — the vault half of this repo: skills, brains, references, decisions |
| **Brain** | A Karpathy-style LLM wiki folder under `brains/` (`raw/` → `wiki/` → `outputs/`) |
| **Tenant / client** | One business served by the platform; a `ClientConfig` row |
| **Option 1** | The ElevenLabs Conversational AI pipeline — live on the salon number |
| **Option 2** | The custom Robinexis gateway — Groq Whisper + Groq Llama + ElevenLabs TTS |
| **Gateway** | `apps/voice-gateway` — the only service that handles live audio |
| **Media Stream** | Twilio's WebSocket protocol for bidirectional µ-law 8 kHz call audio |
| **Barge-in** | The caller interrupting the agent mid-sentence; aborts LLM + TTS and clears Twilio's buffer |
| **VAD** | Voice Activity Detection — the local RMS-energy speech detector |
| **Frozen prompt** | The immutable `PromptVersion` a call runs on, fixed at call start |
| **Published** | A tenant with a compiled prompt version and `published: true`; unpublished tenants cannot answer |
| **Credential ref** | An env-var *name* stored in config instead of a secret value |
| **Idempotency key** | A caller-supplied token making a mutating tool safe to retry |
| **Reservation** | A Redis sorted-set entry enforcing `maxConcurrentCalls` per tenant |
| **Disposition** | The controlled-vocabulary outcome of an outbound call |
| **Suppression** | A do-not-call entry, keyed `(clientId, phone)` |
| **Fallback TwiML** | The `<Say>` + `<Dial>`/`<Redirect>` response used whenever the AI must not or cannot answer |
| **3Ms** | Mindset → Method → Machine — the operator framework |
| **4Cs** | Context → Connections → Capabilities → Cadence — the architecture framework |
| **Track 1 / Track 2** | Sturdy Ai engagement models: £75/hr, or a 50/50 partnership at volume |

---

*End of document. Source of truth is the code; this file describes it as of 2026-08-29.*
