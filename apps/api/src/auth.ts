import { createRemoteJWKSet, jwtVerify } from "jose";
import type http from "node:http";
import { isProductionRuntime, loadDatabaseEnv } from "@robinexis/database";

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
  return process.env.SKIP_AUTH === "true" && !isProductionRuntime();
}

export function corsHeaders(origin: string | undefined): Record<string, string> {
  const allow = origin && allowedOrigins.includes(origin) ? origin : allowedOrigins[0] || "";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export function applyCors(req: http.IncomingMessage, res: http.ServerResponse) {
  const headers = corsHeaders(req.headers.origin);
  for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
}

export function describeAuthMode(): string {
  if (skipAuthEnabled()) return "SKIP_AUTH — local testing, /api/v1 is open";
  if (process.env.SUPABASE_URL) return "Supabase JWT required; email must match ADMIN_EMAILS";
  if (process.env.ADMIN_API_KEY) return "ADMIN_API_KEY required on /api/v1";
  if (isProductionRuntime()) return "production auth misconfigured — /api/v1 will reject every request";
  return "no auth configured — /api/v1 is open outside production";
}

function bearer(req: http.IncomingMessage) {
  const header = req.headers.authorization || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}

async function emailFromSupabaseToken(token: string): Promise<string | undefined> {
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
  return email || undefined;
}

export async function isAdmin(req: http.IncomingMessage): Promise<boolean> {
  if (skipAuthEnabled()) return true;
  const token = bearer(req);
  if (!token) return !isProductionRuntime() && !process.env.ADMIN_API_KEY && !process.env.SUPABASE_URL;

  if (process.env.ADMIN_API_KEY && token === process.env.ADMIN_API_KEY && !isProductionRuntime()) {
    return true;
  }

  try {
    const email = await emailFromSupabaseToken(token);
    return Boolean(email && adminEmails.includes(email));
  } catch {
    return false;
  }
}
