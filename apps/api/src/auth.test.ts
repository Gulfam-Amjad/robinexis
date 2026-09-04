import type http from "node:http";
import { SignJWT } from "jose";
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
