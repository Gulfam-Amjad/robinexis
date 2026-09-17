# Robinexis Voice Agent System — Playbook

**Version 1.1 · Prepared by Sturdy Ai — AI & Automation Partner · 25 May 2026**

The blueprint for how Robinexis creates voice agent demos for prospects, closes deals, and (depending on chosen path) deploys those agents into customer businesses.

Stack: Claude Desktop (with custom build skill), ElevenLabs, Cal.com, Twilio.

---

## Scope at a glance — what this playbook covers

| Phase | Activity | Owner | Commercial |
|---|---|---|---|
| **Foundation** (£750, this engagement) | Set up demo-creation system: Claude Desktop skill, ElevenLabs architecture, prompt library, recorded training, 7 days light support | Sturdy Ai builds → Robinexis operates | One-off £750 |
| **Demo creation** (ongoing) | Generate prospect-specific demo agents for sales pitches | Robinexis (self-serve via skill) | Included in £750 foundation |
| **Customer deployment** (post-sale) | Take signed demo → production: Twilio numbers, Cal.com booking, KB load, deploy, tune | Sturdy Ai | **Track 1: £75/hr hourly** OR **Track 2: 50/50 partnership** |
| **Ongoing maintenance** (post-deployment) | Prompt tuning, debugging, optimisation, monitoring | Sturdy Ai | Track 1: hourly as needed · Track 2: included in 50/50 |

**Robinexis can mix and match tracks per customer** — start with hourly, graduate to partnership when volume justifies.

---

## About Sturdy Ai

**Sturdy Ai is your AI & Automation Partner.** We **architect, build, deploy and optimise** intelligent systems end-to-end — voice agents, workflow automations, full AI stacks.

**On this engagement (Foundation):** Sturdy Ai sets up the demo-creation system so Robinexis can self-serve demos for prospects. Going forward, Robinexis sells; Sturdy Ai handles deployment + maintenance under whichever commercial track suits each deal.

Founder & AI Solutions Architect: Joe Sturdy · joe@sturdyai.uk · sturdyai.uk

---

## 1. The System in One Diagram

```
Customer's Website / Phone Number
            │
            ▼
   ┌────────────────────┐
   │   ElevenLabs       │  ◄── Voice (TTS), LLM brain, conversation loop
   │   Voice Agent      │
   └─────────┬──────────┘
             │
   ┌─────────┼─────────┐
   ▼         ▼         ▼
 Cal.com   Twilio   Knowledge
(bookings) (phone)   (FAQs, docs)
```

Four moving parts. One repeatable pipeline.

---

## 2. The Four Building Blocks of Every Agent

Every voice agent we deploy has the same four ingredients. Master these, master the system.

| Block | What it is | Where it lives |
|-------|-----------|----------------|
| **Persona** | System prompt — tone, role, rules | ElevenLabs agent config |
| **Voice** | TTS voice (cloned or stock) | ElevenLabs voice library |
| **Knowledge** | Business info, FAQs, services | KB document or vector store |
| **Tools** | What the agent can *do* (book calls, look up orders, etc.) | ElevenLabs tools config |

---

## 3. Deployment Modes

Three ways to ship an agent. Pick based on the client's need.

1. **Website Widget** — JS snippet pasted onto the customer's site. Floating button → start call. *Default for most B2B clients.*
2. **Twilio Phone Number** — agent answers a real number. *For clients who get inbound calls.*
3. **Dashboard / App** — internal use only, less common.

Most Robinexis clients will want **widget + Twilio** combined: one agent, two doorways.

---

## 4. The Build Process — Two Paths

There are two distinct workflows: the **demo build** (Robinexis self-serve, used in sales) and the **production deploy** (Sturdy Ai, post-signed-deal).

### Path A — Demo Build (Robinexis self-serve)

Used in sales. Built by Robinexis in minutes using a Claude Desktop skill that Sturdy Ai sets up during the foundation build.

**The flow:**

1. Open Claude Desktop
2. Trigger the **"Build Voice Agent Demo"** skill
3. Paste:
   - Prospect's website URL
   - 2-3 lines on the business (industry, what the agent should do, tone preference)
4. The skill:
   - Scrapes the prospect's site for context and brand
   - Drafts a system prompt
   - Configures a new ElevenLabs agent via API on Sturdy Ai's infrastructure (white-labelled as Robinexis)
   - Returns a widget snippet + a shareable demo link
5. Robinexis shows the demo in their pitch

**Time to demo: 2-5 minutes.** No technical work. No code. No dashboards.

If the prospect signs, Robinexis hands the deal to Sturdy Ai for production.

### Path B — Production Deploy (Sturdy Ai, post-signed-deal)

Once a customer signs and pays Robinexis, Sturdy Ai takes over end-to-end.

**Step 1 — Intake (15 min)**
- Customer's signed scope (which tier, which integrations)
- Tools needed beyond Cal.com (CRM, order lookup, etc.)
- Final tone/voice direction
- Customer's preferred Twilio number (or geography for selection)

**Step 2 — Architecture & Build (60-90 min)**
- Promote the demo agent into a production agent on Sturdy Ai's ElevenLabs (white-labelled as Robinexis)
- Harden the system prompt for live use
- Load full knowledge base (services, pricing, FAQs, edge cases)
- Wire integrations:
  - Customer's Cal.com → check_availability + book_appointment tools (Sturdy Ai's agent calls customer's calendar via API)
  - Twilio number provisioned on Sturdy Ai's Twilio, routed to the ElevenLabs agent
  - CRM hooks (if scoped)
- Apply security guardrails (domain allowlist, spend caps, rate limits)

**Step 3 — Test Loop (30 min)**
- Live test calls — listen for: latency, voice quality, first message fires, tool calls succeed, timezone handling correct
- Iterate prompt and config until clean
- Run edge cases (caller refuses to share email, asks for refund, etc.)

**Step 4 — Customer Handover (15 min)**
- Send customer the widget snippet to paste on their site
- Confirm Twilio number is live (if applicable)
- Loom walkthrough showing the agent working
- Schedule 7-day check-in

**Step 5 — Ongoing Tuning (light-touch, forever)**
- Pull call transcripts weekly via ElevenLabs API
- Listen for failure patterns
- Iterate prompts and config

**Total Sturdy Ai time per signed-and-paid customer: ~2-3 hours upfront, then light ongoing.**

---

## 5. The Robinexis Demo Agent (Proof Build)

The agent on robinexis.com is the foundation build. Spec:

- **Persona:** Robinexis sales agent. Warm, professional, B2B. Pushes toward booking a discovery call.
- **Voice:** [TBD — stock or clone of [founder name]]
- **Knowledge:** Robinexis services, pricing tiers, FAQs, case studies
- **Tools:**
  - `check_cal_availability` — query Cal.com
  - `book_discovery_call` — write to Cal.com
- **Captures:** Full name, work email, company name, problem-to-solve, team size
- **Embed:** Floating widget bottom-right of robinexis.com
- **Phone (optional):** Twilio number routes inbound calls to same agent

---

## 6. Security & Cost Guardrails

Critical — must be configured on every deployment.

| Risk | Mitigation |
|------|-----------|
| Malicious user spams agent → burns API credits | ElevenLabs: monthly spend cap. Widget: max call duration (5-10 min). Rate limit per IP. |
| Widget stolen and pasted on another site | ElevenLabs: lock allowed domains (security → host allowlist) |
| API keys leaked | All keys in `.env` files, never committed. GitHub repo is private. Rotate quarterly. |
| Agent hallucinates pricing / makes promises | Knowledge base grounded in real docs. System prompt: "If you don't know, say you'll have a human follow up." |
| Twilio bill runaway | Twilio: spend alerts at £50 / £100 / £250 per number per month. |

---

## 7. Commercial Model — Two Tracks Post-Foundation

Once the Foundation is delivered (£750, demo-creation system live), Robinexis has two distinct commercial routes for deploying voice agents into customer businesses. They are **not mutually exclusive** — Robinexis can use Track 1 for early one-off deals and graduate to Track 2 once volume justifies.

### Track 1 — Ad-Hoc Hourly: £75/hour

**When to use:** Robinexis closes a customer and wants Sturdy Ai's hands for a specific piece of work without entering a longer-term arrangement.

**What's covered at £75/hr:**
- Implementing a closed-deal demo into a live customer system
- Wiring Twilio for live inbound/outbound calls from a real phone number
- Cal.com booking integration into the customer's calendar (handles reschedules)
- Knowledge base updates
- Prompt tuning, troubleshooting, additional training
- Strategic consulting on AI/automation projects

**How it's billed:** 30-minute increments, invoiced monthly in arrears.

**Typical scope examples:**
- Standard customer deployment (demo → production, Twilio, Cal.com): ~6-10 hrs = £450-£750
- Knowledge base refresh: ~1-2 hrs = £75-£150
- Phone routing + voicemail config: ~2-3 hrs = £150-£225

**Best for:** Robinexis's first few customers, while you're still validating the sales motion.

### Track 2 — Long-Term Partnership: 50/50 Net Revenue Share

**When to use:** Robinexis has 3+ active customers (or pipeline justifying that level) and wants to step out of customer deployments entirely. Sturdy Ai becomes the full implementation partner.

This track uses the **value-based pricing framework** developed by Sturdy Ai for Robinexis previously — the rest of this section details how that framework works.

### Why value-based pricing for Track 2

A voice agent that recovers £15k/year of missed bookings for a 5-person business and one that recovers £150k/year for a 50-person business take the same effort to build — but they deliver 10x the value. Fixed-tier pricing undercharges the second customer and overcharges the first. **Value-based pricing scales the fee with the prize.**

This framework was developed by Sturdy Ai for AI & automation agencies; Robinexis is the implementing agency, applying it to each customer.

### The Three-Part Model

Every Robinexis customer is quoted three line items:

#### 1. One-Time Value Implementation Fee
A fixed, upfront fee for design, build, and launch — calculated as a **percentage of the customer's quantified first-year value**.

| Agency tier | % of first-year value |
|---|---|
| **Beginner** | 20-30% |
| **Experienced** | 30-50% |
| **Expert** | 50%+ |

Robinexis starts at **beginner tier (25%)** and graduates up as case studies accumulate.

#### 2. Annual Maintenance & Support Subscription
Recurring annual fee covering monitoring, prompt tuning, platform-change adaptation, and ongoing optimisation. Calculated cost-plus:

**Formula:** `Final Price = Total Annual Cost / (1 − Desired Profit Margin)`

Where `Total Annual Cost = (Est. annual maintenance hours × internal hourly rate) + hard costs`

| Agency tier | Profit margin |
|---|---|
| **Beginner** | 25-35% |
| **Established** | 35-50% |
| **Expert** | 50-65%+ |

Robinexis starts at **beginner tier (30% margin)**.

**Critical: Year 1 of the Annual Subscription is billed upfront alongside the Implementation Fee.** Same invoice, same payment. Covers everything from go-live for the first 12 months.

#### 3. Ad-Hoc Development & Consulting
Any work outside the original scope or the maintenance agreement is billed hourly:

| Capability tier | Hourly rate (UK) |
|---|---|
| **Beginner / Junior** | £40-£65 |
| **Experienced / Mid-Level** | £65-£100 |
| **Expert / Senior** | £100-£150+ |

Robinexis quotes ad-hoc work at **£75-£90/hour** to start (mid-level — reflects Sturdy Ai handling the actual build).

### The split: 50/50 of net revenue

**Customer pays Robinexis. Sturdy Ai invoices Robinexis monthly for (a) platform costs incurred + (b) 50% of net revenue. Robinexis keeps the remainder.**

```
Customer pays Robinexis (Implementation + Year 1 Maintenance, upfront)
        │
        ▼
Sturdy Ai invoices Robinexis:
    [1] Platform costs incurred (pass-through, no markup)
        • ElevenLabs minutes & subscription
        • Twilio number + usage
        • (Customer Cal.com costs if dedicated seat needed)
    [2] Sturdy Ai's 50% share of net revenue (Customer Payment − Platform Costs) × 0.5
        │
        ▼
Robinexis keeps: Customer Payment − Sturdy Ai's invoice
    (= 50% of net, equivalent share)
```

**Why this flow vs. Robinexis paying platforms directly:** All production agents run on Sturdy Ai's ElevenLabs and Twilio accounts (white-labelled managed services — see §8). Sturdy Ai gets the platform bill, so Sturdy Ai recovers those costs by invoicing Robinexis. The end result is the same 50/50 net split — just routed through one consolidated set of platform accounts for operational simplicity and volume pricing.

### Worked Example — 5-BDR customer, £15k first-year value

(Robinexis quoting at beginner-tier rates: 25% implementation, 30% margin on subscription.)

| Line item | Calculation | Amount |
|---|---|---|
| **Implementation Fee** | 25% × £15,000 | £3,750 |
| **Year 1 Maintenance Subscription** | £2,020 internal cost / (1 − 0.30) | £2,885 |
| **Total Year 1 Upfront Invoice** | | **£6,635** |

**Money flow:**

| | Year 1 Upfront | Year 2+ (recurring) |
|---|---|---|
| Customer pays Robinexis | £6,635 | £2,885/yr |
| Sturdy Ai invoice to Robinexis (platform pass-through + 50% share) | £3,617 | £1,682/yr |
| **Robinexis keeps** | **£3,018** | **£1,203/yr** |
| **Sturdy Ai keeps (after paying platforms)** | **£3,017** | **£1,202/yr** |

Both sides net the same ~50% of post-platform-cost revenue. Sturdy Ai just runs the invoicing through one consolidated set of platform accounts.

### How to quantify first-year value (sales conversation)

This is the work Robinexis does during the pitch. Ask the prospect:

- How many enquiries / calls do you currently miss per week?
- What's the average deal value?
- How many hours per week does your team spend on calls the agent could handle?
- What's the loaded hourly cost of that time?

Multiply out → annual value. That's the number the Implementation Fee is anchored to.

**Conservative defaults if the prospect can't quantify:**
- Missed calls recovered: 2-4 / week × avg deal value × 50 weeks
- Staff time saved: 5-10 hrs/week × £20-30/hr loaded × 50 weeks

### Scale picture

As Robinexis closes more deals and graduates from beginner → experienced tier (40% implementation, 45% margin), the same £15k-value customer becomes:

- Implementation: £6,000
- Year 1 Subscription: £3,672
- Total upfront: **£9,672** (vs £6,635 at beginner tier)

**Same agent. 46% more revenue. Earned by maturing the agency.**

| Live customers (mixed sizes) | Avg Year 1 upfront | Annual recurring | Sturdy Ai/yr (50% net) |
|---|---|---|---|
| 5 customers | £35,000 cumulative | £15,000 | ~£6,750 |
| 15 customers | £100,000 cumulative | £45,000 | ~£20,000 |
| 30 customers | £200,000 cumulative | £90,000 | ~£40,000 |

---

## 8. Tools & Accounts — Infrastructure Layer

### The model: white-labelled managed services

All production voice agents (Robinexis's own demo agent + every customer agent) run on **Sturdy Ai's** ElevenLabs and Twilio accounts. This is the standard implementation-partner pattern — same way marketing agencies run client ad campaigns on their own Meta accounts, or dev agencies host client apps on their own AWS.

**Customers never see Sturdy Ai.** Every agent is branded as Robinexis end-to-end. The hosting layer is invisible.

### Sturdy Ai owns (all platform accounts for delivery)

| Platform | Purpose |
|---|---|
| **ElevenLabs** (Creator tier+) | Hosts every voice agent — Robinexis's own and every customer agent |
| **Twilio** (pay-as-you-go) | All phone numbers, all inbound/outbound call routing |
| **Claude** (own subscription) | LLM brain for all builds — zero cost to Robinexis |
| **Claude Desktop demo-build skill** | Set up by Sturdy Ai, used by Robinexis from their own Claude Desktop for prospect demos |
| **System prompt library & build templates** | Maintained internally by Sturdy Ai |

### Robinexis owns (customer-relationship layer)

| | Purpose |
|---|---|
| **Cal.com** (Teams plan) | Robinexis's own demo agent books into Ed/Will's calendars here |
| **Customer contracts & invoicing** | Robinexis is the contracting party with every customer |
| **Brand & sales motion** | Every agent is branded as Robinexis |

### Per customer

| Item | Lives on |
|---|---|
| Production ElevenLabs agent | **Sturdy Ai's** ElevenLabs |
| Customer's Twilio phone number | **Sturdy Ai's** Twilio |
| Customer's Cal.com calendar | **Customer's own Cal.com** (agent books *into* their calendar via API) |
| Knowledge base / system prompt | **Sturdy Ai's** ElevenLabs |

Customers never need their own ElevenLabs or Twilio. They keep using whatever calendar they already have (Cal.com, Calendly, Google Calendar — Sturdy Ai wires the agent to it via API).

### What about the logins Robinexis already shared?

They become dormant. **Robinexis can close those ElevenLabs and Twilio accounts to save the monthly subscriptions** — Sturdy Ai's infrastructure handles everything. Robinexis's Cal.com stays live (for the demo agent on robinexis.com to book into Ed/Will's calendars).

This means **Robinexis pays zero ongoing platform fees**. All platform costs flow through Sturdy Ai and are recovered transparently via the customer-revenue invoicing model (see §7).

### Data portability guarantee — written into the agreement

To protect Robinexis from infrastructure lock-in:

> If the Sturdy Ai partnership ends for any reason, Sturdy Ai will provide Robinexis with full export of: all agent configurations, system prompts, knowledge bases, customer call logs, and a migration runbook — within 30 days' notice. Robinexis can spin up on its own ElevenLabs / Twilio accounts and continue serving customers without service disruption.

Customer relationships are Robinexis's; infrastructure is just where the kit runs.

---

## 9. Troubleshooting Cheat Sheet

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| First message doesn't play | ElevenLabs widget timing bug | Toggle "play first message immediately" in agent config |
| Wrong time zone in booking slots | Tool call sending UTC not local | Update tool parameter to customer's TZ |
| Agent mispells email | Not confirming character-by-character | Add to system prompt: "Always read back name and email letter by letter to confirm" |
| Long pauses / latency | Premium voice + large LLM | Drop to faster voice or Claude Haiku for non-critical paths |
| Agent hallucinates | Weak KB or vague prompt | Tighten system prompt, add explicit "if unknown say X" rule |

---

## 10. Who Does What — The Operating Split

Cleanest possible division of labour. No grey zones. Read it twice.

### Robinexis owns

| Activity | Detail |
|---|---|
| **Customer acquisition** | Cold outreach, inbound, networking — finding prospects |
| **Demo creation** | Builds the prospect-specific demo agent using the Sturdy Ai template (trained once, reusable forever) |
| **Pitching & closing** | Walking into businesses, showing the demo, getting the signature |
| **Customer contracts & invoicing** | They sign and pay Robinexis |
| **Customer-facing support comms** | First line of contact for the customer |
| **Branding** | Every deployed agent is branded as Robinexis |
| **Customer Cal.com** | Robinexis's own Cal.com is live (so robinexis.com demo agent books into Ed/Will's calendars). Each customer keeps using their own calendar. |

### Sturdy Ai owns

| Activity | Detail |
|---|---|
| **Platform infrastructure** | Owns and operates ElevenLabs and Twilio accounts hosting every production agent (Robinexis's own + all customers). White-labelled — customers never see Sturdy Ai. |
| **Demo skill setup** | Builds and configures a Claude Desktop skill so Robinexis can generate prospect demos in minutes (covered by £1,000 foundation fee) |
| **Claude account** | Operated on Sturdy Ai's own Claude subscription — zero Claude cost to Robinexis |
| **Data portability** | Provides full export of agent configs, prompts, KBs, call logs + migration runbook within 30 days of any partnership end — Robinexis is never locked in |
| **System architecture** | Designs the full production architecture from the signed-customer demo |
| **Production build** | Hardens the demo into a live, integrated, scalable system |
| **All integrations** | Cal.com booking, Twilio routing, CRM hooks, knowledge base loading |
| **Deployment** | Pushes the widget to the customer's site, configures phone numbers, security guardrails |
| **First-week monitoring** | Live call review, prompt iteration, fixes |
| **Ongoing maintenance** | Forever — prompt tuning, debugging, performance optimisation |
| **Build template & prompt library** | Sturdy Ai maintains internally; Robinexis accesses the demo-build skill via Claude Desktop |
| **Technical escalation** | Tier-2 support if Robinexis can't resolve a customer issue |

### Critical rule — no work before payment

**Sturdy Ai only engages on signed and paid deals.** No "quick demos for prospects." No spec work. No exceptions.

Demo creation is a Robinexis sales activity. Once a customer pays Robinexis, the implementation clock starts and Sturdy Ai takes the deal end-to-end through to production.

This stops scope creep and protects both sides:
- Robinexis isn't bottlenecked waiting for Sturdy Ai to build demos for prospects who might not close
- Sturdy Ai isn't burning hours on pre-revenue speculation

---

## 11. Next Actions

1. Robinexis returns signed acceptance + **£1,000 upfront payment**
2. Sturdy Ai provisions Robinexis's voice agent on its own ElevenLabs / Twilio infrastructure (consolidates all hosting under Sturdy Ai's stack — Robinexis's previously-shared platform accounts can be closed to save monthly fees)
3. Production agent live on robinexis.com within 72 hours of payment
4. Full handover by Fri 29 May — including the Claude Desktop demo-build skill set up for Robinexis

---

*Sturdy Ai — AI & Automation Partner · We architect, build, deploy & optimise end-to-end · Frome, Somerset · joe@sturdyai.uk*
