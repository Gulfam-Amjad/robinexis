# Sturdy AIOS Intake

This is the source-of-truth file for your AIOS. Fill it in by typing, voice-pasting (Wispr Flow / OS dictation), or running `/onboard` for a guided conversation. Whichever mode, this file is what `/onboard` reads to scaffold your Day-1 setup.

**Hard cap: 7 questions.** Each answerable in under 60 seconds. Don't overthink — you can edit and re-run `/onboard` any time.

---

## Q1 — Who are you, what do you sell, who do you sell it to?

Identity, offer, ICP. One paragraph each is fine.

```
Robinexis is a bespoke AI Receptionist service. We provide an automated AI receptionist that answers missed calls 24/7, reschedules cancelled appointments, contacts waitlists to fill calendar gaps, and connects seamlessly to existing booking calendars (like Google Calendar, Outlook, and Fresha). Our Ideal Customer Profile (ICP) includes appointment-based businesses—such as hair and beauty salons, dental clinics, barbershops, and health practices—that lose revenue whenever calls go unanswered or appointments are cancelled.
```

---

## Q2 — Paste 1-2 things you've written recently. Don't edit them.

An email, a LinkedIn post, a DM, a doc — anything that sounds like you when you're not trying. **Paste verbatim.** Do not type these mid-conversation with Claude — chat-shaped samples are worse than no samples (voice contamination).

```
Most appointment-based businesses don't realize how much revenue slips away from missed calls. If a client calls a salon or clinic to book and gets voicemail, over 80% won't leave a message—they just call the next business on Google. At Robinexis, we built an AI receptionist that handles missed calls 24/7, syncs directly with your calendar, and automatically fills last-minute cancellations from your waitlist. Stop letting missed calls turn into lost appointments.
```

```
Hi [Name], quick question—what happens to your revenue when a client calls after hours or during a busy appointment slot? Most clinics and salons lose thousands each month simply because nobody can answer the phone in real time. We built Robinexis to solve this exact problem: an intelligent AI receptionist that handles bookings, answers FAQs, and fills cancelled slots automatically 24/7. Would you be open to a quick 5-minute demo to see how it works with your existing calendar?
```

---

## Q3 — What are your 2-3 biggest priorities for the next 90 days?

Quarterly priorities. Not yearly aspirations. Things that, if not done by July, would make you say "I wasted Q2."

```
1. Onboard 30 active appointment-based businesses (salons, clinics, barbershops) onto the AI Receptionist system with live calendar syncing by November.
2. Ensure seamless, zero-conflict booking integrations across Google Calendar, Outlook, and Fresha with automated SMS/email confirmations.
3. Build a repeatable outbound outreach campaign that generates at least 50 qualified demo calls over the next 90 days.
```

---

## Q4 — Where does revenue actually land, and where is it tracked?

Multiple answers OK. Stripe? Circle? GoHighLevel? QuickBooks? A spreadsheet?

```
Revenue lands directly in Stripe for client subscription plans and setup fees. Sales pipeline and active deal values are tracked in GoHighLevel (GHL) CRM, while overall accounting and revenue reporting are managed through Stripe Dashboard and QuickBooks.
```

---

## Q5 — Where do you talk to customers, your team, and the outside world day-to-day?

Email (which one — Gmail / Outlook)? Slack? Teams? DMs (Discord / Slack / iMessage)? Phone?

```
Customers: Email (Gmail / Google Workspace), Phone (Twilio / AI Receptionist calls), and WhatsApp / SMS DMs.
Team: Slack for internal communication and project tracking, along with WhatsApp for quick updates.
Outside World & Leads: Email (Gmail), LinkedIn DMs, and scheduled video calls via Google Meet / Cal.com.
```

---

## Q6 — Where do meeting recordings, notes, and important docs live?

Granola? Otter? Fireflies? Google Drive? Notion? Dropbox? A folder on your desktop you keep meaning to organize?

```
Meeting Recordings & Transcripts: Fireflies.ai and Google Meet recordings.
Notes, SOPs, & Project Planning: Notion.
Important Documents & Shared Files: Google Drive.
```

---

## Q7 — What's the one task that eats your week, and where do you currently track work?

The single biggest time-suck or recurring drudgery. Plus where tasks/projects live (Monday.com / Asana / Linear / Notion / a notebook).

```
Biggest Time-Suck: Manual client onboarding, configuring custom calendar/integration settings, and back-and-forth follow-ups to answer incoming service inquiries.
Task & Project Tracking: Notion for project roadmaps, client onboarding pipelines, and operational SOPs; GitHub Issues for technical tasks and code repository management.
```

---

When this file is filled, run `/onboard` (or re-run it) and the wizard will scaffold your Day-1 file set: `context/`, `references/voice.md`, populated `connections.md`, and a filled `CLAUDE.md`.
