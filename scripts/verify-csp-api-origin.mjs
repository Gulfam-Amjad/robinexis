import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function connectSources(vercelConfig) {
  const policies = (vercelConfig.headers || [])
    .flatMap((entry) => entry.headers || [])
    .filter((header) => header.key?.toLowerCase() === "content-security-policy")
    .map((header) => String(header.value));
  if (policies.length !== 1) {
    throw new Error(`expected exactly one Content-Security-Policy header, found ${policies.length}`);
  }
  const directive = policies[0]
    .split(";")
    .map((part) => part.trim())
    .find((part) => part === "connect-src" || part.startsWith("connect-src "));
  if (!directive) throw new Error("vercel.json CSP has no connect-src directive");
  return directive.split(/\s+/).slice(1);
}

export function sourceAllowsOrigin(source, origin) {
  if (source === origin) return true;
  const wildcard = source.match(/^(https?):\/\/\*\.([^/:]+)(?::(\d+))?$/);
  if (!wildcard) return false;
  const candidate = new URL(origin);
  const expectedPort = wildcard[3] || "";
  return candidate.protocol === `${wildcard[1]}:`
    && candidate.hostname.endsWith(`.${wildcard[2]}`)
    && candidate.hostname !== wildcard[2]
    && candidate.port === expectedPort;
}

export function verifyApiOrigin(apiBaseUrl, vercelConfig) {
  const parsed = new URL(apiBaseUrl);
  if (!["https:", "http:"].includes(parsed.protocol)) {
    throw new Error("VITE_API_BASE_URL must use http or https");
  }
  const origin = parsed.origin;
  const sources = connectSources(vercelConfig);
  if (!sources.some((source) => sourceAllowsOrigin(source, origin))) {
    throw new Error(`${origin} is missing from vercel.json CSP connect-src`);
  }
  return origin;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const apiBaseUrl = (process.env.VITE_API_BASE_URL || "").trim();
  if (!apiBaseUrl) {
    console.log("CSP check skipped: VITE_API_BASE_URL is empty (local proxy mode)");
    process.exit(0);
  }
  try {
    const config = JSON.parse(readFileSync(path.join(root, "vercel.json"), "utf8"));
    const origin = verifyApiOrigin(apiBaseUrl, config);
    console.log(`CSP check passed: connect-src allows ${origin}`);
  } catch (error) {
    console.error(`CSP check failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
