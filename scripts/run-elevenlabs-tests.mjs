import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnv({ path: path.join(root, ".env"), quiet: true });

const agentId = process.argv[2];
const testIds = process.argv.slice(3);
if (!agentId || !testIds.length) {
  throw new Error("usage: node scripts/run-elevenlabs-tests.mjs <agent_id> <test_id...>");
}

const response = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${agentId}/run-tests`, {
  method: "POST",
  headers: {
    "xi-api-key": process.env.ELEVENLABS_API_KEY || "",
    "content-type": "application/json",
  },
  body: JSON.stringify({
    tests: testIds.map((testId) => ({ test_id: testId })),
    repeat_count: 1,
  }),
});
const body = await response.json();
if (!response.ok) throw new Error(JSON.stringify(body));

let result = body;
const deadline = Date.now() + 120_000;
while (
  result.test_runs?.some((run) => run.status === "pending") &&
  Date.now() < deadline
) {
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  const poll = await fetch(
    `https://api.elevenlabs.io/v1/convai/test-invocations/${body.id}`,
    { headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY || "" } },
  );
  result = await poll.json();
  if (!poll.ok) throw new Error(JSON.stringify(result));
}

console.log(JSON.stringify(result, null, 2));
if (result.test_runs?.some((run) => run.status !== "passed")) {
  process.exitCode = 1;
}
