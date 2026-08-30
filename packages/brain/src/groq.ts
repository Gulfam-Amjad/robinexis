import Groq from "groq-sdk";
import type {
  ChatCompletionChunk,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "groq-sdk/resources/chat/completions";
import type { LlmDriver, LlmMessage, LlmTurn } from "./llm.js";

type ReasoningEffort = "none" | "default" | "low" | "medium" | "high";

function reasoningEffort(value = process.env.GROQ_REASONING_EFFORT): ReasoningEffort {
  return value === "none" ||
    value === "default" ||
    value === "medium" ||
    value === "high"
    ? value
    : "low";
}

export class GroqDriver implements LlmDriver {
  private client: Groq;

  constructor(
    apiKey = process.env.GROQ_API_KEY ?? "",
    private model = process.env.GROQ_LLM_MODEL || "openai/gpt-oss-120b",
  ) {
    if (!apiKey) throw new Error("GROQ_API_KEY is required for the conversational brain");
    this.client = new Groq({ apiKey });
  }

  async complete(args: Parameters<LlmDriver["complete"]>[0]): Promise<LlmTurn> {
    const messages: ChatCompletionMessageParam[] = [
      ...toGroqMessages(args.system, args.messages),
    ];
    const tools: ChatCompletionTool[] = args.tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.input_schema,
      },
    }));

    const stream = await this.client.chat.completions.create(
      {
        model: this.model,
        messages,
        tools,
        tool_choice: "auto",
        max_completion_tokens: 1024,
        reasoning_effort: reasoningEffort(),
        stream: true,
      },
      { signal: args.signal },
    );
    return accumulateGroqStream(stream, args.stream);
  }
}

export async function accumulateGroqStream(
  stream: AsyncIterable<ChatCompletionChunk>,
  callbacks?: Parameters<LlmDriver["complete"]>[0]["stream"],
): Promise<LlmTurn> {
  const content: string[] = [];
  const toolBuffers = new Map<number, { id: string; name: string; arguments: string }>();
  let stopReason: string | undefined;
  let toolCallStarted = false;

  for await (const chunk of stream) {
    const choice = chunk.choices[0];
    if (!choice) continue;
    const delta = choice.delta;
    if (delta.content) {
      content.push(delta.content);
      callbacks?.onTextDelta?.(delta.content);
    }
    for (const toolCall of delta.tool_calls ?? []) {
      if (!toolCallStarted) {
        toolCallStarted = true;
        callbacks?.onToolCallStart?.();
      }
      const current = toolBuffers.get(toolCall.index) ?? {
        id: "",
        name: "",
        arguments: "",
      };
      if (toolCall.id) current.id = toolCall.id;
      if (toolCall.function?.name) current.name += toolCall.function.name;
      if (toolCall.function?.arguments) current.arguments += toolCall.function.arguments;
      toolBuffers.set(toolCall.index, current);
    }
    if (choice.finish_reason) stopReason = choice.finish_reason;
  }

  const toolCalls = [...toolBuffers.entries()]
    .sort(([left], [right]) => left - right)
    .map(([index, call]) => ({
      id: call.id || `tool-${index}`,
      name: call.name,
      input: parseArguments(call.arguments),
    }));

  return {
    text: content.join("").trim() || undefined,
    toolCalls,
    stopReason,
  };
}

export function toGroqMessages(
  system: string,
  messages: LlmMessage[],
): ChatCompletionMessageParam[] {
  return [{ role: "system", content: system }, ...messages.map(toGroqMessage)];
}

export function turnFromGroqMessage(
  message:
    | {
        content?: string | null;
        tool_calls?: Array<{
          id: string;
          type: string;
          function: { name: string; arguments: string };
        }>;
      }
    | undefined,
  finishReason?: string | null,
): LlmTurn {
  const toolCalls = (message?.tool_calls ?? [])
      .filter((call) => call.type === "function")
      .map((call) => ({
        id: call.id,
        name: call.function.name,
        input: parseArguments(call.function.arguments),
      }));

  return {
    text: message?.content?.trim() || undefined,
    toolCalls,
    stopReason: finishReason ?? undefined,
  };
}

function toGroqMessage(message: LlmMessage): ChatCompletionMessageParam {
  if (message.role === "tool") {
    return { role: "tool", tool_call_id: message.toolCallId, content: message.content };
  }
  if ("toolCalls" in message) {
    return {
      role: "assistant",
      content: message.content ?? null,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: "function" as const,
        function: { name: call.name, arguments: JSON.stringify(call.input) },
      })),
    };
  }
  return { role: message.role, content: message.content };
}

function parseArguments(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
