import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnv({ path: path.join(root, ".env"), quiet: true });

const agentId = "agent_6101m1c3n4wnfsgskgzr13w2gt9s";
const prompt = await fs.readFile(
  path.join(root, "brains/robinexis/outputs/demos/agents-project/blades-client-demo-prompt.txt"),
  "utf8",
);

const response = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${agentId}`, {
  method: "PATCH",
  headers: {
    "xi-api-key": process.env.ELEVENLABS_API_KEY || "",
    "content-type": "application/json",
  },
  body: JSON.stringify({
    conversation_config: {
      agent: {
        prompt: { prompt: prompt.trim() },
      },
      asr: {
        keywords: [
          "Blades Hair",
          "Cullum Street",
          "Galyna",
          "Cristina",
          "Jana",
          "Daiva",
          "Denise",
          "Stacey",
          "Laima",
          "highlights",
          "clipper",
          "layered",
          "restyle",
        ],
      },
    },
  }),
});

const body = await response.json();
if (!response.ok) {
  console.error(JSON.stringify(body, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, agent_id: body.agent_id || agentId, name: body.name }, null, 2));
