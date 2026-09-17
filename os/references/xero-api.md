# Xero Accounting API reference

> **STATUS: PLANNED — not yet active in the Sturdy Ai stack.** This doc is the *connection spec* for wiring Xero in. No live credentials exist yet; treat every example below as the blueprint for when the integration goes live. Mark this active in `connections.md` only once OAuth is connected and a token round-trip succeeds.

Endpoint reference for the Xero Accounting API. This is the *connection doc* for the bookkeeping tool in the Sturdy Ai stack — keep it current. When a call fails and you work out why, fix it here so the same mistake never happens twice.

> **Why API over an off-the-shelf connector:** the REST API gives you exact control over scopes (read-only by default) and which tenant you touch — non-negotiable when the data is the company's books. Use a managed connector only for write-heavy ops you've explicitly sanctioned.

**Every endpoint, path, scope, header and parameter below is verified against Xero's official OpenAPI 3.0 specification** (Accounting API v16.0.0 + Identity API v16.0.0) — the authoritative machine-readable source — cross-checked against the official developer docs. Sources:
- **Official OpenAPI — Accounting** (machine-readable, authoritative): https://raw.githubusercontent.com/XeroAPI/Xero-OpenAPI/master/xero_accounting.yaml
- **Official OpenAPI — Identity** (connections endpoint): https://raw.githubusercontent.com/XeroAPI/Xero-OpenAPI/master/xero-identity.yaml
- OpenAPI repo (file index): https://github.com/XeroAPI/Xero-OpenAPI
- Accounting API overview — https://developer.xero.com/documentation/api/accounting/overview
- OAuth2 auth-code flow — https://developer.xero.com/documentation/guides/oauth2/auth-flow/
- Scopes — https://developer.xero.com/documentation/guides/oauth2/scopes/
- API limits — https://developer.xero.com/documentation/guides/oauth2/limits/
- Tenants & connections — https://developer.xero.com/documentation/guides/oauth2/tenants/

---

## 🔑 Set up access (plain English — for the setup wizard)

Xero is a bit more involved (a one-off OAuth app) — I do the technical parts; you sign in and approve.

1. Go to **https://developer.xero.com** → **My Apps** → **New app** (web app).
2. Name it, add the redirect URL I give you, then copy the **Client ID** and **Client Secret**.
3. Paste both here — I'll wire it and run the sign-in.

*(Defaults to read-only — no writes to your books without your explicit go-ahead.)*

---

## ⚠️ SAFETY — READ THIS FIRST

**The AI account defaults to READ-ONLY. This is the rule, not a setting.**

- Request the **`.read` scopes only** (`accounting.contacts.read`, `accounting.transactions.read`, `accounting.reports.read`, `accounting.settings.read`). Never request the read-write scopes (`accounting.transactions`, `accounting.contacts`, `accounting.settings`) unless Joe has explicitly authorised a specific write workflow. *(The OpenAPI lists both the read-write and `.read` variant on every accounting operation — always pick the `.read` one.)*
- **Never auto-create an invoice. Never auto-pay or approve anything. Never reconcile a bank transaction.** These are money-moving actions — they require an explicit human in the loop, every time.
- A `POST`/`PUT` to Xero with a money side-effect is a hard stop: surface the drafted payload to Joe and wait for a clear go-ahead. No silent writes.
- The AI acts as a **dedicated Sturdy Ai app/user against a sandboxed or clearly-scoped org** — never against the live company books with broad permissions "to be safe".
- If a read scope returns 403, the fix is to widen *read* scope and re-consent — never to escalate to a write scope as a shortcut.

---

## Connection

| | |
|---|---|
| **Base URL** | `https://api.xero.com/api.xro/2.0` (Accounting API — confirmed `servers.url` in the OpenAPI) |
| **Method** | REST — `GET` for all reads below |
| **Auth** | OAuth 2.0, **authorization code flow** (`Authorization: Bearer <access_token>`) |
| **Tenant header** | `xero-tenant-id: <XERO_TENANT_ID>` — **required on every Accounting call** (OpenAPI `requiredHeader`, `required: true`); selects which connected org you hit |
| **Accept** | `Accept: application/json` (default response is XML — always send this header) |
| **Authorize URL** | `https://login.xero.com/identity/connect/authorize` (OpenAPI `flows.authorizationCode.authorizationUrl`) |
| **Token URL** | `https://identity.xero.com/connect/token` (OpenAPI `flows.authorizationCode.tokenUrl`) |
| **Connections URL** | `https://api.xero.com/Connections` (Identity OpenAPI `getConnections` — lists tenants your token can reach) |

**Env vars** (in `.env`, gitignored — never commit; secrets never go in a brain):
```
XERO_CLIENT_ID=        # from your app at developer.xero.com > My Apps (Auth Code grant type)
XERO_CLIENT_SECRET=    # same app; private, rotate if ever exposed
XERO_TENANT_ID=        # the connected org's tenantId (see "Find your tenant" below)
```
Access/refresh tokens are runtime artefacts — keep them in the OS keychain or a gitignored token store, **never** in source or a brain.

**Minimal request shape:**
```bash
curl https://api.xero.com/api.xro/2.0/Invoices \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "xero-tenant-id: $XERO_TENANT_ID" \
  -H "Accept: application/json"
```

---

## OAuth scopes (verified strings)

Exact scope strings from the OpenAPI `securitySchemes.OAuth2.flows.authorizationCode.scopes`. **Request only the read-only set:**

| Scope | Official description (from OpenAPI) | Covers |
|---|---|---|
| `openid` | Grant read-only access to your open id | identity |
| `profile` | your profile information | identity |
| `email` | Grant read-only access to your email | identity |
| `offline_access` | (issues a **refresh token** — auth-flow doc) | token refresh without re-consent |
| `accounting.transactions.read` | Grant read-only access to invoices | **Invoices, BankTransactions** |
| `accounting.contacts.read` | Grant read-only access to contacts and contact groups | **Contacts** |
| `accounting.settings.read` | Grant read-only access to organisation and account settings | **Accounts, Organisation** |
| `accounting.reports.read` | Grant read-only access to accounting reports | **Reports** (P&L, Balance Sheet, etc.) |
| `accounting.journals.read` | Grant read-only access to journals | Journals (if needed later) |
| `accounting.budgets.read` | Grant read-only access to read budgets | Budgets (if needed later) |

> **Scope gotcha confirmed in the spec:** `/Accounts` and `/Organisation` need **`accounting.settings.read`**, *not* `accounting.transactions.read`. Reading the chart of accounts but only requesting the transactions scope returns **403**. The per-endpoint scope is listed under each operation below.

The read-write counterparts (`accounting.transactions`, `accounting.contacts`, `accounting.settings`) exist in the spec but are **out of scope for this read-only doc** — do not request them.

---

## OAuth 2.0 flow (the part that bites you)

Standard authorization code flow (suitable because we hold a client secret server-side). In four steps:

**1. Send the user to authorize** (one-time consent, opens in a browser):
```
https://login.xero.com/identity/connect/authorize?
  response_type=code
  &client_id=$XERO_CLIENT_ID
  &redirect_uri=$REDIRECT_URI            # must match the app config exactly; must be HTTPS
  &scope=openid profile email accounting.transactions.read accounting.contacts.read accounting.settings.read accounting.reports.read offline_access
  &state=$RANDOM_STATE                   # CSRF guard; verify on return
```
- `scope` is a **space-separated** list (URL-encode the spaces). The set above is the **read-only** spread for everything this doc covers.
- `offline_access` is what gets you a **refresh token** — without it the access token dies in 30 minutes and you must re-consent. Always include it.
- `redirect_uri` **must be HTTPS**. For local testing `http://localhost/` is permitted; `http://127.0.0.1` is **not** (official auth-flow doc).

**2. Exchange the code for tokens** (`POST` to the token URL, HTTP Basic auth with client id/secret, form-encoded body):
```bash
curl -X POST https://identity.xero.com/connect/token \
  -u "$XERO_CLIENT_ID:$XERO_CLIENT_SECRET" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=authorization_code" \
  -d "code=$AUTH_CODE" \
  -d "redirect_uri=$REDIRECT_URI"
```
Response gives `access_token` (JWT), `refresh_token`, `id_token`, `expires_in`, and the granted `scope`. **Access tokens expire after 30 minutes; refresh tokens expire after 60 days** (official auth-flow doc).

**3. Find your tenant** — the access token isn't bound to an org; you pick one:
```bash
curl https://api.xero.com/Connections \
  -H "Authorization: Bearer $ACCESS_TOKEN" -H "Accept: application/json"
```
Returns an array of connected orgs, each with `id`, `tenantId`, `tenantName`, `tenantType` (e.g. `ORGANISATION`). Grab the `tenantId` you want → that's `XERO_TENANT_ID`. *(Identity OpenAPI `getConnections`. Note: the operation path is `/Connections` with a capital C; the official auth-flow doc also shows the lowercase form `https://api.xero.com/connections` — both resolve. Use the capital-C spec form.)*

**4. Refresh before expiry** (access token dies in 30 min — automate this):
```bash
curl -X POST https://identity.xero.com/connect/token \
  -u "$XERO_CLIENT_ID:$XERO_CLIENT_SECRET" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=refresh_token" \
  -d "refresh_token=$REFRESH_TOKEN"
```
**Refresh token rotation:** the refresh response returns a **new** `refresh_token` — persist it and discard the old one, or the next refresh fails. An unused refresh token expires after 60 days. This is the #1 silent-death cause for long-running routines. *(Token lifetimes — 30 min / 60 days — and the `offline_access` requirement are confirmed verbatim in the official auth-flow doc; the "new refresh token each rotation" behaviour is Xero's documented refresh-flow behaviour — confirm the exact wording in the official auth-flow / refresh-token doc when you wire it.)*

---

## Core objects (the mental model)

- **Organisation (tenant)** → identified by `tenantId`, passed as the `xero-tenant-id` header. One token can reach many tenants.
- **Contacts** — customers and suppliers. Each has a `ContactID` (UUID).
- **Accounts** — the chart of accounts (the ledger codes). Each has an `AccountID` and a `Code`.
- **Invoices** — sales (`Type: ACCREC`) and bills (`Type: ACCPAY`). Each has an `InvoiceID`, a `Status` (DRAFT/SUBMITTED/AUTHORISED/PAID/VOIDED), and `LineItems`.
- **BankTransactions** — spend/receive money entries (`Type: SPEND`/`RECEIVE`), tied to a bank `Account`.
- **Reports** — computed views (Profit & Loss, Balance Sheet, etc.), not stored objects. You request them with date params.
- IDs are **UUIDs** (`format: uuid` in the spec). Collection endpoints can return summaries (`summaryOnly=true`); fetch by ID for full detail (e.g. line items).

---

## Common operations (reads)

All Accounting calls assume the three standard headers (`Authorization`, `xero-tenant-id`, `Accept`). Base = `https://api.xero.com/api.xro/2.0`. Each block notes the **required read scope** and the **official query params** straight from the OpenAPI operation.

**Test the connection / list orgs** — *(Identity API, no tenant header)*
```
GET https://api.xero.com/Connections
```

**Get organisation details** — scope: `accounting.settings.read`
```
GET /Organisation
```
No query params in the spec.

**List invoices** — scope: `accounting.transactions.read`
```
GET /Invoices
```
Official query params (OpenAPI `getInvoices`): `where`, `order`, `IDs`, `InvoiceNumbers`, `ContactIDs`, `Statuses`, `page`, `includeArchived`, `createdByMyApp`, `unitdp`, `summaryOnly`, `pageSize`, `searchTerm`. Plus the `If-Modified-Since` **header**.
```
GET /Invoices?where=Status=="AUTHORISED"&&Type=="ACCREC"&order=Date DESC
GET /Invoices?Statuses=AUTHORISED,PAID&page=1&pageSize=100
GET /Invoices?searchTerm=REF12          # case-insensitive across InvoiceNumber, Reference
```
- `summaryOnly=true` returns a lightweight object (faster, omits heavy fields like line items).
- `pageSize` sets records per page (param is an integer; `page` selects the page).

**Get one invoice in full** — scope: `accounting.transactions.read` (line items only come back on a single-invoice fetch)
```
GET /Invoices/<INVOICE_ID>            # InvoiceID is format: uuid
```
Query param: `unitdp`.

**List contacts** — scope: `accounting.contacts.read`
```
GET /Contacts
GET /Contacts?where=IsCustomer==true&order=Name
```
Official query params (`getContacts`): `where`, `order`, `IDs`, `page`, `includeArchived`, `summaryOnly`, `searchTerm`, `pageSize`. Plus the `If-Modified-Since` header.

**Get one contact** — scope: `accounting.contacts.read`
```
GET /Contacts/<CONTACT_ID>           # ContactID is format: uuid
```

**List the chart of accounts** — scope: `accounting.settings.read`
```
GET /Accounts
GET /Accounts?where=Type=="BANK"&order=Name      # just the bank accounts
```
Official query params (`getAccounts`): `where`, `order`. Plus the `If-Modified-Since` header. **No `page` param — Accounts is not paginated.**

**List bank transactions** — scope: `accounting.transactions.read`
```
GET /BankTransactions?page=1
GET /BankTransactions?where=Type=="SPEND"&&Status=="AUTHORISED"&order=Date DESC
```
Official query params (`getBankTransactions`): `where`, `order`, `page`, `unitdp`, `pageSize`. Plus the `If-Modified-Since` header.

**Get one bank transaction in full** — scope: `accounting.transactions.read`
```
GET /BankTransactions/<BANKTRANSACTION_ID>      # format: uuid
```
Query param: `unitdp`.

**Profit & Loss report** — scope: `accounting.reports.read`
```
GET /Reports/ProfitAndLoss?fromDate=2026-01-01&toDate=2026-06-30
```
Official query params (`getReportProfitAndLoss`): `fromDate`, `toDate`, `periods`, `timeframe`, `trackingCategoryID`, `trackingCategoryID2`, `trackingOptionID`, `trackingOptionID2`, `standardLayout`, `paymentsOnly`. Dates are `format: date` → `YYYY-MM-DD`.

**Balance Sheet report** — scope: `accounting.reports.read`
```
GET /Reports/BalanceSheet?date=2026-06-30
```
Official query params (`getReportBalanceSheet`): `date`, `periods`, `timeframe`, `trackingOptionID1`, `trackingOptionID2`, `standardLayout`, `paymentsOnly`. *(Note: Balance Sheet uses a single `date`, not `fromDate`/`toDate`.)*

**Other read-only reports** (same `/Reports/<Name>` pattern, all scope `accounting.reports.read`):
```
GET /Reports/TrialBalance?date=2026-06-30                          # params: date, paymentsOnly
GET /Reports/BankSummary?fromDate=2026-01-01&toDate=2026-06-30     # params: fromDate, toDate
GET /Reports/AgedReceivablesByContact?contactId=<CONTACT_ID>&fromDate=2026-01-01&toDate=2026-06-30
GET /Reports/AgedPayablesByContact?contactId=<CONTACT_ID>&fromDate=2026-01-01&toDate=2026-06-30
GET /Reports/ExecutiveSummary?date=2026-06-30                      # param: date
```
`AgedReceivablesByContact` / `AgedPayablesByContact` official params: `contactId`, `date`, `fromDate`, `toDate`.

Reports come back as nested `Rows` (sections → rows → cells). Parse by row `RowType` (`Header`/`Section`/`Row`/`SummaryRow`), not by position.

---

## Filtering syntax (the `where` clause)

Xero's `where` is its own mini-language, not SQL. The spec's own examples use this syntax. Quirks that catch you:
- String equality uses **double `=`**: `Name=="Acme Ltd"` (OpenAPI example: `Status=="ACTIVE"`).
- UUIDs must be wrapped: `Contact.ContactID==guid("...")`.
- Dates in `where`: `DateTime(2026,06,01)` — commas, not slashes.
- Combine with `&&` / `||`; the whole clause is URL-encoded in the query string.
- Enums (Status, Type) are **UPPERCASE** strings in quotes: `Status=="PAID"`.
- For status filtering on Invoices you can also use the dedicated `Statuses` param (comma-separated) instead of `where`.

---

## Pagination

- **Invoices, Contacts, BankTransactions** support `?page=N` (+ optional `pageSize`). Keep incrementing `page` until you get an empty `<Resource>` array. There is no cursor.
- **Accounts and Organisation are not paginated** (no `page` param in the spec) — one call returns the lot.
- Summary endpoints can omit heavy fields when you pass `summaryOnly=true` (Invoices, Contacts); fetch by ID for the full object.
- Prefer the `If-Modified-Since` header + paging for incremental syncs rather than re-pulling everything. Header name and format per the OpenAPI: `If-Modified-Since: 2020-02-06T12:17:43.202-08:00`.

---

## Rate limits

Confirmed from the official limits doc (https://developer.xero.com/documentation/guides/oauth2/limits/):
- **Concurrent limit: 5** calls in progress at one time (per tenant).
- **Minute limit: 60** calls per minute (per tenant).
- **Daily limit: 1,000** calls per day on the **starter** tier; **5,000** calls per day on **higher tiers**. *(New apps default to starter — budget for 1,000/day until the app is on Core or above.)*
- **App minute limit: 10,000** calls per minute **across all tenants** (app-wide ceiling).
- Each org/practice can connect a maximum of **two uncertified apps** (no limit on certified apps).

When you hit a limit:
- You get **HTTP 429 (Too Many Requests)** with a **`Retry-After`** header (seconds) — pause requests to that tenant until then. Honour it; back off and retry, don't hammer.
- An **`X-Rate-Limit-Problem`** header tells you *which* limit you hit.
- Every response includes **`X-DayLimit-Remaining`**, **`X-MinLimit-Remaining`** and **`X-AppMinLimit-Remaining`** headers — watch these to throttle proactively.

---

## Debugging notes

- **Default response is XML.** If you're parsing garbage, you forgot `Accept: application/json`.
- **401** → access token expired (30-min life). Refresh it; don't re-run the whole auth flow.
- **403** → missing scope for that resource. Widen the **read** scope and re-consent — never escalate to a write scope. Classic case: reading `/Accounts` or `/Organisation` with only `accounting.transactions.read` (they need `accounting.settings.read`).
- **Missing the tenant header** → request fails. `xero-tenant-id` is `required: true` on *every* Accounting call.
- **Empty line items** → you read the collection endpoint; fetch the single resource by ID for full detail.
- **Refresh fails after working fine** → you didn't persist the rotated refresh token from the last refresh. Each refresh issues a new one.
- **429** → respect `Retry-After`; check `X-Rate-Limit-Problem` to see whether it was the minute (60), daily (1,000 starter / 5,000 higher), concurrent (5) or app-wide (10,000/min) limit.
- **Dates look wrong** → some payloads return `.NET` epoch dates (`/Date(1551399321121)/`, as seen in the OpenAPI examples); parse the millisecond timestamp, ignore the wrapper. Reports and filters, by contrast, take/return ISO `YYYY-MM-DD`.
- **Wrong report date param** → P&L and BankSummary use `fromDate`/`toDate`; Balance Sheet, Trial Balance and Executive Summary use a single `date`.

<!-- Append fixes here as you hit and solve real errors. This doc should get smarter every time the AIOS stumbles. -->
