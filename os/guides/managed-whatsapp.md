---
created: 2026-09-18
type: guide
tags:
  - whatsapp
  - twilio
  - operations
status: active
---

# Managed WhatsApp activation

This guide activates the Pro-plan WhatsApp allowance for one customer workspace. The allowance is 3,000 metered Robinexis messages per subscription period; Twilio and Meta charges remain separate.

## Credentials and provider setup

Keep all values in Railway Variables or local `.env`. Never paste credentials into this vault.

1. In Twilio, connect a Meta WhatsApp Business Account (WABA) via Self Sign-up or Embedded Signup, then approve the Robinexis/Blades WhatsApp sender. The first sender create requires `WHATSAPP_WABA_ID`; without it Twilio returns 63100 (`waba_id is required when creating the first sender`).
2. Create approved **utility** Content Templates for:
   - booking confirmation
   - appointment reminder
   - cancellation/rebooking follow-up
   - outside-window conversation restart
3. Set the sender's incoming webhook to:
   `https://api.robinexis.com/webhooks/twilio/whatsapp/inbound`

   From this repo, inspect the Twilio account, create missing utility Content Templates, and write blank `.env` keys with:

   `npm run whatsapp:ensure`

   Then assign the approved sender to a Pro receptionist tenant (default Blades) with:

   `WHATSAPP_SENDER=+44… npm run whatsapp:assign`

   Use `ALLOW_INTERNAL_PRO_WHATSAPP=true` only for a local internal Pro subscription. Stripe Starter workspaces must be upgraded in billing.
4. Supply these Railway variables to both API and worker services through the Railway configuration:
   - `TWILIO_ACCOUNT_SID`
   - `TWILIO_AUTH_TOKEN`
   - `WHATSAPP_ENABLED=true`
   - `WHATSAPP_BRAIN_PROCESSOR_ENABLED=true`
   - `WHATSAPP_BOOKING_REMINDER_LEAD_HOURS=1`
   - the four `WHATSAPP_*_CONTENT_SID` values
   - matching `WHATSAPP_*_TEMPLATE_TEXT` fallback text
5. Deploy the API and worker after saving variables.

## Assign a sender to a Pro customer

Open **Admin → Customers → Customer detail → Managed WhatsApp status**. Enter the approved sender in E.164 format (for example, `+44...`) and select **Configure managed sender**.

The protected admin action:

- requires an active/trialing plan with a non-zero message allowance
- prevents assigning one sender to multiple tenants
- changes the tenant to Robinexis-managed phone mode
- stores an active `whatsapp_sender` provider resource
- enables the tenant WhatsApp entitlement
- records a sanitized operator audit event

The UI never reads the sender number or credentials back from the API.

## Verification

All three readiness badges must be green:

- **Managed sender:** active
- **Approved templates:** configured
- **Runtime:** active

Then perform these tests:

1. Make a voice booking with a real opted-in mobile number.
2. Confirm one WhatsApp booking confirmation arrives.
3. Confirm a pending appointment reminder exists and is sent **one hour before** the booking start.
4. Cancel a test booking; confirm its reminder is cancelled and one rebooking follow-up is scheduled.
5. Send `HELP`, `STOP`, then `START` to the managed number and verify each response.

> [!warning]
> Use approved utility templates and documented customer consent. Do not use the service for bulk marketing. WhatsApp's 24-hour service window and opt-out handling remain enforced by the runtime.
