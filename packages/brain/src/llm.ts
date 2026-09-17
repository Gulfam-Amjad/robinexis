export interface LlmToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export type LlmMessage =
  | { role: "user" | "assistant"; content: string }
  | { role: "assistant"; content?: string; toolCalls: LlmToolCall[] }
  | { role: "tool"; toolCallId: string; content: string };

export interface LlmTurn {
  text?: string;
  toolCalls: LlmToolCall[];
  stopReason?: string;
}

export interface LlmStreamCallbacks {
  onTextDelta?: (text: string) => void;
  onToolCallStart?: () => void;
}

export interface LlmDriver {
  complete(args: {
    system: string;
    messages: LlmMessage[];
    tools: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>;
    signal?: AbortSignal;
    stream?: LlmStreamCallbacks;
  }): Promise<LlmTurn>;
}

export class ScriptedLlm implements LlmDriver {
  private i = 0;
  constructor(private script: LlmTurn[]) {}

  async complete(): Promise<LlmTurn> {
    const turn = this.script[Math.min(this.i, this.script.length - 1)];
    this.i++;
    return turn ?? { toolCalls: [], text: "Sorry, could you say that again?" };
  }
}
