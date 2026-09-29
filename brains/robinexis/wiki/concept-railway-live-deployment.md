---
created: 2026-09-26
type: concept
tags: [production, railway, deploy, billing]
status: current
---

# Railway live deployment — pleasing-dedication

As of 27 September 2026 the backend is live on Railway. Code changes for the active services below go to their matching GitHub repos. Railway auto-builds and deploys on push. A manual `railway up` is not the deploy path for this project.

Project: [pleasing-dedication](https://railway.com/project/45610819-8e06-480a-b147-d2f4dee28a70?environmentId=77a70722-c909-4f37-9cd3-929effc1af0b)

| | |
|---|---|
| Project name | `pleasing-dedication` |
| Project ID | `45610819-8e06-480a-b147-d2f4dee28a70` |
| Environment | `production` |
| Environment ID | `77a70722-c909-4f37-9cd3-929effc1af0b` |

## Railway services

Active:

- `@robinexis/worker`
- `@robinexis/api`

Present but sleeping:

- `@robinexis/web` — production web hosting is Vercel

Removed on 27 September 2026:

- `@robinexis/voice-runtime` — unused alternate LiveKit runtime; its missing
  runtime variables caused it to exit and appear as crashed. The gated code
  remains in `apps/voice-runtime`, but production calls remain on ElevenLabs.

Deployment candidate added to IaC on 29 September 2026:

- `@robinexis/voice-runtime` — dedicated browser-only Cost Saver worker. It is
  not active until Railway applies the service and the browser plus conversation
  canaries pass. This does not change Twilio or Blades phone routing.

> [!warning] Trial workspace — services can shut off
> This project sits in a personal **Trial** Railway workspace. It is not on a teammate's Pro workspace and is not on that teammate's billing.
>
> The trial banner on 26 September 2026 read **27 days or $5.00 — upgrade to keep services online**. Unless someone adds a payment method (about $5/month or more) or the project is moved into the Pro workspace, Railway shuts these services down automatically. Counting from that banner, the window ends around **23 October 2026**.
>
> This is not confirmed as the lasting production home. Decide — move it into the Pro workspace, or add a payment method on this Trial workspace — before building more on top of it.

## What this replaces

The 20 September 2026 note that Railway deploys stay manual until a GitHub App is authorized is **superseded for this project**. See [[brains/robinexis/outputs/production/PLATFORM|Production platform]].

Earlier Railway layout is also superseded for this project only:

- `@robinexis/web` was removed from Railway on 16 September 2026, with the public app left on Vercel. A redundant service was later recreated in this project and is now sleeping.
- `@robinexis/voice-runtime` previously ran inside the worker because of the free-plan service cap. A dedicated service was later created, but it had no production role and was deleted after crash-looping. `VOICE_RUNTIME_ENABLED=false` keeps the worker path disabled.

The 1 September retirement of the old audio gateway still stands. This project does not restore a raw-audio or WebSocket path. Twilio speech stays on ElevenLabs unless a separate cutover says otherwise.

Related: [[brains/robinexis/outputs/production/PLATFORM|Production platform]] · `deploy/railway/RUNBOOK.md`
