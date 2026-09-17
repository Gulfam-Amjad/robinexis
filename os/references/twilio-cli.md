# Twilio CLI reference

Command reference for the **Twilio CLI** — the connection doc for telephony in the Sturdy Ai stack. We use it to provision a live business phone number and wire its **Voice webhook** to a voice agent (built in ElevenLabs), so the agent answers a real number. This is the *connection doc*: when a command fails and you work out why, fix it here so the same mistake never bites twice.

> **Why the CLI over the raw REST API here:** the CLI ships authenticated, scriptable commands (`twilio phone-numbers:update …`) that wrap the same REST endpoints, so the AIOS gets one consistent, copy-pasteable surface for buying numbers and pointing their webhooks — no hand-rolled HTTP signing. For anything the convenience commands don't cover, drop to `twilio api:core:…` for raw REST access (same auth, same profile).

> ⚠️ **SAFETY — costs real money.** Buying a number and placing outbound calls are billed actions. The AIOS must **confirm with a human before purchasing any number or initiating any call.** Default to read-only commands (`:list`, `:fetch`) unless a human has explicitly approved the spend.

---

## 🔑 Get your key (plain English — for the setup wizard)

Twilio needs **two** things: your **Account SID** and your **Auth Token**.

1. Go to **https://console.twilio.com** and sign in (free account is fine to start).
2. On the main dashboard, scroll to **Account Info**.
3. Copy your **Account SID**, then click to reveal and copy your **Auth Token**.
4. Paste both here — I'll add them to your `.env` and verify the connection.

---

## Install & auth

| | |
|---|---|
| **Install (macOS)** | `brew tap twilio/brew && brew install twilio` (Homebrew is the suggested method on macOS, incl. Apple Silicon) |
| **Install (npm, fallback)** | `npm install -g twilio-cli` — discouraged: no auto-update, uses system Node. Requires **Node.js 20+** (CLI v6.0.0+) |
| **Verify** | `twilio version` (or `twilio --version` / `twilio -v`) → e.g. `twilio-cli/6.0.1 darwin-arm64 node-v20.x` |
| **Update** | `twilio update` (Homebrew installs only; npm installs use `npm install -g twilio-cli@latest`) |
| **Log in** | `twilio login` — prompts for **Account SID** + **Auth Token**, mints an API Key, stores it as a local **profile**. The Auth Token is used once and **not stored** |
| **Autocomplete** | `twilio autocomplete zsh` (then restart shell; re-run after installing any plugin) |

Don't mix install methods (e.g. Homebrew *and* npm) — it causes `PATH` conflicts.

**Profiles** (multiple accounts / sub-accounts on one machine):
```bash
twilio login                 # create a profile; give it a shorthand id when prompted (e.g. "sturdyai")
twilio profiles:list         # see all local profiles + which is active
twilio profiles:use sturdyai # set the active profile
twilio phone-numbers:list -p sturdyai   # or target a profile per-command with -p
twilio profiles:remove sturdyai
```
Note: `twilio login` does **not** auto-activate the new profile — run `profiles:use` after.

**Env vars** (alternative to a profile — useful for CI / the AIOS runtime; put in `.env`, gitignored, never commit):
```
# Recommended (API Key pair — least-privilege, revocable):
TWILIO_ACCOUNT_SID=     # Console > Account Info
TWILIO_API_KEY=         # an API Key SID
TWILIO_API_SECRET=      # the API Key secret

# Discouraged fallback (only if you genuinely can't use an API Key):
# TWILIO_ACCOUNT_SID=
# TWILIO_AUTH_TOKEN=    # higher risk — exposes the master token
```
If these are set, no profile is required. Credential precedence: **`-p` profile → env vars → active profile**.

---

## Command model (the mental model)

- Structure is **topic → sub-topic → resource → action**, separated by colons:
  `twilio phone-numbers:update`, `twilio api:core:messages:list`.
- **Colons and spaces are interchangeable** — `twilio api:core:messages:list` ≡ `twilio api core messages list`.
- Two layers:
  - **Convenience topics** — `phone-numbers:*`, `phone-numbers:list/update`, `debugger`, etc. Short, ergonomic.
  - **Raw REST** — `twilio api:core:…` mirrors the REST API one-to-one. Use it when no convenience command exists.
- Discover anything: `twilio` (lists topics), `twilio api -h`, or append `--help` / `-h` to any command for its full flag list.
- **Output format**: add `-o json` for machine-readable output (pipe to `jq`). Default is a human table.

---

## Common operations (the real use case)

The job: get a number, point its **Voice URL** at the ElevenLabs voice-agent endpoint, confirm it stuck.

### 1. Find an available number (read-only, free)
```bash
# Local number in a given area code + country (UK = GB, US = US)
twilio api:core:available-phone-numbers:local:list \
  --area-code 207 --country-code GB

# Toll-free instead: drop --area-code, swap "local" for "toll-free"
twilio api:core:available-phone-numbers:toll-free:list \
  --country-code US
```

### 2. Buy a number — 💰 HUMAN CONFIRMATION REQUIRED
Pick one from the list above (keep the leading `+`):
```bash
twilio api:core:incoming-phone-numbers:create \
  --phone-number "+442071234567"
```
The response includes the number's **SID** (starts with `PN…`) — you need it for the next step.

### 3. List the numbers you own (and see their current webhooks)
```bash
twilio phone-numbers:list

# Just the fields that matter, as JSON:
twilio phone-numbers:list -o json \
  | jq '.[] | {sid, phoneNumber, smsUrl, voiceUrl}'
```

### 4. Point the **Voice webhook** at the voice agent (the core wiring)
This is what makes a live call hit the ElevenLabs voice agent. Target the number by its **`PN` SID** or its **E.164 number**:
```bash
# By SID:
twilio phone-numbers:update PNXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX \
  --voice-url https://your-voice-agent-endpoint.example.com/incoming-call

# By phone number:
twilio phone-numbers:update "+442071234567" \
  --voice-url https://your-voice-agent-endpoint.example.com/incoming-call
```
- The `--voice-url` is the HTTP endpoint Twilio requests (TwiML / media-stream handler) when a call comes in — set it to whatever public URL your ElevenLabs voice-agent integration exposes.
- Equivalent for inbound SMS is `--sms-url`. A fallback handler and more are available — run `twilio phone-numbers:update --help` for the full list.
- The webhook URL **must be publicly reachable** — Twilio's servers can't hit `localhost`. For local testing, tunnel with ngrok and use that public URL.

### 5. Verify the wiring
```bash
twilio phone-numbers:list -o json | jq '.[] | {phoneNumber, voiceUrl}'
```
Confirm `voiceUrl` shows your endpoint. (You can also eyeball it in the Console under Phone Numbers → Manage → Active numbers.)

### Raw-REST equivalents (when you need them)
The convenience commands above wrap these; use the raw form for fields the convenience command doesn't expose:
```bash
# Set the voice URL via raw REST (sid = the PN… SID):
twilio api:core:incoming-phone-numbers:update \
  --sid PNXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX \
  --voice-url "https://your-voice-agent-endpoint.example.com/incoming-call"

# Look up carrier / caller info for a number (read-only):
twilio api:lookups:v1:phone-numbers:fetch \
  --phone-number +442071234567 --type carrier
```

### Outbound test call / SMS — 💰 HUMAN CONFIRMATION REQUIRED
```bash
twilio api core messages create \
  --from "+442071234567" \
  --to "+447700900123" \
  --body "Sent from the Sturdy Ai AIOS."
```

---

## Plugins

Base commands cover the voice-number workflow above. Extend with plugins when needed:
```bash
twilio plugins:install PLUGIN_PACKAGE_NAME
```
Officially listed plugins (Twilio Labs) relevant to voice/serverless work:
- **Serverless Toolkit** — deploy Twilio Functions & Assets (e.g. host a TwiML / call-handler endpoint without standing up your own server):
  ```bash
  twilio plugins:install @twilio-labs/plugin-serverless
  ```
- **Dev Phone** — test Voice & SMS apps without a separate device:
  ```bash
  twilio plugins:install @twilio-labs/plugin-dev-phone
  ```
- **Webhook plugin** — emulate webhook events to validate your handler:
  ```bash
  twilio plugins:install @twilio-labs/plugin-webhook
  ```
- **twilio watch** — stream debugger alerts, calls, and messages live (handy when debugging a misbehaving voice agent).

After installing a plugin, re-run `twilio autocomplete <shell>` to rebuild the command cache. Each plugin has its own release status — check the plugin's own docs.

---

## Gotchas

- **`twilio login` doesn't activate the profile.** New profile ≠ active profile. Run `twilio profiles:use <id>` or pass `-p <id>` per command.
- **Phone number SID vs E.164.** `phone-numbers:update` accepts either, but the **`PN…` SID** is unambiguous. Find it via `phone-numbers:list` or the Console (top of the number's page).
- **Webhook URL must be public.** A `localhost` URL silently fails to receive calls — Twilio can't reach your machine. Tunnel (ngrok) for local dev.
- **Country codes are ISO 3166-1 alpha-2.** UK is **`GB`**, not `UK`.
- **Don't mix install methods.** Homebrew + npm together breaks `PATH` and updates.
- **npm installs don't auto-update.** Use `npm install -g twilio-cli@latest`; `twilio update` only works for non-npm installs.

---

## Limits & cost

- **Buying numbers and outbound calls/SMS are billed.** Recurring number rental + per-minute / per-message usage. The AIOS must get explicit human sign-off before any `:create` (number purchase) or outbound `messages create` / call.
- Number **availability and regulatory requirements vary by country** — some (incl. many UK number types) require address/identity bundles before purchase. If a `:create` is rejected, check the Console for outstanding regulatory bundles.
- The CLI inherits your account's API rate limits; heavy `:list` loops can be throttled.

---

## Debugging

- **Append `--help` / `-h` to any command** for its full, current flag list — the source of truth for options.
- **`-l debug`** raises logging: `twilio phone-numbers:list -l debug` shows the underlying HTTP request/response.
- **`twilio debugger:logs:list`** surfaces account-level error events (e.g. a failing voice webhook returning a non-200).
- A call that connects but the agent never answers → check the `voiceUrl` is set (`phone-numbers:list -o json | jq …`) **and** that the endpoint is public and returns valid TwiML / a 200.
- Wrong account? Confirm the active profile with `twilio profiles:list`, or scope with `-p <profile>`.

---

## Official sources

- Quickstart — https://www.twilio.com/docs/twilio-cli/quickstart
- Install — https://www.twilio.com/docs/twilio-cli/getting-started/install
- Profiles & env vars — https://www.twilio.com/docs/twilio-cli/general-usage/profiles
- Work with webhooks (voice-url / sms-url) — https://www.twilio.com/docs/twilio-cli/general-usage/work-with-webhooks
- Example: get a number & explore — https://www.twilio.com/docs/twilio-cli/examples/explore-sms
- Plugins — https://www.twilio.com/docs/twilio-cli/plugins

<!-- Append fixes here as you hit and solve real errors. This doc should get smarter every time the AIOS stumbles. -->
