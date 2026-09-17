/**
 * Pushes Stripe CLI profile keys onto Railway without printing values.
 * Also appends missing STRIPE_* names to local .env.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync, appendFileSync } from "node:fs";
import { spawn } from "node:child_process";

const raw = readFileSync(join(homedir(), ".config", "stripe", "config.toml"), "utf8");
const secret = raw.match(/test_mode_api_key\s*=\s*'([^']+)'/)?.[1];
const publishable = raw.match(/test_mode_pub_key\s*=\s*'([^']+)'/)?.[1];
if (!secret || !publishable) {
  console.error("Stripe CLI profile is missing test keys.");
  process.exit(1);
}

function run(args, stdinValue) {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["--yes", "@railway/cli", ...args], {
      stdio: stdinValue ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"],
      shell: true,
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => {
      out += chunk;
    });
    child.stderr.on("data", (chunk) => {
      err += chunk;
    });
    if (stdinValue) child.stdin.end(stdinValue);
    child.on("close", (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(err || out || `exit ${code}`));
    });
  });
}

const priceIds = process.env.STRIPE_PRICE_IDS_JSON;
const features = process.env.STRIPE_PRICE_FEATURES_JSON;
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

await run(["variable", "set", "STRIPE_SECRET_KEY", "--stdin", "--service", "@robinexis/api", "--skip-deploys", "--json"], secret);
await run(["variable", "set", "STRIPE_SECRET_KEY", "--stdin", "--service", "@robinexis/worker", "--skip-deploys", "--json"], secret);
await run(["variable", "set", "STRIPE_PUBLISHABLE_KEY", "--stdin", "--service", "@robinexis/api", "--skip-deploys", "--json"], publishable);
if (priceIds) {
  await run(["variable", "set", "STRIPE_PRICE_IDS_JSON", "--stdin", "--service", "@robinexis/api", "--skip-deploys", "--json"], priceIds);
}
if (features) {
  await run(["variable", "set", "STRIPE_PRICE_FEATURES_JSON", "--stdin", "--service", "@robinexis/api", "--skip-deploys", "--json"], features);
}
if (webhookSecret) {
  await run(["variable", "set", "STRIPE_WEBHOOK_SECRET", "--stdin", "--service", "@robinexis/api", "--skip-deploys", "--json"], webhookSecret);
}
await run(["variable", "set", "SAAS_PROVISIONING_ENABLED=false", "--service", "@robinexis/api", "--skip-deploys", "--json"]);

const envPath = join(process.cwd(), ".env");
let envText = "";
try {
  envText = readFileSync(envPath, "utf8");
} catch {
  envText = "";
}
const lines = [];
if (!/^STRIPE_SECRET_KEY=/m.test(envText)) lines.push(`STRIPE_SECRET_KEY=${secret}`);
if (!/^STRIPE_PUBLISHABLE_KEY=/m.test(envText)) lines.push(`STRIPE_PUBLISHABLE_KEY=${publishable}`);
if (priceIds && !/^STRIPE_PRICE_IDS_JSON=/m.test(envText)) lines.push(`STRIPE_PRICE_IDS_JSON=${priceIds}`);
if (features && !/^STRIPE_PRICE_FEATURES_JSON=/m.test(envText)) lines.push(`STRIPE_PRICE_FEATURES_JSON=${features}`);
if (lines.length) appendFileSync(envPath, `\n${lines.join("\n")}\n`);

console.log(JSON.stringify({
  railway: ["api", "worker"],
  localEnvAppended: lines.map((line) => line.split("=")[0]),
  saasProvisioningEnabled: false,
}));
