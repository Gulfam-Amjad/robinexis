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

const CASES = [
  {
    id: "availability",
    input: "I want Monday at twelve. Is it available?",
    expectedAction: "check_availability",
  },
  {
    id: "silence",
    input: "We selected Monday at 11:30. You asked which service. I gave no clear answer.",
    expectedAction: "ask_service",
  },
  {
    id: "incomplete_phone",
    input: "We selected Monday at 11:30 for a gentleman's cut. My number is +44 34435609, then I add 443443532.",
    expectedAction: "ask_complete_phone",
  },
  {
    id: "confirmed_booking",
    input: "I explicitly confirm Monday at 11:30, gentleman's cut, Michael, mobile 07443 443532.",
    expectedAction: "create_booking",
  },
  {
    id: "goodbye",
    input: "Thank you so much.",
    expectedAction: "close",
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
Return strict JSON: {"cases":[{"id":"...","nextAction":"...","spokenReply":"..."}]}.
Allowed nextAction values: check_availability, ask_service, ask_complete_phone, create_booking, close.
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
    ];
    if (scenario.id === "availability") {
      checks.push(["no_invented_slot", !/\b(10|11|12)(?::\d\d)?\s*(am|pm|o'clock)\b/i.test(reply)]);
    }
    if (scenario.id === "incomplete_phone") {
      checks.push(["asks_full_number", /complete|beginning|from the start|start again|full number|repeat|once more|mobile number|number again/i.test(reply)]);
      checks.push(["no_reconstructed_number", !/07443\s*443532|\+447443443532/.test(reply.replace(/[()-]/g, ""))]);
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
    max_completion_tokens: 700,
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
          maxOutputTokens: 700,
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
