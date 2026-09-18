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

1. In Twilio, connect and approve the Robinexis Meta Business account and WhatsApp sender.
2. Create approved **utility** Content Templates for:
   - booking confirmation
   - appointment reminder
   - cancellation/rebooking follow-up
   - outside-window conversation restart
3. Set the sender's incoming webhook to:
   `https://api.robinexis.com/webhooks/twilio/whatsapp/inbound`
4. Supply these Railway variables to both API and worker services through the Railway configuration:
   - `TWILIO_ACCOUNT_SID`
   - `TWILIO_AUTH_TOKEN`
   - `WHATSAPP_ENABLED=true`
   - `WHATSAPP_BRAIN_PROCESSOR_ENABLED=true`
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
3. Confirm a pending appointment reminder exists and is sent at the configured lead time.
4. Cancel a test booking; confirm its reminder is cancelled and one rebooking follow-up is scheduled.
5. Send `HELP`, `STOP`, then `START` to the managed number and verify each response.

> [!warning]
> Use approved utility templates and documented customer consent. Do not use the service for bulk marketing. WhatsApp's 24-hour service window and opt-out handling remain enforced by the runtime.
