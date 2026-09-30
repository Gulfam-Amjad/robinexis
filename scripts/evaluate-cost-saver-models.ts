import Groq from "groq-sdk";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { compilePrompt } from "@robinexis/brain";
import { bladesHairSeed } from "@robinexis/database";

type Decision = { id: string; nextAction: string; spokenReply: string };
type ModelResult = {
  provider: "groq" | "google";
  model: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  score: number;
  passed: string[];
  failed: string[];
};

export const CASES = [
  {
    id: "unfinished_request",
    input: "I want to set an appointment for...",
    expectedAction: "ask_completion",
  },
  {
    id: "day",
    input: "Monday.",
    expectedAction: "ask_service",
  },
  {
    id: "service",
    input: "A gentleman's cut.",
    expectedAction: "ask_time",
  },
  {
    id: "time",
    input: "Half past eleven.",
    expectedAction: "check_availability",
  },
  {
    id: "name",
    input: "Michael.",
    expectedAction: "ask_phone",
  },
  {
    id: "incomplete_phone",
    input: "Plus forty-four, three four four, three five six zero nine.",
    expectedAction: "ask_complete_phone",
  },
  {
    id: "complete_phone",
    input: "Start again: zero seven four four three, four four three, five three two.",
    expectedAction: "summarize_confirmation",
  },
  {
    id: "confirmed_booking",
    input: "Yes, I confirm.",
    expectedAction: "create_booking",
  },
  {
    id: "goodbye",
    input: "Thank you so much.",
    expectedAction: "close",
  },
  {
    id: "faq_hours",
    input: "What time are you open?",
    context: "Independent new call.",
    expectedAction: "answer_fact",
  },
  {
    id: "vague_request",
    input: "I need something doing with my hair.",
    context: "Independent new call.",
    expectedAction: "ask_completion",
  },
  {
    id: "time_correction",
    input: "Sorry, I meant half four, not half three.",
    context: "The caller previously asked for Tuesday at half three.",
    expectedAction: "accept_correction",
  },
  {
    id: "frustrated_caller",
    input: "I've already explained this twice and I'm getting frustrated.",
    context: "The caller wants a haircut but no date has been established.",
    expectedAction: "acknowledge_and_help",
  },
  {
    id: "human_request",
    input: "I'd rather speak to someone at the salon, please.",
    context: "The agent has already offered to help with the booking.",
    expectedAction: "transfer_to_human",
  },
] as const;

function evaluationPrompt() {
  return `${compilePrompt({
    client: bladesHairSeed(),
    direction: "inbound",
    objective: "Browser provider comparison",
    compactVoice: true,
  })}

Quality evaluation only: for every case return one decision. Do not execute tools.
The first nine cases through "goodbye" are one continuous conversation in listed order.
Cases with a context field are independent new calls; use only that case's context and input.
Return strict JSON: {"cases":[{"id":"...","nextAction":"...","spokenReply":"..."}]}.
Allowed nextAction values: ask_completion, ask_service, ask_time, check_availability, ask_phone, ask_complete_phone, summarize_confirmation, create_booking, close, answer_fact, accept_correction, acknowledge_and_help, transfer_to_human.
Never invent a calendar slot or phone digit. A spokenReply must contain only customer-facing speech.`;
}

export function scoreDecisions(decisions: Decision[]): Pick<ModelResult, "score" | "passed" | "failed"> {
  const passed: string[] = [];
  const failed: string[] = [];
  const byId = new Map(decisions.map((item) => [item.id, item]));
  for (const scenario of CASES) {
    const decision = byId.get(scenario.id);
    const reply = decision?.spokenReply || "";
    const checks: Array<[string, boolean]> = [
      ["action", decision?.nextAction === scenario.expectedAction],
      ["concise", reply.length > 0 && reply.length <= 280],
      ["no_meta", !/the user|i should|analysis|reasoning|system prompt/i.test(reply)],
      ["not_robotic", !/how may i assist|please provide|kindly provide|your request has been|as an ai|language model/i.test(reply)],
    ];
    if (scenario.id === "time") {
      checks.push(["no_invented_slot", !/\b(10|11|12)(?::\d\d)?\s*(am|pm|o'clock)\b/i.test(reply)]);
    }
    if (scenario.id === "incomplete_phone") {
      checks.push(["asks_full_number", /complete|beginning|from the start|start again|full number|repeat|once more|mobile number|number again/i.test(reply)]);
      checks.push(["no_reconstructed_number", !/07443\s*443532|\+447443443532/.test(reply.replace(/[()-]/g, ""))]);
    }
    if (["service", "time", "name", "incomplete_phone", "complete_phone"].includes(scenario.id)) {
      checks.push(["does_not_restart_day", !/which day|what day|preferred day/i.test(reply)]);
    }
    if (["time", "name", "incomplete_phone", "complete_phone"].includes(scenario.id)) {
      checks.push(["does_not_repeat_service", !/which service|what service|cut, colour|highlights/i.test(reply)]);
    }
    if (scenario.id !== "complete_phone" && scenario.id !== "confirmed_booking") {
      checks.push(["one_question", (reply.match(/\?/g) || []).length <= 1]);
    }
    if (scenario.id === "faq_hours") {
      checks.push(["correct_hours", /(?:weekdays|monday).*(?:ten|10).*(?:seven|7)/i.test(reply)]);
      checks.push(["answers_first", !/^(?:would|could|may|can) you/i.test(reply)]);
    }
    if (scenario.id === "time_correction") {
      checks.push(["uses_correction", /half (?:past )?four|4(?::30)?/i.test(reply)]);
      checks.push(["no_blame", !/you said|your mistake|wrong/i.test(reply)]);
    }
    if (scenario.id === "frustrated_caller") {
      checks.push(["acknowledges_feeling", /sorry|understand|frustrat|not to worry|sort this/i.test(reply)]);
    }
    if (scenario.id === "human_request") {
      checks.push(["warm_handoff", /of course|certainly|team|connect|put you through|someone/i.test(reply)]);
    }
    const failures = checks.filter(([, ok]) => !ok).map(([name]) => name);
    const target = failures.length
      ? `${scenario.id}:fail(${failures.join(",")})`
      : `${scenario.id}:pass`;
    (failures.length ? failed : passed).push(target);
  }
  return { score: passed.length, passed, failed };
}

function parseDecisions(text: string): Decision[] {
  const parsed = JSON.parse(text) as { cases?: Decision[] };
  return Array.isArray(parsed.cases) ? parsed.cases : [];
}

async function evaluateGroq(system: string): Promise<ModelResult> {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) throw new Error("GROQ_API_KEY_missing");
  const model = process.env.GROQ_LLM_MODEL?.trim() || "openai/gpt-oss-120b";
  const started = Date.now();
  const result = await new Groq({ apiKey }).chat.completions.create({
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: JSON.stringify(CASES) },
    ],
    response_format: { type: "json_object" },
    temperature: 0,
    max_completion_tokens: 1_600,
    reasoning_effort: "low",
  });
  const scored = scoreDecisions(parseDecisions(result.choices[0]?.message.content || "{}"));
  return {
    provider: "groq",
    model,
    latencyMs: Date.now() - started,
    inputTokens: result.usage?.prompt_tokens || 0,
    outputTokens: result.usage?.completion_tokens || 0,
    ...scored,
  };
}

async function evaluateGoogle(system: string): Promise<ModelResult> {
  const apiKey = (process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY)?.trim();
  if (!apiKey) throw new Error("GOOGLE_API_KEY_missing");
  const model = process.env.COST_SAVER_GOOGLE_EVAL_MODEL?.trim() ||
    process.env.GEMINI_LLM_MODEL?.trim() ||
    "gemini-3.6-flash";
  const started = Date.now();
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: JSON.stringify(CASES) }] }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 1_600,
          responseMimeType: "application/json",
        },
      }),
    },
  );
  const payload = await response.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    error?: { message?: string };
  };
  if (!response.ok) throw new Error(`google_evaluation_failed:${payload.error?.message || response.status}`);
  const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "{}";
  const scored = scoreDecisions(parseDecisions(text));
  return {
    provider: "google",
    model,
    latencyMs: Date.now() - started,
    inputTokens: payload.usageMetadata?.promptTokenCount || 0,
    outputTokens: payload.usageMetadata?.candidatesTokenCount || 0,
    ...scored,
  };
}

async function main() {
  const system = evaluationPrompt();
  const results = await Promise.allSettled([
    evaluateGroq(system),
    evaluateGoogle(system),
  ]);
  const completed = results.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : []);
  const errors = results.flatMap((result, index) =>
    result.status === "rejected"
      ? [{ provider: index === 0 ? "groq" : "google", error: String(result.reason?.message || result.reason) }]
      : []);
  const ranked = completed.sort((left, right) =>
    right.score - left.score || left.latencyMs - right.latencyMs || left.inputTokens - right.inputTokens);
  console.log(JSON.stringify({ ok: ranked[0]?.score === CASES.length, recommended: ranked[0]?.provider, results: ranked, errors }));
  if (!ranked.length || ranked[0]!.score < CASES.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  void main();
}
