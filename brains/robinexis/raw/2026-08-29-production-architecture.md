# Robinexis production architecture — supplied 2026-08-29

Website: https://www.robinexis.com/

The contractor confirmed the production source of truth:

- Twilio manages inbound/outbound routing and bidirectional call audio.
- Groq Whisper performs speech-to-text.
- Groq Llama is the conversational brain and selects Robinexis tools.
- ElevenLabs performs text-to-speech only.
- Robinexis Gateway is the Node.js orchestration, tenant, state and tool layer.
- Cal.com is the booking bridge to each salon's Google or Outlook calendar.
- Railway hosts the custom services.
- Each salon has isolated phone, voice, prompt, services, rules and calendar
  configuration.

The supplied website copy also used older descriptions in which ElevenLabs
performed STT or the conversation. Those descriptions conflict with the
confirmed production source of truth above.

The live Railway hostname supplied was
`robinexis-aios-production.up.railway.app`. The number `+447446868067` must not
be assumed to route there until Twilio/ElevenLabs console routing is checked.
