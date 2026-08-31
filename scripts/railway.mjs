import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync } from "node:fs";
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

const artifacts = {
  api: "apps/api/dist/server.js",
  gateway: "apps/voice-gateway/dist/server.js",
  worker: "apps/worker/dist/index.js",
  web: "dist/index.html",
};

const stashRoot = "/opt/robinexis-dist";
const stashDirs = {
  api: ["apps/api/dist", "packages/database/dist"],
  gateway: ["apps/voice-gateway/dist"],
  worker: ["apps/worker/dist"],
  web: ["dist"],
};

function stashBuilt() {
  if (process.platform === "win32") return;
  const dirs = stashDirs[service] || [];
  for (const dir of dirs) {
    const from = path.join(root, dir);
    if (!existsSync(from)) continue;
    const to = path.join(stashRoot, dir);
    mkdirSync(path.dirname(to), { recursive: true });
    cpSync(from, to, { recursive: true });
  }
  console.log("railway.mjs: stashed dist outside /app so Nixpacks recopy cannot wipe it");
}

function restoreStash() {
  if (process.platform === "win32") return false;
  const dirs = stashDirs[service] || [];
  let restored = false;
  for (const dir of dirs) {
    const from = path.join(stashRoot, dir);
    if (!existsSync(from)) continue;
    const to = path.join(root, dir);
    mkdirSync(path.dirname(to), { recursive: true });
    cpSync(from, to, { recursive: true });
    restored = true;
  }
  if (restored) console.log("railway.mjs: restored dist from /opt/robinexis-dist");
  return restored;
}

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

function ensureBuilt() {
  const artifact = artifacts[service];
  if (artifact && existsSync(path.join(root, artifact))) return;
  if (restoreStash() && artifact && existsSync(path.join(root, artifact))) return;
  console.error(`railway.mjs: ${artifact} missing and stash empty — refusing to tsup at runtime (OOM on hobby)`);
  process.exit(1);
}

if (action === "start") {
  ensureBuilt();
  run(starts[service]);
  process.exit(0);
}

ensureInstall();
run(builds[service]);
if (service === "api") run(["run", "build:migrate"]);
stashBuilt();
