# Sturdy Ai — Recommended Stack

**Read this only if you're choosing tools, not if you've already chosen.**

Your AIOS is tool-agnostic by design. Already run something in a slot — Asana, QuickBooks, whatever? Keep it; `/connect` wires any tool with an API/CLI/MCP. This doc is for the other case: you're early, greenfield, or want a steer from people who build on these every day.

**What makes this list different: it's what Sturdy Ai actually runs on** — a working picture of a modern AI-first company. Because we use every tool here ourselves, each one already ships with a **pre-built reference doc in `references/`** — so you're minutes from connected, not hours of doc-hunting.

Criteria for anything that joins the stack: (1) agentic-friendly, (2) solid API, (3) bonus MCP. And we connect in the order **CLI → API → MCP** — MCP last, for context economy (see the *Connecting Your Tools* guide and the `/connect` skill).

---

## The stack

| Role | Sturdy Ai tool | Mechanism | Pre-built doc |
|---|---|---|---|
| **Harness — the AIOS itself** | Claude Code | native | — |
| **Mission Control** — projects, tasks, light CRM, ops | **Monday.com** | API | `monday-api.md` |
| **Workspace** — email, calendar, Drive, Docs/Sheets/Slides, **Meet** | **Google Workspace CLI** (`gws`) | CLI | `google-workspace-cli.md` |
| **Automation** — scenarios, webhooks, data stores | **Make.com** (N8N as self-host alt) | CLI | `make-cli.md` |
| **Voice & audio AI** — agents, TTS, SFX | **ElevenLabs** | CLI (agents) · API/MCP (TTS/SFX) | `elevenlabs-cli.md` |
| **Live phone numbers** — put a voice agent on a business line | **Twilio** | CLI | `twilio-cli.md` |
| **Scheduling / booking** — let an agent book meetings on your calendar | **Cal.com** | CLI (`@calcom/cli`) · API | `calcom-cli.md` |
| **AI video** | **HeyGen** | CLI (v3) | `heygen-cli.md` |
| **Design & decks** | **Canva** (Figma for UI) | API | `canva-api.md` |
| **Hosting & edge** — Workers, Pages, DNS | **Cloudflare** | Wrangler CLI · API | `cloudflare-cli.md` |
| **Code & version control** | **GitHub** | `gh` CLI | `github-cli.md` |
| **Research** | **Google NotebookLM** | MCP | — (MCP self-describes) |
| **Payments** *(planned)* | **Stripe** | CLI · API | `stripe-cli.md` |
| **Accounting** *(planned)* | **Xero** | API | `xero-api.md` |
| **Brain front-end** *(optional)* | **Obsidian** | local | — |

Monday.com is the hub: projects up top, tasks as subitems, and it doubles as a light CRM and knowledge store — which is why we lead with it over a separate CRM or Notion.

---

## How to use this

1. **Already have a tool for a role?** Keep it — run `/connect` to wire it. The `references/{tool}-{mechanism}.md` pattern works for anything.
2. **Greenfield?** Take our pick. The reference doc is already in `references/`, so you're minutes from connected.
3. **Mixed?** Normal. Wire what you have, fill the gaps from here.

Whatever you choose, log it in `connections.md`.

> Sturdy Ai's working stack as of mid-2026. Tools change — when ours do, this doc and the `references/` docs change with them. Items marked *planned* are chosen but not yet live.
