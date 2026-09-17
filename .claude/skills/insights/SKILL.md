---
name: insights
description: Use for a reflection pass across the whole brain — "insights", "what am I missing", "what's the brain telling me", "find patterns / stalled threads", "what should I double down on". Read-only synthesis → 3-5 ranked actions with citations. Pairs with level-up.
inputs: [brain_repo_path, focus (optional)]
outputs: [insight summary, ranked suggested actions]
dependencies: [git]
---

# Insights — what does the brain know that you've missed?

Synthesis, not capture. Turns the accumulated brain into direction. Pairs with `/level-up`.

## Steps
1. Read across `wiki/` + `log.md` (or scope to `focus` if given).
2. Cluster: recurring themes across decisions, repeated blockers, people who keep coming up, pages reused vs ignored.
3. Find the signal — what's working and should be doubled down, what's stalled, what contradicts itself.
4. Surface 3–5 concrete, ranked actions, each tied to the evidence (cite the brain pages).
5. Offer to route outputs: a reusable pattern → `/level-up`; a stale area → `/brain-compact`; a decision to record → `/save`.
6. **Read-only on the brain — write nothing unless the user picks an action.**
