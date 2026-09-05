// Reads the local (gitignored) .env and writes paste-ready variable blocks for
// each Railway service plus Vercel, into .railway-vars/ (also gitignored).
//
//   node scripts/railway-vars.mjs
//
// Values that must not leave a laptop are read from .env. Unknown values stay
// empty and are reported after generation; secrets are never written to git.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, ".railway-vars");

function readEnvFile(file) {
  let raw = "";
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    console.error(`railway-vars: ${file} not found. Run \`cp .env.example .env\` and fill it first.`);
    process.exit(1);
  }
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    out[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

const env = readEnvFile(path.join(root, ".env"));
const missing = new Set();

function value(name, fallback) {
  const found = env[name];
  if (found) return found;
  if (fallback !== undefined) return fallback;
  missing.add(name);
  return "";
}

// Supabase project ref is embedded in the Postgres host: db.<ref>.supabase.co
function supabaseUrl() {
  const ref = /db\.([a-z0-9]+)\.supabase\.co/.exec(env.DATABASE_URL || "")?.[1];
  if (!ref) {
    missing.add("SUPABASE_URL");
    return "";
  }
  return `https://${ref}.supabase.co`;
}

const shared = {
  NODE_ENV: "production",
  NODE_VERSION: "24",
  DATABASE_URL: value("DATABASE_URL"),
  DATABASE_SSL: "true",
  REQUIRE_DATABASE: "true",
  GEMINI_API_KEY: value("GEMINI_API_KEY"),
  GEMINI_EMBEDDING_MODEL: value("GEMINI_EMBEDDING_MODEL", "gemini-embedding-001"),
};

const services = {
  api: {
    ...shared,
    RAILWAY_BUILD_TARGET: "api",
    API_PUBLIC_BASE_URL: "https://${{RAILWAY_PUBLIC_DOMAIN}}",
    TWILIO_ACCOUNT_SID: value("TWILIO_ACCOUNT_SID"),
    TWILIO_AUTH_TOKEN: value("TWILIO_AUTH_TOKEN"),
    CALCOM_API_KEY: value("CALCOM_API_KEY"),
    CALCOM_USERNAME: value("CALCOM_USERNAME", "admin"),
    VOICE_TOOL_SECRET: value("VOICE_TOOL_SECRET"),
    WEB_ORIGIN: value("WEB_ORIGIN", "https://app.robinexis.com,https://robinexis-pink.vercel.app"),
    ADMIN_EMAILS: value("ADMIN_EMAILS", "gulfamamjad633@gmail.com"),
    SUPABASE_URL: supabaseUrl(),
    SUPABASE_JWT_SECRET: value("SUPABASE_JWT_SECRET"),
    SUPABASE_JWT_KEY_ID: value("SUPABASE_JWT_KEY_ID"),
    RAG_TOP_K: value("RAG_TOP_K", "5"),
    RAG_MIN_SIMILARITY: value("RAG_MIN_SIMILARITY", "0.55"),
    RAG_EMBEDDING_DIMENSIONS: value("RAG_EMBEDDING_DIMENSIONS", "768"),
  },
  worker: {
    ...shared,
    RAILWAY_BUILD_TARGET: "worker",
    WORKER_POLL_MS: value("WORKER_POLL_MS", "15000"),
    DATA_RETENTION_DAYS: value("DATA_RETENTION_DAYS", "90"),
  },
};

const vercel = {
  VITE_API_BASE_URL: value("VITE_API_BASE_URL"),
  VITE_SUPABASE_URL: supabaseUrl(),
  VITE_SUPABASE_ANON_KEY: value("VITE_SUPABASE_ANON_KEY"),
};

function serialize(vars) {
  return `${Object.entries(vars)
    .map(([name, val]) => `${name}=${val}`)
    .join("\n")}\n`;
}

mkdirSync(outDir, { recursive: true });
for (const [name, vars] of Object.entries(services)) {
  writeFileSync(path.join(outDir, `${name}.env`), serialize(vars));
}
writeFileSync(path.join(outDir, "vercel.env"), serialize(vercel));

console.log("railway-vars: wrote .railway-vars/{api,worker,vercel}.env");
console.log("Paste each file into the matching service's Variables -> Raw Editor (ENV tab).");
if (missing.size) {
  console.log("\nStill needs a real value (left empty):");
  for (const name of [...missing].sort()) console.log(`  - ${name}`);
}
