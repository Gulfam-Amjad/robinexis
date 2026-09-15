import type http from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_CLIENT_ID, MemoryStore, SMITH_ENGLAND_ID, seedStore } from "@robinexis/database";
import { createCalcomOAuthState, encryptCalcomCredential, resolveCalcomTenantConnection } from "@robinexis/integrations";
import type { AuthenticatedActor } from "./auth.js";
import { completeCalcomOAuthCallback, handleProductRoute } from "./productRoutes.js";

const owner: AuthenticatedActor = {
  subject: "calendar_owner",
  email: "owner@example.test",
  role: "salon",
  clientRoles: { [DEMO_CLIENT_ID]: "owner" },
};

async function request(store: MemoryStore, actor: AuthenticatedActor, path: string, method = "GET", input?: unknown) {
  let status = 0;
  let body: any;
  await handleProductRoute({
    req: { method } as http.IncomingMessage,
    res: {} as http.ServerResponse,
    url: new URL(path, "http://localhost"),
    store,
    actor,
    readRaw: async () => Buffer.from(input === undefined ? "" : JSON.stringify(input)),
    send: (_res, code, value) => { status = code; body = value; },
  });
  return { status, body };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function callAt(mock: { mock: { calls: unknown[][] } }, index: number) {
  const [url, init] = (mock.mock.calls[index] || []) as [string, RequestInit];
  return {
    url: String(url),
    method: init?.method,
    headers: (init?.headers || {}) as Record<string, string>,
    body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body,
  };
}

describe("Cal.com dual tenant routes", () => {
  beforeEach(() => {
    vi.stubEnv("WEB_ORIGIN", "https://app.example.test");
    vi.stubEnv("CALCOM_OAUTH_CLIENT_ID", "oauth-client");
    vi.stubEnv("CALCOM_OAUTH_CLIENT_SECRET", "oauth-secret");
    vi.stubEnv("CALCOM_OAUTH_REDIRECT_URI", "https://api.example.test/oauth/calcom/callback");
    vi.stubEnv("CALCOM_OAUTH_STATE_SECRET", "state-secret");
    vi.stubEnv("CALCOM_CREDENTIAL_ENCRYPTION_KEY", "encryption-secret");
    vi.stubEnv("CALCOM_PLATFORM_CLIENT_ID", "platform-client");
    vi.stubEnv("CALCOM_PLATFORM_CLIENT_SECRET", "platform-secret");
    vi.stubEnv("CALCOM_PLATFORM_ORG_ID", "org_1");
    vi.stubEnv("CALCOM_OAUTH_REVOKE_URL", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("exchanges an OAuth callback into encrypted tenant credentials and never returns tokens", async () => {
    const store = new MemoryStore();
    await seedStore(store);
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({
        access_token: "plain-access",
        refresh_token: "plain-refresh",
        token_type: "bearer",
        expires_in: 1800,
        scope: "PROFILE_READ BOOKING_READ",
      }))
      .mockResolvedValueOnce(jsonResponse({ data: { id: 42, username: "demo-owner" } }));
    const state = createCalcomOAuthState({
      clientId: DEMO_CLIENT_ID,
      returnTo: "https://app.example.test/app/integrations",
    });

    await expect(completeCalcomOAuthCallback(store, { code: "code", state }))
      .resolves.toContain("calcom=connected");

    const tokenCall = callAt(fetchMock, 0);
    expect(tokenCall.url).toBe("https://api.cal.com/v2/auth/oauth2/token");
    expect(tokenCall.headers["Content-Type"]).toBe("application/json");
    expect(tokenCall.body).toEqual({
      client_id: "oauth-client",
      client_secret: "oauth-secret",
      grant_type: "authorization_code",
      code: "code",
      redirect_uri: "https://api.example.test/oauth/calcom/callback",
    });

    const connection = (await store.listCalendarConnections(DEMO_CLIENT_ID))[0]!;
    expect(connection).toMatchObject({ clientId: DEMO_CLIENT_ID, mode: "oauth", status: "active" });
    expect(connection.scopes).toEqual(["PROFILE_READ", "BOOKING_READ"]);
    expect(connection.encryptedAccessToken).not.toContain("plain-access");
    expect(JSON.stringify(await store.listProviderResources(DEMO_CLIENT_ID))).not.toContain("plain-access");
  });

  it("creates a managed user once with the documented request and returns only public status", async () => {
    const store = new MemoryStore();
    await seedStore(store);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({
      status: "success",
      data: {
        user: { id: 179, email: "demo@example.test", username: "demo-managed" },
        accessToken: "managed-access",
        refreshToken: "managed-refresh",
      },
    }, 201));

    const first = await request(store, owner, `/api/v1/clients/${DEMO_CLIENT_ID}/calendar-connection/managed`, "POST");
    const second = await request(store, owner, `/api/v1/clients/${DEMO_CLIENT_ID}/calendar-connection/managed`, "POST");

    expect(first).toMatchObject({ status: 201, body: { status: "active", mode: "managed" } });
    expect(second).toMatchObject({ status: 200, body: { idempotent: true } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(first.body)).not.toContain("managed-access");

    const call = callAt(fetchMock, 0);
    expect(call.url).toBe("https://api.cal.com/v2/oauth-clients/platform-client/users");
    expect(call.headers["x-cal-secret-key"]).toBe("platform-secret");
    expect(call.headers["x-cal-client-id"]).toBe("platform-client");
    expect(call.headers["x-cal-user-mode"]).toBe("managed");
    expect(call.headers.Authorization).toBeUndefined();
    expect(call.body).toEqual({
      email: "demo@robinexis.invalid",
      name: "Robinexis Demo",
      timeZone: "Europe/London",
    });

    const connection = (await store.listCalendarConnections(DEMO_CLIENT_ID))[0]!;
    expect(connection.metadata).toMatchObject({ externalUserId: "179", organizationId: "org_1" });
  });

  it("refreshes an expired managed token through the managed refresh endpoint", async () => {
    const store = new MemoryStore();
    await seedStore(store);
    const past = new Date(Date.now() - 60_000).toISOString();
    await store.upsertCalendarConnection({
      id: `calendar_${DEMO_CLIENT_ID}_primary`,
      clientId: DEMO_CLIENT_ID,
      provider: "calcom",
      externalAccountId: "demo-managed",
      mode: "managed",
      encryptedAccessToken: encryptCalcomCredential("stale-access"),
      encryptedRefreshToken: encryptCalcomCredential("managed-refresh"),
      accessTokenExpiresAt: past,
      status: "active",
      metadata: {},
      createdAt: past,
      updatedAt: past,
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({
      status: "success",
      data: { accessToken: "fresh-access", refreshToken: "fresh-refresh" },
    }));

    const client = (await store.getClient(DEMO_CLIENT_ID))!;
    const resolved = await resolveCalcomTenantConnection(store, client);

    expect(resolved.tenant.apiKey).toBe("fresh-access");
    const call = callAt(fetchMock, 0);
    expect(call.url).toBe("https://api.cal.com/v2/oauth/platform-client/refresh");
    expect(call.headers["x-cal-secret-key"]).toBe("platform-secret");
    expect(call.headers["x-cal-client-id"]).toBe("platform-client");
    expect(call.headers["x-cal-user-mode"]).toBe("managed");
    expect(call.body).toEqual({ refreshToken: "managed-refresh" });
  });

  it("disconnects locally without calling an unconfigured revocation endpoint", async () => {
    const store = new MemoryStore();
    await seedStore(store);
    const now = new Date().toISOString();
    await store.upsertCalendarConnection({
      id: `calendar_${DEMO_CLIENT_ID}_primary`,
      clientId: DEMO_CLIENT_ID,
      provider: "calcom",
      externalAccountId: "demo-owner",
      mode: "oauth",
      encryptedAccessToken: encryptCalcomCredential("live-access"),
      encryptedRefreshToken: encryptCalcomCredential("live-refresh"),
      accessTokenExpiresAt: new Date(Date.now() + 600_000).toISOString(),
      status: "active",
      metadata: {},
      createdAt: now,
      updatedAt: now,
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ ok: true }));

    const result = await request(store, owner, `/api/v1/clients/${DEMO_CLIENT_ID}/calendar-connection`, "DELETE");

    expect(result).toMatchObject({ status: 200, body: { status: "disabled", providerRevoked: false } });
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await store.listCalendarConnections(DEMO_CLIENT_ID))[0]).toMatchObject({
      status: "disabled",
      encryptedAccessToken: undefined,
      encryptedRefreshToken: undefined,
    });
  });

  it("best-effort revokes at a configured endpoint during disconnect", async () => {
    const store = new MemoryStore();
    await seedStore(store);
    vi.stubEnv("CALCOM_OAUTH_REVOKE_URL", "https://revoke.example.test/oauth/revoke");
    const now = new Date().toISOString();
    await store.upsertCalendarConnection({
      id: `calendar_${DEMO_CLIENT_ID}_primary`,
      clientId: DEMO_CLIENT_ID,
      provider: "calcom",
      externalAccountId: "demo-owner",
      mode: "oauth",
      encryptedAccessToken: encryptCalcomCredential("live-access"),
      accessTokenExpiresAt: new Date(Date.now() + 600_000).toISOString(),
      status: "active",
      metadata: {},
      createdAt: now,
      updatedAt: now,
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ ok: true }));

    const result = await request(store, owner, `/api/v1/clients/${DEMO_CLIENT_ID}/calendar-connection`, "DELETE");

    expect(result).toMatchObject({ status: 200, body: { status: "disabled", providerRevoked: true } });
    const call = callAt(fetchMock, 0);
    expect(call.url).toBe("https://revoke.example.test/oauth/revoke");
    expect(call.body).toEqual({
      token: "live-access",
      client_id: "oauth-client",
      client_secret: "oauth-secret",
    });
  });

  it("does not allow one tenant owner to inspect another tenant connection", async () => {
    const store = new MemoryStore();
    await seedStore(store);
    const result = await request(store, owner, `/api/v1/clients/${SMITH_ENGLAND_ID}/calendar-connection`);
    expect(result.status).toBe(404);
  });

  it("keeps active encrypted credentials while an OAuth reconnect is abandoned", async () => {
    const store = new MemoryStore();
    await seedStore(store);
    const timestamp = new Date().toISOString();
    await store.upsertCalendarConnection({
      id: `calendar_${DEMO_CLIENT_ID}_primary`,
      clientId: DEMO_CLIENT_ID,
      provider: "calcom",
      externalAccountId: "live-user",
      mode: "oauth",
      encryptedAccessToken: "ciphertext-access",
      encryptedRefreshToken: "ciphertext-refresh",
      status: "active",
      metadata: {},
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const result = await request(
      store,
      owner,
      `/api/v1/clients/${DEMO_CLIENT_ID}/calendar-connection/oauth/start`,
      "POST",
    );
    expect(result.status).toBe(200);
    expect((await store.listCalendarConnections(DEMO_CLIENT_ID))[0]).toMatchObject({
      status: "active",
      encryptedAccessToken: "ciphertext-access",
      encryptedRefreshToken: "ciphertext-refresh",
      metadata: { reconnectPendingAt: expect.any(String) },
    });
  });
});
