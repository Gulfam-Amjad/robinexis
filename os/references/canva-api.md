# Canva Connect API reference

Endpoint reference for the Canva Connect REST API. This is the *connection doc* for the design-automation tool in the Sturdy Ai stack — keep it current. When a call fails and you work out why, fix it here so the same mistake never happens twice.

Official docs: <https://www.canva.dev/docs/connect/>

> **Why API, not CLI, here:** Canva *does* ship an official CLI (`@canva/cli`), but it only **builds Canva apps** — it can't generate, autofill, or export designs. For design automation (what we actually use), the Connect REST API is the correct mechanism. (Same pattern as Monday's `mapps` CLI: app-dev only, so the data work goes through the API.)
>
> **Why API over MCP:** the REST API is portable — it ships into any client build, scheduled routine, or Make.com scenario without depending on the desktop connector. A **Canva MCP is also connected** to this AIOS and is quicker to wire for your own live work — use the MCP for ad-hoc desktop tasks; teach/ship this doc for low-context, reproducible client automations.

---

## 🔑 Set up access (plain English — for the setup wizard)

Canva uses a one-off integration setup — I handle the technical bits.

1. Go to **https://www.canva.com/developers/** → **Integrations** → create one.
2. Copy the **Client ID** and **Client Secret**.
3. Paste both here — I'll run the sign-in and get your access token.

---

## Connection

| | |
|---|---|
| **Base URL** | `https://api.canva.com/rest/v1` |
| **Method** | REST — `GET` / `POST` / `PATCH` / `DELETE` per endpoint |
| **Auth header** | `Authorization: Bearer <CANVA_ACCESS_TOKEN>` |
| **Content type** | `Content-Type: application/json` (asset binary uploads use `application/octet-stream`) |
| **Auth model** | OAuth 2.0 — **authorization code + PKCE** (user-delegated; the integration acts on the user's behalf) |
| **Authorize URL** | `https://www.canva.com/api/oauth/authorize` |
| **Token URL** | `https://api.canva.com/rest/v1/oauth/token` |

**Env vars** (in `.env`, gitignored — never commit):
```
CANVA_ACCESS_TOKEN=   # short-lived bearer token from the OAuth exchange (refresh when it expires)
CANVA_CLIENT_ID=      # integration's client ID — Canva Developer Portal > your integration
CANVA_CLIENT_SECRET=  # integration's client secret — used ONLY in the token exchange, never client-side
```

---

## OAuth flow (authorization code + PKCE)

1. **Generate a PKCE pair** — a random `code_verifier`, and its SHA-256 hash as the `code_challenge`.
2. **Send the user to the authorization URL.** After they approve, Canva redirects to your `redirect_uri` with a `?code=...` (and your `state`):
   ```
   https://www.canva.com/api/oauth/authorize
     ?response_type=code
     &client_id=CANVA_CLIENT_ID
     &scope=asset:read%20asset:write%20design:content:read%20design:content:write%20design:meta:read%20brandtemplate:meta:read%20brandtemplate:content:read%20folder:read
     &code_challenge=<code_challenge>
     &code_challenge_method=s256
     &redirect_uri=<your redirect uri>
     &state=<random anti-CSRF string>
   ```
3. **Exchange the code for tokens** at the token endpoint. Authenticate with **HTTP Basic auth** — `Authorization: Basic base64(CANVA_CLIENT_ID:CANVA_CLIENT_SECRET)`:
   ```bash
   curl --request POST 'https://api.canva.com/rest/v1/oauth/token' \
     --header 'Authorization: Basic <base64(client_id:client_secret)>' \
     --header 'Content-Type: application/x-www-form-urlencoded' \
     --data-urlencode 'grant_type=authorization_code' \
     --data-urlencode 'code=<authorization code>' \
     --data-urlencode 'code_verifier=<the code_verifier from step 1>' \
     --data-urlencode 'redirect_uri=<your redirect uri>'
   ```
   The response carries `access_token`, `expires_in`, and a `refresh_token`.
4. **Refresh** when the access token expires — same endpoint, `grant_type=refresh_token`, with `refresh_token=<token>`. **Each refresh token is single-use** — store the new one it returns.

> The [Canva Connect API Starter Kit](https://github.com/canva-sdks/canva-connect-api-starter-kit) handles this whole dance if you don't want to hand-roll it.

**Common scopes** (request only what you need): `profile:read`, `asset:read`, `asset:write`, `design:meta:read`, `design:content:read`, `design:content:write`, `brandtemplate:meta:read`, `brandtemplate:content:read`, `folder:read`, `folder:write`, `comment:read`, `comment:write`.

---

## Core objects (the mental model)

- **Designs** — the core artefact (a Canva document). Identified by a `design_id`. Has page thumbnails, edit/view URLs, and a `design_type` (a `preset` like `doc`/`presentation`, or a `custom` width × height).
- **Brand templates** — reusable, locked layouts. The ones with a **dataset** (named, fillable fields) are what you drive with **Autofill**. Identified by a `brand_template_id`. (IDs migrated to a new format in **Sept 2025** — old IDs accepted for a 6-month grace window only.)
- **Assets** — uploaded media (images etc.), identified by an `asset_id`. You reference assets when creating designs or autofilling image fields.
- **Folders** — containers for designs, assets, and (optionally) brand templates. Identified by a `folder_id`; `root` is the top level.
- **Async jobs** — exports, asset uploads, and autofills are **asynchronous**. The `create` call returns a `job` with an `id` and `status`; you **poll the matching `get` endpoint** until `status` is `success` (or `failed`).

> **Autofill + brand-template content require a Canva Enterprise** org membership for the acting user (paid plans get a limited dev trial). Plan around this for client work.

---

## Common operations

### Designs

**List designs** (paginated)
```bash
curl 'https://api.canva.com/rest/v1/designs?ownership=owned&sort_by=modified_descending' \
  --header 'Authorization: Bearer {token}'
```
Paginate with the returned `continuation` token: `/v1/designs?continuation={continuation}`. Loop until no token comes back.

**Get a single design**
```bash
curl 'https://api.canva.com/rest/v1/designs/{designId}' \
  --header 'Authorization: Bearer {token}'
```

**Create a design** — at least one of `design_type` or `asset_id` is required.
```bash
# Preset type
curl --request POST 'https://api.canva.com/rest/v1/designs' \
  --header 'Authorization: Bearer {token}' \
  --header 'Content-Type: application/json' \
  --data '{ "design_type": { "type": "preset", "name": "presentation" }, "title": "Q3 deck" }'

# Custom dimensions (40–8000px per side; total area ≤ 25,000,000 px²)
curl --request POST 'https://api.canva.com/rest/v1/designs' \
  --header 'Authorization: Bearer {token}' \
  --header 'Content-Type: application/json' \
  --data '{ "design_type": { "type": "custom", "width": 1080, "height": 1080 }, "title": "IG square" }'
```

### Brand templates + Autofill

**List brand templates** (filter to autofillable ones via dataset, paginate via `continuation`)
```bash
curl 'https://api.canva.com/rest/v1/brand-templates?ownership=owned' \
  --header 'Authorization: Bearer {token}'
```

**Get a brand template's dataset** (discover the field keys + types before autofilling)
```bash
curl 'https://api.canva.com/rest/v1/brand-templates/{brandTemplateId}/dataset' \
  --header 'Authorization: Bearer {token}'
```

**Create a design from a brand template (autofill job)** — this is the "fill a template and get a finished design" workflow. Async: poll the get-autofill endpoint for the result.
```bash
curl --request POST 'https://api.canva.com/rest/v1/autofills' \
  --header 'Authorization: Bearer {token}' \
  --header 'Content-Type: application/json' \
  --data '{
    "brand_template_id": "DAFVztcvd9z",
    "title": "Weekly social post",
    "data": {
      "headline_text":   { "type": "text",  "text": "It was like this when I got here!" },
      "hero_image":      { "type": "image", "asset_id": "Msd59349ff" }
    }
  }'
```
Field `type` values: `text`, `image` (needs `asset_id`), `chart` / sheet (preview — `chart_data` with `column_configs` + `rows`). **Keys must match the dataset exactly** — fetch the dataset first.

**Get the autofill job result** (poll until `status` is `success`)
```bash
curl 'https://api.canva.com/rest/v1/autofills/{jobId}' \
  --header 'Authorization: Bearer {token}'
```

### Assets

**Upload an asset** — binary body, metadata in a header. `name_base64` is the **Base64-encoded** display name.
```bash
curl --request POST 'https://api.canva.com/rest/v1/asset-uploads' \
  --header 'Authorization: Bearer {token}' \
  --header 'Content-Type: application/octet-stream' \
  --header 'Asset-Upload-Metadata: { "name_base64": "TXkgQXdlc29tZSBVcGxvYWQg8J+agA==" }' \
  --data-binary '@/path/to/image.png'
```
Async — poll `GET /v1/asset-uploads/{jobId}` for the resulting `asset.id`. (There's also a **URL-based** upload: `POST /v1/url-asset-uploads` with a JSON `url` + `name`.)

### Exports

**Create a design export job** — async; download URLs are valid for **24 hours only**.
```bash
curl --request POST 'https://api.canva.com/rest/v1/exports' \
  --header 'Authorization: Bearer {token}' \
  --header 'Content-Type: application/json' \
  --data '{ "design_id": "DAFVztcvd9z", "format": { "type": "pdf" } }'
```
Format `type` values: `jpg`, `png`, `gif`, `pdf`, `pptx`, `mp4`, `csv`, `html_bundle`, `html_standalone`. (`jpg`/`png` accept quality/size options; `pdf`/`pptx` accept `pages`.) Use **Get export formats** (`GET /v1/designs/{designId}/export-formats`) to learn what a given design supports.

**Get the export job + download URLs** (poll until `status` is `success`)
```bash
curl 'https://api.canva.com/rest/v1/exports/{exportJobId}' \
  --header 'Authorization: Bearer {token}'
```

### Folders

**Create a folder**
```bash
curl --request POST 'https://api.canva.com/rest/v1/folders' \
  --header 'Authorization: Bearer {token}' \
  --header 'Content-Type: application/json' \
  --data '{ "name": "Client deliverables", "parent_folder_id": "root" }'
```

**List folder items** (paginate via `continuation`; `brand_template` items only appear if explicitly requested in `item_types`)
```bash
curl 'https://api.canva.com/rest/v1/folders/{folderId}/items?item_types=design,folder,image' \
  --header 'Authorization: Bearer {token}'
```

---

## Async job pattern (the part that bites you)

Exports, asset uploads, and autofills all follow the same shape:
1. `POST` the create endpoint → returns `{ "job": { "id": "...", "status": "in_progress" } }`.
2. Poll the matching `GET .../{jobId}` endpoint on a short interval (e.g. 1–2s, backing off).
3. Stop when `status` is `success` (read the result — `design`, `asset`, or export `urls`) or `failed` (read the error).
4. **Export download URLs expire after 24 hours** — fetch the file promptly, don't store the URL.

---

## Rate limits

- Per-endpoint, per-user throttles apply (e.g. several write endpoints are limited to **20 requests/minute per user** of your integration). Read the specific endpoint page for its limit.
- **Exports** carry extra throttles:
  - Integration: **750 / 5-min** and **5,000 / 24-hr**.
  - Per document: **75 / 5-min**.
  - Per user: **75 / 5-min** and **500 / 24-hr**.
- Exceeding a limit returns **HTTP 429** — back off and retry after the window.

---

## Debugging notes

- **Check the `code`/`message` body on errors** — Canva returns structured error codes (e.g. `autofill_data_invalid`, `design_not_fillable`, `bad_request_params`, `not_found`), not just an HTTP status.
- **`401`** → expired/invalid access token. Refresh it (refresh tokens are single-use — save the new one).
- **`403` / missing-scope** → the token wasn't granted the scope the endpoint needs. Re-run the authorize step with the right `scope` list.
- **Autofill `design_not_fillable` / `autofill_data_invalid`** → your `data` keys don't match the template dataset, or the template has no fillable fields. Fetch `/brand-templates/{id}/dataset` first and mirror its keys/types exactly.
- **Autofill / brand-template content `403`** → the acting user isn't in a Canva Enterprise org (or the dev trial quota is spent).
- **Asset upload garbled name** → `name_base64` must be Base64-encoded, and the metadata goes in the `Asset-Upload-Metadata` *header*, not the body.
- **Brand template "not found" after Sept 2025** → you may be holding an old-format ID past the 6-month grace window. Re-list to get the current ID.
- **Stale export download** → URL older than 24h is dead; re-create the export job.

<!-- Append fixes here as you hit and solve real errors. This doc should get smarter every time the AIOS stumbles. -->
