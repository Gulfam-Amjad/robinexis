import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const argvTask = process.argv[2];

const builds = {
  api: ["run", "build:api"],
  gateway: ["run", "build:gateway"],
  worker: ["run", "build:worker"],
  web: ["run", "build:web"],
};

const starts = {
  api: ["run", "start", "-w", "@robinexis/api"],
  gateway: ["run", "start", "-w", "@robinexis/voice-gateway"],
  worker: ["run", "start", "-w", "@robinexis/worker"],
  web: ["run", "start", "-w", "@robinexis/web"],
};

function run(args) {
  const result = spawnSync(npm, args, {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, NPM_CONFIG_OMIT: "" },
  });
  if (result.error) {
    console.error("railway.mjs: failed to spawn npm:", result.error.message);
    process.exit(1);
  }
  if (result.signal) {
    console.error("railway.mjs: npm killed by", result.signal);
    process.exit(1);
  }
  if (result.status) process.exit(result.status);
}

function inferService() {
  const explicit = (process.env.RAILWAY_BUILD_TARGET || "").trim().toLowerCase();
  if (builds[explicit]) return explicit;
  const name = (process.env.RAILWAY_SERVICE_NAME || "").toLowerCase();
  if (name.includes("gateway") || name.includes("voice")) return "gateway";
  if (name.includes("worker")) return "worker";
  if (name.includes("web")) return "web";
  if (name.includes("api")) return "api";
  return "";
}

function ensureInstall() {
  if (existsSync(path.join(root, "node_modules"))) {
    console.log("railway.mjs: node_modules already present, skipping npm ci");
    return;
  }
  if (!existsSync(path.join(root, "package-lock.json"))) {
    console.error("railway.mjs: package-lock.json not found at", root);
    process.exit(1);
  }
  run(["ci", "--include=dev"]);
}

const service = builds[argvTask] ? argvTask : inferService();
const action = ["start", "migrate", "predeploy"].includes(argvTask) ? argvTask : "build";

if (action === "migrate" || (action === "predeploy" && service === "api")) {
  run(["run", "db:migrate"]);
  process.exit(0);
}

if (action === "predeploy") {
  console.log(`railway.mjs: skip migrate for ${service || "unknown service"}`);
  process.exit(0);
}

if (!service) {
  console.error(
    "railway.mjs: cannot tell which service to build. Set RAILWAY_BUILD_TARGET to api, gateway, worker, or web.",
  );
  process.exit(1);
}

console.log(`railway.mjs: ${action} ${service}`);

if (action === "start") {
  run(starts[service]);
  process.exit(0);
}

ensureInstall();
run(builds[service]);
if (service === "api") run(["run", "build:migrate"]);
