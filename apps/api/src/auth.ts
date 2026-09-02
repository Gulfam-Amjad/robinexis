import { createRemoteJWKSet, jwtVerify } from "jose";
import type http from "node:http";
import {
  isProductionRuntime,
  loadDatabaseEnv,
  type PlatformStore,
  type WorkspaceRole,
} from "@robinexis/database";

loadDatabaseEnv();

const allowedOrigins = (process.env.WEB_ORIGIN || "http://localhost:5173")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const adminEmails = (process.env.ADMIN_EMAILS || "gulfamamjad633@gmail.com")
  .split(",")
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);

function skipAuthEnabled() {
  if (process.env.SKIP_AUTH !== "true") return false;
  if (!isProductionRuntime()) return true;
  // Testing only. Anyone who can load the Vercel URL can mutate production data.
  return process.env.ALLOW_INSECURE_SKIP_AUTH === "true";
}

export function corsHeaders(origin: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Expose-Headers": "X-Request-Id",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  // Never advertise an allowed origin for a different/unknown caller.
  if (origin && allowedOrigins.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

export function applyCors(req: http.IncomingMessage, res: http.ServerResponse) {
  const headers = corsHeaders(req.headers.origin);
  for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
}

export function describeAuthMode(): string {
  if (skipAuthEnabled()) return "SKIP_AUTH — local testing, /api/v1 is open";
  if (process.env.SUPABASE_URL) return "Supabase JWT required; operator allowlist or workspace membership";
  if (process.env.ADMIN_API_KEY) return "ADMIN_API_KEY required on /api/v1";
  if (isProductionRuntime()) return "production auth misconfigured — /api/v1 will reject every request";
  return "no auth configured — /api/v1 is open outside production";
}

function bearer(req: http.IncomingMessage) {
  const header = req.headers.authorization || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}

type VerifiedIdentity = { subject: string; email: string };

export type AuthenticatedActor =
  | {
      subject: string;
      email: string;
      role: "operator";
      clientRoles: Record<string, "operator">;
    }
  | {
      subject: string;
      email: string;
      role: "salon";
      clientRoles: Record<string, WorkspaceRole>;
    };

async function identityFromSupabaseToken(token: string): Promise<VerifiedIdentity | undefined> {
  const supabaseUrl = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
  if (!supabaseUrl) return undefined;
  const secret = process.env.SUPABASE_JWT_SECRET;
  const payload = secret
    ? (await jwtVerify(token, new TextEncoder().encode(secret))).payload
    : (
        await jwtVerify(token, createRemoteJWKSet(new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`)))
      ).payload;
  const email = String(
    payload.email ||
      (typeof payload.user_metadata === "object" && payload.user_metadata
        ? (payload.user_metadata as { email?: string }).email
        : "") ||
      "",
  ).toLowerCase();
  const subject = String(payload.sub || "");
  return email && subject ? { email, subject } : undefined;
}

export async function authenticateRequest(
  req: http.IncomingMessage,
  store: PlatformStore,
): Promise<AuthenticatedActor | undefined> {
  if (skipAuthEnabled()) {
    return {
      subject: "local-operator",
      email: "local@robinexis.test",
      role: "operator",
      clientRoles: {},
    };
  }
  const token = bearer(req);
  if (!token) {
    if (!isProductionRuntime() && !process.env.ADMIN_API_KEY && !process.env.SUPABASE_URL) {
      return {
        subject: "local-operator",
        email: "local@robinexis.test",
        role: "operator",
        clientRoles: {},
      };
    }
    return undefined;
  }

  if (process.env.ADMIN_API_KEY && token === process.env.ADMIN_API_KEY && !isProductionRuntime()) {
    return {
      subject: "local-api-key",
      email: "local@robinexis.test",
      role: "operator",
      clientRoles: {},
    };
  }

  try {
    const identity = await identityFromSupabaseToken(token);
    if (!identity) return undefined;
    if (adminEmails.includes(identity.email)) {
      return { ...identity, role: "operator", clientRoles: {} };
    }
    const memberships = await store.listMembershipsForEmail(identity.email);
    if (!memberships.length) return undefined;
    return {
      ...identity,
      role: "salon",
      clientRoles: Object.fromEntries(
        memberships.map((membership) => [membership.clientId, membership.role]),
      ),
    };
  } catch {
    return undefined;
  }
}

export function canAccessClient(actor: AuthenticatedActor, clientId: string): boolean {
  return actor.role === "operator" || Boolean(actor.clientRoles[clientId]);
}

export function canManageClient(actor: AuthenticatedActor, clientId: string): boolean {
  if (actor.role === "operator") return true;
  return ["owner", "manager"].includes(actor.clientRoles[clientId] || "");
}

export function canAdministerPlatform(actor: AuthenticatedActor): boolean {
  return actor.role === "operator";
}
