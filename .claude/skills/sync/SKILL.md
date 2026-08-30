---
name: sync
description: Use at the start or end of a work session — "sync", "pull the brain", "let's start", "wrap up and push", "save everything" — to pull the latest brain, distil what changed into wiki pages, run brain-compact, and push. Keeps everyone on one live brain. The self-improving loop.
inputs: [brain_repo_path, since (optional)]
outputs: [updated brain, git commit + push]
dependencies: [git, brain-compact]
---

# Sync — refresh and persist a brain

Keeps every person working off one live brain. Run at session start (pull) and end (distil + push).

## Steps
1. `git -C <brain_repo_path> pull --rebase` — get the latest.
2. Read the brain's `handoff.md` (if present) then `index.md` to orient; drill into the `wiki/` pages relevant to today.
3. Do the work.
4. At session end, distil what changed, following the brain's own `CLAUDE.md`:
   - Interpreted facts → `wiki/` pages (`entity-*.md`, `concept-*.md`, `source-*.md`). Never paste raw material — that goes in `raw/`.
   - Append one line per event to `log.md` (`## [YYYY-MM-DD] …`).
   - Update `index.md`.
   - On a **shared** brain, append decisions to your own `log-<your-name>.md` to avoid write collisions; never edit someone else's file.
5. Run `/brain-compact` (lives in the brain) to dedupe + tighten — anti-rot.
6. `git -C <brain_repo_path> add -A && git commit -m "brain: <one-line summary>" && git push`.
7. TODO(cred:GITHUB-MCP): a non-technical teammate in Claude Desktop commits via the GitHub MCP write tool — same result, no terminal.

**Routing:** only in-scope facts go in this brain (see its `CLAUDE.md`). Cross-stream facts go to *their* brain.
