const agentId = process.argv[2];
if (
  !agentId?.startsWith("agent_") ||
  agentId === "agent_6101m1c3n4wnfsgskgzr13w2gt9s" ||
  process.env.LIVE_STAGING_CANARY !== "true"
) {
  throw new Error("confirmed non-protected staging agent is required");
}
const response = await fetch(
  `https://api.elevenlabs.io/v1/convai/agents/${encodeURIComponent(agentId)}/simulate-conversation`,
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "xi-api-key": process.env.ELEVENLABS_API_KEY || "",
    },
    body: JSON.stringify({
      simulation_specification: {
        simulated_user_config: {
          first_message: "Hello, I want to book the first available appointment tomorrow afternoon.",
          language: "en",
          disable_first_message_interruptions: false,
          prompt: {
            prompt: "Act as a cooperative caller. Ask for appointment availability, choose the first slot, give the name Robin Test, and explicitly confirm the booking.",
            llm: "gemini-2.5-flash-lite",
          },
        },
      },
      new_turns_limit: 8,
    }),
  },
);
const text = await response.text();
let body = {};
try {
  body = text ? JSON.parse(text) : {};
} catch {}
if (!response.ok) throw new Error(`ElevenLabs simulation failed: ${response.status}`);
const transcript = body.simulated_conversation || body.transcript || [];
const serialized = JSON.stringify(transcript);
console.log(JSON.stringify({
  ok: true,
  status: response.status,
  turnCount: Array.isArray(transcript) ? transcript.length : undefined,
  mentionedAvailability: /availab|appointment|slot/i.test(serialized),
  toolCallObserved: /check_availability|create_booking|tool_call/i.test(serialized),
  analysisPresent: Boolean(body.analysis || body.evaluation_criteria_results),
}));
