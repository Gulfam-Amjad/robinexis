---
name: connect
description: Use to wire tools into the AIOS — both the guided multi-tool setup wizard ("set me up", "connect my tools", "let's wire up my stack", "connect my connectors") AND single-tool wiring ("connect X", "wire up X", "add a connection / API / CLI / MCP", or handed a tool name or docs URL). Preinstalled with the common connectors; for anything new it researches the official docs, writes a reference doc, and walks the same auth flow. Picks the leanest mechanism (CLI → API → MCP), guides non-technical users to get each key, writes it to .env, verifies it works, and registers it in os/connections.md. The "research once, save forever" + "non-technical setup wizard" skill.
---

## What this skill does

Two modes, one skill — built so a **non-technical person can wire up their whole stack themselves**:

- **Wizard mode** (no specific tool — "set me up", "connect my tools") → shows a tick-box list of connectors, then walks them through each one, one at a time: get the key → paste it → Claude writes `.env`, runs the auth, **verifies it works**, flips `os/connections.md` to ✓.
- **Single-tool mode** ("connect Stripe", or a docs URL) → wires that one tool. If it's **new** (no reference doc yet), Claude researches the official docs, writes the reference doc, then continues the same auth flow.

The human only ever does the one thing they must — log into *their own* account and create a key. Claude owns everything technical: where the key goes, formatting, auth, verification, and fixing errors. That division of labour is the whole point.

## The mechanism preference order (the whole point)

**CLI → API → MCP.** Driven by context-window economy and maintenance cost:

1. **CLI first — *if a quality official CLI exists*** (`gh`, `stripe`, `gws`, `wrangler`, `heygen`, `elevenlabs`…). Token-light and zero-maintenance: the tool handles auth, pagination, retries.
2. **API second — when there's no good CLI.** Maximum control, still lean *if* you keep a tight reference doc. Prefer official REST/GraphQL.
3. **MCP last — hard rule.** An MCP loads *every* tool definition into context whether used or not. Reserve for: no API/CLI exists, used constantly, or an MCP already connected where convenience clearly wins. **Actively migrate off MCPs onto a CLI/API when one exists.**

> Override only with a stated reason. Otherwise walk the order top-down, stop at the first that's available and solid.

---

## Wizard mode (the guided multi-tool flow)

Trigger: the user wants to set up connections generally, not name one tool.

### Step W1 — Show the menu
List the connectors as a tick-box menu, split into:
- **Ready now (preinstalled):** every tool that already has a `os/references/{tool}-*.md` doc — these connect instantly, no research needed. Pre-tick the ones their **vertical/stack** needs (e.g. self-storage → Twilio, ElevenLabs, Stora, Make, Google).
- **Add something else:** anything not in the library → triggers the new-connector research path (Step N below) before connecting.

Ask which they want. Let them tick several; you'll do them one at a time.

### Step W2 — For each ticked tool, run the guided loop (ONE at a time)
1. **Tell them where to get the key — in plain English.** Pull the steps from that tool's reference doc (its `## 🔑 Get your key` block, or the Connection/Auth section). 2–4 numbered steps, no jargon, with the exact settings URL. Example: *"1. Go to elevenlabs.io and sign in. 2. Click your profile → API Keys. 3. Copy the key and paste it here."*
2. **Wait for them to paste the key.** Never ask them to edit files — they paste into chat, you handle the rest.
3. **Claude does the technical part:**
   - Write the value into `.env` (use `os/bin/tidy-env.py` ordering if present; never echo the value back).
   - Run the auth / login for the chosen mechanism (`heygen auth status`, `gws auth login`, etc.).
   - **Verify with a read-only call** ("who am I", "list 3"). If it errors, diagnose and fix live — wrong key, missing scope, env not exported — and append the fix to the reference doc.
4. **Confirm:** "✓ {tool} connected." Flip its `os/connections.md` row to ✓ with today's date. Move to the next ticked tool.

### Step W3 — Close
Summarise what's now live, what still needs a key, and what was deferred. Suggest the next sensible connector for their goals.

> OAuth tools (e.g. Google `gws`) have no key to paste — for those, guide the browser login (`gws auth login -s drive,gmail,calendar`) instead of a paste step.

---

## Single-tool mode + the new-connector research path

Trigger: "connect {tool}" or a docs URL.

1. **Known tool** (has a reference doc) → jump straight to the guided loop (Step W2) for that one tool.
2. **New tool** (no reference doc) → research first, then connect:
   - **a. Discover** — web-search `"{tool} official API docs"`, `"{tool} CLI"`, `"{tool} MCP server"` to see what exists.
   - **b. Choose mechanism** — walk CLI → API → MCP, stop at the first available and first-party-quality. State which and why in one line. If an MCP is already connected in-session, say so and offer MCP-now vs CLI/API.
   - **c. Research the official docs** (vendor source, not a blog). Extract only what you'll use: auth (how to get the key, header format, scopes, **exact settings path**), connection basics (base URL / install+auth command / server config), 10–20 common operations, gotchas + limits. Record the official doc URL.
   - **d. Write `os/references/{tool}-{mechanism}.md`** — follow the `monday-api.md` shape (connection table, object model, common operations with copy-paste examples, gotchas, "append fixes here" footer). **Include a `## 🔑 Get your key` block** (the plain-English 2–4 steps the wizard reads).
   - **e. Register + connect** — add the `.env` placeholder, fill the `os/connections.md` row, then run the guided loop (Step W2) to get the key and verify.

---

## Rules

- **Mechanism order is CLI → API → MCP, MCP last, every time** unless the user gives an explicit override reason. Migrate off MCPs where a CLI/API exists.
- **Secrets live only in `.env` (gitignored).** `os/connections.md` and every `os/references/` doc record *that* a tool is connected and *how* — never the credential. Confirm `.env` is gitignored; never echo a pasted key back.
- **Never make a non-technical user edit a file or run a raw command.** They paste a key; you do the rest. Always end a tool on a green ✓ verification, not "it should work now."
- **Official docs only.** Cite the source URL. Don't reconstruct an API from memory — go read current docs.
- **Dedicated, scoped account** where supported; read-only until writes are proven necessary. Never the user's personal login for write access.
- **Lean over complete.** A reference doc the AI scans in 1–2k tokens beats a full API dump.
- **Date-stamp** every connection's *Last checked* so `/audit` flags stale wiring.

## Output

- For new tools: a `os/references/{tool}-{mechanism}.md` (with a `## 🔑 Get your key` block).
- An updated `os/connections.md` row (✓ + date) per tool connected.
- A `.env` value written (no secret ever shown in chat).
- A short summary: what's live, what still needs a key, the next suggested connector.

## When NOT to run this

- The user wants advice on *which* tool to pick → `os/references/recommended-stack.md`, not a wiring job.
- The connection already exists and verifies → only re-run to refresh a stale reference doc or add a key.
