---
name: onboard
description: Use on Day 1 of a Sturdy AIOS install, when someone says "set me up", "onboard me", "let's get started", "fill in my AIOS", or has just cloned the kit. Combined wizard — runs the 7-question intake AND scaffolds the Day-1 file set at the end. Idempotent — re-run any time after editing os/aios-intake.md.
---

## What this skill does

Single combined wizard. Reads or writes `os/aios-intake.md` (the canonical intake), conducts the 7-question interview if the file isn't filled, then scaffolds the Day-1 file set inline at the end of the run. No separate `/scaffold-from-intake` skill — this is one flow.

**The wow moment:** at the end, suggest the closing prompt *"Try this — ask me: what should I focus on this week?"* The user runs it once. That's the wow. There's no `/today` skill to save — the prompt itself plants the Mindset framework (Default Shift) for them to internalize.

## When NOT to run this

- If the user has already onboarded and wants to refresh: still run, but skip questions already answered (idempotent).
- If the user wants to add a new connection: that's not onboarding — point them at `os/connections.md` to edit directly, or schedule a `/level-up` Phase 2 walk.

## Execution

### Step 1: Read the intake

Read `os/aios-intake.md`. Check which Q1-Q7 sections have content vs. `[Your answer here]` placeholders.

- **All filled** → skip Step 2, jump to Step 3 (scaffold).
- **Some filled** → ask the user: "I see Q1, Q3, Q4 are answered. Want to fill the rest now, or scaffold from what's there?" Their call.
- **None filled (fresh clone)** → run Step 2 conversationally.

### Step 2: The interview (7 questions, hard cap)

Ask one at a time. Write each answer into `os/aios-intake.md` as you go (so the user can resume if interrupted).

**Q1 — Who are you, what do you sell, who do you sell it to?**
Identity, offer, ICP. One paragraph each is fine.

**Q2 — Paste 1-2 things you've written recently. Don't edit them.**
*This is the only question with a hard rule.* Voice samples MUST be pasted, not typed mid-conversation. If the user starts typing fresh prose, refuse:

> *"Stop — paste it raw. If you type it here while we're talking, the sample is already shaped by our conversation. Open your last email or LinkedIn post in another tab and paste the unedited text. This is the one rule I can't bend."*

Ask for two samples. One email, one post. Or two of either.

**Q3 — What are your 2-3 biggest priorities for the next 90 days?**
Quarterly priorities. Push back if they say "grow my business" — make them name a number, a deadline, or a deliverable.

**Q4 — Where does revenue actually land, and where is it tracked?**
Multiple answers OK. Map to Tier-1 Domain 1 (Revenue/Financials).

**Q5 — Where do you talk to customers, your team, and the outside world day-to-day?**
Email (Gmail/Outlook), Slack/Teams/Discord, DMs. Map to Domains 2 + 4.

**Q6 — Where do meeting recordings, notes, and important docs live?**
Map to Domains 6 + 7.

**Q7 — What's the one task that eats your week, and where do you currently track work?**
Capture top_pain (used by `/level-up` Day-14) + Domain 5 (tasks).

Domain 3 (Calendar) is auto-inferred from Q5: Gmail → Google Cal; Outlook → Outlook Cal. Confirm in Step 3.

### Step 3: Scaffold the Day-1 file set

Once the intake is complete, generate these files (or update if re-running). If originals exist, commit them first (`git add -A && git commit -m "onboard: pre-refresh snapshot"`) — git history is the backup; no archive folders.

1. **`os/context/about-me.md`** — from Q1 (identity, role) + Q7 (top_pain). One short paragraph each.
2. **`os/context/about-business.md`** — from Q1 (offer, ICP) + Q4 (revenue model). One paragraph.
3. **`os/context/priorities.md`** — from Q3. Numbered list, one line per priority.
4. **`os/references/voice.md`** — from Q2. Paste samples verbatim with a short header explaining their use ("Match this register when drafting; don't fake voice on external content without showing me first").
5. **`os/connections.md`** — populate the 7-row table from Q4-Q7 answers. Each row gets `mechanism: not yet connected`, `auth: —`, `last checked: —`. The user wires connections on Day 2.
6. **`CLAUDE.md`** — fill all `{{...}}` placeholders. Substitute the user's name, stated priority, voice register summary, and a brief connections summary.
7. **First brains** — from Q1/Q4, copy `brains/_template/` to one folder per stream the user actually has (at minimum a company brain; a personal brain if they want one). Fill each new brain's `README.md` scope block, then register every brain in **both** the `CLAUDE.md` routing table and `BRAINS.md`, and list them in `index.md`. Never delete `brains/_template/` itself.

### Step 4: The closing screen

Print one screen. Three lines max:

```
✓ Day 1 done. Your AIOS knows who you are, what you sell, what matters this quarter, and how you sound.

Today: ask me — "what should I focus on this week?"
Tomorrow: `cp .env.example .env`, install the Sturdy Ai app (https://github.com/apps/sturdy-ai) to stay auto-updated, then wire one tool from os/connections.md.
Day 7: run /audit to see your score.
```

When the user runs the closing prompt ("what should I focus on this week?"), respond using only the new context files. Hit:
- 3-bullet priority list, in their voice register from Q2
- Each bullet ties back to a stated 90-day priority from Q3
- Final line: *"If I had to pick one thing for Monday, it'd be [X], because [reason from priorities]. Want me to draft the first email? And — where could the Default Shift apply here? To what extent could AI be leveraged on this task?"*

The Default Shift question seeds the Mindset framework before `/level-up` formally introduces it on Day 14.

### Step 5: Install the Sturdy Ai app (keeps you auto-updated) — REQUIRED

Part of the Day-2 setup, alongside wiring connections and API keys. The **Sturdy Ai GitHub App** is what keeps this AIOS (and your brains) current with the latest skills and improvements automatically — without it, you're frozen on the version you cloned.

Walk the user through it (it's on **their** GitHub account, so only they can authorise it — exactly like connecting a tool or generating an API key on their machine):

1. Open **https://github.com/apps/sturdy-ai/installations/new**
2. Choose the account that owns this AIOS repo.
3. Select the AIOS repo (brains live inside it — one repo is the whole system).
4. Authorise. Done — Sturdy Ai improvements now land automatically; they can revoke any time in GitHub → Settings → Applications.

Then tell Sturdy Ai (Joe) the new repo names so they're added to the fan-out roster. Until both are done (App installed **and** repo on the roster), this instance won't receive updates.

### Step 5b: Set up the `.env` (your single key store) — Day 2

Before wiring any tool, **copy the example — don't rename it:**

```bash
cp .env.example .env
```

`.env.example` ships with the kit: a **tracked, placeholder-only** list of every key the stack might need. It stays in the repo so it always documents what's required — so you *copy* it, never rename or delete it. Your real keys go in `.env` only, which is **gitignored (local-only, never committed)**. That's your one canonical secret store. Never put real values in `.env.example`. Add keys as you wire each tool — `/connect` drops the right placeholder into `.env` for you.

### Step 6: Offer to set up the routines (AFTER connections)

Routines depend on wired connections, so this comes **once the user has connected their tools** (Day 2+), not on Day 1. When they're connected, walk them through `ROUTINES.md` — the two ready-to-activate routines — and offer to set them up as **cloud** routines (run with the laptop closed) via `/schedule` or the app's Routines tab:

1. **⭐ Daily Brief (daily)** — set this up FIRST. It pulls important emails + calendar + news and generates a voice brief. It's the fastest proof the system delivers serious value while they sleep. Needs mail/calendar connectors + `ELEVENLABS_API_KEY`.
2. **Weekly Estate Sweep (Sunday)** — compact + lint + audit + insights across their brains. (Template/logic updates aren't part of this — the Sturdy Ai App pushes those automatically.)

Paste the routine prompts straight from `ROUTINES.md`. Prefer **cloud** routines for laptop-closed autonomy; local desktop tasks only run while the app is open. Heavy client production automation → Make.com. Reactive skills (`ingest`, `save`, `sync`…) need no routine — they fire on demand. Full table: `os/references/cadence-and-routines.md`.

## Critical implementation rules

1. **The 7-question cap is non-negotiable.** Don't add Q8 in conversation.
2. **Voice paste cannot be skipped.** If the user types samples mid-chat, refuse and tell them to paste from real writing.
3. **One-shot scaffold.** After Step 2 ends, write Step 3 files in a single batch. No multi-turn confirmation. The user iterates by editing `os/aios-intake.md` and re-running.
4. **Idempotent.** Re-running with an edited intake refreshes context files; originals are committed to git first (history is the backup). Skips questions already answered unless the user wants to revise.
5. **Closing screen is three lines.** Not a menu.
6. **No extra skills generated.** Don't scaffold `/today`, `/draft`, etc. The kit ships its skill set; the user authors more via `/level-up`.
7. **Read-only on `os/references/3ms-framework.md`.** It already ships in the kit. Don't overwrite.
8. **No `.env` writes.** Don't ask for API keys on Day 1. Connections come Day 2.

## Verification (for the implementer)

- Cold-test: clone a fresh kit, run `/onboard`, fill 7 answers, scaffold runs, ask the wow prompt, response cites Q1 + Q3 + Q7 specifically. Generic = fail.
- Idempotency: re-run `/onboard` with one Q3 priority changed. Expected: only `os/context/priorities.md` and `CLAUDE.md`'s priority section update; a pre-refresh git commit exists.
- Voice rejection: type a sample mid-chat. Expected: skill refuses, asks for paste.

> The Mindset language used in the closing screen comes from `os/references/3ms-framework.md`.
