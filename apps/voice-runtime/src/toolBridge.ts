import { llm, type FunctionTool } from "@livekit/agents";
import { TOOL_DEFINITIONS, type ToolName } from "@robinexis/tool-contracts";
import type { ToolHistoryItem } from "./contracts.js";

export interface ToolBridgeOptions {
  apiBaseUrl: string;
  tenantId: string;
  toolSecret: string;
  callId: string;
  history: ToolHistoryItem[];
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

export function createToolBridge(options: ToolBridgeOptions): FunctionTool<any>[] {
  const fetchImpl = options.fetchImpl || fetch;
  const now = options.now || (() => new Date());
  return TOOL_DEFINITIONS.map((definition) => llm.tool<unknown, any>({
    name: definition.name,
    description: definition.description,
    // The contracts are deeply readonly; clone to the SDK's mutable JSONSchema7 shape.
    parameters: JSON.parse(JSON.stringify(definition.input_schema)),
    execute: async (args: Record<string, unknown>) => {
      const input = { ...args, conversationId: options.callId };
      delete (input as Record<string, unknown>).clientId;
      delete (input as Record<string, unknown>).tenantId;
      const item: ToolHistoryItem = {
        name: definition.name,
        input,
        at: now().toISOString(),
      };
      options.history.push(item);
      try {
        const response = await fetchImpl(
          `${options.apiBaseUrl.replace(/\/$/, "")}/api/v1/voice-tools/${toolPath(definition.name)}`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-voice-tool-secret": options.toolSecret,
              "x-voice-tool-tenant": options.tenantId,
            },
            body: JSON.stringify(input),
          },
        );
        const result = await response.json() as unknown;
        if (!response.ok) throw new Error(`voice_tool_${response.status}`);
        item.result = result;
        return result;
      } catch (error) {
        item.error = error instanceof Error ? error.message : "voice_tool_failed";
        throw error;
      }
    },
  }));
}

export function toolPath(name: ToolName): string {
  return name.replaceAll("_", "-");
}
