# Routines — your AIOS working while your laptop is closed

Routines are scheduled Claude agents. Two ship with every Sturdy AIOS. **Activate them at the END of onboarding — *after* you've wired your connections** (mail, calendar, etc.), because they depend on those.

> **Use CLOUD routines** so they run on Anthropic's infrastructure with your laptop closed — create them with **`/schedule`** in the Claude Code CLI, or in the desktop app: **Routines → New routine → Cloud**. Cloud routines clone your repos from GitHub and use your wired connectors. *(Local "desktop tasks" only run while the app is open — fine for testing, not for daily value.)*
>
> Heads-up: cloud routines are rate-limited (~5 runs/day on Pro, 15 on Max). One daily + one weekly is well within that.

---

## 1. ⭐ Daily Brief — the one that shows the magic

**Schedule:** every day, ~07:00 your local time.

**What it does:** pulls your important unread emails, today's calendar, and relevant news; distils them into a sharp morning brief; then generates a **voice version** (ElevenLabs) you can listen to with your coffee.

**Needs first:** mail + calendar connectors wired, a news/web source, and `ELEVENLABS_API_KEY` in `.env`.

**Routine prompt (paste into `/schedule`):**
> "Produce my Daily Brief. 1) Pull my unread/important emails from the last 24h and today's calendar events via my connectors. 2) Pull 3–5 relevant news items for my industry/interests. 3) Write a sharp, British-English brief: what needs my attention today, what's new, what to ignore — prioritised, no fluff. 4) Generate a natural-voice audio version with ElevenLabs and save/deliver it. Keep it under 3 minutes spoken. Income-first framing where relevant."

---

## 2. Weekly Estate Sweep — keeps the brain(s) clean

**Schedule:** weekly, Sunday 21:00.

**What it does:** for every brain this AIOS routes to (see `CLAUDE.md` / `BRAINS.md`): `/brain-compact` + `/lint`; then `/audit` (Four-Cs score) + `/insights`. Commits and pushes per brain. Never commits secrets.

> Template-logic sync (`/update`) is **not** part of this sweep — the **Sturdy Ai GitHub App** (see `os/references/sturdy-ai-app.md`) now owns template fan-out, pushing logic updates to every installed repo automatically whenever the template changes. No `/update`, no PRs. This sweep is brain-hygiene + reflection only.

**Routine prompt (paste into `/schedule`):**
> "Run the weekly estate sweep. For each brain in BRAINS.md, run /brain-compact then /lint. Then /audit and /insights from this AIOS. Commit and push wiki/index/log changes per brain; before each push grep for secrets (.env/.pem/.key/-sa.json) and abort that push if any match. Leave the Four-Cs score and top ranked actions ready for me."

---

## Activate at onboarding (after connections)

`/onboard` will offer to set these up once your connections are wired. Or do it yourself:
- **CLI:** `/schedule` → paste the prompt → set the cadence → choose **cloud**.
- **App:** Routines → New routine → **Cloud** → paste prompt + schedule.

**Start with the Daily Brief** — it's the fastest "wow", and it proves the system works while you sleep.
