---
created: 2026-09-01
type: demo-script
tags: [blades-hair, elevenlabs, calcom, pitch]
status: tested
---

# Blades Hair demo pitch

Open the [branded Robinexis voice demo](https://app.robinexis.com/demo/blades-hair), use [[blades-hair-demo]] locally, or call `+447446868067`.

> [!info] Browser demo
> No login is required during testing. Select **Talk to Sophie**, allow microphone access, and use headphones where practical. The page uses the same live Sophie agent and existing Cal.com testing diary as the phone experience.

1. Let Sophie finish: “Hi, thanks for calling Blades Hair on Cullum Street — you're through to Sophie. How are you today?”
2. Interrupt naturally: “Actually, what time do you close on Friday?” She should stop and answer 7pm immediately.
3. Ask: “How much are full-head highlights, and who can do them?” Listen for FROM £135 and Galyna, Jana or Denise.
4. Say: “I'd like highlights next Tuesday afternoon with anyone.” She should explain the final price is confirmed at consultation and wait for agreement before checking the diary.
5. Agree, select one returned slot, then give a name and mobile. Decline email if you want; it is optional.
6. Listen for the complete readback. Say “yes” once. She must not claim the appointment is booked until Cal.com returns a booking UID.

## What to point out

- Twilio connects directly to ElevenLabs, so Railway adds no audio latency.
- The caller can interrupt the greeting.
- Railway is a narrow authenticated REST layer for live Cal.com actions.
- Duplicate create requests are idempotent.
- Unverified accessibility, policy or availability claims are handed back to the team rather than invented.
- The custom page is fully Robinexis and Blades branded; visitors never leave the experience for a third-party playground.
