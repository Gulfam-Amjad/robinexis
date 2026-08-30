---
name: session-handoff
description: Use when wrapping up a session — "handoff", "leave a handoff note", "wrap up", "where did we get to", "I'm done for now". Writes handoff.md (Done / In flight / Next actions / Blockers) so the next session or teammate resumes in seconds. Run alongside save.
inputs: [brain_repo_path, session_summary]
outputs: [brain handoff.md, git commit]
dependencies: [git, save]
---

# Session-handoff — leave the next person a running start

`save` persists durable learnings; handoff captures the volatile working state so momentum survives the context window.

## Steps
1. Summarise this session: what got done, key decisions (these also go to `save`), what's mid-flight.
2. Write/overwrite `handoff.md` at the brain root with: **Done**, **In flight**, **Next actions** (ranked), **Open threads / blockers**, **Watch-outs**. Absolute dates.
3. Keep it a *pointer*, not a duplicate — `[[wikilink]]` anything durable to its `wiki/` page.
4. Run `/save` for the durable decisions, then `git -C <brain_repo_path> add -A && git commit -m "brain: handoff <date>"`.
5. Next session: `/sync` pulls the brain and reads `handoff.md` first — instant resume.
6. TODO(cred:GITHUB-MCP): non-technical teammates commit the handoff via the GitHub MCP write tool in Claude Desktop.
