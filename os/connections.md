# Connections

Registry of every system your AIOS can reach. Filled by `/onboard` from Q4-Q7 answers; expanded over time as you wire new tools. `/audit` checks this file for domain coverage and freshness.

| # | Domain | Tool | Mechanism | Auth | Last checked |
|---|---|---|---|---|---|
| 1 | Revenue / Financials | Stripe (payments) · GoHighLevel (pipeline) · QuickBooks (accounting) | Stripe: webhook handler in apps/api (keys local `.env`) | .env | 2026-08-29 |
| 2 | Customer interactions | Twilio + ElevenLabs (Blades Hair client demo live on +447446868067; inbound voice routes directly to agent `agent_6101m1c3n4wnfsgskgzr13w2gt9s`) · Gmail · WhatsApp/SMS | Twilio: API key · ElevenLabs: CLI/API key | .env | 2026-09-02 |
| 3 | Calendar | Cal.com (verified live Blades Hair availability and ElevenLabs booking tools) · Google Calendar (internal) · Outlook & Fresha (supported client-side) | key+ref | .env | 2026-09-02 |
| 4 | Communication | Slack (team) · WhatsApp (team quick updates) | not yet connected | — | — |
| 5 | Project / task tracking | Notion (roadmaps, onboarding pipeline, SOPs) · GitHub Issues (technical tasks) | not yet connected | — | — |
| 6 | Meeting intelligence | Fireflies.ai · Google Meet recordings | not yet connected | — | — |
| 7 | Knowledge / files | Google Drive · Notion | not yet connected | — | — |
| 8 | Auth email delivery | Supabase Auth (magic links, sign-up confirmations) sending through Google Workspace SMTP on `hello@robinexis.com` | key+ref: `smtp.gmail.com:465` custom SMTP set in the Supabase dashboard | Google app password, held only in Google and the Supabase dashboard — never in this repo | 2026-09-06 |

**This registry is tool-agnostic — it mirrors *your* stack, whatever it is.** If you already run Asana, Xero, HubSpot, etc., wire those. Greenfield and want a steer? See `references/recommended-stack.md` for the tools Sturdy Ai knows best — a starting point, never a requirement.

**Mechanism options:** `mcp` (MCP server), `script` (Python/Bash hitting an API, in `scripts/`), `export` (CSV/JSON dump pipeline), `key+ref` (`.env` key + `references/{tool}-api.md` guide), `not yet connected`.

When you wire a new tool, also save `references/{tool}-api.md` capturing endpoints, auth flow, and common queries — researched-once-saved-forever.
