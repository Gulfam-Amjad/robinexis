import type { CallSession, ClientConfig } from "@robinexis/database";
import { TOOL_DEFINITIONS, type ToolName } from "@robinexis/tool-contracts";
import { compilePrompt, greetingFor } from "./compiler.js";
import type { LlmDriver, LlmMessage, LlmTurn } from "./llm.js";
import { redactSensitiveText } from "./notes.js";

export type ToolResult = { ok: true; data: unknown } | { ok: false; error: string };

export type ToolExecutor = (req: {
  name: ToolName;
  input: Record<string, unknown>;
  call: CallSession;
  client: ClientConfig;
}) => Promise<ToolResult>;

export type TurnResult =
  | { type: "speak"; text: string }
  | { type: "transfer"; reason: string }
  | { type: "aborted" };

export interface BrainStreamCallbacks {
  onTextDelta?: (text: string) => void;
  onSpeakCancel?: () => void;
}

const MAX_TOOL_ITERATIONS = 8;

export class BrainSession {
  private messages: LlmMessage[] = [];
  private currentAbort: AbortController | null = null;
  private readonly systemPrompt: string;

  constructor(
    private llm: LlmDriver,
    private tools: ToolExecutor,
    private client: ClientConfig,
    private call: CallSession,
    greeting?: string,
    frozenSystemPrompt?: string,
  ) {
    const g = greeting ?? greetingFor(client);
    this.messages.push({ role: "assistant", content: g });
    this.systemPrompt =
      frozenSystemPrompt ??
      compilePrompt({
        client,
        direction: call.direction,
        objective: call.objective,
      });
  }

  abortTurn() {
    this.currentAbort?.abort();
  }

  getCall() {
    return this.call;
  }

  async handleUserTurn(
    transcript: string,
    stream?: BrainStreamCallbacks,
  ): Promise<TurnResult> {
    const controller = new AbortController();
    this.currentAbort?.abort();
    this.currentAbort = controller;
    this.call.transcript.push({
      role: "caller",
      text: redactSensitiveText(transcript),
      at: new Date().toISOString(),
    });
    this.messages.push({ role: "user", content: transcript });

    const toolDefs = TOOL_DEFINITIONS.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema as Record<string, unknown>,
    }));

    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      if (controller.signal.aborted) return { type: "aborted" };
      let turn: LlmTurn;
      try {
        turn = await this.llm.complete({
          system: this.systemPrompt,
          messages: this.messages,
          tools: toolDefs,
          signal: controller.signal,
          stream: {
            onTextDelta: stream?.onTextDelta,
            onToolCallStart: stream?.onSpeakCancel,
          },
        });
      } catch (err) {
        if (controller.signal.aborted) return { type: "aborted" };
        throw err;
      }

      if (!turn.toolCalls.length) {
        const text = turn.text?.trim() || "Sorry, could you say that again?";
        this.messages.push({ role: "assistant", content: text });
        this.call.transcript.push({
          role: "agent",
          text: redactSensitiveText(text),
          at: new Date().toISOString(),
        });
        return { type: "speak", text };
      }

      const transfer = turn.toolCalls.find((c) => c.name === "transfer_to_human");
      if (transfer) {
        const reason = String(transfer.input.reason ?? "caller requested a human");
        return { type: "transfer", reason };
      }

      this.messages.push({
        role: "assistant",
        content: turn.text,
        toolCalls: turn.toolCalls,
      });

      for (const c of turn.toolCalls) {
        const result = await this.tools({
          name: c.name as ToolName,
          input: c.input,
          call: this.call,
          client: this.client,
        });
        this.call.toolHistory.push({
          name: c.name,
          input: c.input,
          result: result.ok ? result.data : undefined,
          error: result.ok ? undefined : result.error,
          at: new Date().toISOString(),
        });
        this.messages.push({
          role: "tool",
          toolCallId: c.id,
          content: JSON.stringify(result.ok ? result.data : { error: result.error }),
        });
      }
    }

    const fallback = "Sorry, I'm having trouble with that — let me get someone from the team to call you back.";
    this.call.transcript.push({ role: "agent", text: fallback, at: new Date().toISOString() });
    return { type: "speak", text: fallback };
  }
}
