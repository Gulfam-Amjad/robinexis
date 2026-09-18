import { llm, type FunctionTool } from "@livekit/agents";
import { TOOL_DEFINITIONS, type ToolName } from "@robinexis/tool-contracts";
import type { ToolHistoryItem } from "./contracts.js";
import { runtimeLog } from "./logger.js";

export const VOICE_TOOL_NAMES = [
  "get_business_info",
  "search_knowledge",
  "check_availability",
  "create_booking",
  "reschedule_booking",
  "cancel_booking",
  "create_callback",
  "transfer_to_human",
] as const satisfies readonly ToolName[];

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
  const allowed = new Set<ToolName>(VOICE_TOOL_NAMES);
  return TOOL_DEFINITIONS.filter((definition) => allowed.has(definition.name))
    .map((definition) => llm.tool<unknown, any>({
    name: definition.name,
    description: definition.description,
    // The contracts are deeply readonly; clone to the SDK's mutable JSONSchema7 shape.
    parameters: JSON.parse(JSON.stringify(definition.input_schema)),
    execute: async (args: Record<string, unknown>) => {
      const startedAt = Date.now();
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
        item.result = result;
        if (!response.ok) {
          runtimeLog("voice_runtime_tool_completed", {
            tool: definition.name,
            durationMs: Date.now() - startedAt,
            status: "rejected",
            errorType: response.status === 429 ? "rate_limit" : "validation_or_provider",
          });
          // Keep the structured API error in the LLM context so it can ask for
          // corrected input or offer a retry instead of going silent.
          return result;
        }
        runtimeLog("voice_runtime_tool_completed", {
          tool: definition.name,
          durationMs: Date.now() - startedAt,
          status: "ok",
        });
        return result;
      } catch (error) {
        item.error = error instanceof Error ? error.message : "voice_tool_failed";
        runtimeLog("voice_runtime_tool_completed", {
          tool: definition.name,
          durationMs: Date.now() - startedAt,
          status: "error",
          errorType: classifyToolError(item.error),
        });
        throw error;
      }
    },
  }));
}

function classifyToolError(message: string): string {
  if (/429|rate.limit/i.test(message)) return "rate_limit";
  if (/calendar/i.test(message)) return "calendar";
  if (/phone/i.test(message)) return "phone_validation";
  return "provider";
}

export function toolPath(name: ToolName): string {
  return name.replaceAll("_", "-");
}
