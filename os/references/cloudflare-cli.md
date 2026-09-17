# Cloudflare CLI reference (Wrangler)

Connection doc for Cloudflare in the Sturdy Ai stack. **Wrangler** is Cloudflare's official CLI — it manages Workers, Pages, KV, R2, D1 and secrets from the terminal. This is the *connection doc*: keep it current. When a command fails and you work out why, fix it here so the same mistake never bites twice.

> **Why CLI over MCP here:** Wrangler is the canonical deploy path — it bundles your code, manages bindings, and ships to the edge in one command, scriptable into any routine. A Cloudflare MCP is also connected — reach for that for read/inspect work (list Workers, query D1, peek KV/R2) inside your live AIOS when it's wired up; teach/ship *this* doc for portable, low-context client builds and anything that deploys. For account-level things Wrangler doesn't touch (DNS, zones), drop to the REST API at the bottom.

---

## 🔑 Get your key (plain English — for the setup wizard)

1. Go to **https://dash.cloudflare.com** and sign in.
2. Top-right, click your profile → **My Profile → API Tokens**.
3. **Create Token** → pick a least-privilege template, create it, copy it.
4. Paste it here — I'll add it to your `.env` and verify. *(Or just say "log me in" and I'll run the browser login instead.)*

---

## Install & auth

| | |
|---|---|
| **Install** | `npm i -g wrangler` (global). Cloudflare recommends installing *per-project* instead — `npm i -D wrangler` — and running via `npx wrangler …` so each project pins its own version |
| **Runtime** | Node.js — a [current LTS](https://nodejs.org/) version. Bun/Deno also work |
| **Check version** | `wrangler --version` |
| **Update** | `npm i -g wrangler@latest` (or bump the devDependency) |
| **Auth (interactive)** | `wrangler login` — OAuth flow, opens a browser, scoped to your account. Best for local dev |
| **Auth (headless/CI)** | Set `CLOUDFLARE_API_TOKEN` env var — no browser needed. Best for routines, CI, servers |
| **Who am I** | `wrangler whoami` — confirms the logged-in account + token scopes |
| **Logout** | `wrangler logout` (OAuth) — or delete the API token in the dashboard if using `CLOUDFLARE_API_TOKEN` |

**Env vars** (in `.env`, gitignored — never commit):
```
CLOUDFLARE_API_TOKEN=    # scoped API token — dashboard > My Profile > API Tokens > Create Token
CLOUDFLARE_ACCOUNT_ID=   # dashboard > any zone > Overview (right sidebar), or `wrangler whoami`
```
- `CLOUDFLARE_API_TOKEN` overrides OAuth — if it's set, Wrangler uses it instead of `wrangler login` creds.
- `CLOUDFLARE_ACCOUNT_ID` saves you the account-picker prompt when your token can see multiple accounts. The Pages deploy command in particular wants it set.
- Create a token with **least privilege** — scope it to the products you actually use (Workers Scripts: Edit, Pages: Edit, KV/R2/D1 as needed). See the official [Create API token](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/) guide.

---

## Command model

```
wrangler <COMMAND> <SUBCOMMAND> [PARAMETERS] [OPTIONS]
```
- Global install: `wrangler deploy`. Local install: `npx wrangler deploy` (yarn/pnpm equivalents work too).
- Most resource commands read defaults from **`wrangler.toml`** (or `wrangler.jsonc`) in the project root — Worker `name`, `main` entry, `compatibility_date`, and **bindings** (which KV namespace / R2 bucket / D1 db this Worker can reach).
- `--env <name>` selects a named environment block in your config (e.g. staging vs production) and the matching `.env` / `.dev.vars` file.
- Wire repeat commands into `package.json` scripts: `"deploy": "wrangler deploy"`, then `npm run deploy`.

---

## Workers — init, dev, deploy, tail

```bash
# Scaffold a new Worker project (runs the create-cloudflare C3 tool — frameworks/templates)
wrangler init my-worker
wrangler init my-worker --yes          # accept all defaults, non-interactive
wrangler init --from-dash my-worker    # pull a Worker you created in the dashboard

# Run locally on a dev server (hot reload, local edge runtime)
wrangler dev
wrangler dev --remote                  # run against real Cloudflare infra, not local sim

# Ship to the edge
wrangler deploy                        # bundles + deploys the Worker in wrangler.toml
wrangler deploy --dry-run --outdir dist # bundle only, don't publish (inspect output)

# Live-stream logs from a deployed Worker
wrangler tail                          # real-time requests + console logs + exceptions
wrangler tail --format pretty
wrangler tail --status error           # only failed requests

# Remove a deployed Worker
wrangler delete                        # deletes the Worker named in wrangler.toml
```
- `wrangler dev` simulates the edge locally; `--remote` uses the genuine runtime (needed when a binding only behaves correctly against real infra).
- Versioned deploys exist too: `wrangler versions upload` then `wrangler versions deploy` for gradual rollouts.

---

## Pages — deploy static / framework assets

```bash
# Deploy a folder of prebuilt assets to a Pages project (Direct Upload)
wrangler pages deploy ./dist --project-name=my-site

# In CI, set the account id inline so there's no prompt
CLOUDFLARE_ACCOUNT_ID=<id> wrangler pages deploy ./dist --project-name=my-site

# Useful flags
wrangler pages deploy ./dist --project-name=my-site --branch=preview   # deploy to a preview branch
wrangler pages deploy ./dist --project-name=my-site --commit-dirty=true
```
- For GitHub Actions, use the official `cloudflare/wrangler-action@v3` with `command: pages deploy <dir> --project-name=<name>`, passing `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as repo secrets.
- New static projects can also be served straight from a Worker (Workers Static Assets) — Cloudflare now steers most new work to Workers rather than Pages.

---

## KV — key-value namespaces

```bash
# Namespaces
wrangler kv namespace create MY_KV          # create; prints the id + binding snippet for wrangler.toml
wrangler kv namespace list
wrangler kv namespace delete --binding=MY_KV

# Keys (target a namespace by --binding or --namespace-id)
wrangler kv key put my-key "my value" --binding=MY_KV
wrangler kv key put my-key "my value" --binding=MY_KV --remote   # write to production, not local
wrangler kv key get my-key --binding=MY_KV
wrangler kv key list --binding=MY_KV
wrangler kv key delete my-key --binding=MY_KV

# Bulk
wrangler kv bulk put kv.json --binding=MY_KV    # kv.json: [{"key":"k","value":"v"}, ...]
wrangler kv bulk delete keys.json --binding=MY_KV
```
- After `kv namespace create`, paste the printed binding block into `wrangler.toml` so your Worker can reach it.
- `--local` (default for dev) vs `--remote`: writes land in different stores. A "key isn't there" surprise is usually a local/remote mismatch.

---

## R2 — object storage (S3-compatible)

```bash
# Buckets
wrangler r2 bucket create my-bucket
wrangler r2 bucket list
wrangler r2 bucket delete my-bucket

# Objects (path is {bucket}/{key})
wrangler r2 object put my-bucket/photo.jpg --file=./photo.jpg
wrangler r2 object get my-bucket/photo.jpg --file=./out.jpg
wrangler r2 object delete my-bucket/photo.jpg
```
- R2 has **no egress fees** — the reason to pick it over S3 for edge-served assets.
- `--remote` / `--local` apply to objects just like KV. Add `--jurisdiction <j>` if the bucket lives in a data-residency jurisdiction.

---

## D1 — serverless SQLite

```bash
# Create / list
wrangler d1 create my-db                    # prints the binding block for wrangler.toml
wrangler d1 list

# Run SQL (--remote = production db; default/--local = the dev sim)
wrangler d1 execute my-db --command="SELECT * FROM users LIMIT 5" --remote
wrangler d1 execute my-db --file=./schema.sql --remote
wrangler d1 execute my-db --command="SELECT 1" --local

# Migrations (files live in ./migrations)
wrangler d1 migrations list my-db --remote
wrangler d1 migrations apply my-db --remote
```
- `[DATABASE]` accepts the **name or the binding**.
- Default target is **local** — pass `--remote` to touch the real database. Forgetting `--remote` is the classic "my migration didn't apply to prod" trap.
- `--remote` requires either `--command` or `--file`; in CI the confirmation prompt is skipped automatically.

---

## Secrets — encrypted env vars for Workers

```bash
wrangler secret put API_KEY                  # prompts for the value (hidden), encrypts it
echo "s3cr3t" | wrangler secret put API_KEY  # pipe from stdin (non-interactive)
wrangler secret list
wrangler secret delete API_KEY

# Bulk — JSON {"k":"v",...} or a .env-style file; up to 100 per call
wrangler secret bulk secrets.json
wrangler secret bulk < secrets.json          # via stdin
```
- Secrets are **encrypted at rest** and exposed to the Worker as `env.API_KEY` at runtime — never put them in `wrangler.toml`.
- Set a key to `null` in the JSON to delete it in a `secret bulk` run (requires Wrangler ≥ 4.97.0; JSON only, not `.env`).
- For local dev, put non-production values in a `.dev.vars` file (gitignored) — `wrangler dev` reads it instead of the real secrets.
- Versioned variant: `wrangler versions secret put` / `... secret bulk` / `... secret delete` for staged rollouts.

---

## API section — what Wrangler doesn't do

Wrangler manages your *developer-platform* resources. For **DNS, zones, account settings, page rules, firewall, analytics** — anything zone- or account-level — hit the REST API directly.

| | |
|---|---|
| **Base URL** | `https://api.cloudflare.com/client/v4` |
| **Auth header** | `Authorization: Bearer {CLOUDFLARE_API_TOKEN}` (recommended). Legacy global-key auth uses `X-Auth-Email` + `X-Auth-Key` — avoid it |
| **Content type** | `Content-Type: application/json` |
| **Docs** | [developers.cloudflare.com/api](https://developers.cloudflare.com/api/) — full endpoint reference |
| **SDKs** | Official typed clients exist: `npm install cloudflare` (TS), `pip install cloudflare` (Python). Prefer these over hand-rolled fetch for anything non-trivial |

Most endpoints are scoped under an account or a zone:
```
GET  /accounts/{account_id}/...
GET  /zones/{zone_id}/...
```

**Test the token / list accounts**
```bash
curl https://api.cloudflare.com/client/v4/accounts \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
```

**List zones (domains)**
```bash
curl "https://api.cloudflare.com/client/v4/zones" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
```

**Create a DNS record**
```bash
curl -X POST "https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"type":"A","name":"www","content":"203.0.113.10","ttl":3600,"proxied":true}'
```

**List DNS records**
```bash
curl "https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
```
- Get the `{zone_id}` from the dashboard zone Overview (right sidebar) or `GET /zones?name=example.com`.
- KV/R2/D1/Workers also have REST endpoints (`/accounts/{account_id}/storage/kv/...`, `/r2/buckets/...`, `/d1/...`) — but Wrangler is the better path for those day-to-day. Use REST when scripting against a runtime that doesn't ship Wrangler.

---

## Gotchas

- **Local vs remote is the #1 trap.** KV writes, R2 objects, and D1 queries default to a **local** simulation. Pass `--remote` for anything that must hit production. A "the data isn't there" bug is almost always this.
- **Bindings live in `wrangler.toml`, not flags.** Creating a KV namespace / R2 bucket / D1 db doesn't connect it to your Worker — you must paste the printed binding block into config and redeploy.
- **`name` / `compatibility_date` are required** in `wrangler.toml` for a Worker to deploy. A stale `compatibility_date` can silently change runtime behaviour.
- **Secrets ≠ vars.** `[vars]` in config are plaintext and committed; `wrangler secret put` values are encrypted and never in the repo. Don't confuse them.
- **`pages deploy` wants the account id.** If it stalls on an account picker in CI, set `CLOUDFLARE_ACCOUNT_ID`.
- **Token scope errors masquerade as 'not found'.** A `10000`/authentication error on the REST API usually means the token lacks the permission for that resource, not that the resource is missing.
- **Install locally for reproducibility.** A globally-pinned Wrangler drifts across projects; a `-D` devDependency keeps each project on a known version.

---

## Limits (rough, check current plan)

- **Workers free:** 100k requests/day; 10ms CPU per invocation. Paid (Workers Paid, ~$5/mo): 10M requests included, 30s+ CPU, then metered.
- **KV:** values up to 25 MB; eventually-consistent global reads, ~1 write/sec per key.
- **R2:** no egress fees; standard class-A/class-B operation pricing; 5 TB max single object.
- **D1:** SQLite-backed; generous free tier (rows read/written per day), per-database size cap in the low-GBs — built for edge-read-heavy, not huge OLTP.
- **REST API:** global rate limit of **1200 requests / 5 minutes per user**. Batch and cache; a `429` means back off.

These move — confirm against the live docs before relying on a number for a client quote.

---

## Debugging notes

- `wrangler whoami` first — confirms *which* account and whether the token has the scopes you think it does.
- `wrangler tail` is your edge `console.log` — stream a live Worker's requests/exceptions instead of guessing.
- `wrangler deploy --dry-run --outdir dist` to inspect the bundle without shipping when a deploy behaves oddly.
- `WRANGLER_LOG=debug wrangler <cmd>` for verbose CLI logging when a command fails opaquely.
- REST API errors return a JSON `errors` array with a numeric `code` — read it; the HTTP status alone won't tell you it was a permissions problem.
- After `*-binding* not found` at runtime: the binding name in `wrangler.toml` must match exactly what your code reads off `env.`.

---

## Official sources

- Wrangler: https://developers.cloudflare.com/workers/wrangler/
- Wrangler commands: https://developers.cloudflare.com/workers/wrangler/commands/
- Install/update: https://developers.cloudflare.com/workers/wrangler/install-and-update/
- System env vars: https://developers.cloudflare.com/workers/wrangler/system-environment-variables/
- REST API reference: https://developers.cloudflare.com/api/
- Create an API token: https://developers.cloudflare.com/fundamentals/api/get-started/create-token/

<!-- Append fixes here as you hit and solve real errors. This doc should get smarter every time the AIOS stumbles. -->
