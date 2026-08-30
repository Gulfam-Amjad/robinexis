# Cadence & Routines — which skills run themselves

Two kinds of skill. **Reactive** ones fire when you act (no setup needed). **Cadence** ones should run on a schedule so they work *while your laptop is closed* — that's the 4th C. During `/onboard`, set the cadence skills up as routines.

## Reactive — fire on demand, no routine needed
`ingest` · `save` · `session-handoff` · `sync` · `connect` · `onboard` · `level-up` (you describe the need → the skill fires). `update` is an on-demand manual force-sync only — the **Sturdy Ai GitHub App** auto-pushes template improvements, so you rarely need it (see the note below).

## Cadence — set these up as scheduled routines

| Skill | Suggested schedule | Why it's autonomous |
|---|---|---|
| **`brain-compact`** (per brain) | weekly | Anti-rot — merges/tightens without you. Run from the AIOS across all its brains. |
| **`lint`** (per brain) | weekly | Surfaces broken links, orphans, contradictions for review. |
| **`audit`** | weekly or monthly | Four-Cs score — the client QBR artefact that justifies the retainer. |
| **`insights`** | weekly | Reflection → ranked actions, waiting for you when you sit down. |
| **daily brief** | daily | The flagship Cadence output — a brief in your inbox each morning. |

Set them in the AIOS so one routine can sweep every brain it routes to (e.g. "compact + lint all my brains every Sunday night").

> **Template/logic updates are no longer a routine.** The **Sturdy Ai GitHub App** pushes the latest skills + references to every installed repo automatically whenever the upstream template changes — there's no `/update` routine to schedule. Just keep the App installed (see `references/sturdy-ai-app.md`). `/update` remains as an on-demand manual force-sync if you ever want to pull immediately.

## Where routines actually run (platform reality)

- **Claude Code app (desktop/web) → Routines tab**, and the **CLI `/schedule`** command — both create scheduled agents. This is the primary surface.
- **"Local routines only run while your computer is awake."** For true 24/7 autonomy (laptop shut), use **cloud routines** (run on Anthropic's infra) — or an external scheduler.
- **VS Code extension** is primarily interactive — it may not expose the Routines UI. For scheduling, use the **Claude Code app / Claude Desktop / CLI `/schedule`**, not the editor extension.
- **Critical / client-facing cadence** (Sturdy Ai's daily brief, debt-chase) already belongs on **Make.com** (the conductor, per Sturdy Ai canon) — keep heavy production automation there; use Claude routines for personal-AIOS rituals.

> Rule of thumb: if it must run when you're not at the machine, it's a **cloud routine** (or Make.com), not a local one.
