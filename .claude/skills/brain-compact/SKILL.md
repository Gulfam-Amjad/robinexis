---
name: brain-compact
description: Use to tighten a brain so it doesn't rot — "compact the brain", "tidy/dedupe the wiki", "clean this up", on a schedule, or after a big ingest session. Works on one brain under brains/ (or all of them). Merges duplicates, supersedes stale facts, digests old history. The fix to /lint's diagnosis.
inputs: [max_age_days (default 90)]
outputs: [rewritten brain files, git commit]
dependencies: [git]
---

# Brain-compact — keep the brain sharp

`/lint` *finds* problems (read-only). `/brain-compact` *fixes* them (rewrites). Run lint first if you want to review before compacting.

## Steps
1. Pick the target brain (`brains/{name}/`), or every folder under `brains/` if asked. Skip `brains/_template/`.
2. Read every page in the brain's `wiki/`, plus its `index.md` and `log.md`.
3. Merge duplicate facts; when two conflict, keep the newest and **note the supersession** (date) — don't delete the trail.
4. Tighten each page: one fact per line, absolute dates, `[[wikilinks]]` to related pages, frontmatter intact.
5. `log.md` is append-only history — summarise old entries into a digest section, **never delete the record**.
6. Update the brain's `index.md` so it matches the compacted pages.
7. `git add -A && git commit -m "brain({name}): compact"`.

**Never** drop an in-scope fact just because it's old — supersede or digest, don't erase.
