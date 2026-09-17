---
name: ingest
description: Use when a new source needs turning into brain knowledge — "ingest this", "process my raw", "add this to the brain", "process this transcript/doc/export". Routes each item from the raw/ front door into the right brain under brains/, writes interpreted wiki pages with [[links]], updates that brain's index.md, and logs it. The core loop that grows a brain.
---

## What this skill does

Turns a raw source document into compounding brain knowledge. Raw goes in at the front door (`raw/` at the repo root), interpreted interlinked pages come out in the right brain's `wiki/`. This is the loop that makes the system grow over time.

## Steps

1. **Locate the source.** Items usually land in root `raw/` (the front door). If the user pasted content instead, save it there as `raw/{YYYY-MM-DD}-{slug}.{ext}` first.
2. **Route it.** Decide which brain the item belongs to via `BRAINS.md` (the routing rule: each fact goes in exactly one brain — the stream it belongs to). When ambiguous, ask before writing.
3. **Move the original** into that brain's own `raw/` — `brains/{name}/raw/{YYYY-MM-DD}-{slug}.{ext}`. That folder is the evidence trail and must hold the original, immutable. Root `raw/` is left empty.
4. **Read it in full.**
5. **Discuss takeaways** with the user before writing. Surface what's new, what's surprising, what's worth keeping. Don't silently absorb a wall of text.
6. **Write/update wiki pages** in `brains/{name}/wiki/`. One source typically touches 10–25 pages:
   - A `source-{date}-{slug}.md` summary page — **interpret, don't transcribe.**
   - Every affected `entity-` and `concept-` page — create them if missing.
   - `[[wikilinks]]` between related pages (a link to a not-yet-written page is fine — it's a to-do marker).
   - Frontmatter on every page (`created`, `type`, `tags`, `status`).
7. **Flag contradictions** where the new source disagrees with existing pages. **Supersede, don't delete:** mark the old fact stale with a date.
8. **Update `brains/{name}/index.md`** — add/relabel the new pages under the right category.
9. **Append to `brains/{name}/log.md`:** `## [{date}] ingest | {source title}`.

## Rules

- **Interpreted facts only** in `wiki/`. Never paste the raw transcript/email into a wiki page — that's what the brain's `raw/` is for.
- **Stay in stream.** Only write facts into the brain they belong to (see each brain's `README.md` scope block). If a fact belongs to another stream, route it there — never cross streams.
- **No secrets**, ever — not even in a private brain.

## Output

Updated `wiki/` pages, `index.md`, and `log.md` in the owning brain — plus a one-paragraph summary of what changed and any contradictions flagged.
