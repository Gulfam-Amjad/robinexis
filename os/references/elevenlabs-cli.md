# ElevenLabs CLI reference

Command reference for the official **`@elevenlabs/cli`** — ElevenLabs' "agents as code" tool. This is the *connection doc* for managing voice agents in the Sturdy Ai stack: it lets you keep ElevenLabs voice-agent configs as version-controlled files and push/pull them like any other codebase. When a command fails and you work out why, fix it here so the same mistake never happens twice.

> **Scope — agents only.** This CLI manages **voice agents as code**: init, auth, agents push/pull/list/delete, tools, tests, branches, CI/CD. It does **not** do TTS, sound-effects, music, or one-off voice generation — for those, hit the ElevenLabs API directly or use the connected ElevenLabs MCP. Don't reach for the CLI to synthesise audio.

> **Why CLI over MCP here:** the CLI treats agents as local config files you commit to git — diffable, reviewable, deployable from CI. Use the ElevenLabs MCP for live/interactive work in your own AIOS; teach/ship this doc for portable, reproducible agent builds.

Official docs: <https://elevenlabs.io/docs/eleven-agents/operate/cli> · Repo: <https://github.com/elevenlabs/cli>

---

## Connection

| | |
|---|---|
| **Package** | `@elevenlabs/cli` (npm) |
| **Binary** | `elevenlabs` |
| **Install** | `npm i -g @elevenlabs/cli` (or `pnpm install -g @elevenlabs/cli`) |
| **Runtime** | Node.js 16+ |
| **Auth command** | `elevenlabs auth login` |
| **API key precedence** | `ELEVENLABS_API_KEY` env → OS keychain (keytar) → `~/.elevenlabs/api_key` (perms `600`) |
| **Config dir** | `~/.elevenlabs/` (perms `700` on Unix) |
| **Check login** | `elevenlabs auth whoami` |

**Env var** (in `.env`, gitignored — never commit the real key):
```
ELEVENLABS_API_KEY=   # dashboard > profile > API Keys. Highest priority; used for CI/CD.
```

The key resolves in three places, in this order: the `ELEVENLABS_API_KEY` env var wins (use it in CI/CD), then the native OS keychain (set by `auth login`), then a permission-locked file at `~/.elevenlabs/api_key`.

---

## 🔑 Get your key (plain English — for the setup wizard)

1. Go to **https://elevenlabs.io** and sign in.
2. Click your **profile icon** (bottom-left) → **API Keys**.
3. Click **Create API Key**, give it a name, and copy it.
4. Paste it here — I'll add it to your `.env` and verify the connection.

---

## Project model (the mental model)

A CLI project is a folder of files you commit to git:

- **`agents.json`** — the registry/lock file: maps each local agent config to its remote ElevenLabs `agent_id`.
- **`agent_configs/`** — one JSON file per agent (prompt, voice, tools, model settings).
- **`tool_configs/`** — webhook/client tool definitions agents reference.
- **`test_configs/`** — agent test definitions.

You `pull` to bring remote agents down into files, edit the files, and `push` to send changes back. `push` updates **main plus every registered branch config** by default. Each agent can have multiple **branches** (e.g. `staging`, `production`) pulled as separate config files.

---

## Setup & auth

```bash
npm i -g @elevenlabs/cli            # install globally (Node 16+)
elevenlabs agents init              # scaffold a project in the current directory
elevenlabs auth login               # store API key in OS keychain
elevenlabs auth whoami              # confirm who you're authenticated as
elevenlabs auth logout              # clear stored credentials
```

`init` variants:
```bash
elevenlabs agents init ./my-project   # scaffold in a specific directory
elevenlabs agents init --override     # wipe and recreate project files from scratch
```

---

## Common commands

**Create an agent from a template**
```bash
elevenlabs agents add "Support Bot" --template customer-service
elevenlabs agents add "Support Bot" --template customer-service --output-path agent_configs/
```

**List / inspect templates**
```bash
elevenlabs agents templates list                      # available starter templates
elevenlabs agents templates show customer-service     # show one template's detail
```

**Import an existing agent config file** (registers it with ElevenLabs, gets an `agent_id`, writes it into `agents.json`)
```bash
elevenlabs agents add --from-file my-template.json
elevenlabs agents add "My Agent" --from-file existing-config.json --output-path agent_configs/
```

**Pull agents down from ElevenLabs**
```bash
elevenlabs agents pull                                # pull all registered agents
elevenlabs agents pull --search "support"             # pull matching by name
elevenlabs agents pull --update                       # overwrite local files with remote
elevenlabs agents pull --dry-run                      # show what would change, write nothing
```

**Pull a specific branch / all branches**
```bash
elevenlabs agents pull --agent <agent_id> --branch staging
elevenlabs agents pull --all --all-branches           # each branch saved as its own config file
```

**Push changes back** (main + all registered branches by default)
```bash
elevenlabs agents push                                # push everything
elevenlabs agents push --agent <agent_id>             # push one agent
elevenlabs agents push --agent <agent_id> --branch staging
elevenlabs agents push --dry-run                      # preview, no write
elevenlabs agents push --no-ui                        # non-interactive (CI)
```

**List branches for an agent**
```bash
elevenlabs agents branches list --agent <agent_id>
elevenlabs agents branches list --agent <agent_id> --include-archived
```

**Check sync status**
```bash
elevenlabs agents status
elevenlabs agents status --agent "Support Bot"
```

**Delete an agent** (removes locally **and** from ElevenLabs)
```bash
elevenlabs agents delete <agent_id>
```

**Tools** (webhook + client tools agents call)
```bash
elevenlabs tools pull                                 # pull tool configs into tool_configs/
elevenlabs tools pull --search "crm" --output-dir tool_configs
elevenlabs tools add-webhook "Lookup Order"           # scaffold a webhook tool
elevenlabs tools add-client "Show Card"               # scaffold a client tool
elevenlabs tools push                                 # sync tools to ElevenLabs
elevenlabs tools push --tool "Lookup Order" --dry-run
```

**Tests**
```bash
elevenlabs tests push                                 # sync agent tests
elevenlabs tests push --config-dir test_configs --dry-run
```

---

## Typical workflows

**Stand up a new project**
```bash
elevenlabs agents init
elevenlabs auth login
elevenlabs agents add "Support Bot" --template customer-service
elevenlabs agents push
```

**Pull, edit, push (the everyday loop)**
```bash
elevenlabs agents pull --all --all-branches --update --no-ui
# ...edit agent_configs/*.json...
elevenlabs agents push --no-ui     # auto-pushes main + every registered branch
```

**Wire up tools**
```bash
elevenlabs tools pull              # tool configs land in tool_configs/ with an 'env' field
# ...edit tool_configs/*.json, reference the tool from an agent config...
elevenlabs agents push
```

---

## CI/CD

The env var wins over keychain and file, so CI/CD is just: set the secret, run a non-interactive push.

```yaml
# GitHub Actions — deploy agents on merge
- name: Deploy ElevenLabs agents
  env:
    ELEVENLABS_API_KEY: ${{ secrets.ELEVENLABS_API_KEY }}
  run: |
    npm i -g @elevenlabs/cli
    elevenlabs agents push --no-ui
```

Always pass `--no-ui` in pipelines so the CLI never blocks on an interactive prompt. Source the official CI/CD section before changing the workflow: <https://elevenlabs.io/docs/eleven-agents/operate/cli>.

---

## Gotchas

- **Agents only.** No TTS / sound-effects / music / voice-design here — use the API or the ElevenLabs MCP for audio generation.
- **`delete` is destructive on the remote.** `elevenlabs agents delete <id>` removes the agent from ElevenLabs, not just your disk. `--dry-run` it first if unsure.
- **`push` is wide by default.** A bare `push` sends main **plus every registered branch**. Scope with `--agent` / `--branch` when you only mean to touch one.
- **`--update` overwrites local files** on pull. Without it, pull won't clobber existing configs. Commit before a `--update` pull so you can diff.
- **`agents.json` is the source of truth** for the local→remote `agent_id` mapping. Don't hand-edit it; let `add` / `pull` maintain it. Commit it.
- **Status/label-style fields must match** what exists on the agent remotely — re-`pull` if a `push` silently no-ops.

---

## Limits & auth notes

- **Node 16+** required; install fails or misbehaves on older runtimes.
- **Key precedence is fixed**: env → keychain → `~/.elevenlabs/api_key`. If the wrong account is being used, an old `ELEVENLABS_API_KEY` in the shell env is the usual culprit — it overrides the keychain.
- **`~/.elevenlabs/` is locked down** (`700` dir, `600` key file on Unix). Don't loosen permissions or copy the key into a repo.
- ElevenLabs **API rate limits and plan quotas still apply** to the underlying calls the CLI makes (agent create/update). Heavy bulk pushes can hit them.

---

## Debugging notes

- **`command not found: elevenlabs`** → global npm bin not on `PATH`, or install didn't complete. Re-run `npm i -g @elevenlabs/cli` and check `npm bin -g`.
- **Auth failures / wrong workspace** → run `elevenlabs auth whoami`. If it shows the wrong identity, unset a stale `ELEVENLABS_API_KEY` env var (it beats the keychain), then `elevenlabs auth login` again.
- **CI hangs** → you forgot `--no-ui`; the CLI is waiting on an interactive prompt.
- **Push "did nothing"** → `--dry-run` left over, or the local config matches remote. Run `elevenlabs agents status` to see drift.
- **Verify real flags before scripting** — the CLI is described by ElevenLabs as an experimental "agents as code" exploration and evolves. Check `elevenlabs <command> --help` and the official docs rather than trusting a remembered flag.

<!-- Append fixes here as you hit and solve real errors. This doc should get smarter every time the AIOS stumbles. -->
