import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnv({ path: path.join(root, ".env"), quiet: true });

const file = path.join(
  root,
  "brains/robinexis/outputs/demos/agents-project/knowledge/blades-hair-client-demo.md",
);
const text = await fs.readFile(file, "utf8");
const documentId = process.argv[2];
const endpoint = documentId
  ? `https://api.elevenlabs.io/v1/convai/knowledge-base/${documentId}`
  : "https://api.elevenlabs.io/v1/convai/knowledge-base/text";
const response = await fetch(endpoint, {
  method: documentId ? "PATCH" : "POST",
  headers: {
    "xi-api-key": process.env.ELEVENLABS_API_KEY || "",
    "content-type": "application/json",
  },
  body: JSON.stringify({
    name: "Blades Hair — verified facts and demo assumptions",
    ...(documentId ? { content: text } : { text }),
  }),
});
const body = await response.json();
if (!response.ok) throw new Error(JSON.stringify(body));
console.log(body.id || documentId);
