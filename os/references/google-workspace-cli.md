# Google Workspace CLI (`gws`) reference

Connection reference for the **Google Workspace CLI** — the `gws` command-line tool. This is the *connection doc* for the entire Google side of the Sturdy Ai stack: one CLI covering **Gmail, Calendar, Drive, Docs, Sheets, Slides, Chat, Meet** and every other Workspace API. When a call fails and you work out why, fix it here so the same mistake never bites twice.

> **Why this is the single biggest unlock for a Google-based stack:** `gws` is built dynamically from Google's Discovery Service, so it exposes *every* Workspace API method through one consistent grammar. Every response is structured JSON — agent-friendly out of the box. One auth flow, one tool, the whole of Workspace. Replace a drawer full of bespoke API scripts with this.
>
> Official docs: **https://github.com/googleworkspace/cli** (cite this; it is the source of truth for command shape and auth).

---

## Connection

| | |
|---|---|
| **Tool** | `gws` (npm package `@googleworkspace/cli`, written in Rust) |
| **Install** | `npm install -g @googleworkspace/cli` (Node 18+) — or `brew install googleworkspace-cli`, or a pre-built binary from GitHub Releases |
| **Auth model** | **OAuth 2.0** (no static API key in `.env`). One-time `gws auth setup`, then `gws auth login` |
| **Backing project** | A **Google Cloud project** supplies the OAuth client. `gws auth setup` can create it for you (needs `gcloud`), or set it up manually in the Cloud Console |
| **Output** | Structured **JSON** on stdout — pipe to `jq`. Errors go to stderr; exit code `1` on API error |
| **Config dir** | `~/.config/gws` (override with `GOOGLE_WORKSPACE_CLI_CONFIG_DIR`) |

**Where credentials live** (this is the answer to "no API key — so where's the secret?"):
- Tokens are **encrypted at rest (AES-256-GCM)**. The encryption key sits in your **OS keyring** (macOS Keychain on Joe's M3), *not* in a plaintext file.
- File-backed fallback: set `GOOGLE_WORKSPACE_CLI_KEYRING_BACKEND=file` and the key lands at `~/.config/gws/.encryption_key`.
- **Nothing goes in `.env` by default** and nothing goes in any brain. `connections.md` records *that* Google is wired — never the token.

**Optional env vars** (only when you need to override the default keyring flow — e.g. CI, servers, service accounts):
```
GOOGLE_WORKSPACE_CLI_TOKEN=            # pre-obtained OAuth2 access token (highest priority; e.g. from gcloud)
GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE= # path to OAuth credentials JSON (user OR service account)
GOOGLE_WORKSPACE_CLI_CLIENT_ID=        # OAuth client id (alternative to client_secret.json)
GOOGLE_WORKSPACE_CLI_CLIENT_SECRET=    # paired with CLIENT_ID
GOOGLE_WORKSPACE_CLI_CONFIG_DIR=       # override config dir (default ~/.config/gws)
GOOGLE_WORKSPACE_PROJECT_ID=           # GCP project id for quota/billing
GOOGLE_WORKSPACE_CLI_LOG=gws=debug     # stderr log level (off by default)
```
These belong in this AIOS only (gitignored) — never in a brain.

---

## 🔑 Connect (plain English — for the setup wizard)

Google needs **no key to paste** — it's a secure browser sign-in (OAuth).

1. When I prompt you, run the login — a browser opens.
2. Sign in to your Google account and approve access (Drive, Gmail, Calendar).
3. Done — I'll confirm it works.

*(First-time setup may need a one-off Google Cloud project; I'll walk you through it if so.)*

---

## OAuth setup flow (do this once)

### Fast path — `gcloud` is installed
```bash
gws auth setup     # one-time: creates a Cloud project, enables the APIs, runs first login
gws auth login     # subsequent scope selection + login
gws drive files list --params '{"pageSize": 5}'   # smoke test
```

### Manual path — no `gcloud`, or you want explicit control
1. **Create / pick a Google Cloud project** at https://console.cloud.google.com/.
2. **Configure the OAuth consent screen** (Credentials → OAuth consent screen):
   - App type: **External** (testing mode is fine).
   - **Add yourself under Test users → Add users.** This is the step everyone forgets — see gotchas.
3. **Create an OAuth client** (Credentials → Create credentials → OAuth client ID, Desktop app). Download the `client_secret.json`, or feed it via `GOOGLE_WORKSPACE_CLI_CLIENT_ID` / `GOOGLE_WORKSPACE_CLI_CLIENT_SECRET`.
4. **Enable the APIs** you'll use (Drive, Gmail, Calendar, Sheets, Slides, Docs, Meet) for that project.
5. Run `gws auth login`. It opens a browser, you consent, encrypted credentials are saved.

### Scope your login (do this — don't grab everything)
```bash
gws auth login --scopes drive,gmail,calendar     # or -s for short
```
Pick only the services you need. The `recommended` preset pulls 85+ scopes and **fails on unverified apps** (see gotchas). Default the AI account to read-only services and add write scopes only when a routine genuinely needs them.

---

## The command model (the mental model)

`gws` has **two layers**, both worth knowing:

**1. Discovery methods — the full API surface.** Every Workspace API method maps to:
```
gws <service> <resource> <method> --params '{<URL/query params>}' --json '{<request body>}'
```
- `--params` carries path + query parameters (ids, ranges, page sizes) as JSON.
- `--json` carries the request body for creates/updates.
- Mirrors Google's REST API 1:1, so the official API docs tell you exactly which fields go where.

**2. `+helper` commands — ergonomic shortcuts** for the common stuff, so you don't hand-build request bodies:
```
gws gmail +send --to a@b.com --subject "Hi" --body "..."
```

Useful global flags:
| Flag | Does |
|---|---|
| `--page-all` | Auto-paginate, stream results as NDJSON (pipe to `jq`) |
| `--dry-run` | Print the request that *would* be sent — preview before you mutate |
| `--upload ./file` | Attach a local file to an upload method |
| `gws schema <method>` | Introspect a method's request/response schema, e.g. `gws schema drive.files.list` |
| `gws <service> --help` | List that service's Discovery methods **and** `+helpers` together |

---

## Common commands per service (copy-paste)

### Drive — search & read
```bash
# 10 most recent files
gws drive files list --params '{"pageSize": 10}'

# Search by name + type (Drive query syntax in q)
gws drive files list --params '{"q": "name contains '\''Q2'\'' and mimeType='\''application/pdf'\''", "pageSize": 25}'

# Stream every match as NDJSON, pull just the names
gws drive files list --params '{"pageSize": 100}' --page-all | jq -r '.files[].name'

# Upload a local file (helper handles metadata)
gws drive +upload --file ./report.pdf
```

### Gmail — triage, read & send
```bash
# Unread inbox summary (sender, subject, date)
gws gmail +triage

# Search threads (standard Gmail search operators)
gws gmail users messages list --params '{"userId": "me", "q": "is:unread newer_than:2d"}'

# Read one message
gws gmail users messages get --params '{"userId": "me", "id": "<MESSAGE_ID>"}'

# Send / reply (reply handles threading automatically)
gws gmail +send  --to alice@example.com --subject "Hello" --body "Hi there"
gws gmail +reply --message <MESSAGE_ID> --body "On it — sending the deck over."
```

### Calendar — create an event **with a Google Meet link**
```bash
# Quick create via helper
gws calendar +insert --summary "Discovery call" --start "2026-06-20T15:00:00+01:00" --end "2026-06-20T15:30:00+01:00"

# Show upcoming events (uses your Google account timezone)
gws calendar +agenda

# Create an event that auto-generates a Meet link.
# Meet links come from the Calendar API: set conferenceData.createRequest in the
# body AND pass conferenceDataVersion=1 in params, or Google ignores it.
gws calendar events insert \
  --params '{"calendarId": "primary", "conferenceDataVersion": 1}' \
  --json '{
    "summary": "Sturdy Ai intro",
    "start": {"dateTime": "2026-06-20T15:00:00+01:00", "timeZone": "Europe/London"},
    "end":   {"dateTime": "2026-06-20T15:30:00+01:00", "timeZone": "Europe/London"},
    "attendees": [{"email": "client@example.com"}],
    "conferenceData": {
      "createRequest": {
        "requestId": "sturdy-20260620-1500",
        "conferenceSolutionKey": {"type": "hangoutsMeet"}
      }
    }
  }'
# The Meet URL comes back in the response under conferenceData.entryPoints[].uri
```

### Sheets — build & read
```bash
# Create a spreadsheet
gws sheets spreadsheets create --json '{"properties": {"title": "Q1 Budget"}}'

# Read a range
gws sheets +read --spreadsheet <SPREADSHEET_ID> --range "Sheet1!A1:C10"
# (Discovery form: gws sheets spreadsheets values get --params '{"spreadsheetId":"<ID>","range":"Sheet1!A1:C10"}')

# Append a row
gws sheets +append --spreadsheet <SPREADSHEET_ID> --values "Alice,95"
```

### Slides — create a deck
```bash
# Create a presentation
gws slides presentations create --json '{"title": "Sturdy Ai — Q2 Review"}'

# Add a slide / content via batchUpdate (build requests in the body)
gws slides presentations batchUpdate \
  --params '{"presentationId": "<PRESENTATION_ID>"}' \
  --json '{"requests": [{"createSlide": {"slideLayoutReference": {"predefinedLayout": "TITLE_AND_BODY"}}}]}'
```

### Docs — append text
```bash
gws docs +write --document <DOCUMENT_ID> --text "Appended by the AIOS morning routine."
```

### Chat — post a message
```bash
gws chat +send --space spaces/<SPACE_ID> --text "Deploy complete."
```

---

## Gotchas (the stuff that wastes an hour)

- **"Access blocked" on login →** you didn't add yourself as a **Test user** on the OAuth consent screen. Add your Google account under Test users and retry. This is the single most common first-run failure.
- **`recommended` scope preset fails on personal/unverified apps.** Google caps an unverified (testing-mode) app at ~25 scopes; the `recommended` preset asks for 85+ and is rejected, especially for `@gmail.com` accounts. **Fix:** request services explicitly — `gws auth login -s drive,gmail,calendar`.
- **Meet link silently absent →** you set `conferenceData.createRequest` but forgot `"conferenceDataVersion": 1` in `--params`. Both are required.
- **`auth login` looping →** usually a stale/partial credential or the test-user step. Re-run `gws auth setup`, confirm test user, retry. (Known issue thread on the repo.)
- **`--params` vs `--json` mix-up.** Ids, ranges, page sizes, `conferenceDataVersion` → `--params`. The thing being created/updated (event body, sheet properties, slide requests) → `--json`. When unsure, run `gws schema <service>.<resource>.<method>`.
- **Quoting `q` filters in zsh** is fiddly — single-quote the whole JSON and escape inner single quotes as `'\''` (see the Drive search example), or write the JSON to a file and pass it.
- **`gws auth setup` needs `gcloud`.** No `gcloud` → use the manual Cloud Console path above.

---

## Limits & quotas

- **Not an officially supported Google product** — it's a wrapper over the public Workspace APIs, so **per-API quotas apply** (Gmail, Drive, Sheets etc. each have their own per-minute / per-user limits set in your Cloud project). Heavy loops can hit `429`/`rate limit exceeded` — back off and batch.
- **Scope ceiling in testing mode:** ~25 scopes until the OAuth app is verified.
- **Pagination:** prefer `--page-all` (streams NDJSON) over fetching huge `pageSize` values in one shot.
- Bill/quota is charged against the Cloud project behind `GOOGLE_WORKSPACE_PROJECT_ID`.

---

## Debugging notes

- **Preview before you mutate:** append `--dry-run` to any write to see the exact request without sending it.
- **Inspect a method's shape:** `gws schema drive.files.list` (or any `service.resource.method`) prints request/response schema — faster than digging through REST docs.
- **Turn on logs:** `export GOOGLE_WORKSPACE_CLI_LOG=gws=debug` for stderr debug output; set `GOOGLE_WORKSPACE_CLI_LOG_FILE` for rotating JSON log files.
- **Exit codes:** `0` success, `1` on API error. Check `echo $?` in scripts; the human-readable error is on stderr while JSON data stays on stdout.
- **Re-auth cleanly:** if tokens are wedged, re-run `gws auth login` (or `gws auth setup` to rebuild from the project).

<!-- Append fixes here as you hit and solve real errors. This doc should get smarter every time the AIOS stumbles. -->
