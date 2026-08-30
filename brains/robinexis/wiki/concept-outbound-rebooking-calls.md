---
created: 2026-07-31
type: concept
tags: [voice-agent, outbound-calling, compliance, sales, roadmap]
status: planned
---
# Outbound Rebooking Calls — planned feature, not yet live

> The agent doesn't just answer calls — it can place them: ringing a client to prompt a rebooking, live, by voice, instead of the SMS/email nudge Fresha/Booksy/Zenoti already send. Built into the underlying stack; **gated to switch on per client post-onboarding**, once — and only once — that client has proper consent on file. Not shown in demos, and not to be pitched as live until the consent flow below is actually built.

## Why it's worth having

Fresha, Booksy and Zenoti already do outbound rebooking reminders — but all three are asynchronous (a scheduled text/email, or a "book again" button the client has to tap themselves). None of them puts a live voice on the phone. That's the real gap this fills, and it sits alongside — not in competition with — the core pitch (see [[concept-demo-workflow]]): the agent answering *inbound* calls nobody's there to pick up. Outbound rebooking is the same "we're present when your booking software isn't" logic, running the other direction.

## Current status

- **Underlying capability: built into the stack** (ElevenLabs agent + Twilio can originate calls today).
- **Not in any demo.** Demos only ever show inbound (widget/website), consistent with the grounding rule — a demo should never show or claim a capability that isn't actually wired and consent-cleared for that business.
- **Planned to activate per client, post-onboarding** — not a day-one feature. Pitch it as a forward-looking line (same pattern as the "we keep your knowledge base current" promise), never as something the demo itself does.

## The legal constraint — this is the part that gates everything

UK PECR **Regulation 19** requires **specific, active, opt-in consent** before any automated calling system (confirmed: AI conversational voice agents fall under this by ICO's current position) can call someone for marketing purposes.

- **"Soft opt-in" does not apply here.** It covers email/SMS to existing customers under Reg 22 — it does **not** extend to automated calls under Reg 19. A salon's existing client relationship, or general marketing consent, is not sufficient on its own.
- Consent must **specifically name automated/AI/recorded calls** — not be bundled into a generic "sign up for offers" tickbox.
- Consent must be **documented and auditable** (exact wording shown, timestamp, how it was captured).
- **Opt-out must be available at any time**, including mid-call.
- Caller ID must be visible, the business identifiable, a real callback number given.
- **No third-party/bought lists** — first-party relationship + directly captured consent only.
- Penalties were realigned with UK GDPR in 2025: up to **£17.5M or 4% of global turnover**.
- One live nuance: the ICO has signalled a genuinely two-way conversational AI with human handoff may sit closer to a "live call" than a strictly automated one. Worth designing toward (favours this product's actual shape), but **not a substitute for real consent** — don't build the compliance case on it.

## The compliant design

1. **Existing client base — a one-time pass.** None of them have given this specific consent yet, so they can't be called on day one. Run a single SMS/email campaign asking them to opt in specifically to automated call reminders (email/SMS to existing customers about similar services can use the softer Reg 22 rules, unlike calls). Only the ones who actively confirm — reply, or tap a link — go onto the callable list. Silence isn't a yes. One message clears the whole backlog.
2. **New clients — ongoing, forever, not a campaign.** Anyone who becomes a client *after* that pass wasn't on the list it went to. For them, consent capture is a permanent part of first-booking intake from day one onward — a checkbox or spoken confirmation every time, not a one-off event. Explicit, specific wording either way — e.g. *"Can we call you with an AI voice assistant for appointment reminders and rebooking offers? Opt out anytime."* Double opt-in (confirm via reply or link) is the safer pattern and gives a clean audit trail for free.
3. **Technical gate, not just policy:** whatever triggers an outbound call must check a recorded consent flag first and refuse to dial without it. This is a build requirement, to brief whoever implements outbound calling (Sturdy Ai, per the operating split in the Playbook) — not something to leave as a sales-side promise.
4. **Call mechanics:** agent states who's calling at the start, caller ID visible (never withheld), a spoken opt-out ("say stop and we won't call again").
5. **Opt-out is permanent and immediate, not a soft signal:** the moment anyone opts out — at sign-up or mid-call — that has to flip their record to do-not-call automatically, overriding any earlier yes. It can't depend on someone manually updating a list afterwards.
6. **Consent goes stale — refresh it.** No fixed legal expiry, but a "yes" from a long-dormant contact is shakier ground than a recent one. Good practice: periodically re-confirm consent, particularly for anyone who opted in but hasn't been contacted in a long stretch.

## Review cadence — who signs off, and how often

Not a solicitor per client — that doesn't scale. Two different checks, two different owners:

- **The system, reviewed once (by an actual solicitor, not this writeup):** the consent wording, the technical gate logic, the call script mechanics, the audit-trail design. Once that's cleared, it's a reusable, compliant template — same logic as building the demo pipeline once and reusing it per prospect. Re-trigger only on material change: the law shifts (this area is actively moving — ICO enforcement activity, and the EU AI Act's AI-disclosure duty lands 2 Aug 2026 if any client is EU-facing), the consent flow itself changes, or the use case expands beyond rebooking reminders.
- **Each client, checked operationally (by Robinexis/Sturdy Ai, not a lawyer):** before outbound calling switches on for a given client, confirm *that* client has actually run the consent-gathering step and has real, valid opt-ins on file. PECR responsibility sits with whoever is calling their customer — i.e. the client business — so this precondition has to be verified per client even though the system itself was only reviewed once.

## Pitching it before it's built

Say it's coming, don't demo it. Something like: *"Once you're a client, we can also do outbound reminder calls, not just inbound — and we set up the opt-in properly so it's actually legal to use, which most people building this stuff haven't thought about."* Honest about timing, and turns the compliance requirement into a trust signal instead of a caveat to bury.

## Next actions

1. Before this is scoped as a real build: get the consent flow + technical gate design reviewed by an actual solicitor — the above is the shape from public ICO/PECR guidance, not legal sign-off.
2. Brief Sturdy Ai on the technical gate requirement (§ "compliant design," point 3) when outbound calling is actually scoped — it's a build requirement, not a config toggle to add later.
3. Don't add outbound calling to any live pitch as a *demoed* capability until the consent flow exists — forward-looking mention only.
