# Make.com CLI reference

Command reference for the **official Make CLI** — the open-source command-line interface for Make.com. This is the *connection doc* for the automation-platform tool in the Sturdy Ai stack — keep it current. When a call fails and you work out why, fix it here so the same mistake never happens twice.

> **Why CLI over API here:** the Make CLI is official, open-source, and leaner to wire than raw REST — it handles auth, zones, and JSON output for you, so the AIOS calls one binary instead of hand-rolling HTTP requests against the Make API. A **Make MCP is also connected** and is quickest for live, interactive work in your own AIOS. Default to the **CLI** for portable, scriptable, low-context client builds and CI/CD; reach for the MCP when you want conversational, already-authenticated access.

Official docs (cite these, not third-party blogs):
- Overview — https://developers.make.com/make-cli
- Install — https://developers.make.com/make-cli/make-cli/install-the-make-cli
- Authenticate — https://developers.make.com/make-cli/make-cli/authenticate-the-make-cli
- Full command reference — https://developers.make.com/make-cli/make-cli/make-cli-reference
- Launch note — https://help.make.com/the-make-cli-is-now-live

---

## 🔑 Get your key (plain English — for the setup wizard)

1. Go to **https://www.make.com** and sign in.
2. Click your **profile** (bottom-left) → **Profile**.
3. Open the **API / Authentication** tab → **Add token**, name it, copy it.
4. Paste it here — I'll add it to your `.env` and verify. *(For a single automation you may instead just need a scenario's webhook URL — I'll tell you which.)*

---

## Install

The CLI runs on macOS, Linux, and Windows. Pick one method (don't mix npm + Homebrew — it fouls your `PATH`).

| Method | Command | Notes |
|---|---|---|
| **npm** (global) | `npm install -g @makehq/cli` | Needs Node.js. Gives you the `make-cli` binary. |
| **npx** (no install) | `npx @makehq/cli <command>` | Run ad-hoc, e.g. `npx @makehq/cli scenarios list --team-id=123`. |
| **Homebrew** (macOS/Linux) | `brew install make-cli integromat/tap/make-cli` | |
| **Binary** | Download from the [releases page](https://github.com/integromat/make-cli/releases), extract, move onto `PATH`. | Platform tarballs: `make-cli-darwin-arm64.tar.gz` (Apple Silicon), `-darwin-amd64` (Intel), `-linux-amd64/arm64`, `-windows-amd64`. |
| **.deb** (Linux) | `sudo dpkg -i make-cli-linux-amd64.deb` | `amd64` / `arm64` packages on the releases page. |

On the M3 MacBook Air, `npm install -g @makehq/cli` or the Homebrew tap is the path of least resistance.

---

## Authenticate

Three ways to supply credentials. The CLI resolves them in this **priority order**: (1) per-command options → (2) environment variables → (3) saved login-wizard credentials.

| Method | How | When to use |
|---|---|---|
| **Login wizard** (recommended) | `make-cli login` — pick zone, create/paste an API key. | Your own machine. Saves creds locally so every later command runs bare. |
| **Environment variables** | `export MAKE_API_KEY="…"` and `export MAKE_ZONE="eu2.make.com"` | CI/CD, the AIOS, scripts. |
| **Per-command** | `--api-key <key> --zone <zone>` on each call. | One-off or multi-account runs. |

Saved-credential locations (from the login wizard):
- macOS / Linux: `~/.config/make-cli/config.json`
- Windows: `%APPDATA%\make-cli\config.json`

Housekeeping commands:
```bash
make-cli whoami    # which account am I signed in as
make-cli logout    # wipe saved credentials
```

**Getting an API key:** the login wizard opens the Make API-key page in your browser; or generate one manually in Make under your profile → **API/Apps** access. The key carries scopes (e.g. `scenarios:read`, `scenarios:write`) — give the AIOS the minimum it needs.

**Zone** is region-specific and must match the account: `eu1.make.com`, `eu2.make.com`, `us1.make.com`, `us2.make.com` (Celonis-hosted orgs use `eu1.make.celonis.com` / `us1.make.celonis.com`). Get it from the URL you log into Make at. `--zone` accepts the short form too (e.g. `EU1`) in the login wizard.

**Env placeholders** (in `.env`, gitignored — never commit a real key):
```
MAKE_API_KEY=     # Make API token; create via `make-cli login` or Make profile > API/Apps
MAKE_ZONE=        # region host, e.g. eu2.make.com — match the account you log into
MAKE_TEAM_ID=     # the team you operate in (most commands need --team-id)
MAKE_ORG_ID=      # the organization (team/org listing commands need --organization-id)
```
> The official env-var names are `MAKE_API_KEY` and `MAKE_ZONE` (confirmed in the docs). If you've standardised on `MAKE_API_TOKEN` elsewhere in the AIOS, map it: `export MAKE_API_KEY="$MAKE_API_TOKEN"`. Secrets live in this AIOS's gitignored `.env` or the OS keychain only — never in a brain.

---

## Command model (the mental shape)

Every command follows the same structure:
```
make-cli [global options] <category> <action> [action options]
```

**Global options** (apply to all commands):

| Option | Description |
|---|---|
| `--api-key <key>` | Make API key |
| `--zone <zone>` | Make zone, e.g. `eu2.make.com` |
| `--output <fmt>` | Output format: `json` (default), `compact`, or `table` |
| `-V`, `--version` | Print the CLI version |
| `-h`, `--help` | Help for the command |

Discover anything from the binary itself:
```bash
make-cli --help              # all categories
make-cli <category> --help   # actions within a category, e.g. make-cli scenarios --help
```

Example with a global option and table output:
```bash
make-cli --zone eu2.make.com scenarios list --team-id=1 --output=table
```

**Categories:** `scenarios`, `executions`, `incomplete-executions`, `folders`, `functions`, `hooks`, `devices` (Scenarios group) · `connections`, `keys`, `credential-requests` (Credentials group) · `data-stores`, `data-store-records`, `data-structures` (Data stores group) · `teams`, `organizations`, `users`, `enums` (Account management) · plus a Custom app development group (app definitions, modules, functions, RPCs, webhooks — see the official reference if you build custom apps).

Most listing/creating commands require `--team-id`; team/org commands use `--organization-id`. IDs are passed positionally (e.g. `make-cli scenarios get 925`) or as a named flag where noted.

---

## Scenarios

```bash
# List scenarios for a team
make-cli scenarios list --team-id=5

# Get one scenario (returns it plus its blueprint)
make-cli scenarios get 925

# Activate / deactivate (activate also schedules it if it runs on an interval)
make-cli scenarios activate 925
make-cli scenarios deactivate 925

# Run a scenario on demand; --responsive waits and returns the result
make-cli scenarios run 925 --data='{"name":"John"}' --responsive

# Delete
make-cli scenarios delete 925
```

**Create a scenario** (blueprint + scheduling are JSON strings):
```bash
make-cli scenarios create \
  --team-id=5 \
  --scheduling='{"type":"indefinitely","interval":60}' \
  --blueprint='{
    "name": "Gmail Attachments to Google Drive",
    "flow": [
      { "id": 1, "module": "google-email:watchEmails", "version": 1,
        "parameters": { "connection": 5, "folder": "INBOX", "filter": "has:attachment" },
        "mapper": {}, "metadata": { "expect": [] } },
      { "id": 2, "module": "google-drive:uploadFile", "version": 1,
        "parameters": { "connection": 6 },
        "mapper": { "folderId": "your-folder-id-here", "file": "{{1.attachments[]}}" },
        "metadata": { "expect": [] } }
    ],
    "metadata": { "version": 1 }
  }'
```

**Update** (name and/or scheduling):
```bash
make-cli scenarios update 925 \
  --name='Updated Scenario' \
  --scheduling='{"type":"indefinitely","interval":900}'
```

**Scenario interface** (declared inputs/outputs):
```bash
make-cli scenarios interface 925
make-cli scenarios set-interface 925 \
  --interface='{"input":[{"name":"myInput","type":"text","required":true}],"output":[]}'
```

**Executions & incomplete executions** (debugging runs):
```bash
make-cli executions list --scenario-id=925
make-cli executions get a07e16f2ad134bf49cf83a00aa95c0a5 --scenario-id=925
make-cli executions get-detail a07e16f2ad134bf49cf83a00aa95c0a5 --scenario-id=925
make-cli incomplete-executions list --scenario-id=925
make-cli incomplete-executions get a07e16f2ad134bf49cf83a00aa95c0a5
```

---

## Webhooks (hooks)

```bash
make-cli hooks list --team-id=5
make-cli hooks get 11

# Create a webhook (type-name examples: gateway-webhook)
make-cli hooks create \
  --team-id=5 \
  --name='My Webhook' \
  --type-name=gateway-webhook

make-cli hooks update 11 --data='{"method":true,"headers":true}'
make-cli hooks delete 11
```

---

## Connections (credentials)

```bash
make-cli connections list --team-id=5
make-cli connections get 2

# Create a connection (account-name is the Make app, e.g. google)
make-cli connections create \
  --name='My Google Connection' \
  --account-name=google \
  --team-id=5

make-cli connections update 2 --name='Updated Connection'
make-cli connections verify 2     # test the connection still works
make-cli connections delete 2
```

**Keys** (e.g. basic-auth, API-key credentials reused across scenarios):
```bash
make-cli keys list --team-id=5
make-cli keys create \
  --team-id=5 \
  --name='My API Key' \
  --type-name=basicauth \
  --parameters='{"user":"admin","pass":"secret"}'
make-cli keys update 1 --name='My Updated Key'
make-cli keys delete 1
```

**Credential requests** (ask a teammate/client to authorise a connection without sharing secrets):
```bash
make-cli credential-requests list --team-id=5
make-cli credential-requests create \
  --name='Google Connection Request' \
  --team-id=5 \
  --credentials='[{"appName":"google","appModules":["*"]}]'
make-cli credential-requests extend-connection 2 \
  --scopes='["https://www.googleapis.com/auth/spreadsheets"]'
```

---

## Data stores & records

```bash
# Stores
make-cli data-stores list --team-id=5
make-cli data-stores get 137
make-cli data-stores create \
  --name=Customers \
  --team-id=5 \
  --max-size-m-b=1 \
  --datastructure-id=178
make-cli data-stores update 137 --name='Updated Store' --max-size-m-b=2
make-cli data-stores delete 137

# Records (the row's key is the positional id, e.g. ecc4819b2260)
make-cli data-store-records list --data-store-id=137
make-cli data-store-records create \
  --data-store-id=137 \
  --data='{"name":"John Doe","email":"john.doe@example.com","status":"active"}'
make-cli data-store-records update ecc4819b2260 \
  --data-store-id=137 \
  --data='{"status":"inactive"}'
make-cli data-store-records replace ecc4819b2260 \
  --data-store-id=137 \
  --data='{"name":"Jane Doe","email":"jane.doe@example.com","status":"active"}'
make-cli data-store-records delete \
  --data-store-id=137 \
  --keys='["ecc4819b2260","8f7162828bc0"]'
```

**Data structures** (the schema a store enforces; `--strict` rejects undeclared fields):
```bash
make-cli data-structures list --team-id=5
make-cli data-structures create \
  --team-id=5 \
  --name='Customer Data' \
  --strict \
  --spec='[{"name":"name","type":"text","label":"Name","required":true},
           {"name":"email","type":"text","label":"Email","required":true},
           {"name":"status","type":"text","label":"Status","required":false}]'
make-cli data-structures update 178 --name='Updated Structure'
make-cli data-structures delete 178
```

---

## Account management

```bash
make-cli teams list --organization-id=5
make-cli teams get 5
make-cli teams create --name='My Team' --organization-id=5

make-cli organizations list
make-cli organizations get 5

make-cli users me                 # current authenticated user

# Shared enumerations (handy for filling org/connection forms)
make-cli enums countries
make-cli enums regions
make-cli enums timezones
```

---

## Gotchas

- **JSON args are strings.** `--blueprint`, `--scheduling`, `--data`, `--spec`, `--parameters`, `--credentials`, `--keys`, `--scopes` all take a JSON *string*. Wrap in single quotes so the shell doesn't mangle the double quotes inside. For big blueprints, read from a file: `--blueprint="$(cat scenario.json)"`.
- **`--team-id` is required on most listing/create commands**, and team commands use `--organization-id`. A "missing team" error usually means you omitted it.
- **Zone must match the account.** Wrong `--zone` → auth failures even with a valid key. Confirm the host from your Make login URL.
- **`scenarios run` without `--responsive`** returns once the run is *queued*, not finished. Add `--responsive` when you need the result/output synchronously.
- **Activate ≠ run.** `scenarios activate` enables (and schedules) a scenario; `scenarios run` fires it once on demand. Don't confuse them.
- **Record keys are opaque ids**, passed positionally; deletes take a `--keys='[...]'` JSON array of those ids.
- **Don't mix install methods** (npm + Homebrew) — it breaks `PATH` resolution of `make-cli`.

---

## Limits & safety

- The CLI commands **create, modify, and delete** real Make resources. Per Make's own launch note: *always test in a non-production environment first.* Default the AIOS to read-only (`list`/`get`) until a write is genuinely needed.
- API-key **scopes** gate what the CLI can do (e.g. a key without `scenarios:write` can't activate/create). Mint least-privilege keys.
- Underlying Make **API rate limits and operations/credit consumption** still apply — every scenario run the CLI triggers spends operations on the account's plan. The CLI is a thin client over the Make API, so the platform's per-plan rate limits govern throughput.
- *(Confirm in the official reference: exact per-minute CLI rate ceilings are not stated in the CLI docs — they inherit the Make API limits for your zone/plan.)*

---

## Debugging

- `make-cli whoami` — verify you're authenticated as the right account/zone before blaming a command.
- `make-cli <category> --help` — the binary is the source of truth for the exact flags on any action; if a flag here ever drifts, check `--help` first.
- `--output=json` (default) for machine parsing; `--output=table` for eyeballing; `--output=compact` for terse logs.
- For failed runs: `make-cli executions list --scenario-id=<id>` then `make-cli executions get-detail <execution-id> --scenario-id=<id>` to see what blew up.
- Stuck/partial runs: `make-cli incomplete-executions list --scenario-id=<id>`.
- **Query the docs live:** any doc page answers natural-language questions — `GET https://developers.make.com/make-cli/make-cli/make-cli-reference.md?ask=<your question>`. Or pull the full index at https://developers.make.com/llms.txt.

<!-- Append fixes here as you hit and solve real errors. This doc should get smarter every time the AIOS stumbles. -->
