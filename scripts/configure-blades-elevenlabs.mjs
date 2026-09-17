import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const project = path.join(root, "brains/robinexis/outputs/demos/agents-project");
const source = path.join(project, "agent_configs/Blades-Hair-Client-Demo.json");
const outputFile = process.argv[5] || "Blades-Hair-Client-Demo.json";
const target = path.join(project, "agent_configs", outputFile);
const promptPath = path.join(project, "blades-client-demo-prompt.txt");
const knowledgeId = process.argv[2];
const ttsModel = process.argv[3] || "eleven_flash_v2";
const voiceId = process.argv[4] || "Se2Vw1WbHmGbBbyWTuu4";
const agentName = process.argv[6] || "Blades Hair — Client Demo";

if (!knowledgeId) {
  throw new Error(
    "usage: node scripts/configure-blades-elevenlabs.mjs <knowledge_id> [tts_model] [voice_id] [output_file] [agent_name]",
  );
}

const agent = JSON.parse(await fs.readFile(source, "utf8"));
const prompt = await fs.readFile(promptPath, "utf8");
const config = agent.conversation_config;

agent.name = agentName;
agent.tags = ["client-demo", "robinexis", "blades-hair", "salon"];
config.agent.first_message =
  "Hi, thanks for calling Blades Hair on Cullum Street — you're through to Sophie. How are you today?";
config.agent.disable_first_message_interruptions = false;
config.agent.prompt.prompt = prompt.trim();
config.agent.prompt.llm = "gemini-2.5-flash";
config.agent.prompt.reasoning_effort = null;
config.agent.prompt.thinking_budget = null;
config.agent.prompt.temperature = 0.28;
config.agent.prompt.max_tokens = -1;
config.agent.prompt.cascade_timeout_seconds = 2.5;
config.agent.prompt.ignore_default_personality = false;
config.agent.prompt.timezone = "Europe/London";
config.agent.prompt.tool_ids = [
  "tool_1601m1c1vbdheaptfewv2sxnb9q4",
  "tool_2601m1c3133bfty8z3sd8fyt7aaf",
];
config.agent.prompt.knowledge_base = [
  {
    type: "text",
    name: "Blades Hair — verified facts and demo assumptions",
    id: knowledgeId,
    usage_mode: "auto",
  },
];
config.agent.prompt.rag = {
  ...config.agent.prompt.rag,
  enabled: false,
  optional_rag_enabled: false,
  max_documents_length: 12000,
  max_retrieved_rag_chunks_count: 6,
};

config.asr.provider = "scribe_realtime";
config.asr.quality = "high";
config.asr.keywords = [
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
];

config.turn.turn_model = "turn_v3";
config.turn.turn_eagerness = "eager";
config.turn.turn_timeout = 5;
config.turn.spelling_patience = "auto";
config.turn.speculative_turn = false;
config.turn.transcribe_on_disabled_interruptions = true;
config.turn.soft_timeout_config = {
  ...config.turn.soft_timeout_config,
  timeout_seconds: -1,
  message: "One moment.",
  randomize_fillers: false,
  max_soft_timeouts_per_generation: 1,
};

config.tts.model_id = ttsModel;
config.tts.voice_id = voiceId;
config.tts.expressive_mode = false;
config.tts.optimize_streaming_latency = 3;
config.tts.speed = 1.02;
config.tts.stability = 0.48;
config.tts.similarity_boost = 0.8;
config.conversation.max_duration_seconds = 420;
config.conversation.monitoring_enabled = false;

agent.platform_settings.widget.transcript_enabled = true;
agent.platform_settings.widget.show_agent_status = true;
agent.platform_settings.widget.action_text = "Talk to the Blades receptionist";
agent.platform_settings.widget.start_call_text = "Start demo call";
agent.platform_settings.widget.listening_text = "Listening";
agent.platform_settings.widget.speaking_text = "Speaking";
agent.platform_settings.testing = {
  ...agent.platform_settings.testing,
  attached_tests: [
    { test_id: "test_9801m1c3qswtfewryx6bfqaz99ym" },
    { test_id: "test_3901m1c3qvpyennaaxykj3bh9sz6" },
    { test_id: "test_5801m1c3qy14fpev5h6yzr3etej0" },
    { test_id: "test_9801m1dnmjb3eayrg997s49bf6te" },
    { test_id: "test_4101m1dneg18e7v9cp8f29zvc91g" },
    { test_id: "test_0301m1dnegz6fvat3cnn1ywn5vt1" },
    { test_id: "test_7401m1dnehxveck8gzj939d8018n" },
    { test_id: "test_4301m1dnejwcerw99yyg4gzcvpa7" },
    { test_id: "test_3301m1dneks4frbvb5v26hkrse2q" },
  ],
};

await fs.writeFile(target, `${JSON.stringify(agent, null, 2)}\n`);
console.log(target);
