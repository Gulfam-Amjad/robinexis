# HeyGen CLI reference

Connection doc for **HeyGen** — AI avatar-video generation — in the Sturdy Ai stack. We drive HeyGen through its **official CLI**, a single binary that wraps the **v3 API**. This is the *connection doc*: keep it current. When a command fails and you work out why, fix it here so the same mistake never happens twice.

> **Why the CLI over the raw API here:** HeyGen's v2 API is sunsetting (end of life 1 Nov 2026). The official CLI is v3-native, ships as one static binary with no runtime, and prints stable JSON on stdout with stable exit codes — leaner to script and agent-friendly out of the box. A HeyGen **MCP** is also connected (remote endpoint, OAuth) — use that for your own live AIOS when it's wired; teach/ship this CLI doc for portable, low-context client builds and CI.
>
> Official docs: <https://developers.heygen.com/cli> · Repo: <https://github.com/heygen-com/heygen-cli>

---

## Install & auth

| | |
|---|---|
| **Install** | `curl -fsSL https://static.heygen.ai/cli/install.sh | bash` |
| **Installs to** | `~/.local/bin` (ensure it's on your `PATH`) |
| **Binary** | Single static binary, no runtime required |
| **Platforms** | macOS, Linux, and Windows (via WSL) |
| **Verify install** | `heygen --version` |
| **Auth** | HeyGen **API key** (get one at <https://app.heygen.com/settings/api>) |
| **Verify auth** | `heygen auth status` |

**Three ways to authenticate** (official docs — pick one):

```bash
# 1. Env var — agents / CI; ephemeral, nothing written to disk. Takes precedence.
export HEYGEN_API_KEY=your-key-here

# 2. Pipe to auth login — agents; persists to ~/.heygen/credentials
echo "$HEYGEN_API_KEY" | heygen auth login

# 3. Interactive — humans; paste key when prompted, persists to ~/.heygen/credentials
heygen auth login
```

`HEYGEN_API_KEY` (env) overrides the stored credentials file — set it in CI/Docker/agent runs.

**Env vars** (in `.env`, gitignored — never commit the real secret):
```
HEYGEN_API_KEY=    # API key: app.heygen.com/settings/api. Records *that* it's connected in connections.md, never the value.
HEYGEN_OUTPUT=     # optional: set to "human" for readable layout. Default (JSON) is what agents/scripts should consume.
```

**Config files** the CLI writes locally:

| File | Purpose |
|---|---|
| `~/.heygen/credentials` | API key (when persisted via `auth login`) |
| `~/.heygen/config.toml` | Output format and other non-secret settings |

`heygen config list` shows every setting with its source. `HEYGEN_API_KEY` and `HEYGEN_OUTPUT` override the respective files.

---

## 🔑 Get your key (plain English — for the setup wizard)

1. Go to **https://app.heygen.com/settings?nav=API** (or Settings → API).
2. Copy your **API Key**.
3. Paste it here — I'll add it to your `.env` and verify the connection.

---

## Command model (the mental model)

- Pattern: **`heygen <noun> <verb>`** — mirrors the v3 API.
- **stdout is always JSON** (the stable contract). Even `video download` emits `{"asset", "message", "path"}` so you can chain on `.path`; the binary itself writes to disk.
- **Errors** go to **stderr** as a structured envelope: `{"error": {"code", "message", "hint"}}`, with stable `code` values for programmatic branching.
- **`--human`** on any command renders a readable table/describe-style layout instead of JSON. It may change between releases — **scripts and agents must consume the default JSON**, which is never altered.
- **Async jobs**: add **`--wait`** to block until done (exponential backoff); **`--timeout`** sets the max (default 20m). 429s and 5xx retry automatically.
- **Request bodies**: flags for simple inputs; **`-d`** for nested JSON — inline, a file path, or `-` for stdin. Flags override matching fields in `-d`.
- Self-describing: **`--request-schema`** / **`--response-schema`** return JSON Schema with no auth or API call. Every command supports **`--help`**.

**Command groups:**

| Group | What it does |
|---|---|
| `video-agent` | Create videos from a text prompt (AI handles avatar, voice, layout) |
| `video` | Create, list, get, delete, download videos |
| `avatar` | List and manage avatars and looks |
| `voice` | List voices, design voices, generate speech |
| `audio` | Search the background-music catalog |
| `video-translate` | Translate videos into other languages |
| `lipsync` | Dub or replace audio on existing videos |
| `webhook` | Manage webhook endpoints and events |
| `asset` | Upload files for use in video creation |
| `user` | Account info and billing |

---

## Common commands (copy-paste)

**Check auth / who am I**
```bash
heygen auth status
heygen user --help        # account info & billing verbs
```

**Create a video from a prompt** (Video Agent picks avatar/voice/layout)
```bash
# Returns immediately with JSON incl. video_id; or add --wait to block to completion.
heygen video-agent create --prompt "A presenter explaining our product launch in 30 seconds" --wait
```
Example JSON (returns immediately, no `--wait`):
```json
{ "data": { "session_id": "sess_abc123", "status": "generating", "video_id": "vid_xyz789", "created_at": 1711288320 } }
```

**Create a video with full control over every parameter** (avatar + voice + script)
```bash
# Use `video create` with a JSON body via -d (inline, @file, or - for stdin).
# Flags override matching fields in the JSON. Confirm exact field names with:
#   heygen video create --request-schema
heygen video create -d @video.json
heygen video create -d - < video.json
```
Recommended v3 defaults for a direct avatar video: `aspect_ratio: "auto"`, `resolution: "1080p"`. The look `id` from `avatar list` is the `avatar_id` you pass.

**List avatars / looks** (find the `avatar_id` to render with)
```bash
heygen avatar list          # avatar groups (characters) and looks
heygen avatar --help        # full verb list for this group
```

**List / design voices, generate speech**
```bash
heygen voice list           # browse voices; a voice_id feeds video/speech creation
heygen voice --help         # design voices + generate speech (Starfish TTS) verbs
```

**Poll a job's status and grab the share link**
```bash
heygen video get <video-id>                                   # full JSON: status, video_url, video_page_url, thumbnail_url, duration
heygen video get <video-id> | jq -r '.data.video_page_url'    # → https://app.heygen.com/videos/...
heygen video get <video-id> | jq -r '.data.status'            # generating | completed | ...
```

**Download the finished mp4**
```bash
heygen video download <video-id>                              # writes mp4 to disk; stdout JSON has .path
heygen video download <video-id> | jq -r '.path'              # the local file path
```

**Translate a video** into other languages (voice clone + lip-sync, 30+ languages)
```bash
heygen video-translate create -d @translate.json --wait       # one job per target language
heygen video-translate get <translation-id>                   # status + output video_url
heygen video-translate --help                                 # incl. list supported languages
```

**Lipsync / dub** audio onto an existing video
```bash
heygen lipsync create -d @lipsync.json --wait
heygen lipsync get <lipsync-id>
```

**Upload an asset** (e.g. a headshot for photo-to-video, or audio for lipsync)
```bash
heygen asset --help         # upload files for use in video creation
```

**Search background music**
```bash
heygen audio --help         # semantic search of the background-music catalog
```

> Confirm exact verbs and flags per group with `heygen <noun> --help` — this doc lists the officially-documented groups; the per-verb flag surface is best read live from `--help` / `--request-schema`.

---

## Exit codes (branch on these in scripts)

| Code | Meaning |
|---|---|
| `0` | OK |
| `1` | API or network error |
| `2` | Usage error (bad flags/args) |
| `3` | Auth error (missing/invalid key) |
| `4` | Timeout under `--wait` (stdout still contains the partial resource so you can resume) |

Error envelope on stderr:
```json
{"error": {"code": "not_found", "message": "Video not found", "hint": "Check ID with: heygen video list"}}
```

---

## Gotchas

- **Don't parse `--human` output.** It's a terminal convenience and can change between releases. Agents and scripts must consume the **default JSON** (stable contract). Set `HEYGEN_OUTPUT=human` only for your own eyeballing.
- **`~/.local/bin` must be on `PATH`.** If `heygen` is "command not found" right after install, that's why — add it and re-open the shell.
- **Env beats file.** `HEYGEN_API_KEY` overrides `~/.heygen/credentials`. In CI/Docker/agents prefer the env var so nothing touches disk and nothing reads a TTY.
- **Async by default.** `video-agent create` / `video create` / `video-translate create` return *immediately* with a job id and `status: "generating"`. Either add `--wait` (blocks, default 20m via `--timeout`) or poll `... get <id>` until `status` is `completed` before downloading.
- **`download` writes a file, prints JSON.** The mp4 lands on disk; stdout is `{"asset","message","path"}` — chain on `.path`, don't expect the binary on stdout.
- **`avatar_id` is the *look* id**, not the group/character id. Pull it from `avatar list` (looks), not the avatar group.
- **v2 is sunsetting.** This CLI is v3-native. A few v2-only features (multi-scene Studio API, Template-variable API) have no v3 equivalent yet — if a workflow needs those, it stays on v2 until HeyGen ships the v3 equivalent. Plan all new work on v3.

---

## Limits

- HeyGen bills **per operation** (credits / dollar-based on Enterprise). Video generation, translation and lipsync each consume credits — check balance/plan via the `user` group.
- **Rate limits, concurrency and quotas** apply across v3 endpoints (see HeyGen "Usage Limits"). The CLI auto-retries `429` and `5xx` on `--wait` jobs.
- **v3 API end of life for v1/v2: 1 Nov 2026** — route everything through v3 (this CLI) before then.

---

## Debugging notes

- **`heygen auth status`** first — a `3` exit or auth-coded error envelope means the key is missing/invalid or the env var isn't exported into this shell.
- **Use `--request-schema` / `--response-schema`** to see exact field names without spending an API call or needing auth — faster than guessing JSON keys.
- **A `4` exit isn't a failure of the job** — it's a `--wait` timeout. The job may still be rendering; the partial resource is on stdout, so re-poll with `... get <id>` rather than recreating.
- **`heygen config list`** shows which credential/output source is actually in effect (env vs file) when behaviour surprises you.
- **`--help` is exhaustive** on every command — per-verb flags live there and stay correct across releases; trust it over any cached memory of the flag surface.

<!-- Append fixes here as you hit and solve real errors. This doc should get smarter every time the AIOS stumbles. -->
