# Stripe CLI reference

> **PLANNED — not yet active in the Sturdy Ai stack.** This doc is wired and ready, but Stripe isn't connected to any live AIOS account yet. Treat every command here as untested against a real key until that changes. When you do connect, work through the safety section first.

Command reference for the **official Stripe CLI** — the local tool for testing payments, forwarding webhooks, and reading live data from a terminal. This is the *connection doc* for Stripe in the Sturdy Ai stack — keep it current. When a command fails and you work out why, fix it here so the same mistake never happens twice.

> **Why the CLI over raw API here:** the CLI handles auth, pagination, and webhook signing for you, and it can replay real test events into your localhost — far quicker than hand-rolling `curl`. A short **API note** at the bottom covers the cases where you want a direct HTTP call instead. Official docs: <https://docs.stripe.com/stripe-cli> and <https://docs.stripe.com/api>.

---

## 🔴 Safety — read before any command (HARD RULES)

Stripe moves real money. The AIOS treats it accordingly.

1. **READ-ONLY by default.** The AIOS may `list`, `retrieve`, `get`, `listen`, `trigger`, and `logs tail`. It may **NOT** create charges, capture/refund payments, move money, modify customers/subscriptions, or run any mutating call — **unless a human explicitly asks for that specific action in that moment.** No standing permission to mutate.
2. **NEVER touch live money autonomously.** No charge, refund, payout, transfer, subscription change, or any `sk_live` write happens without an explicit, in-the-moment human action. Automations never do this. Full stop.
3. **Test mode for all automation.** Any routine, scheduled task, or unattended script uses **test-mode keys (`sk_test_…`) only.** Live keys are for deliberate, supervised human runs.
4. **When in doubt, stop and ask.** If a request is ambiguous about test vs live, or read vs write, ask before running anything.

These rules override convenience. A wrong write here costs real money or real customer trust.

---

## 🔑 Get your key (plain English — for the setup wizard)

⚠️ Use a **test key** (`sk_test_…`) for anything automated — never a live key.

1. Go to **https://dashboard.stripe.com** and sign in.
2. Toggle **Test mode** ON (top-right).
3. Go to **Developers → API keys**.
4. Copy the **Secret key** (`sk_test_…`) and paste it here — I'll add it to your `.env` and verify.

---

## Install & authenticate

| Step | Command / action |
|---|---|
| **Install** (macOS, Homebrew) | `brew install stripe/stripe-cli/stripe` |
| **Verify install** | `stripe version` |
| **Authenticate** | `stripe login` — opens a browser, you confirm a pairing code, it stores a restricted key in the local config |
| **Authenticate (headless)** | `stripe login --interactive` then paste a key, or pass `--api-key sk_test_…` per command |
| **Check who you are** | `stripe config --list` (shows the active account/keys the CLI holds) |
| **Upgrade** | `brew upgrade stripe` |

Docs: install <https://docs.stripe.com/stripe-cli/install> · keys <https://docs.stripe.com/stripe-cli/keys>

**Env vars** (in `.env`, gitignored — never commit, never put in a brain):
```
STRIPE_API_KEY=    # sk_test_… for automation; sk_live_… only for supervised human runs
```
- Prefer `stripe login` (stores a scoped key in the CLI config) for interactive use.
- Use `STRIPE_API_KEY` / `--api-key` only when scripting, and default it to the **test** key.
- The key prefix *is* the mode switch: `sk_test_…` = test/sandbox, `sk_live_…` = live. The CLI and API both decide live-vs-test purely from the key you hand them (<https://docs.stripe.com/api/authentication>).

---

## Command model (the mental shape)

```
stripe <resource> <action> [id] [--flags]
stripe <verb> [--flags]
```
- **Resource commands** mirror the API objects: `stripe customers`, `stripe charges`, `stripe invoices`, `stripe subscriptions`, `stripe payment_intents`, …
- **Actions** on a resource: `list`, `retrieve <id>` (read); `create`, `update`, `delete` (write — gated by the safety rules above).
- **Verbs** are standalone tools: `listen`, `trigger`, `logs`, `login`, `config`.
- Add `--live` to target live mode when the CLI is logged into a test sandbox (use deliberately). Most reads accept `--limit N` and standard filters.
- `stripe <resource> --help` and `stripe <verb> --help` list every flag — the CLI is self-documenting.

---

## Common commands (copy-paste)

### Webhook forwarding — `stripe listen`
Forwards live Stripe events to a local endpoint so you can develop webhook handlers without deploying.
```bash
# Forward all events to your local server
stripe listen --forward-to localhost:4242/webhook

# Only forward specific events (lean — recommended)
stripe listen --events payment_intent.succeeded,checkout.session.completed \
  --forward-to localhost:4242/webhook

# Print the webhook signing secret it generates, then verify signatures with it
# (it prints: "Ready! Your webhook signing secret is whsec_…")
```
- On start it prints a **`whsec_…` signing secret** — use that to verify signatures in your handler during local dev. It differs from your dashboard endpoint's secret.
- `listen` runs in the foreground and streams events until you Ctrl-C. Reads only — it does not create anything.

Docs: <https://docs.stripe.com/stripe-cli> · webhook quickstart <https://docs.stripe.com/webhooks/quickstart>

### Fire test events — `stripe trigger`
Generates a realistic test event (and the objects behind it) so your handler has something to react to. **Test mode only.**
```bash
stripe trigger payment_intent.succeeded
stripe trigger checkout.session.completed
stripe trigger customer.subscription.created
stripe trigger invoice.paid

# List every event you can trigger
stripe trigger --help
```
- Pair with a running `stripe listen` in another terminal to see the round trip end-to-end.
- Triggers only fire against **test mode** — they won't (and must not) be pointed at live.

Docs: triggers <https://docs.stripe.com/stripe-cli/triggers>

### Tail API logs — `stripe logs tail`
Live stream of API request logs for your account — great for debugging what an integration is actually sending.
```bash
stripe logs tail

# Filter the stream
stripe logs tail --filter-http-method POST
stripe logs tail --filter-status-code-type 4XX        # only client errors
stripe logs tail --filter-request-path /v1/charges
```
- Read-only observation. Ctrl-C to stop.

Docs: <https://docs.stripe.com/stripe-cli>

### Resource reads (the safe daily drivers)
```bash
# Customers
stripe customers list --limit 10
stripe customers list --email "jane@example.com"
stripe customers retrieve cus_XXXXXXXX

# Charges
stripe charges list --limit 10
stripe charges retrieve ch_XXXXXXXX

# Invoices
stripe invoices list --limit 10
stripe invoices list --customer cus_XXXXXXXX --status open
stripe invoices retrieve in_XXXXXXXX

# Subscriptions
stripe subscriptions list --limit 10
stripe subscriptions list --customer cus_XXXXXXXX --status active
stripe subscriptions retrieve sub_XXXXXXXX

# Payment intents
stripe payment_intents list --limit 10
stripe payment_intents retrieve pi_XXXXXXXX
```
- `list` returns JSON; pipe to `jq` for fields you care about, e.g. `stripe customers list --limit 5 | jq '.data[].email'`.
- These are all reads — safe under the default policy.

---

## API note (when you need a direct HTTP call)

For anything outside the CLI's reach, call the REST API directly.

| | |
|---|---|
| **Base URL** | `https://api.stripe.com` |
| **Resource path** | `/v1/<resource>` (e.g. `/v1/charges`, `/v1/customers`) |
| **Method** | `GET` to read, `POST` to create/update, `DELETE` to delete |
| **Body encoding** | `application/x-www-form-urlencoded` (form-encoded, **not** JSON) |
| **Auth** | Secret key as the HTTP basic-auth *username*, empty password |
| **Transport** | HTTPS only — plain HTTP fails |

**Authenticated read (official curl shape):**
```bash
curl https://api.stripe.com/v1/charges \
  -u "$STRIPE_API_KEY:"
# The trailing colon supplies an empty password so curl doesn't prompt.
```
The key you pass decides the mode: `sk_test_…` hits the sandbox, `sk_live_…` hits live data. Docs: <https://docs.stripe.com/api> · <https://docs.stripe.com/api/authentication>.

---

## Gotchas

- **Mode lives in the key, nowhere else.** There's no global "test/live" toggle — `sk_test_` vs `sk_live_` is the only switch. Mixing a test key against live object ids (or vice versa) returns "No such …" errors.
- **`stripe listen` signing secret ≠ dashboard endpoint secret.** The `whsec_…` the CLI prints is for local dev only. Production endpoints have their own secrets in the dashboard.
- **`trigger` is test-only.** It won't simulate events in live mode by design.
- **`stripe login` stores a *restricted* key**, not your full secret key. That's deliberate and safe — but it means some actions a full key could do may be denied; use `--api-key` for those (supervised, with the safety rules in force).
- **Form-encoded, not JSON.** If you hand-roll API calls, sending a JSON body silently misbehaves — Stripe expects form encoding.
- **One object per request.** The API has no bulk update; loop client-side and respect rate limits.

---

## Limits

- **Rate limits:** Stripe limits requests per second (live and test counted separately; test is lower). A `429` / `rate_limit` error means back off and retry with exponential delay.
- **Pagination:** list endpoints return up to `--limit 100` per call (default smaller). Page with `starting_after=<last_id>` / `ending_before=<first_id>`. Docs: <https://docs.stripe.com/api/pagination>.
- **CLI sessions:** `listen` and `logs tail` are long-lived foreground processes — they hold the terminal until interrupted.

---

## Debugging notes

- **Auth fails / "Invalid API Key":** run `stripe config --list` to see which key the CLI holds; re-run `stripe login` if it's stale or wrong-account.
- **"No such customer/charge/…":** almost always a **test-vs-live key mismatch** — the id exists in the other mode. Check the key prefix.
- **Webhook handler gets nothing:** confirm `stripe listen --forward-to` points at the exact local path your server listens on, and that the server is actually up. Use `stripe trigger <event>` to force a delivery.
- **Signature verification fails locally:** you're verifying against the dashboard secret instead of the `whsec_…` that `stripe listen` printed this session.
- **Inspect raw traffic:** `stripe logs tail --filter-status-code-type 4XX` to catch the failing requests as they happen.

<!-- Append fixes here as you hit and solve real errors. This doc should get smarter every time the AIOS stumbles. -->
