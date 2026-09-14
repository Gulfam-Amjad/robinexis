import { readFileSync } from "node:fs";

const file = process.argv[2];
if (!file) throw new Error("Usage: node scripts/verify-staging-env.mjs <staging-env-file>");

const values = Object.fromEntries(
  readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/))
    .filter(Boolean)
    .map((match) => [match[1], match[2].replace(/^["']|["']$/g, "")]),
);

const failures = [];
if (!values.STRIPE_SECRET_KEY?.startsWith("sk_test_")) failures.push("Stripe secret must be test mode");
if (!values.STRIPE_PUBLISHABLE_KEY?.startsWith("pk_test_")) failures.push("Stripe publishable key must be test mode");
if (values.SAAS_PROVISIONING_ENABLED !== "false") failures.push("SaaS provisioning must remain false");
if (/api\.robinexis\.com|app\.robinexis\.com/i.test(`${values.API_PUBLIC_BASE_URL} ${values.WEB_ORIGIN}`)) {
  failures.push("Staging origins must not use production domains");
}
if (/client_blades_hair|447446868067|agent_6101m1c3n4wnfsgskgzr13w2gt9s/i.test(JSON.stringify(values))) {
  failures.push("Blades identifiers are forbidden in staging");
}
if (values.DATABASE_URL && values.DATABASE_URL === process.env.DATABASE_URL) {
  failures.push("Staging database matches the current environment");
}

if (failures.length) {
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, provisioning: false, stripeMode: "test" }));
