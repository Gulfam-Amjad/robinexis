# {{Brain Name}} — a Sturdy Ai Brain

This folder is a **brain**: a Karpathy-style LLM wiki. A compounding, interlinked set of markdown files that an LLM maintains — not a dump of documents. The brain is the codebase; Obsidian is the IDE; the LLM is the programmer; you are the architect.

> To start a new stream of knowledge, **copy this whole `_template/` folder** to `brains/{{new-name}}/`, fill in the block below, and register it in `BRAINS.md` + the `CLAUDE.md` routing table. One brain = one stream. Never delete `_template/` itself.

## What kind of brain is this?

- **Name:** {{Brain Name}}
- **Type:** {{company | personal | venture | client/work}}
- **Scope (what belongs here):** {{one line — e.g. "Everything about Acme: clients, offers, ops, finances, decisions."}}
- **Out of scope (never write here):** {{one line — e.g. "Anything personal/private — that lives in brains/personal/."}}

**The one rule that must never break:** only in-scope facts go in this brain. If a fact belongs to a different stream (another venture, your private life, a different client), it goes in *that* brain — never here. When unsure, ask before writing.

## Structure

- `raw/` — immutable source documents (transcripts, exports, articles, PDFs). **Read these; never edit them.**
- `wiki/` — the generated knowledge: entity pages, concept pages, source summaries. **The LLM owns this layer entirely.**
- `outputs/` — finished deliverables for this stream (decks, docs, videos, proposals).
- `index.md` — the catalogue. Every page: a link + one-line summary, grouped by category. **Read this first; update it on every change.**
- `log.md` — append-only timeline. One line per event. Grep-able history.
- `README.md` — this file. The brain's schema. Co-evolve it as the brain grows.

## The three operations

**Ingest** (raw → wiki) — run `/ingest`, or say "add this to the brain". Reads the source in full, discusses takeaways, writes/updates interlinked `wiki/` pages, updates `index.md`, appends to `log.md`, flags contradictions.

**Query** (answer from the brain) — read `index.md` to orient, drill into the relevant pages, answer **with citations**. Good answers get filed back as new pages — exploration should compound, not evaporate.

**Lint** (health-check) — `/lint` finds contradictions, stale claims, orphan pages, missing cross-references; `/brain-compact` fixes them. Run periodically.

## Rules

- **Interpreted facts only.** Never paste raw emails, Slack threads, or transcripts into `wiki/`. Raw material lives in `raw/`; the wiki holds what it *means*.
- **Link liberally.** `[[wikilinks]]` between pages are the whole value — the graph, not the pages, is the asset. A link to a page that doesn't exist yet is fine; it marks a page worth writing.
- **Supersede, don't delete.** When a fact changes, mark the old one stale with a date and keep the trail. History is signal.
- **Flat + good naming** beats deep folders. Name pages `entity-acme-corp.md`, `concept-positioning.md`, `source-2026-06-01-discovery-call.md`.
- **Frontmatter on every page** (`created`, `type`, `tags`, `status`) so Obsidian can query the brain.
- **Secrets never live here.** No API keys, tokens, or passwords — not even in a private brain. Those stay in the AIOS `.env` / keychain.

---
*A Sturdy Ai Brain (MIT). The contents are yours; the conventions are the template's.*
