import type http from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEMO_CLIENT_ID, MemoryStore, seedStore } from "@robinexis/database";
import type { AuthenticatedActor } from "./auth.js";
import { handleProductRoute } from "./productRoutes.js";

const owner: AuthenticatedActor = {
  subject: "twilio_owner",
  email: "owner@example.test",
  role: "salon",
  clientRoles: { [DEMO_CLIENT_ID]: "owner" },
};

async function request(store: MemoryStore, path: string, method = "GET", input?: unknown) {
  let status = 0;
  let body: any;
  await handleProductRoute({
    req: { method } as http.IncomingMessage,
    res: {} as http.ServerResponse,
    url: new URL(path, "http://localhost"),
    store,
    actor: owner,
    readRaw: async () => Buffer.from(input === undefined ? "" : JSON.stringify(input)),
    send: (_res, code, value) => { status = code; body = value; },
  });
  return { status, body };
}

beforeEach(() => {
  process.env.WEB_ORIGIN = "https://app.example.test";
  process.env.TWILIO_OAUTH_CLIENT_ID = "oauth-client";
  process.env.TWILIO_OAUTH_REDIRECT_URI = "https://api.example.test/oauth/twilio/callback";
  process.env.TWILIO_OAUTH_STATE_SECRET = "state-secret";
});

afterEach(() => {
  for (const key of [
    "TWILIO_MANAGED_PROVISIONING_ENABLED",
    "WEB_ORIGIN",
    "TWILIO_OAUTH_CLIENT_ID",
    "TWILIO_OAUTH_REDIRECT_URI",
    "TWILIO_OAUTH_STATE_SECRET",
  ]) delete process.env[key];
});

describe("Twilio hybrid API", () => {
  it("returns only redacted customer connection status and preserves revoked records", async () => {
    const store = new MemoryStore();
    await seedStore(store);
    const now = new Date().toISOString();
    await store.upsertTwilioConnection({
      id: "twilio_connection_test",
      clientId: DEMO_CLIENT_ID,
      mode: "customer_oauth",
      accountSid: "AC1234567890abcdef",
      encryptedAccessToken: "encrypted-access",
      encryptedRefreshToken: "encrypted-refresh",
      apiKeySid: "SK1234567890abcdef1234567890abcdef",
      encryptedApiKeySecret: "encrypted-api-secret",
      encryptedAccountAuthToken: "encrypted-account-auth-token",
      selectedPhoneNumber: "+442079460123",
      status: "active",
      metadata: { verifiedPhoneNumber: "+442079460123" },
      createdAt: now,
      updatedAt: now,
    });

    const visible = await request(store, `/api/v1/clients/${DEMO_CLIENT_ID}/twilio-connection`);
    expect(visible).toMatchObject({
      status: 200,
      body: {
        status: "active",
        accountSidMasked: "AC12…cdef",
        verifiedPhoneNumber: "+442079460123",
        canReconnect: false,
      },
    });
    expect(JSON.stringify(visible.body)).not.toContain("encrypted");

    const revoked = await request(store, `/api/v1/clients/${DEMO_CLIENT_ID}/twilio-connection`, "DELETE");
    expect(revoked).toMatchObject({ status: 200, body: { status: "revoked" } });
    expect(await store.getTwilioConnection(DEMO_CLIENT_ID)).toMatchObject({
      status: "revoked",
      encryptedAccessToken: undefined,
      encryptedApiKeySecret: undefined,
      encryptedAccountAuthToken: undefined,
    });
  });

  it("blocks managed provisioning before any provider setup when the flag is disabled", async () => {
    const store = new MemoryStore();
    await seedStore(store);
    const result = await request(
      store,
      `/api/v1/clients/${DEMO_CLIENT_ID}/twilio-connection/managed`,
      "POST",
      { operationKey: "disabled-test", countryCode: "GB" },
    );
    expect(result).toMatchObject({
      status: 503,
      body: { error: "twilio_managed_provisioning_disabled" },
    });
    expect(await store.listProviderResources(DEMO_CLIENT_ID)).toEqual([]);
  });

  it("denies another tenant from claiming an existing number", async () => {
    const store = new MemoryStore();
    await seedStore(store);
    const now = new Date().toISOString();
    await store.upsertPhoneEndpoint({
      id: "phone_existing",
      clientId: DEMO_CLIENT_ID,
      provider: "twilio",
      e164: "+442079460123",
      direction: "inbound",
      status: "active",
      metadata: {},
      createdAt: now,
      updatedAt: now,
    });
    const other = { ...(await store.getClient("client_smith_england"))!, id: "client_other", slug: "other" };
    await store.upsertClient(other);
    await expect(store.upsertPhoneEndpoint({
      id: "phone_other",
      clientId: other.id,
      provider: "twilio",
      e164: "+442079460123",
      direction: "inbound",
      status: "active",
      metadata: {},
      createdAt: now,
      updatedAt: now,
    })).rejects.toThrow("phone_number_claimed_by_another_tenant");
  });

  it("keeps active encrypted credentials while an OAuth reconnect is abandoned", async () => {
    const store = new MemoryStore();
    await seedStore(store);
    const now = new Date().toISOString();
    await store.upsertTwilioConnection({
      id: "twilio_reconnect",
      clientId: DEMO_CLIENT_ID,
      mode: "customer_oauth",
      accountSid: "AC1234567890abcdef",
      encryptedAccessToken: "ciphertext-access",
      encryptedRefreshToken: "ciphertext-refresh",
      apiKeySid: "SK1234567890abcdef1234567890abcdef",
      encryptedApiKeySecret: "ciphertext-api-secret",
      encryptedAccountAuthToken: "ciphertext-account-auth-token",
      selectedPhoneNumber: "+442079460123",
      status: "active",
      metadata: {},
      createdAt: now,
      updatedAt: now,
    });
    const result = await request(
      store,
      `/api/v1/clients/${DEMO_CLIENT_ID}/twilio-connection/start`,
      "POST",
    );
    expect(result.status).toBe(200);
    expect(await store.getTwilioConnection(DEMO_CLIENT_ID)).toMatchObject({
      status: "active",
      encryptedAccessToken: "ciphertext-access",
      encryptedRefreshToken: "ciphertext-refresh",
      encryptedApiKeySecret: "ciphertext-api-secret",
      encryptedAccountAuthToken: "ciphertext-account-auth-token",
      metadata: { reconnectPendingAt: expect.any(String) },
    });
  });
});

