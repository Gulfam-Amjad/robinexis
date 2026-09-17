import { cpSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
cpSync(path.join(root, "packages/database/src/migrations"), path.join(root, "packages/database/dist/migrations"), {
  recursive: true,
});
