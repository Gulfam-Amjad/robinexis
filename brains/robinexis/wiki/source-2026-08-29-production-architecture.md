---
created: 2026-08-29
type: source
tags: [production, architecture, groq, railway]
status: active
---

# Production architecture confirmation

Robinexis confirmed that its custom production voice platform uses:

1. Twilio for telephony and bidirectional media.
2. Groq Whisper for speech-to-text.
3. Groq Llama for reasoning and tool selection.
4. Robinexis Gateway for tenant routing, tools, state, safety and billing.
5. ElevenLabs for text-to-speech only.
6. Cal.com as the booking bridge to Google or Outlook.
7. Railway for hosting.

This supersedes the 2026-08-29 implementation direction that selected Claude
as the production reasoning engine. Internal LLM and STT boundaries remain
provider-neutral so a later engine change does not affect tenant or tool
contracts.

> [!warning] Deployment evidence
> The supplied Railway hostname was serving behavior matching an older
> Deepgram/Claude compiled build. `+447446868067` is separately documented as
> attached to an ElevenLabs managed agent. Neither routing claim should be
> treated as verified until the provider consoles are checked.

## Publishing constraints

Website copy must say Groq hears and reasons, ElevenLabs voices, and Robinexis
controls tenant state and tools. Claims such as production-ready, no delay,
80% savings, full GDPR compliance, customer counts or recovery figures require
business evidence before publication.

Related: [[brains/robinexis/outputs/production/PLATFORM|Production platform]]

Source: [[brains/robinexis/raw/2026-08-29-production-architecture|supplied architecture notes]]
