# Sturdy AIOS — engine bootstrap

This repository is part of a **Sturdy AIOS** estate. Any agent/engine (Codex, Claude, Gemini, ChatGPT, …) starts here:

1. **Read `CLAUDE.md` in this repo** — it is your operating manual: identity, scope, routing rules, secrets policy, how to work.
2. Read **`BRAINS.md`** too — the machine-readable manifest of the brains (folders under `brains/` in this repo) that hold the knowledge.
3. Then act exactly as `CLAUDE.md` directs.

Rules that never break:
- **Knowledge lives in the brains (`brains/`), never in the operating layer.** Each fact goes in exactly one brain — the stream it belongs to. Never cross streams.
- **Never commit secrets** (`.env`, `*.key`, `*.pem`, tokens). Credentials live locally / in connectors.

`CLAUDE.md` is the single source of truth — this file just guarantees every engine bootstraps the same way.
