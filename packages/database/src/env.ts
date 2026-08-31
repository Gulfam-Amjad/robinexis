import { config as loadEnv } from "dotenv";
import dns from "node:dns";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Railway trial/hobby IPv6 egress is off by default. Supabase AAAA records then
// fail with ENETUNREACH on 5432. Prefer IPv4 unless the platform has IPv6.
dns.setDefaultResultOrder("ipv4first");

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(packageDir, "../../..");

/** Load local `.env` files. Cloud hosts inject process.env and this is a no-op. */
export function loadDatabaseEnv() {
  loadEnv({ path: path.join(process.cwd(), ".env") });
  loadEnv({ path: path.join(repoRoot, ".env") });
}

export function isProductionRuntime() {
  return Boolean(process.env.RAILWAY_ENVIRONMENT) || process.env.NODE_ENV === "production";
}

export function databaseUrlFromEnv(): string | undefined {
  loadDatabaseEnv();
  const url = process.env.DATABASE_URL?.trim();
  if (!url) return undefined;
  return url.replace("@localhost", "@127.0.0.1");
}

export function poolSsl(databaseUrl: string) {
  if (process.env.DATABASE_SSL === "false") return undefined;
  const needsSsl =
    process.env.DATABASE_SSL === "true" ||
    databaseUrl.includes("supabase.co") ||
    databaseUrl.includes("pooler.supabase.com");
  if (!needsSsl) return undefined;
  return { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false" };
}
