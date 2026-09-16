import { fileURLToPath } from "node:url";
import { cli, ServerOptions } from "@livekit/agents";
import { config as loadDotEnv } from "dotenv";
import { loadVoiceRuntimeEnv } from "./env.js";
import { runtimeLog } from "./logger.js";

loadDotEnv();

try {
  const env = loadVoiceRuntimeEnv();
  cli.runApp(new ServerOptions({
    agent: fileURLToPath(new URL("./agent.ts", import.meta.url)),
    wsURL: env.livekitUrl,
    apiKey: env.livekitApiKey,
    apiSecret: env.livekitApiSecret,
    agentName: "robinexis-alternate-runtime",
    logLevel: "info",
  }));
} catch (error) {
  runtimeLog("voice_runtime_refused_start", { error: String(error) });
  process.exitCode = 1;
}
