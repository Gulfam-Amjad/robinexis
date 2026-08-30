---
name: demo-build
description: Build Voice Agent Demo — paste a prospect's website URL + 2-3 lines (industry, what the agent should do, tone) and get a working ElevenLabs voice-agent demo with a shareable test link in minutes. Use when the user says "build a demo", "make a voice agent for {url}", "demo for this prospect", or mentions a prospect they want to pitch. The Robinexis sales weapon.
inputs: [prospect website URL, 2-3 line brief (industry · agent job · tone)]
outputs: [live ElevenLabs demo agent, shareable test link, website widget snippet, demo log entry]
dependencies: [ElevenLabs CLI (@elevenlabs/cli) + ELEVENLABS_API_KEY]
---

# Demo Build — prospect URL → voice-agent demo in minutes

Turns a prospect's website into a tailored, working Robinexis voice-agent demo you can play in a sales pitch. No code, no dashboards. Target time: **2–5 minutes**. Production phone + calendar is a separate platform (`apps/` — see `apps/demo-factory/README.md`).

## Step 0 — Preflight (silent; only surface problems)

1. **CLI available?** `elevenlabs --version`. If missing: `npm i -g @elevenlabs/cli` (needs Node 16+). If npm itself is missing, or you're in an environment that can't run a terminal, use the **fallback** at the bottom.
2. **Authed?** `elevenlabs auth whoami`. If not: check `.env` for `ELEVENLABS_API_KEY`; else run `elevenlabs auth login` (or `/connect` to wire the key — see `os/references/elevenlabs-cli.md` for where to get it).
3. **Agents project exists?** The demo workspace lives at `brains/robinexis/outputs/demos/agents-project/`. If there's no `agents.json` there: `cd` in and run `elevenlabs agents init`.

## Step 1 — Gather the inputs

Need two things (ask only for what's missing, one message, no interrogation):
- **Prospect URL**
- **2–3 line brief**: industry · what the agent should do (pick: lead qualification / support triage / after-hours capture / booking — or a mix) · tone preference

If the brief is missing entirely, a sensible default for a local-business pitch is **after-hours capture + booking, warm-professional tone** — say you're assuming it and carry on.

## Step 2 — Scrape the prospect's site

Fetch the homepage plus the obvious high-value pages (about, services, pricing, contact, FAQs). Extract into a short fact sheet:
- Business name, what they sell/do, location(s), opening hours
- Services list + any prices published
- Phone/email, booking mechanism if any
- Brand voice cues (formal? cheeky? family-run?) and 1–2 phrases worth echoing

**Only use facts actually on the site.** Where something's unknown (e.g. hours), the agent must say a human will follow up — never invent.

## Step 3 — Draft the system prompt

Open `os/references/system-prompt-library.md`, pick the template matching the brief's job(s), and fill every `{{slot}}` from the fact sheet. Compose multiple templates if the brief spans jobs (e.g. after-hours + booking). Show the user a 5-line summary (persona · job · captures · tone · first message) — proceed unless they object.

## Step 4 — Create the agent

In `brains/robinexis/outputs/demos/agents-project/`:

1. Write the agent config JSON into `agent_configs/` — name it **`Demo — {Business Name} — {YYYY-MM-DD}`** so the ElevenLabs dashboard stays legible. Set: the system prompt, first message, a voice fitting the tone (see the library's voice guide), and the LLM defaults from the library.
2. Register + push: `elevenlabs agents add "Demo — {Business Name} — {YYYY-MM-DD}" --from-file <config>` then `elevenlabs agents push --agent <agent_id> --no-ui` if needed. (Flags evolve — trust `elevenlabs agents --help` over memory; the CLI is young.)
3. Grab the `agent_id` from `agents.json`.

## Step 5 — Return the demo pack

Give the user one tight block:
- **Test link** — the agent's shareable/test link (from the push output or the dashboard's Share option; the widget page also works for a live pitch).
- **Widget snippet** — for showing "on their website" (paste into any HTML page, or use the library's `demo.html` wrapper for a full-screen mock of the prospect's site):
  ```html
  <elevenlabs-convai agent-id="AGENT_ID"></elevenlabs-convai>
  <script src="https://unpkg.com/@elevenlabs/convai-widget-embed" async type="text/javascript"></script>
  ```
- **One suggested opening line for the pitch** (e.g. "this is answering your phone at 9pm tonight").

## Step 6 — Log it

Append one line to `brains/robinexis/outputs/demos/demo-log.md`: `| {date} | {Business} | {url} | {agent_id} | {job} | pitched? |` — and one line to `brains/robinexis/log.md`. If the pitch lands and the prospect wants it on a real phone number, that's a **signed-deal handover to Sturdy Ai** (Track 1) — log the decision.

## Rules

- **Demos ground only in scraped facts.** The system prompt must include the "if you don't know, say a human will follow up" rule — a demo that hallucinates prices kills the sale.
- **One agent per prospect, clearly named.** Never reuse/rename another prospect's demo.
- **Hygiene:** demos older than ~30 days with no live deal — offer to delete (`elevenlabs agents delete <id>` — destructive on the remote, confirm first).
- **Never commit `.env`** or paste the API key anywhere.

## Fallback — no CLI available (e.g. Claude Desktop only)

Same steps 1–3, then create the agent by hand: elevenlabs.io → **Agents** → Create → paste the system prompt + first message, pick the voice, save, copy the `agent_id` + share link. Slower but identical result. (If the ElevenLabs MCP is connected, it can do the creation step instead.)
