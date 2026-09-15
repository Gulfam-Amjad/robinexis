import { createWriteStream, existsSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { finished } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const confirmation = "I_UNDERSTAND_THIS_READS_PRODUCTION";

function fail(message) {
  throw new Error(message);
}

function required(name) {
  const value = (process.env[name] || "").trim();
  if (!value) fail(`${name} is required`);
  return value;
}

async function main() {
  const databaseUrl = new URL(required("DATABASE_URL"));
  if (!["postgres:", "postgresql:"].includes(databaseUrl.protocol)) {
    fail("DATABASE_URL must use postgres:// or postgresql://");
  }
  const environment = required("BACKUP_ENVIRONMENT");
  if (!["staging", "production"].includes(environment)) {
    fail("BACKUP_ENVIRONMENT must be staging or production");
  }
  if (environment === "production" && process.env.BACKUP_CONFIRM_PRODUCTION !== confirmation) {
    fail(`production backup blocked; set BACKUP_CONFIRM_PRODUCTION=${confirmation}`);
  }

  const outputPath = path.resolve(required("BACKUP_OUTPUT_PATH"));
  if (!path.isAbsolute(process.env.BACKUP_OUTPUT_PATH) || !outputPath.endsWith(".dump.age")) {
    fail("BACKUP_OUTPUT_PATH must be absolute and end in .dump.age");
  }
  if (outputPath === root || outputPath.startsWith(`${root}${path.sep}`)) {
    fail("BACKUP_OUTPUT_PATH must be outside the repository");
  }
  if (existsSync(outputPath)) fail("BACKUP_OUTPUT_PATH already exists; refusing to overwrite");
  const recipient = required("BACKUP_AGE_RECIPIENT");

  const database = databaseUrl.pathname.replace(/^\//, "");
  if (!databaseUrl.hostname || !database || !databaseUrl.username) {
    fail("DATABASE_URL must include host, database, and user");
  }

  const pgEnv = {
    ...process.env,
    PGHOST: databaseUrl.hostname,
    PGPORT: databaseUrl.port || "5432",
    PGDATABASE: database,
    PGUSER: decodeURIComponent(databaseUrl.username),
    PGPASSWORD: decodeURIComponent(databaseUrl.password),
    PGSSLMODE: process.env.DATABASE_SSL === "false" ? "disable" : "require",
  };
  const output = createWriteStream(outputPath, { flags: "wx", mode: 0o600 });
  const dump = spawn("pg_dump", ["--format=custom", "--no-owner", "--no-acl"], {
    env: pgEnv,
    stdio: ["ignore", "pipe", "inherit"],
  });
  const age = spawn("age", ["--recipient", recipient], {
    stdio: ["pipe", "pipe", "inherit"],
  });
  dump.stdout.pipe(age.stdin);
  age.stdout.pipe(output);
  const outputFinished = finished(output);

  const wait = (child, name) => new Promise((resolve, reject) => {
    child.once("error", (error) => reject(new Error(`${name} failed to start: ${error.message}`)));
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error(`${name} exited ${code}`)));
  });

  try {
    await Promise.all([wait(dump, "pg_dump"), wait(age, "age"), outputFinished]);
    console.log(`Encrypted ${environment} backup written to ${outputPath}`);
    console.log("Upload/retention is operator-managed; verify this artifact in approved offsite storage.");
  } catch (error) {
    dump.kill();
    age.kill();
    output.destroy();
    rmSync(outputPath, { force: true });
    throw error;
  }
}

main().catch((error) => {
  console.error(`Backup failed safely: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
