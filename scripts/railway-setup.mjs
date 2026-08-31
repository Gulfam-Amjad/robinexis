// One-command Railway setup. Applies .railway/railway.ts (services, Redis, build and
// start commands, non-secret variables), pushes the secret variables from
// .railway-vars/*.env, and generates public domains for the API and gateway.
//
//   node scripts/railway-setup.mjs            # preview only (railway config plan)
//   node scripts/railway-setup.mjs --apply    # apply, push secrets, generate domains
//
// Requires one interactive login first: npx @railway/cli login
// Variable values are passed as argv to the real railway binary (no shell), so
// passwords and JWTs are never expanded or quoted by PowerShell, and never printed.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const varsDir = path.join(root, ".railway-vars");
const apply = process.argv.includes("--apply");

const PROJECT_ID = process.env.RAILWAY_PROJECT_ID || "8658606d-ca2e-48d2-954b-0affc1824d12";
const ENVIRONMENT = process.env.RAILWAY_ENVIRONMENT_NAME || "production";

// Service names must match .railway/railway.ts exactly — worker.env references the
// other two by name via ${{@robinexis/api.API_PUBLIC_BASE_URL}}.
const services = [
  { file: "api", name: "@robinexis/api", domain: true },
  { file: "gateway", name: "@robinexis/voice-gateway", domain: true },
  { file: "worker", name: "@robinexis/worker", domain: false },
];

function resolveCli() {
  const local = path.join(
    root,
    "node_modules",
    "@railway",
    "cli",
    "bin",
    process.platform === "win32" ? "railway.exe" : "railway",
  );
  if (existsSync(local)) return { command: local, prefix: [] };
  return { command: process.platform === "win32" ? "npx.cmd" : "npx", prefix: ["--yes", "@railway/cli@latest"] };
}

const cli = resolveCli();

function railway(args, { input, allowFailure = false, quiet = false } = {}) {
  const result = spawnSync(cli.command, [...cli.prefix, ...args], {
    cwd: root,
    input,
    encoding: "utf8",
    // Only needed to launch npx.cmd; the real binary is spawned directly.
    shell: cli.prefix.length > 0 && process.platform === "win32",
  });
  const stdout = result.stdout || "";
  const stderr = result.stderr || "";
  if (!quiet && stdout.trim()) console.log(stdout.trim());
  if (result.status !== 0 && !allowFailure) {
    console.error(stderr.trim() || `railway ${args[0]} failed`);
    process.exit(result.status ?? 1);
  }
  return { ok: result.status === 0, stdout, stderr };
}

function parseEnvFile(file) {
  const out = [];
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const value = match[2].trim();
    if (!value) continue;
    out.push([match[1], value]);
  }
  return out;
}

const auth = railway(["whoami"], { allowFailure: true, quiet: true });
if (!auth.ok) {
  console.error("Not logged in. Run this once, then re-run this script:\n");
  console.error("  npx @railway/cli login\n");
  console.error("Headless alternative: set RAILWAY_TOKEN (project token) in your shell.");
  process.exit(1);
}
console.log(auth.stdout.trim());

console.log(`\n== link project ${PROJECT_ID} (${ENVIRONMENT})`);
railway(["link", "--project", PROJECT_ID, "--environment", ENVIRONMENT]);

console.log("\n== plan (.railway/railway.ts vs live environment)");
railway(["config", "plan"]);

if (!apply) {
  console.log("\nPreview only. Re-run with --apply to create services, push secrets, and add domains.");
  process.exit(0);
}

console.log("\n== apply");
railway(["config", "apply", "--yes"]);

for (const service of services) {
  const file = path.join(varsDir, `${service.file}.env`);
  if (!existsSync(file)) {
    console.error(`missing ${file} — run: node scripts/railway-vars.mjs`);
    process.exit(1);
  }
  const pairs = parseEnvFile(file);
  console.log(`\n== variables for ${service.name} (${pairs.length})`);
  const args = ["variables", "--service", service.name, "--skip-deploys"];
  for (const [key, value] of pairs) args.push("--set", `${key}=${value}`);
  // Values are secret; suppress echo.
  railway(args, { quiet: true });
  console.log(`set ${pairs.map(([key]) => key).join(", ")}`);
}

const domains = {};
for (const service of services.filter((entry) => entry.domain)) {
  console.log(`\n== domain for ${service.name}`);
  const listed = railway(["domain", "list", "--service", service.name, "--json"], {
    allowFailure: true,
    quiet: true,
  });
  let host = /([a-z0-9-]+\.up\.railway\.app)/i.exec(listed.stdout)?.[1];
  if (!host) {
    const created = railway(["domain", "--service", service.name, "--json"], { quiet: true });
    host = /([a-z0-9-]+\.up\.railway\.app)/i.exec(created.stdout)?.[1];
  }
  if (host) {
    domains[service.file] = `https://${host}`;
    console.log(domains[service.file]);
  } else {
    console.log("no domain returned — generate it in Settings → Networking");
  }
}

if (domains.api) {
  const vercelFile = path.join(varsDir, "vercel.env");
  const updated = readFileSync(vercelFile, "utf8").replace(
    /^VITE_API_BASE_URL=.*$/m,
    `VITE_API_BASE_URL=${domains.api}`,
  );
  writeFileSync(vercelFile, updated);
  console.log(`\nwrote VITE_API_BASE_URL=${domains.api} into .railway-vars/vercel.env`);
}

console.log("\nDone. Remaining manual steps:");
console.log("  1. Vercel → Settings → Environment Variables → Import .railway-vars/vercel.env, then redeploy.");
console.log("  2. Point the Twilio webhook at {gateway domain}/twiml when you go live.");
console.log("  3. Rotate the Supabase password and JWT secret, then re-run railway-vars.mjs + this script.");
