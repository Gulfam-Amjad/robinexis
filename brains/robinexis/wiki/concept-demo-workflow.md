---
created: 2026-07-03
type: concept
tags: [demo, voice-agent, sales]
status: current
---
# The Demo Workflow — Robinexis's sales weapon

> Paste a prospect's website URL + 2–3 lines into `/demo-build` → a working, tailored voice-agent demo with a shareable link in **2–5 minutes**. Make one for every prospect. Walk in, show it live, sell it.

## How it works

1. **You:** "build a demo for {url}" + industry · what the agent should do · tone.
2. **The skill:** scrapes the site → drafts a system prompt from the [[system-prompt-library|prompt library]] (lead qualification · support triage · after-hours capture · booking) → creates the ElevenLabs agent via CLI → returns a test link + widget snippet.
3. **You:** pitch with it. Log the outcome in `outputs/demos/demo-log.md`.

## Grounding rule (why demos are safe to show)

Demo agents only state facts scraped from the prospect's own site. Anything unknown → "I'll have someone from the team confirm that." A demo that invents prices kills the sale.

## When a prospect signs

Demo → production (real phone number via Twilio, real calendar booking, hardened prompt, knowledge base) is **Sturdy Ai's job, post-signed-and-paid deal** — Track 1 at £75/hr, or Track 2 (50/50 partnership) when volume justifies. The full detail is in `raw/Playbook_Robinexis_Voice_Agent_System.md`. Trigger: tell Joe the deal is signed.

## Housekeeping

- One agent per prospect, named `Demo — {Business} — {date}`.
- Demos with no live deal after ~30 days: delete (keeps the ElevenLabs workspace clean).
