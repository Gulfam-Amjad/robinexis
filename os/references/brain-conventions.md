# Brain Conventions — how to maintain a brain (LLM wiki)

Every brain this AIOS touches is a **Karpathy-style LLM wiki**: a compounding, interlinked set of markdown files the *LLM* maintains, not a doc dump. Pattern source: Karpathy's "LLM Wiki". The brain is the codebase; Obsidian is the IDE; you are the programmer.

## The three layers in a brain

1. **`raw/`** — immutable source documents (articles, transcripts, exports). You read these, never edit them.
2. **The wiki** — your generated markdown: entity pages, concept pages, summaries, an `index.md`. You own this layer entirely.
3. **The schema** — the brain's own `CLAUDE.md` (conventions for *that* brain). Co-evolve it over time.

## Two navigation files (every brain has these)

- **`index.md`** — content catalogue. Every page: link + one-line summary, grouped by category (entities, concepts, sources). Read this first when answering; update it on every ingest.
- **`log.md`** — append-only timeline. One line per event, consistent prefix: `## [YYYY-MM-DD] ingest | Title`. Grep-able: `grep "^## \[" log.md | tail -5`.

## The three operations

- **Ingest** — drop a source in `raw/`, then: read it, discuss takeaways, write a summary page, update `index.md`, update every affected entity/concept page (one source can touch 10–15 pages), append to `log.md`. Flag where new data contradicts old.
- **Query** — read `index.md` → drill into relevant pages → answer with citations. **File good answers back as new pages** so exploration compounds.
- **Lint** — periodically health-check: contradictions, stale claims, orphan pages, missing cross-references, concepts lacking a page. Suggest new sources/questions.

## Rules

- **Interpreted facts only** — never dump raw email/Slack/transcripts into the wiki. Raw goes in `raw/`.
- **Link liberally** — `[[wikilinks]]` between pages; the graph is the value.
- **Supersede, don't delete** — when a fact changes, mark the old one stale with a date, keep the trail.
- **Flat + good naming** beats deep folders. If you need a hierarchy to find something, you have a search problem.
- **Frontmatter** on pages (`created`, `type`, `tags`) so Obsidian Dataview can query them.

## Company vs personal (routing)

This conventions file applies to *every* brain. But **what** goes where is set by the AIOS routing rule: work facts → company brain, private facts → personal brain. Never mix.
