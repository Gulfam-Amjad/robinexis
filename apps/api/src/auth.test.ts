import type http from "node:http";
import { createServer } from "node:http";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryStore } from "@robinexis/database";
import {
  authenticateRequest,
  requireAdmin,
  requireTenantAccess,
  requireTenantWrite,
} from "./auth.js";

const original = {
  NODE_ENV: process.env.NODE_ENV,
  RAILWAY_ENVIRONMENT: process.env.RAILWAY_ENVIRONMENT,
  SKIP_AUTH: process.env.SKIP_AUTH,
  ALLOW_INSECURE_SKIP_AUTH: process.env.ALLOW_INSECURE_SKIP_AUTH,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_JWT_SECRET: process.env.SUPABASE_JWT_SECRET,
};

afterEach(() => {
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("production authentication", () => {
  it("cannot be bypassed by environment flags", async () => {
    process.env.NODE_ENV = "production";
    process.env.SKIP_AUTH = "true";
    process.env.ALLOW_INSECURE_SKIP_AUTH = "true";
    const request = {
      headers: {},
    } as http.IncomingMessage;

    await expect(authenticateRequest(request, new MemoryStore())).resolves.toBeUndefined();
  });

  it("maps a Supabase subject through the normalized client profile", async () => {
    process.env.NODE_ENV = "test";
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_JWT_SECRET = "test-secret-at-least-32-characters";
    delete process.env.SKIP_AUTH;
    const token = await new SignJWT({ email: "owner@example.test" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("auth-client")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET));
    const store = new MemoryStore();
    await store.upsertUserProfile({
      id: "profile-client",
      authUserId: "auth-client",
      email: "owner@example.test",
      platformRole: "client",
      clientId: "client-a",
      workspaceRole: "owner",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const request = {
      headers: { authorization: `Bearer ${token}` },
    } as http.IncomingMessage;

    await expect(authenticateRequest(request, store)).resolves.toMatchObject({
      role: "salon",
      clientRoles: { "client-a": "owner" },
    });
  });

  it("keeps a verified but unassigned signup outside every tenant and admin boundary", async () => {
    process.env.NODE_ENV = "test";
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_JWT_SECRET = "test-secret-at-least-32-characters";
    delete process.env.SKIP_AUTH;
    const token = await new SignJWT({ email: "new-signup@example.test" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("auth-pending")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET));
    const request = {
      headers: { authorization: `Bearer ${token}` },
    } as http.IncomingMessage;

    const actor = await authenticateRequest(request, new MemoryStore());
    expect(actor).toMatchObject({ role: "pending", clientRoles: {} });
    expect(requireAdmin(actor!)).toBe(false);
    expect(requireTenantAccess(actor!, "client-a")).toBe(false);
    expect(requireTenantWrite(actor!, "client-a")).toBe(false);
  });

  it("verifies current Supabase ES256 tokens through JWKS even when a legacy secret remains configured", async () => {
    const { publicKey, privateKey } = await generateKeyPair("ES256");
    const publicJwk = await exportJWK(publicKey);
    Object.assign(publicJwk, { alg: "ES256", kid: "current-signing-key", use: "sig" });
    const jwks = createServer((request, response) => {
      if (request.url === "/auth/v1/.well-known/jwks.json") {
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ keys: [publicJwk] }));
        return;
      }
      response.statusCode = 404;
      response.end();
    });
    await new Promise<void>((resolve) => jwks.listen(0, "127.0.0.1", resolve));
    try {
      const address = jwks.address();
      if (!address || typeof address === "string") throw new Error("JWKS test server did not start");
      process.env.NODE_ENV = "test";
      process.env.SUPABASE_URL = `http://127.0.0.1:${address.port}`;
      process.env.SUPABASE_JWT_SECRET = "legacy-secret-that-must-not-verify-es256";
      delete process.env.SKIP_AUTH;
      const token = await new SignJWT({ email: "google-user@example.test" })
        .setProtectedHeader({ alg: "ES256", kid: "current-signing-key" })
        .setSubject("google-auth-user")
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(privateKey);
      const request = {
        headers: { authorization: `Bearer ${token}` },
      } as http.IncomingMessage;

      await expect(authenticateRequest(request, new MemoryStore())).resolves.toMatchObject({
        role: "pending",
        email: "google-user@example.test",
      });
    } finally {
      await new Promise<void>((resolve, reject) => jwks.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("centralizes admin, tenant-read, and tenant-write decisions", () => {
    const viewer = {
      subject: "viewer",
      email: "viewer@example.test",
      role: "salon" as const,
      clientRoles: { "client-a": "viewer" as const },
    };
    expect(requireAdmin(viewer)).toBe(false);
    expect(requireTenantAccess(viewer, "client-a")).toBe(true);
    expect(requireTenantWrite(viewer, "client-a")).toBe(false);
    expect(requireTenantAccess(viewer, "client-b")).toBe(false);
  });
});
