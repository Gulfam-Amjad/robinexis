import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const exe = path.join(root, "node_modules/@railway/cli/bin/railway.exe");
const file = path.join(root, ".railway-vars/api.env");
const skip = new Set(["REDIS_URL"]);

const pairs = [];
for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
  const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
  if (!match) continue;
  const [, key, raw] = match;
  const value = raw.trim();
  if (!value || skip.has(key)) continue;
  pairs.push(`${key}=${value}`);
}

const args = ["variable", "--service", "@robinexis/api", "--skip-deploys"];
for (const pair of pairs) args.push("--set", pair);
const result = spawnSync(exe, args, { cwd: root, encoding: "utf8" });
if (result.stdout) console.log(result.stdout.trim());
if (result.status) {
  console.error(result.stderr?.trim() || "variable set failed");
  process.exit(result.status);
}
console.log(`set ${pairs.length} keys on @robinexis/api (values not printed)`);
