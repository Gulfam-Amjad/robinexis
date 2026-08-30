# Connections

Registry of every system your AIOS can reach. Filled by `/onboard` from Q4-Q7 answers; expanded over time as you wire new tools. `/audit` checks this file for domain coverage and freshness.

| # | Domain | Tool | Mechanism | Auth | Last checked |
|---|---|---|---|---|---|
| 1 | Revenue / Financials | Stripe (payments) · GoHighLevel (pipeline) · QuickBooks (accounting) | Stripe: webhook handler in apps/api (keys local `.env`) | .env | 2026-08-29 |
| 2 | Customer interactions | Gmail · Twilio (production: Smith England Salon AI receptionist live on +447446868067) · WhatsApp/SMS | Twilio: key+ref | .env | 2026-08-19 |
| 3 | Calendar | Google Calendar (internal) — product also integrates client-side with Outlook & Fresha · Cal.com (production booking tool for Smith England Salon — **account identity unverified, see os/decisions/log.md 2026-08-19**) | key+ref | .env | 2026-08-19 |
| 4 | Communication | Slack (team) · WhatsApp (team quick updates) | not yet connected | — | — |
| 5 | Project / task tracking | Notion (roadmaps, onboarding pipeline, SOPs) · GitHub Issues (technical tasks) | not yet connected | — | — |
| 6 | Meeting intelligence | Fireflies.ai · Google Meet recordings | not yet connected | — | — |
| 7 | Knowledge / files | Google Drive · Notion | not yet connected | — | — |

**This registry is tool-agnostic — it mirrors *your* stack, whatever it is.** If you already run Asana, Xero, HubSpot, etc., wire those. Greenfield and want a steer? See `references/recommended-stack.md` for the tools Sturdy Ai knows best — a starting point, never a requirement.

**Mechanism options:** `mcp` (MCP server), `script` (Python/Bash hitting an API, in `scripts/`), `export` (CSV/JSON dump pipeline), `key+ref` (`.env` key + `references/{tool}-api.md` guide), `not yet connected`.

When you wire a new tool, also save `references/{tool}-api.md` capturing endpoints, auth flow, and common queries — researched-once-saved-forever.
