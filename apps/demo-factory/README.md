# Robinexis demo factory

Sales demos stay **separate** from the production telephone platform (`apps/voice-gateway`, `apps/api`, `apps/worker`).

This is not a second phone system. Input: prospect website + 2–3 lines. Output: ElevenLabs **demo** agent, shareable test link, widget snippet, pitch notes. Demos must not pretend to access a live diary.

## How to run

Use the `/demo-build` skill (`.claude/skills/demo-build/SKILL.md`). Workspace: `brains/robinexis/outputs/demos/`. If `agents-project/` is missing, `cd` there and run `elevenlabs agents init`.

Log every demo in `brains/robinexis/outputs/demos/demo-log.md`.

## Smoke checklist (keep green after platform scaffolding)

- [ ] `ELEVENLABS_API_KEY` is in local `.env` only (never committed).
- [ ] `elevenlabs --version` works on the laptop running demos.
- [ ] Prompt library still at `os/references/system-prompt-library.md`.
- [ ] Demo agents named `Demo — {Business} — {YYYY-MM-DD}`.
- [ ] Unknown prices/hours → “a human from the team will confirm.”
- [ ] Production bookings stay on the custom Groq gateway, not this demo path.

When a prospect **buys**, approved facts become a published `ClientConfig` (see `packages/database`) and live integrations are connected — do not clone this folder per salon.
