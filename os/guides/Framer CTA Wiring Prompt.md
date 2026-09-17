---
title: SaaS-Level Framer CTA Wiring Prompt
created: 2026-09-06
updated: 2026-09-09
type: guide
tags:
  - framer
  - website
  - conversion
status: active
---

# SaaS-Level Framer CTA Wiring Prompt

The prompt below wires the remaining broken calls-to-action on the Framer marketing site (`www.robinexis.com`) to the real routes of the product app (`app.robinexis.com`).

Paste the fenced block into the Framer AI agent on the robinexis.com project. Everything else on this page is context for us, not for Framer.

The first version of this prompt (6 Sep 2026) asked for a full design, responsive and link pass. The design work landed; the link work only partly landed. This version is a narrow fix list for what is still wrong, so the Framer agent cannot wander back into redesigning the site.

## Live audit — 9 Sep 2026

Read from the published HTML of `www.robinexis.com`. Framer inlines every breakpoint variant, so the counts below are per duplicated component.

| CTA | Current href | Should be | Variants |
| --- | --- | --- | --- |
| Nav "Sign Up" | `./contact` | `https://app.robinexis.com/signup` | 3 |
| Pro card "Start free trial" | `./contact` | `https://app.robinexis.com/signup?plan=pro` | 4 |
| Bottom CTA "Start free trial" | `./contact` | `https://app.robinexis.com/signup?plan=starter` | 3 |
| Nav "Book a call" | `./contact` | `https://app.robinexis.com/demo/blades-hair` | 3 |
| Blog "More articles" | `./contact` | Framer `/blog` page | 1 |
| "Calculate my recovery" | no link | `https://app.robinexis.com/demo/blades-hair` | 1 |

Already correct, leave alone: nav "Log in" to `/login` (3 variants), Starter card "Start free trial" to `/signup?plan=starter` (4 variants), Enterprise "Book a demo" to `/demo/blades-hair` (4 variants).

Twenty links on the home page currently resolve to `./contact`, which is why clicking Sign Up lands a prospect on the contact page instead of the app.

## Why these URLs and no others

Taken from the route table in `apps/web/src/App.tsx` and the plan validation in `apps/web/src/lib/supabase.ts`:

| Route | Public? | Notes |
| --- | --- | --- |
| `/login` | Yes | Accepts `?plan=` |
| `/signup` | Yes | Accepts `?plan=starter` or `?plan=pro` |
| `/pricing` | Yes | Not linked from Framer - the Framer pricing section is the canonical one |
| `/enterprise-contact` | Yes | Generic enterprise enquiry path; safe for any prospect |
| `/demo/blades-hair` | Yes | Private Blades Hair client demo; never use as a generic Enterprise CTA |
| `/dashboard`, `/app`, `/admin`, `/billing`, `/auth/callback` | No | `RequireSession` redirects these to `/login` |

`validPlan()` accepts `starter` and `pro` only. `?plan=enterprise` is silently dropped, which is why the Enterprise card must not carry a plan parameter.

Verified 9 Sep 2026: `/signup?plan=starter`, `/login`, `/demo/blades-hair` and `/enterprise-contact` all return 200 on `app.robinexis.com`.

## The prompt

```
You are editing the Robinexis marketing site (www.robinexis.com). This is a link-wiring fix only. Do not redesign anything, do not change layout, spacing, styling or breakpoints, and do not rewrite any copy or button label.

Our product app is a separate React app at https://app.robinexis.com. Use absolute HTTPS URLs for it, always in the same tab. Keep links to Framer pages and in-page sections as native Framer page links or section anchors.

I have read the published HTML of the site, so the list below is exact. Framer duplicates the navigation, the pricing block and the bottom CTA section once per breakpoint, and the number in brackets is how many copies currently carry the wrong link. Fix every copy - desktop, tablet and phone - not only the desktop canvas.

FIX 1 - Navigation "Sign Up" button [3 copies]. Currently links to ./contact.
  Change to: https://app.robinexis.com/signup

FIX 2 - Pricing section, Pro card, "Start free trial" button [4 copies]. Currently links to ./contact.
  Change to: https://app.robinexis.com/signup?plan=pro

FIX 3 - Bottom CTA section "Stop losing bookings to missed calls. Start today.", the "Start free trial" button [3 copies]. Currently links to ./contact.
  Change to: https://app.robinexis.com/signup?plan=starter

FIX 4 - Navigation "Book a call" button [3 copies]. Currently links to ./contact.
  Change to: https://app.robinexis.com/demo/blades-hair

FIX 5 - Blog section "More articles" link [1 copy]. Currently links to ./contact.
  Change to: the Framer /blog page, as a native Framer page link.

FIX 6 - Testimonials section "Calculate my recovery" element. It appears to have no link attached at all.
  Give it: https://app.robinexis.com/demo/blades-hair

ALREADY CORRECT - do not touch these:
- Navigation "Log in" -> https://app.robinexis.com/login
- Pricing Starter card "Start free trial" -> https://app.robinexis.com/signup?plan=starter
- Pricing Enterprise card "Book a demo" -> https://app.robinexis.com/demo/blades-hair
- Navigation "Contact", "Benefits", "Pricing", "Blog", and all footer sitemap and legal links -> internal Framer pages and anchors

HARD RULES - do not break these:
1. Never link to https://app.robinexis.com/dashboard, /app, /admin, /billing or /auth/callback. Those routes require a signed-in session and will bounce a visitor to a login screen. Sign-up and log-in are the only two entry points.
2. The only query parameter our app understands is plan, and its only valid values are starter and pro. Do not invent parameters like ?ref=, ?trial=true or ?plan=enterprise. Starter must stay exactly ?plan=starter and Pro exactly ?plan=pro.
3. Do not open app.robinexis.com links in a new tab. Sign-up should feel like a continuation of the same journey.
4. Do not add a link to the app root https://app.robinexis.com/ - it renders a second landing page that would duplicate this site.
5. Use one destination per CTA purpose across every breakpoint and duplicate component variant.
6. Do not replace real links with scroll interactions, overlays, or prototype-only actions.
7. Change nothing else. No styling, no spacing, no labels, no copy, no new sections.

VERIFY BEFORE YOU REPORT DONE:
1. In preview, click Sign Up, Book a call, both pricing "Start free trial" buttons, the Enterprise CTA, the bottom CTA, "Calculate my recovery" and "More articles". Confirm each lands exactly where listed above.
2. Repeat at 1440px, 768px and 390px, because each breakpoint uses its own copy of the nav, pricing block and CTA section.
3. Confirm that nothing on the home page still points at ./contact except the "Contact" navigation item and the footer Contact link.

Report back: every component and variant you changed, the URL you assigned to each, any element you could not locate, and anything still pointing at ./contact.
```

## Checklist after Framer publishes

1. Sign Up lands on the app sign-up screen.
2. Starter CTA shows the chip "Starter plan selected"; Pro CTA shows "Pro plan selected". That chip is rendered by `SignupPage` only when `?plan=` is valid, so it is the fastest proof the parameter survived.
3. Log in lands on the log-in screen.
4. All demo-led CTAs open the Blades live demo.
5. No button anywhere lands on a redirect-to-login dead end.
6. Repeat on mobile - the nav and pricing blocks are duplicated per breakpoint in Framer.
7. Run `node scripts/verify-framer-links.mjs`. It reads the published HTML, checks every duplicated copy of each CTA against its expected destination, prints how many links still resolve to `./contact`, and exits non-zero while anything is wrong. On 9 Sep 2026 it reported 20 `./contact` links and 15 problems; a clean run should list only the Contact nav item and the footer Contact link.

## Demo destination decision

"Book a call", "Book a demo", Enterprise "Find Out More" / "Talk to us", and "Calculate my recovery" all point at the existing live voice-agent demo at `https://app.robinexis.com/demo/blades-hair`. If Robinexis later publishes a dedicated Cal.com sales-booking URL, replace these destinations consistently across every Framer component variant.
