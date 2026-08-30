---
name: save
description: Use mid-session the moment something worth keeping happens — "save this", "note that", "log this decision", "remember this outcome". Writes the interpreted fact to the right wiki page + log.md and commits (push left to sync). Quick capture, no full loop.
inputs: [brain_repo_path, summary]
outputs: [appended brain entries, git commit]
dependencies: [git]
---

# Save — capture this session into the brain

## Steps
1. Identify what's worth persisting: decisions made, facts learned, outcomes.
2. Interpreted facts → the right `wiki/` page (`entity-*`, `concept-*`, `source-*`); create the page if it doesn't exist and link it with `[[wikilinks]]`.
3. Append one line to `log.md` (`## [YYYY-MM-DD] save | <summary>`). On a shared brain use `log-<your-name>.md`.
4. Update `index.md` if a new page was created.
5. `git -C <brain_repo_path> add -A && git commit -m "brain: <summary>"`.
6. Leave the push to `/sync` (which also compacts), or push now if working solo.
7. TODO(cred:GITHUB-MCP): non-technical teammates commit via the GitHub MCP write tool in Claude Desktop.

**Routing:** only in-scope facts — cross-stream facts go to their own brain.
