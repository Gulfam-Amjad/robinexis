---
name: update
description: Pull the latest improvements from the upstream aios-template (new/updated skills + framework references) WITHOUT touching your own context, routing, brains, or secrets. Run when you say "update", "self-update", "pull template updates".
inputs: []
outputs: [updated .claude/skills + references, git commit + push]
dependencies: [git]
---

# Update — pull template improvements (the "listening" mechanism)

This AIOS was stamped from `sturdyai/aios-template`. This skill pulls *logic* updates from that template (skills, framework docs) while leaving everything that's *yours* untouched.

## Step 0 — one-time v1 → v2 shape migration (run only if needed)

**Check:** if a `references/` folder or `connections.md` exists at the **repo root**, this instance is still on the v1 flat shape. Migrate it once, before pulling anything:

1. `mkdir -p os raw brains`
2. `git mv references guides context decisions bin connections.md EXPANSIONS.md ROUTINES.md aios-intake.md os/ 2>/dev/null` (skip any that don't exist; move stray root files individually).
3. If `archives/` exists: review contents, file anything valuable into the right brain, then `git rm -r archives/` — git history is the archive.
4. Update every old path inside **your filled `CLAUDE.md`** (`references/` → `os/references/`, `connections.md` → `os/connections.md`, etc.).
5. Copy the brain seed + map files from the template: `git checkout template/main -- brains/_template raw/README.md .obsidian .gitignore` — then create `index.md`, `Home.md`, and `BRAINS.md` from the template shape, filled with your own brains.
6. If you had sibling brain repos (v1 model), move each one's contents into `brains/{name}/` in this repo (keep `raw/ → wiki/ → outputs/`), register them in `BRAINS.md` + `CLAUDE.md`, and archive the old remote repos.
7. Commit: `git add -A && git commit -m "aios: migrate to v2 shape (raw/brains/os)"`.

## Steps
1. Ensure the template remote exists:
   `git remote get-url template 2>/dev/null || git remote add template https://github.com/sturdyai/aios-template.git`
2. `git fetch template`.
3. **Pull template-owned paths only** (logic, not content):
   `git checkout template/main -- .claude/skills os/references/3ms-framework.md os/references/4cs-framework.md os/references/brain-conventions.md os/guides brains/_template raw/README.md`
4. **Never pull** `os/context/`, `os/connections.md`, `os/decisions/`, the filled body of your `CLAUDE.md`, `BRAINS.md`, or anything in your brains (other than `_template/`) — those are yours.
5. Review the diff, then `git add -A && git commit -m "aios: pull template updates" && git push`.

> Template owns: skills + the 3Ms/4Cs/brain-conventions references. You own: your context, routing, connections, decisions, secrets. Updates change the logic, never your data.
