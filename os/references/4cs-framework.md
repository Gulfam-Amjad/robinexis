# The Four Cs of an AIOS — architecture (what you build)

> The `/audit` skill scores against this. Each layer depends on the one before.

The architecture half of the kit (the 3Ms are the operator-brain half — see `3ms-framework.md`). Without the 3Ms rewire, this is just a folder structure.

| # | Layer | One-liner | "This layer is in place" test |
|---|---|---|---|
| 1 | **Context** | Knows your business | A fresh session answers *"what does this business do and who works here?"* with no browsing. |
| 2 | **Connections** | Reaches your stuff | *"What's on my calendar tomorrow and what tasks are due?"* → live data, no paste. |
| 3 | **Capabilities** | Knows how to do the work | A short phrase triggers a multi-step workflow that produces an artifact. |
| 4 | **Cadence** | Runs without being asked | Laptop closed. A brief lands in the inbox. A teammate messages it and gets a real answer. |

**Brand line:** Context. Connections. Capabilities. Cadence.

**Dependency graph:** Context is non-skippable. Connections + Capabilities can build in parallel. **Cadence is last** — never automate a workflow that doesn't yet work manually.

## The litmus test (the whole AIOS rolls up to this)

> *"While you're not at your desk, your AIOS observes one real-world event and produces an output that's faster and more accurate than what you'd produce yourself."*

If a layer, skill, or template doesn't contribute to that, it doesn't ship.

## Three felt success indicators (not KPIs — lived experiences)

1. **Team-reaches-out** — you ask your own AIOS even when you're free, because it answers better/faster with sources. You stop being your own bottleneck.
2. **Context-switching reduction** — first move on anything new is "ask the AIOS", not "open six tabs".
3. **Knowledge-leaves-your-head** — you stop trying to remember business facts; you trust retrieval.

## How this maps to our structure (Sturdy layer)

- **Context** = the **brains** (company + personal LLM wikis). See `brain-conventions.md`.
- **Connections** = `connections.md` + MCPs/scripts; secrets stay local (see `CLAUDE.md`).
- **Capabilities** = the `.claude/skills/` in this AIOS.
- **Cadence** = scheduled agents / daily brief (added once the manual workflow works).
