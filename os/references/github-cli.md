# GitHub CLI (`gh`) reference

Connection reference for the official **GitHub CLI** — `gh` — the command-line interface to GitHub. This is the *connection doc* for the version-control tool in the Sturdy Ai stack — keep it current. When a call fails and you work out why, fix it here so the same mistake never happens twice.

Source of truth: the official manual at **https://cli.github.com/manual/** (verify every command against it; do not invent flags).

> **Why the CLI over MCP here:** a GitHub MCP exists and is fine for your own live AIOS if it's already wired. But `gh` is the leaner, zero-maintenance default — one binary, no server to host, no token plumbing per session, and it speaks raw REST + GraphQL via `gh api` when you need the escape hatch. Teach/ship this doc for portable, low-context client builds.

---

## 🔑 Connect (plain English — for the setup wizard)

GitHub needs **no key to paste** — it's a quick browser login.

1. When I prompt you, a browser window (or a short code) appears.
2. Sign in to GitHub and approve.
3. Done — I'll confirm with `gh auth status`.

*(Only if you specifically need a token for scripts: github.com → Settings → Developer settings → Personal access tokens.)*

---

## Install & auth

| | |
|---|---|
| **Install (macOS)** | `brew install gh` |
| **Verify** | `gh --version` |
| **Auth (interactive)** | `gh auth login` — web browser flow by default; token is stored securely in the system keyring |
| **Auth (paste a token)** | `gh auth login --with-token < mytoken.txt` |
| **Auth (CI / non-interactive)** | set `GH_TOKEN` or `GITHUB_TOKEN` env var — no `gh auth login` needed |
| **Check status** | `gh auth status` |
| **Add scopes later** | `gh auth refresh -s project,repo` |
| **Switch account / host** | `gh auth switch`, or `gh auth login --hostname github.example.com` for Enterprise |

**Env vars** (never commit — local AIOS only or in connector config):
```
GH_TOKEN=        # preferred for scripts/CI; a PAT or fine-grained token
GITHUB_TOKEN=    # also honoured (e.g. inside GitHub Actions, auto-injected)
GH_HOST=         # default host for commands (e.g. github.com or an Enterprise host)
GH_REPO=         # default OWNER/REPO so you can skip --repo on every call
```
When `GH_TOKEN`/`GITHUB_TOKEN` is set, `gh` uses it and ignores the keyring — the way to run head-less in a routine.

---

## Command model (the mental shape)

`gh <command> <subcommand> [args] [--flags]`

- Core nouns: **`repo`**, **`pr`**, **`issue`**, **`run`** (Actions), **`release`**, **`gist`**, **`auth`**, plus the raw **`api`** escape hatch.
- Most commands infer the **current repository** from the directory's git remote — so inside a clone you rarely pass `--repo`. Outside one, add `-R OWNER/REPO` (or `--repo`).
- `--web` / `-w` opens the relevant page in a browser instead of printing.
- `--json <fields>` returns machine-readable JSON; pair with `--jq` to filter or `--template` to format. This is how a routine consumes output token-lean.
- `gh <command> --help` lists every verified flag — trust it over memory.

---

## Common commands (copy-paste)

### Repositories — `gh repo`
```bash
# Clone (OWNER defaults to you if omitted)
gh repo clone cli/cli
gh repo clone my-org/brain-template my-brain      # into a named directory

# Create + clone a new repo in one step
gh repo create my-project --private --clone

# Create a remote from the current directory and push it
gh repo create my-project --private --source=. --remote=origin --push

# View / open
gh repo view --web
gh repo list my-org --limit 50
```

### Pull requests — `gh pr`
```bash
# Create (fill from commits, or set title/body explicitly)
gh pr create --fill
gh pr create --title "Fix auth race" --body "Closes #42" --base main
gh pr create --draft --reviewer monalisa,my-org/team-name

# Inspect
gh pr list --state open --label bug
gh pr view 353 --web
gh pr status                                       # PRs relevant to you

# Bring a PR's branch into your working tree
gh pr checkout 353

# Review without leaving the terminal
gh pr review 353 --approve
gh pr review 353 --request-changes --body "Needs tests"

# Merge (pick a strategy; clean up the branch)
gh pr merge 353 --squash --delete-branch
gh pr merge --auto --squash                        # merge once checks pass
```

### Issues — `gh issue`
```bash
gh issue create --title "Found a bug" --body "Nothing works" --label "bug,help wanted"
gh issue create --assignee "@me" --project "Roadmap"
gh issue list --state open --assignee "@me" --limit 30
gh issue view 100
gh issue comment 100 --body "Picked this up — fixing now."
gh issue close 100
```

### Actions / CI — `gh run`
```bash
gh run list --limit 10                              # recent workflow runs
gh run list --workflow deploy.yml --status failure
gh run view 1234567890                              # summary of one run
gh run view 1234567890 --log-failed                # only the failed step logs
gh run watch 1234567890                             # live progress until done
gh run rerun 1234567890 --failed                    # retry just the failures
```

### Releases — `gh release`
```bash
gh release create v1.2.3 --notes "Bugfix release"
gh release create v1.2.3 --generate-notes          # auto notes from merged PRs
gh release create v1.2.3 ./dist/*.tgz              # attach build artefacts
gh release list
gh release download v1.2.3
```

### Gists — `gh gist`
```bash
gh gist create snippet.py --desc "Throwaway script"
gh gist create snippet.py --public
echo "one-liner" | gh gist create - --filename note.txt   # from stdin
gh gist list
```

### The escape hatch — `gh api` (raw REST + GraphQL)
Anything the porcelain commands don't cover, hit the API directly — already authenticated, with `{owner}`/`{repo}`/`{branch}` placeholders auto-filled from the current repo.
```bash
# REST GET
gh api repos/{owner}/{repo}/releases

# REST write (-f = string field, -F = typed/file field, @file reads a file)
gh api repos/{owner}/{repo}/issues/123/comments -f body='Hi from the AIOS'

# Force a verb + add query params to a GET
gh api -X GET search/issues -f q='repo:cli/cli is:open remote'

# Filter the response with jq (token-lean — only pull what you need)
gh api repos/{owner}/{repo}/issues --jq '.[].title'

# Auto-follow pagination across all pages
gh api repos/{owner}/{repo}/issues --paginate --jq '.[].number'

# GraphQL (v4) — pass variables with -F/-f
gh api graphql -F owner='{owner}' -F name='{repo}' -f query='
  query($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      releases(last: 3) { nodes { tagName } }
    }
  }'
```

---

## Gotchas (the parts that bite)

- **`-f` vs `-F` in `gh api`:** `-f` sends every value as a **string**; `-F` infers type (numbers, booleans, `null`) and supports `@filename` to read a file and `placeholder` substitution. Send a number as a number with `-F`, or the API may 422.
- **Placeholders only fill inside a repo.** `{owner}`/`{repo}`/`{branch}` resolve from the current git remote. Outside a clone they stay literal and the call 404s — pass `-R OWNER/REPO` or write the path out in full.
- **`GH_TOKEN` overrides the keyring.** If a routine behaves as the wrong identity, an env var is set somewhere — `gh auth status` shows which token is active.
- **`--json` needs an explicit field list.** `gh pr list --json` errors without fields; run `gh pr list --json 2>&1` or check `--help` to see the available field names, then ask for only those.
- **Default-repo inference can surprise you** when a directory has multiple remotes or a fork. Set `gh repo set-default` once, or pass `-R` to be explicit in scripts.
- **`gh run watch` needs a classic token / OAuth**, not a fine-grained PAT (per the manual). Use `gh run view` polling if you're on a fine-grained token.
- **Scopes are not retroactive.** Adding to a project or reading org data may need `gh auth refresh -s project` (or `read:org`) — the command tells you which scope is missing.

---

## Limits

- `gh` rides the standard GitHub API rate limits: **5,000 requests/hour** for an authenticated user (REST), with a separate GraphQL point budget. Check live headroom with `gh api rate_limit`.
- `--paginate` can burn through the budget fast on large repos — filter server-side (search qualifiers, `per_page`) before paginating everything.
- Unauthenticated calls are capped at 60/hour — always be authenticated.

---

## Debugging notes

- **See the real HTTP traffic:** `GH_DEBUG=api gh <command>` prints requests, responses, and headers — the fastest way to learn why a call failed.
- **Rate-limit headroom:** `gh api rate_limit --jq '.rate'`.
- **Which identity / scopes am I?** `gh auth status` (add `-t` to show the token).
- **A flag "doesn't exist":** you're likely on an old binary — `brew upgrade gh` and re-check `gh <command> --help`. The manual is the authority.
- **Enterprise host:** if commands hit the wrong server, set `GH_HOST` or pass `--hostname` / `-R host/owner/repo`.

<!-- Append fixes here as you hit and solve real errors. This doc should get smarter every time the AIOS stumbles. -->
