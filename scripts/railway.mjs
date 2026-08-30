import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const task = process.argv[2];

if (!existsSync(path.join(root, "package-lock.json"))) {
  console.error("railway.mjs: package-lock.json not found at", root);
  process.exit(1);
}

function run(args) {
  const result = spawnSync(npm, args, {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      NPM_CONFIG_PRODUCTION: "false",
      npm_config_production: "false",
    },
  });
  if (result.status) process.exit(result.status ?? 1);
}

const builds = {
  api: ["run", "build:api"],
  gateway: ["run", "build:gateway"],
  worker: ["run", "build:worker"],
  web: ["run", "build:web"],
};

if (task === "migrate") {
  run(["run", "db:migrate"]);
} else if (builds[task]) {
  run(["ci", "--include=dev"]);
  run(builds[task]);
  if (task === "api") run(["run", "build:migrate"]);
} else {
  console.error("usage: railway.mjs <api|gateway|worker|web|migrate>");
  process.exit(1);
}
