import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const commands = [
  { executable: process.execPath, args: [path.join(root, "apps/worker/dist/index.js")] },
];
if (process.env.VOICE_RUNTIME_ENABLED === "true") {
  commands.push({
    executable: npm,
    args: ["run", "start", "-w", "@robinexis/voice-runtime"],
  });
}

const children = commands.map(({ executable, args }) => spawn(executable, args, {
  cwd: root,
  stdio: "inherit",
  env: process.env,
  shell: process.platform === "win32",
}));
let stopping = false;

function stop(signal = "SIGTERM", exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.killed) child.kill(signal);
  }
  setTimeout(() => process.exit(exitCode), 5_000).unref();
}

for (const child of children) {
  child.on("error", (error) => {
    console.error("worker-runtime: child failed to start", error);
    stop("SIGTERM", 1);
  });
  child.on("exit", (code, signal) => {
    if (stopping) return;
    console.error("worker-runtime: child exited", { code, signal });
    stop("SIGTERM", code || 1);
  });
}

process.on("SIGINT", () => stop("SIGINT", 0));
process.on("SIGTERM", () => stop("SIGTERM", 0));
