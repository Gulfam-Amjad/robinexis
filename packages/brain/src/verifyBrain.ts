/**
 * Sends one real turn through the configured Groq chat model with the agent's
 * own tool schemas. Catches a retired or misconfigured model ID from a terminal
 * instead of mid-call, where it only surfaces as a transfer to the front desk.
 *
 *   npm run check:brain
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { TOOL_DEFINITIONS } from "@robinexis/tool-contracts";
import { GroqDriver } from "./groq.js";

loadEnv({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.env") });

const model = process.env.GROQ_LLM_MODEL || "(package default)";

async function main() {
  console.log(`Brain check — Groq chat model: ${model}`);
  if (!process.env.GROQ_API_KEY) {
    console.log("[FAIL] GROQ_API_KEY is not set");
    return false;
  }

  const driver = new GroqDriver();
  const turn = await driver.complete({
    system:
      "You are the receptionist for Blades Hair, a salon in London. " +
      "Be brief. Use check_availability before offering any specific time.",
    messages: [{ role: "user", content: "Hi, can I book a haircut for tomorrow afternoon?" }],
    tools: TOOL_DEFINITIONS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.input_schema as Record<string, unknown>,
    })),
  });

  console.log(`[PASS] model replied (stopReason=${turn.stopReason ?? "none"})`);
  if (turn.text) console.log(`       text: ${turn.text.slice(0, 220)}`);
  if (turn.toolCalls.length) {
    console.log(`[PASS] tool calling works — ${turn.toolCalls.map((c) => c.name).join(", ")}`);
  } else {
    console.log("[WARN] no tool call on this turn — tool calling unproven, reply was text only");
  }
  return true;
}

main()
  .then((ok) => {
    process.exitCode = ok ? 0 : 1;
  })
  .catch((err) => {
    const status = (err as { status?: number })?.status;
    console.error(`[FAIL] ${status ? `HTTP ${status} — ` : ""}${String(err)}`);
    console.error("       If the model ID was retired, see https://console.groq.com/docs/deprecations");
    process.exitCode = 1;
  });
