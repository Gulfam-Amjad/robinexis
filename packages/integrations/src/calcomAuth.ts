import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import type { CalendarConnection, ClientConfig, PlatformStore } from "@robinexis/database";
import type { CalcomTenant } from "./calcom.js";

const AUTHORIZE_URL = process.env.CALCOM_OAUTH_AUTHORIZE_URL || "https://app.cal.com/auth/oauth2/authorize";
export function calcomApiBase(): string {
  return (process.env.CALCOM_API_BASE_URL || "https://api.cal.com/v2").replace(/\/+$/, "");
}

function tokenUrl(): string {
  return process.env.CALCOM_OAUTH_TOKEN_URL || `${calcomApiBase()}/auth/oauth2/token`;
}
/** Minimum scopes for profile, calendars, availability, event types and bookings. */
export const CALCOM_SCOPES = [
  "PROFILE_READ",
  "APPS_READ",
  "SCHEDULE_READ",
  "EVENT_TYPE_READ",
  "EVENT_TYPE_WRITE",
  "BOOKING_READ",
  "BOOKING_WRITE",
] as const;
/** Cal.com issues 30-minute OAuth access tokens and 60-minute managed-user tokens. */
const OAUTH_TOKEN_TTL_SECONDS = 1_800;
const MANAGED_TOKEN_TTL_SECONDS = 3_600;

export interface CalcomOAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  scope?: string;
}

function required(name: string): string {
  const value = process.env[name] || "";
  if (!value) throw new Error(`${name.toLowerCase()}_required`);
  return value;
}

function key(): Buffer {
  const raw = required("CALCOM_CREDENTIAL_ENCRYPTION_KEY");
  try {
    const decoded = Buffer.from(raw, "base64url");
    if (decoded.length === 32) return decoded;
  } catch {
    // Hashing remains a deterministic 256-bit key for non-base64 deployments.
  }
  return createHash("sha256").update(raw).digest();
}

export function encryptCalcomCredential(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptCalcomCredential(value: string): string {
  const [version, iv, tag, encrypted] = value.split(".");
  if (version !== "v1" || !iv || !tag || !encrypted) throw new Error("invalid_calcom_credential");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
}

export function createCalcomOAuthState(input: { clientId: string; returnTo: string; now?: Date }): string {
  const payload = Buffer.from(JSON.stringify({
    clientId: input.clientId,
    returnTo: input.returnTo,
    nonce: randomBytes(24).toString("base64url"),
    exp: Math.floor((input.now?.getTime() || Date.now()) / 1000) + 600,
  })).toString("base64url");
  const signature = createHmac("sha256", required("CALCOM_OAUTH_STATE_SECRET")).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyCalcomOAuthState(state: string, now = new Date()): { clientId: string; returnTo: string } {
  const [payload, signature] = state.split(".");
  if (!payload || !signature) throw new Error("invalid_calcom_oauth_state");
  const expected = createHmac("sha256", required("CALCOM_OAUTH_STATE_SECRET")).update(payload).digest();
  const actual = Buffer.from(signature, "base64url");
  if (
    expected.length !== actual.length ||
    actual.toString("base64url") !== signature ||
    !timingSafeEqual(expected, actual)
  ) throw new Error("invalid_calcom_oauth_state");
  const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
    clientId?: string; returnTo?: string; exp?: number;
  };
  if (!decoded.clientId || !decoded.returnTo || !decoded.exp || decoded.exp < now.getTime() / 1000) {
    throw new Error("expired_calcom_oauth_state");
  }
  return { clientId: decoded.clientId, returnTo: decoded.returnTo };
}

export function calcomOAuthAuthorizeUrl(state: string): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", required("CALCOM_OAUTH_CLIENT_ID"));
  url.searchParams.set("redirect_uri", required("CALCOM_OAUTH_REDIRECT_URI"));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", CALCOM_SCOPES.join(" "));
  url.searchParams.set("state", state);
  return url.toString();
}

async function oauthToken(params: Record<string, string>): Promise<CalcomOAuthTokens> {
  const response = await fetch(tokenUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: required("CALCOM_OAUTH_CLIENT_ID"),
      client_secret: required("CALCOM_OAUTH_CLIENT_SECRET"),
      ...params,
    }),
  });
  const body = await response.json() as Record<string, unknown>;
  if (!response.ok || !body.access_token) {
    throw new Error(`calcom_oauth_token_failed:${String(body.error || response.status)}`);
  }
  return {
    accessToken: String(body.access_token),
    refreshToken: body.refresh_token ? String(body.refresh_token) : undefined,
    expiresIn: Number(body.expires_in || OAUTH_TOKEN_TTL_SECONDS),
    scope: body.scope ? String(body.scope) : undefined,
  };
}

export function exchangeCalcomOAuthCode(code: string): Promise<CalcomOAuthTokens> {
  if (!code) throw new Error("calcom_oauth_code_required");
  return oauthToken({
    grant_type: "authorization_code",
    code,
    redirect_uri: required("CALCOM_OAUTH_REDIRECT_URI"),
  });
}

export function refreshCalcomOAuthToken(refreshToken: string): Promise<CalcomOAuthTokens> {
  return oauthToken({ grant_type: "refresh_token", refresh_token: refreshToken });
}

/**
 * Cal.com publishes no token-revocation endpoint, so disconnecting is local by
 * default. A revocation URL is only called when an operator configures one.
 */
export async function revokeCalcomOAuthToken(
  token: string,
): Promise<{ revoked: boolean; reason?: string }> {
  const endpoint = process.env.CALCOM_OAUTH_REVOKE_URL || "";
  if (!endpoint) return { revoked: false, reason: "revocation_endpoint_not_configured" };
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      token,
      client_id: required("CALCOM_OAUTH_CLIENT_ID"),
      client_secret: required("CALCOM_OAUTH_CLIENT_SECRET"),
    }),
  });
  if (!response.ok) return { revoked: false, reason: `calcom_oauth_revoke_failed:${response.status}` };
  return { revoked: true };
}

async function bearerJson(path: string, token: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(`${calcomApiBase()}${path}`, {
    ...init,
    headers: { Accept: "application/json", ...init?.headers, Authorization: `Bearer ${token}` },
  });
  const body = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(`calcom_api_failed:${response.status}`);
  return body;
}

export async function fetchCalcomIdentity(accessToken: string): Promise<{ id: string; username: string }> {
  const body = await bearerJson("/me", accessToken, { headers: { "cal-api-version": "2024-06-11" } });
  const data = (body.data || {}) as Record<string, unknown>;
  const id = String(data.id || data.email || "");
  const username = String(data.username || data.email || "");
  if (!id || !username) throw new Error("calcom_identity_missing");
  return { id, username };
}

export async function listCalcomDestinationCalendars(
  accessToken: string,
): Promise<Array<{ id: string; name: string; provider?: string }>> {
  const body = await bearerJson("/calendars", accessToken, { headers: { "cal-api-version": "2024-06-11" } });
  const data = Array.isArray(body.data) ? body.data : [];
  return data.map((item) => {
    const row = item as Record<string, unknown>;
    return {
      id: String(row.externalId || row.id || ""),
      name: String(row.name || row.externalId || row.id || "Calendar"),
      provider: row.integration ? String(row.integration) : undefined,
    };
  }).filter((item) => item.id);
}

export interface ManagedCalcomUser {
  externalAccountId: string;
  username: string;
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  organizationId?: string;
}

/** Platform managed user creation. Authenticates with the OAuth client secret header. */
export async function createManagedCalcomUser(input: {
  clientId: string;
  email: string;
  name: string;
  timeZone: string;
}): Promise<ManagedCalcomUser> {
  const platformClientId = required("CALCOM_PLATFORM_CLIENT_ID");
  const response = await fetch(`${calcomApiBase()}/oauth-clients/${encodeURIComponent(platformClientId)}/users`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "x-cal-secret-key": required("CALCOM_PLATFORM_CLIENT_SECRET"),
      "x-cal-client-id": platformClientId,
      "x-cal-user-mode": "managed",
    },
    body: JSON.stringify({
      email: input.email,
      name: input.name,
      timeZone: input.timeZone,
    }),
  });
  const body = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(`calcom_managed_user_failed:${String(body.error || response.status)}`);
  const data = (body.data || {}) as Record<string, unknown>;
  const user = (data.user || {}) as Record<string, unknown>;
  const accessToken = String(data.accessToken || "");
  if (!accessToken || !user.id) throw new Error("calcom_managed_user_token_missing");
  return {
    externalAccountId: String(user.id),
    username: String(user.username || user.email || input.email),
    accessToken,
    refreshToken: String(data.refreshToken || "") || undefined,
    expiresIn: MANAGED_TOKEN_TTL_SECONDS,
    organizationId: process.env.CALCOM_PLATFORM_ORG_ID || undefined,
  };
}

/** Managed-user tokens rotate through the OAuth client's own refresh endpoint. */
export async function refreshManagedCalcomUserToken(refreshToken: string): Promise<CalcomOAuthTokens> {
  const platformClientId = required("CALCOM_PLATFORM_CLIENT_ID");
  const response = await fetch(`${calcomApiBase()}/oauth/${encodeURIComponent(platformClientId)}/refresh`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "x-cal-secret-key": required("CALCOM_PLATFORM_CLIENT_SECRET"),
      "x-cal-client-id": platformClientId,
      "x-cal-user-mode": "managed",
    },
    body: JSON.stringify({ refreshToken }),
  });
  const body = await response.json() as Record<string, unknown>;
  const data = (body.data || {}) as Record<string, unknown>;
  if (!response.ok || !data.accessToken) {
    throw new Error(`calcom_managed_refresh_failed:${String(body.error || response.status)}`);
  }
  return {
    accessToken: String(data.accessToken),
    refreshToken: String(data.refreshToken || "") || undefined,
    expiresIn: MANAGED_TOKEN_TTL_SECONDS,
  };
}

/**
 * Cal.com refuses OAuth clients and managed users unless the organisation is on
 * the Platform plan, so both per-tenant credential modes are unavailable until
 * that is bought. Reported to the UI so it never offers a button that 403s.
 */
export function calcomPlatformConfigured(): boolean {
  return Boolean(
    process.env.CALCOM_PLATFORM_CLIENT_ID &&
    process.env.CALCOM_PLATFORM_CLIENT_SECRET &&
    (process.env.CALCOM_PLATFORM_ORG_ID || process.env.CALCOM_PLATFORM_ORGANIZATION_ID),
  );
}

export function calcomOAuthConfigured(): boolean {
  return Boolean(process.env.CALCOM_OAUTH_CLIENT_ID && process.env.CALCOM_OAUTH_CLIENT_SECRET);
}

/**
 * Shared mode books every tenant through the Robinexis Cal.com account. Tenants
 * stay separated by prefixed event type slugs and the per-tenant mapping rather
 * than by credential, so it is opt-in and must be turned off once Platform is
 * available.
 */
export function calcomSharedAccountEnabled(): boolean {
  return process.env.CALCOM_SHARED_ACCOUNT_ENABLED === "true" && Boolean(process.env.CALCOM_API_KEY);
}

export function calcomConnectionModes(): { oauth: boolean; managed: boolean; shared: boolean } {
  return {
    oauth: calcomOAuthConfigured(),
    managed: calcomPlatformConfigured(),
    shared: calcomSharedAccountEnabled(),
  };
}

export async function resolveCalcomTenantConnection(
  store: PlatformStore,
  client: ClientConfig,
  now = new Date(),
): Promise<{ tenant: CalcomTenant; connection: CalendarConnection }> {
  const connections = await store.listCalendarConnections(client.id);
  const connection = connections.find((item) => item.provider === "calcom" && item.status === "active");
  // The shared key is a permanent compatibility exception for Blades only. Their
  // connection row predates OAuth and holds no encrypted token, so the exception
  // has to survive both a missing row and a tokenless one.
  const sharedKeyTenant = client.slug === "blades-hair" && client.calendar.credentialRef === "CALCOM_API_KEY";
  if (!connection) {
    if (sharedKeyTenant) {
      return {
        tenant: { apiKey: process.env.CALCOM_API_KEY || "", username: client.calendar.username || process.env.CALCOM_USERNAME || "" },
        connection: connections.find((item) => item.provider === "calcom") || {
          id: `calendar_${client.id}_legacy`, clientId: client.id, provider: "calcom",
          credentialRef: "CALCOM_API_KEY", status: "active", metadata: { legacy: true },
          createdAt: now.toISOString(), updatedAt: now.toISOString(),
        },
      };
    }
    throw new Error("tenant_calendar_connection_required");
  }
  if (!connection.encryptedAccessToken) {
    if (connection.mode === "shared") {
      if (!calcomSharedAccountEnabled()) throw new Error("calcom_shared_account_disabled");
      return {
        tenant: {
          apiKey: process.env.CALCOM_API_KEY || "",
          username: process.env.CALCOM_USERNAME || "",
        },
        connection,
      };
    }
    if (!sharedKeyTenant) throw new Error("tenant_calendar_credential_required");
    return {
      tenant: {
        apiKey: process.env.CALCOM_API_KEY || "",
        username: client.calendar.username || process.env.CALCOM_USERNAME || "",
      },
      connection,
    };
  }
  let accessToken = decryptCalcomCredential(connection.encryptedAccessToken);
  if (connection.accessTokenExpiresAt && Date.parse(connection.accessTokenExpiresAt) <= now.getTime() + 60_000) {
    if (!connection.encryptedRefreshToken) throw new Error("calcom_reconnect_required");
    const storedRefreshToken = decryptCalcomCredential(connection.encryptedRefreshToken);
    const refreshed = connection.mode === "managed"
      ? await refreshManagedCalcomUserToken(storedRefreshToken)
      : await refreshCalcomOAuthToken(storedRefreshToken);
    accessToken = refreshed.accessToken;
    connection.encryptedAccessToken = encryptCalcomCredential(refreshed.accessToken);
    if (refreshed.refreshToken) connection.encryptedRefreshToken = encryptCalcomCredential(refreshed.refreshToken);
    connection.accessTokenExpiresAt = new Date(now.getTime() + refreshed.expiresIn * 1000).toISOString();
    connection.updatedAt = now.toISOString();
    await store.upsertCalendarConnection(connection);
  }
  return {
    tenant: {
      apiKey: accessToken,
      username: connection.externalAccountId || client.calendar.username || "",
      mode: connection.mode,
      clientId: connection.mode === "managed" ? required("CALCOM_PLATFORM_CLIENT_ID") : undefined,
    },
    connection,
  };
}
