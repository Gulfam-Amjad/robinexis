import { createHash } from "node:crypto";
import { createWriteStream, existsSync, rmSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import { finished } from "node:stream/promises";
import pg from "pg";

const confirmation = "I_UNDERSTAND_THIS_READS_PRODUCTION";

function required(name) {
  const value = (process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function identifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

async function main() {
  const environment = required("BACKUP_ENVIRONMENT");
  if (!["staging", "production"].includes(environment)) {
    throw new Error("BACKUP_ENVIRONMENT must be staging or production");
  }
  if (environment === "production" && process.env.BACKUP_CONFIRM_PRODUCTION !== confirmation) {
    throw new Error(`production backup blocked; set BACKUP_CONFIRM_PRODUCTION=${confirmation}`);
  }

  const outputPath = required("BACKUP_OUTPUT_PATH");
  if (!outputPath.endsWith(".jsonl.age")) {
    throw new Error("BACKUP_OUTPUT_PATH must end in .jsonl.age");
  }
  if (existsSync(outputPath)) throw new Error("backup output already exists");

  const ageCommand = process.env.AGE_COMMAND?.trim() || "age";
  const output = createWriteStream(outputPath, { flags: "wx", mode: 0o600 });
  const age = spawn(ageCommand, ["--recipient", required("BACKUP_AGE_RECIPIENT")], {
    stdio: ["pipe", "pipe", "inherit"],
  });
  const hash = createHash("sha256");
  age.stdout.on("data", (chunk) => hash.update(chunk));
  age.stdout.pipe(output);
  const outputFinished = finished(output);
  const ageFinished = new Promise((resolve, reject) => {
    age.once("error", reject);
    age.once("close", (code) => code === 0 ? resolve() : reject(new Error(`age exited ${code}`)));
  });

  const pool = new pg.Pool({
    connectionString: required("DATABASE_URL"),
    ssl: { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === "true" },
  });
  let tableCount = 0;
  let rowCount = 0;

  try {
    const tables = await pool.query(`
      SELECT table_schema, table_name
      FROM information_schema.tables
      WHERE table_type = 'BASE TABLE'
        AND table_schema NOT IN ('information_schema', 'pg_catalog')
        AND table_schema NOT LIKE 'pg_toast%'
      ORDER BY table_schema, table_name
    `);
    age.stdin.write(`${JSON.stringify({
      type: "manifest",
      format: "robinexis-postgres-jsonl-v1",
      environment,
      createdAt: new Date().toISOString(),
      tableCount: tables.rowCount,
    })}\n`);

    for (const table of tables.rows) {
      const schema = table.table_schema;
      const name = table.table_name;
      const result = await pool.query(`SELECT * FROM ${identifier(schema)}.${identifier(name)}`);
      age.stdin.write(`${JSON.stringify({ type: "table", schema, name, rows: result.rowCount })}\n`);
      for (const row of result.rows) {
        age.stdin.write(`${JSON.stringify({ type: "row", schema, name, data: row })}\n`);
      }
      tableCount += 1;
      rowCount += result.rowCount;
    }
    age.stdin.end();
    await Promise.all([ageFinished, outputFinished]);
  } catch (error) {
    age.kill();
    output.destroy();
    rmSync(outputPath, { force: true });
    throw error;
  } finally {
    await pool.end();
  }

  console.log(JSON.stringify({
    ok: true,
    environment,
    outputPath,
    tableCount,
    rowCount,
    encryptedBytes: statSync(outputPath).size,
    sha256: hash.digest("hex"),
  }));
}

main().catch((error) => {
  console.error(`Backup failed safely: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
