import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CALCOM_SCOPES,
  calcomOAuthAuthorizeUrl,
  createCalcomOAuthState,
  createManagedCalcomUser,
  decryptCalcomCredential,
  encryptCalcomCredential,
  exchangeCalcomOAuthCode,
  refreshCalcomOAuthToken,
  refreshManagedCalcomUserToken,
  revokeCalcomOAuthToken,
  verifyCalcomOAuthState,
} from "./calcomAuth.js";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Reads one recorded fetch call as { url, method, headers, body }. */
function callAt(mock: { mock: { calls: unknown[][] } }, index: number) {
  const [url, init] = (mock.mock.calls[index] || []) as [string, RequestInit];
  return {
    url: String(url),
    method: init.method,
    headers: init.headers as Record<string, string>,
    body: typeof init.body === "string" ? JSON.parse(init.body) : init.body,
  };
}

describe("Cal.com dual connection security", () => {
  beforeEach(() => {
    vi.stubEnv("CALCOM_OAUTH_CLIENT_ID", "oauth-client");
    vi.stubEnv("CALCOM_OAUTH_CLIENT_SECRET", "oauth-secret");
    vi.stubEnv("CALCOM_OAUTH_REDIRECT_URI", "https://api.example.test/oauth/calcom/callback");
    vi.stubEnv("CALCOM_OAUTH_STATE_SECRET", "state-secret-with-sufficient-entropy");
    vi.stubEnv("CALCOM_CREDENTIAL_ENCRYPTION_KEY", "credential-secret-with-sufficient-entropy");
    vi.stubEnv("CALCOM_PLATFORM_CLIENT_ID", "platform-client");
    vi.stubEnv("CALCOM_PLATFORM_CLIENT_SECRET", "platform-secret");
    vi.stubEnv("CALCOM_PLATFORM_ORG_ID", "org_1");
    vi.stubEnv("CALCOM_OAUTH_REVOKE_URL", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("signs short-lived tenant state and rejects tampering", () => {
    const state = createCalcomOAuthState({
      clientId: "client_a",
      returnTo: "https://app.example.test/app/integrations",
      now: new Date("2026-09-15T10:00:00Z"),
    });
    expect(verifyCalcomOAuthState(state, new Date("2026-09-15T10:05:00Z"))).toEqual({
      clientId: "client_a",
      returnTo: "https://app.example.test/app/integrations",
    });
    expect(() => verifyCalcomOAuthState(`${state.slice(0, -1)}x`)).toThrow("invalid_calcom_oauth_state");
    expect(() => verifyCalcomOAuthState(state, new Date("2026-09-15T10:11:00Z"))).toThrow("expired_calcom_oauth_state");
  });

  it("requests the documented authorize URL with current minimal scope names", () => {
    const state = createCalcomOAuthState({ clientId: "client_a", returnTo: "https://app.example.test" });
    const url = new URL(calcomOAuthAuthorizeUrl(state));

    expect(`${url.origin}${url.pathname}`).toBe("https://app.cal.com/auth/oauth2/authorize");
    expect(url.searchParams.get("scope")?.split(" ")).toEqual([
      "PROFILE_READ",
      "APPS_READ",
      "SCHEDULE_READ",
      "EVENT_TYPE_READ",
      "EVENT_TYPE_WRITE",
      "BOOKING_READ",
      "BOOKING_WRITE",
    ]);
    expect(CALCOM_SCOPES).not.toContain("READ_BOOKING");
    expect(url.searchParams.get("client_id")).toBe("oauth-client");
    expect(url.searchParams.get("redirect_uri")).toBe("https://api.example.test/oauth/calcom/callback");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("state")).toBe(state);
  });

  it("encrypts credentials with authenticated random nonces", () => {
    const first = encryptCalcomCredential("access-token");
    const second = encryptCalcomCredential("access-token");
    expect(first).not.toBe(second);
    expect(decryptCalcomCredential(first)).toBe("access-token");
    expect(() => decryptCalcomCredential(`${first.slice(0, -1)}x`)).toThrow();
  });

  it("exchanges the authorization code against POST /v2/auth/oauth2/token", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({
      access_token: "access-1",
      refresh_token: "refresh-1",
      token_type: "bearer",
      expires_in: 1800,
      scope: "PROFILE_READ BOOKING_READ",
    }));

    await expect(exchangeCalcomOAuthCode("code-1")).resolves.toEqual({
      accessToken: "access-1",
      refreshToken: "refresh-1",
      expiresIn: 1800,
      scope: "PROFILE_READ BOOKING_READ",
    });

    const call = callAt(fetchMock, 0);
    expect(call.url).toBe("https://api.cal.com/v2/auth/oauth2/token");
    expect(call.method).toBe("POST");
    expect(call.headers["Content-Type"]).toBe("application/json");
    expect(call.body).toEqual({
      client_id: "oauth-client",
      client_secret: "oauth-secret",
      grant_type: "authorization_code",
      code: "code-1",
      redirect_uri: "https://api.example.test/oauth/calcom/callback",
    });
  });

  it("refreshes OAuth tokens against the same documented token endpoint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({
      access_token: "access-2",
      refresh_token: "refresh-2",
      token_type: "bearer",
      expires_in: 1800,
    }));

    await expect(refreshCalcomOAuthToken("refresh-1")).resolves.toMatchObject({ accessToken: "access-2" });

    const call = callAt(fetchMock, 0);
    expect(call.url).toBe("https://api.cal.com/v2/auth/oauth2/token");
    expect(call.body).toEqual({
      client_id: "oauth-client",
      client_secret: "oauth-secret",
      grant_type: "refresh_token",
      refresh_token: "refresh-1",
    });
  });

  it("creates a Platform managed user with the x-cal-secret-key header and quickstart payload", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({
      status: "success",
      data: {
        user: { id: 179, email: "owner@example.test", username: "salon" },
        accessToken: "managed-access",
        refreshToken: "managed-refresh",
      },
    }, 201));

    await expect(createManagedCalcomUser({
      clientId: "client_a",
      email: "owner@example.test",
      name: "Salon",
      timeZone: "Europe/London",
    })).resolves.toEqual({
      externalAccountId: "179",
      username: "salon",
      accessToken: "managed-access",
      refreshToken: "managed-refresh",
      expiresIn: 3600,
      organizationId: "org_1",
    });

    const call = callAt(fetchMock, 0);
    expect(call.url).toBe("https://api.cal.com/v2/oauth-clients/platform-client/users");
    expect(call.method).toBe("POST");
    expect(call.headers["x-cal-secret-key"]).toBe("platform-secret");
    expect(call.headers["x-cal-client-id"]).toBe("platform-client");
    expect(call.headers["x-cal-user-mode"]).toBe("managed");
    expect(call.headers.Authorization).toBeUndefined();
    expect(call.body).toEqual({
      email: "owner@example.test",
      name: "Salon",
      timeZone: "Europe/London",
    });
  });

  it("refreshes managed-user tokens through the OAuth client refresh endpoint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({
      status: "success",
      data: { accessToken: "managed-access-2", refreshToken: "managed-refresh-2" },
    }));

    await expect(refreshManagedCalcomUserToken("managed-refresh")).resolves.toEqual({
      accessToken: "managed-access-2",
      refreshToken: "managed-refresh-2",
      expiresIn: 3600,
    });

    const call = callAt(fetchMock, 0);
    expect(call.url).toBe("https://api.cal.com/v2/oauth/platform-client/refresh");
    expect(call.method).toBe("POST");
    expect(call.headers["x-cal-secret-key"]).toBe("platform-secret");
    expect(call.headers["x-cal-client-id"]).toBe("platform-client");
    expect(call.headers["x-cal-user-mode"]).toBe("managed");
    expect(call.body).toEqual({ refreshToken: "managed-refresh" });
  });

  it("never invents a revocation endpoint and only calls a configured one", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ ok: true }));

    await expect(revokeCalcomOAuthToken("access-1")).resolves.toEqual({
      revoked: false,
      reason: "revocation_endpoint_not_configured",
    });
    expect(fetchMock).not.toHaveBeenCalled();

    vi.stubEnv("CALCOM_OAUTH_REVOKE_URL", "https://revoke.example.test/oauth/revoke");
    await expect(revokeCalcomOAuthToken("access-1")).resolves.toEqual({ revoked: true });

    const call = callAt(fetchMock, 0);
    expect(call.url).toBe("https://revoke.example.test/oauth/revoke");
    expect(call.body).toEqual({
      token: "access-1",
      client_id: "oauth-client",
      client_secret: "oauth-secret",
    });
  });

  it("reports a configured revocation failure without throwing", async () => {
    vi.stubEnv("CALCOM_OAUTH_REVOKE_URL", "https://revoke.example.test/oauth/revoke");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ error: "nope" }, 404));

    await expect(revokeCalcomOAuthToken("access-1")).resolves.toEqual({
      revoked: false,
      reason: "calcom_oauth_revoke_failed:404",
    });
  });
});
