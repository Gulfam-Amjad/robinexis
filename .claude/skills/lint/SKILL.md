---
name: lint
description: Use to health-check a brain — "lint this brain", "clean up the wiki", "find gaps/contradictions in the brain". Scans one brain under brains/ (or all of them) for contradictions, stale claims, orphan pages, missing links, and concepts lacking a page; proposes fixes and new sources to chase.
---

## What this skill does

A periodic maintenance pass on a brain. A brain rots without it — facts go stale, pages orphan, contradictions creep in. Lint keeps the graph healthy and surfaces what to chase next.

## Steps

1. **Pick the target.** A named brain (`brains/{name}/`), or sweep every folder under `brains/` if the user says "lint everything". Skip `brains/_template/`.
2. **Read that brain's `index.md`** for the catalogue, then sweep its `wiki/`.
3. **Check for:**
   - **Contradictions** — two pages asserting different things. Flag both; supersede the outdated one with a date.
   - **Stale claims** — facts with old dates or marked `status: stale` that need revisiting.
   - **Orphan pages** — no `[[links]]` in or out. Link them in (git history is the archive — don't create junk folders).
   - **Missing cross-references** — a page mentions an entity/concept that *has* a page but doesn't link it.
   - **Concept gaps** — a recurring idea referenced across pages with no page of its own. Propose creating one.
   - **Index drift** — pages missing from `index.md`, or index entries pointing at deleted pages.
   - **Stream leaks** — facts that belong to a *different* brain (check the scope block in each brain's `README.md`). Flag for re-routing.
4. **Propose fixes** as a short list ranked by value. Apply the safe mechanical ones (fix links, update the index); confirm the judgement calls before changing meaning.
5. **Suggest next inputs** — the sources or questions that would fill the biggest gaps.
6. **Log it** in the brain's `log.md`: `## [{date}] lint | {n} issues found, {m} fixed`.

## Rules

- **Supersede, don't delete.** Keep the trail.
- **Never invent facts** to fill a gap — flag the gap and suggest a source instead.
- You may use web search to sanity-check a shaky *external* claim, but mark what's external vs first-party.

## Output

A ranked issue list (fixed vs needs-confirmation) and suggested next sources, plus a `log.md` entry per brain touched.
