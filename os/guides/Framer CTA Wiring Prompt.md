---
title: SaaS-Level Framer CTA Wiring Prompt
created: 2026-09-06
type: guide
tags:
  - framer
  - website
  - conversion
status: active
---

# SaaS-Level Framer CTA Wiring Prompt

The prompt below wires every call-to-action on the Framer marketing site (`www.robinexis.com`) to the real routes of the product app (`app.robinexis.com`), upgrades the Log in / Sign Up buttons, and directs Framer to run a complete responsive design and functionality pass.

Paste the fenced block into the Framer AI agent on the robinexis.com project. Everything else on this page is context for us, not for Framer.

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

Verified 6 Sep 2026: `app.robinexis.com` resolves to Vercel, `www.robinexis.com` resolves to Framer, and all public routes return 200.

## The prompt

```
You are editing the Robinexis marketing site (www.robinexis.com). Make it feel like a polished, conversion-focused SaaS website without changing its brand identity or rebuilding its content.

Complete four jobs:
1. Point every navigation item and call-to-action at the correct destination.
2. Improve the styling and visual hierarchy of the Log in, Sign Up, and demo buttons.
3. Normalize spacing, alignment, and responsive behavior across the entire website.
4. Test every link, interaction, variant, and breakpoint before reporting completion.

Our product app is a separate React app hosted at https://app.robinexis.com. The Framer site is the public marketing site. Use absolute HTTPS URLs for anything on app.robinexis.com. Keep links to Framer pages and page sections as native Framer page links or section anchors.

=== JOB 1: LINK DESTINATIONS ===

NAVIGATION BAR (desktop nav, tablet nav, and mobile hamburger menu - apply to all three, they are separate layers in this project):
- "Log in"        -> https://app.robinexis.com/login          (same tab)
- "Sign Up"       -> https://app.robinexis.com/signup         (same tab)
- "Book a call"   -> https://app.robinexis.com/demo/blades-hair (same tab)
- "Benefits"      -> in-page anchor to the Benefits section (unchanged)
- "Pricing"       -> in-page anchor to the Pricing section (unchanged, do NOT send this to the app)
- "Blog"          -> the Framer /blog page (unchanged)
- "Contact"       -> the Framer /contact page (unchanged)

HERO SECTION:
- Any primary "Start free trial" / "Get started" button -> https://app.robinexis.com/signup?plan=starter
- Any "Book a call", "Book a demo", "Try demo", or equivalent demo CTA
  -> https://app.robinexis.com/demo/blades-hair
- If the hero does not currently have a demo CTA, do not add a new one unless it fits the existing layout naturally.

PRICING SECTION (three cards: Starter, Pro, Enterprise):
- Starter card, both "Get Started" and "Start free trial" buttons
  -> https://app.robinexis.com/signup?plan=starter
- Pro card, currently labelled "Talk to us"
  -> https://app.robinexis.com/signup?plan=pro
  ALSO change the Pro button label from "Talk to us" to "Start free trial". Pro is a self-serve plan with instant checkout, not a sales conversation. Keep the "Most Popular" badge as is.
- Enterprise card, "Find Out More" and "Talk to us" buttons
  -> https://app.robinexis.com/enterprise-contact
  Change the Enterprise primary CTA label to "Book a demo" if that is clearer in context.
  Do NOT add any ?plan= parameter to the Enterprise buttons. Our app only accepts plan=starter and plan=pro and will ignore anything else.

IMPORTANT: this pricing block is duplicated three or four times in the project for different breakpoints/variants. Find and update every copy so desktop, tablet and mobile all behave identically. Same for the nav and the footer.

BOTTOM CTA SECTION ("Stop losing bookings to missed calls. Start today."):
- "Start free trial" -> https://app.robinexis.com/signup?plan=starter

TESTIMONIALS SECTION:
- "Calculate my recovery" -> https://app.robinexis.com/demo/blades-hair

FOOTER:
- Sitemap "Home" / "Contact" / "Blog" -> keep as internal Framer page links
- All Legal links (Privacy Policy, Terms & Conditions, GDPR & Data Protection, Cookie Policy, Data Processing Agreement) -> keep as internal Framer pages
- Add a "Log in" text link to the Sitemap column -> https://app.robinexis.com/login

HARD RULES - do not break these:
1. Never link to https://app.robinexis.com/dashboard, /app, /admin, /billing or /auth/callback. Those routes require a signed-in session and will bounce a visitor to a login screen. Sign-up and log-in are the only two entry points.
2. The only query parameter our app understands is plan, and its only valid values are starter and pro. Do not invent parameters like ?ref=, ?utm_plan=, ?trial=true or ?plan=enterprise on the app URLs. UTM tags for analytics are fine to append but the plan parameter must stay exactly as written above.
3. Do not open app.robinexis.com links in a new tab. Sign-up should feel like a continuation of the same journey, not a popup.
4. Do not change section copy other than CTA labels required to make their action clear.
5. Do not add a link to app.robinexis.com root (/). It renders a second landing page that would duplicate this site.
6. Preserve query strings exactly. Starter must remain ?plan=starter and Pro must remain ?plan=pro.
7. Use one destination per CTA purpose across every breakpoint and duplicate component variant.
8. Do not replace real links with scroll interactions, overlays, or prototype-only actions.

=== JOB 2: RESTYLE LOGIN, SIGN-UP, AND DEMO ACTIONS ===

The Log in and Sign Up buttons in the nav currently do not read as a clear pair. Fix the hierarchy so Sign Up is obviously the primary action and Log in is clearly secondary but still easy to find.

"Log in" - secondary / ghost style:
- Transparent background, no border fill
- Text in the site's primary text colour at 100% opacity, same font family and weight as the nav items but one step heavier (medium/500)
- Same font size as "Sign Up" so the pair reads as one unit
- Hover: background fills with the primary text colour at 6-8% opacity, transition 150ms ease-out
- Same height, vertical padding and corner radius as the Sign Up button so the two align perfectly on the same baseline

"Sign Up" - primary / solid style:
- Solid fill in the site's brand accent colour, label in the contrasting on-brand colour (white or near-white)
- Font weight semibold/600
- Hover: darken the fill by roughly 8% and lift the button 1px upward, transition 150ms ease-out
- Active/pressed: return to 0px lift, darken by 12%

Shared between both buttons:
- Identical height (target 40px desktop, 44px on touch breakpoints so they meet tap-target guidance)
- Identical corner radius, matching the radius language already used elsewhere on the site - do not introduce a new radius value
- Horizontal padding: 16px on Log in, 20px on Sign Up
- 8px gap between the two buttons, both vertically centred against the nav items and the "Book a call" button
- Visible keyboard focus ring on both (2px outline in the brand accent, 2px offset) - do not remove focus outlines
- Keep labels on one line and use content-sized width on desktop.

"Book a call" / demo button:
- Treat this as a strong secondary conversion action, visually distinct from both plain navigation links and the primary Sign Up button.
- Reuse an existing brand-compatible outlined or tonal button style.
- Match the height, radius, typography, and interaction quality of Sign Up.
- Do not let it visually compete with Sign Up; Sign Up remains the primary navigation CTA.
- If the current header becomes crowded, place the demo action inside the mobile menu instead of shrinking or clipping it.

=== JOB 3: FULL RESPONSIVE AND SPACING PASS ===

Audit the complete page, not only the navigation. Work from the existing components and visual system. Do not redesign the brand.

Spacing and layout:
- Normalize section padding, container widths, card gaps, vertical rhythm, and text-to-button spacing.
- Use a consistent centered content container. Keep comfortable gutters and prevent content from touching viewport edges.
- Remove accidental oversized gaps, cramped groups, uneven card padding, misaligned columns, and inconsistent button spacing.
- Keep related elements visually grouped. Do not solve layout issues with arbitrary one-off margins.
- Ensure repeated cards have equal internal padding and aligned headings, prices, feature lists, and CTA positions.
- Keep line lengths readable and avoid excessively wide paragraphs.

Desktop and laptop:
- Check wide desktop at 1440px and 1280px, and laptop at 1024px.
- Keep the navigation vertically centered, evenly spaced, and free from collisions.
- Preserve intended multi-column layouts while ensuring cards remain equal-height where appropriate.
- Avoid excessive empty space on wide displays by applying sensible maximum widths.

Tablet:
- Check both 768px portrait and approximately 900px landscape.
- Reduce gaps and padding proportionally rather than simply shrinking everything.
- Allow multi-column sections to become two columns or one column when content becomes cramped.
- Keep Sign Up visible in the header if practical. Move Log in and the demo action into the menu before allowing overlap.

Mobile:
- Check 390px and 375px widths, plus a narrow 320px stress test.
- Use a clear hamburger menu with an obvious open/close state and no background scrolling while open.
- Stack menu actions full-width in this order: Sign Up, Try live demo, Log in. Maintain the same primary/secondary hierarchy.
- Use at least 44px interactive heights and adequate touch spacing.
- Stack pricing cards and content sections cleanly. Never use horizontal scrolling for primary page content.
- Scale headings responsively without clipping, orphaned words, or overflow.
- Keep page-side gutters consistent and ensure cards, images, charts, and decorative layers stay within the viewport.
- Remove empty fixed-height areas that create large mobile gaps.

Across all breakpoints:
- Never let buttons, labels, headings, cards, charts, images, or navigation overflow or get clipped.
- Ensure decorative elements do not cover interactive content.
- Preserve logical reading order when columns stack.
- Respect prefers-reduced-motion for nonessential motion.
- Keep visible keyboard focus states and useful hover, pressed, and menu states.

=== JOB 4: FUNCTIONAL AND VISUAL QA ===

Before finishing:
1. Inspect the component tree for duplicate desktop, tablet, and mobile variants of the header, pricing cards, CTA sections, and footer. Apply the correct URLs to every variant.
2. Preview the home page at 1440px, 1280px, 1024px, 900px, 768px, 390px, 375px, and 320px.
3. Click every navigation link and CTA in preview mode. Confirm external app links open in the same tab and section links scroll to the correct section.
4. Verify that Starter retains ?plan=starter and Pro retains ?plan=pro.
5. Verify that every demo-led CTA opens https://app.robinexis.com/demo/blades-hair.
6. Test the mobile menu open, close, navigation, focus, and scroll behavior.
7. Check default, hover, pressed, focus, and disabled states where present.
8. Fix all clipping, horizontal overflow, broken anchors, inconsistent padding, and breakpoint-specific layout problems you find.
9. Do not claim completion based only on the desktop canvas.

When you are done, report:
- Every component and variant changed.
- Every URL or section anchor assigned.
- CTA labels changed and why.
- Breakpoints tested.
- Responsive or spacing problems fixed.
- Any item you could not complete or verify.
```

## Checklist after Framer publishes

1. Sign Up lands on the app sign-up screen.
2. Starter CTA shows the chip "Starter plan selected"; Pro CTA shows "Pro plan selected". That chip is rendered by `SignupPage` only when `?plan=` is valid, so it is the fastest proof the parameter survived.
3. Log in lands on the log-in screen.
4. All demo-led CTAs open the Blades live demo.
5. No button anywhere lands on a redirect-to-login dead end.
6. Repeat on mobile - the nav and pricing blocks are duplicated per breakpoint in Framer.

## Demo destination decision

"Book a call", "Book a demo", Enterprise "Find Out More" / "Talk to us", and "Calculate my recovery" all point at the existing live voice-agent demo at `https://app.robinexis.com/demo/blades-hair`. If Robinexis later publishes a dedicated Cal.com sales-booking URL, replace these destinations consistently across every Framer component variant.
