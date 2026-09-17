import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { poolSsl } from "./env.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function migrate(databaseUrl: string) {
  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: poolSsl(databaseUrl),
    connectionTimeoutMillis: 8_000,
  });
  await client.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ DEFAULT now()
      )
    `);
    const bundledDir = path.join(__dirname, "migrations");
    const workspaceRoot = path.resolve(process.cwd(), "../..");
    const workspaceDistDir = path.join(workspaceRoot, "packages/database/dist/migrations");
    const sourceDir = path.join(workspaceRoot, "packages/database/src/migrations");
    const dir = fs.existsSync(bundledDir)
      ? bundledDir
      : fs.existsSync(workspaceDistDir)
        ? workspaceDistDir
        : sourceDir;
    const files = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith(".sql"))
      .sort();
    for (const file of files) {
      const id = file.replace(/\.sql$/, "");
      const applied = await client.query("SELECT 1 FROM schema_migrations WHERE id = $1", [id]);
      if (applied.rowCount) continue;
      const sql = fs.readFileSync(path.join(dir, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (id) VALUES ($1)", [id]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.end();
  }
}
