---
created: 2026-07-03
type: index
area: root
---
# Robinexis AIOS — index / map

The top-level map the AIOS reads first. One vocabulary everywhere: **`raw/` → `wiki/` → `outputs/`**. Shared by Will and Ed — one repo, one team.

## The shape

```
raw/        ← ONE front door. Drop anything; the AIOS routes it into a brain. Kept empty.
brains/     ← All knowledge, one folder per stream. Each = raw/ → wiki/ → outputs/
os/         ← Machinery you ignore (references, guides, connections, decisions, context)
```

Map files at root: [[CLAUDE|CLAUDE.md]] (identity — Claude boot) · [[AGENTS|AGENTS.md]] / [[GEMINI|GEMINI.md]] (other-engine boot) · [[BRAINS|BRAINS.md]] (brain manifest) · [[Home]] (dashboard) · [[README]] · this file.

## The one command that matters

> **"Build a demo for {prospect url}"** → `/demo-build` → working voice-agent demo + shareable link in minutes. Every demo (from either of you) lands in [[brains/robinexis/outputs/demos/demo-log|the shared demo log]].

## Brains — every stream, one hop away

| Brain | Scope |
|---|---|
| [[brains/robinexis/index\|robinexis]] ⭐ | The business — prospects, demos, deals, voice-agent craft |
| [[brains/_template/index\|_template]] | The seed — copy to start a new stream |

## Key pointers (machinery)

- Demo prompts → [[os/references/system-prompt-library|system-prompt-library]] · ElevenLabs → [[os/references/elevenlabs-cli|elevenlabs-cli]]
- Production platform (Claude + Twilio, sandbox first) → [[README-PLATFORM]] · [[brains/robinexis/outputs/production/PLATFORM|PLATFORM]]
- Decisions → [[os/decisions/log|decisions log]] · Wired systems → [[os/connections|connections]]
- Frameworks: [[os/references/3ms-framework|3Ms]] · [[os/references/4cs-framework|4Cs]]
