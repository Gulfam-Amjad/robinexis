import { createHash } from "node:crypto";
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

export interface BookingLedger {
  eventTypeSlug?: string;
  start?: string;
  offeredSlots?: string[];
  attendeeName?: string;
  attendeePhone?: string;
  callerConfirmed?: boolean;
  bookingUid?: string;
}

export function createToolBridge(options: ToolBridgeOptions): FunctionTool<any>[] {
  const fetchImpl = options.fetchImpl || fetch;
  const now = options.now || (() => new Date());
  const ledger: BookingLedger = {};
  const allowed = new Set<ToolName>(VOICE_TOOL_NAMES);
  return TOOL_DEFINITIONS.filter((definition) => allowed.has(definition.name))
    .map((definition) => llm.tool<unknown, any>({
    name: definition.name,
    description: definition.description,
    // The contracts are deeply readonly; clone to the SDK's mutable JSONSchema7 shape.
    parameters: JSON.parse(JSON.stringify(definition.input_schema)),
    execute: async (args: Record<string, unknown>) => {
      const startedAt = Date.now();
      const input = prepareToolInput(definition.name, args, ledger, options.callId);
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
          return withConversationState(result, ledger);
        }
        rememberBookingState(ledger, input, result);
        runtimeLog("voice_runtime_tool_completed", {
          tool: definition.name,
          durationMs: Date.now() - startedAt,
          status: "ok",
        });
        return withConversationState(result, ledger);
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

export function rememberBookingState(
  ledger: BookingLedger,
  input: Record<string, unknown>,
  result: unknown,
): BookingLedger {
  if (input.eventTypeSlug) ledger.eventTypeSlug = String(input.eventTypeSlug);
  const slots = result && typeof result === "object"
    ? (result as Record<string, unknown>).slots
    : undefined;
  if (Array.isArray(slots)) {
    ledger.offeredSlots = slots.filter((slot): slot is string => typeof slot === "string");
  } else if (input.start) {
    ledger.start = String(input.start);
  }
  if (input.attendeeName) ledger.attendeeName = String(input.attendeeName);
  if (input.attendeePhone) ledger.attendeePhone = String(input.attendeePhone);
  if (input.callerConfirmed === true) ledger.callerConfirmed = true;
  if (result && typeof result === "object") {
    const record = result as Record<string, unknown>;
    const bookingUid = record.bookingUid || record.uid;
    if (bookingUid) ledger.bookingUid = String(bookingUid);
  }
  return ledger;
}

export function prepareToolInput(
  name: ToolName,
  args: Record<string, unknown>,
  ledger: BookingLedger,
  callId: string,
): Record<string, unknown> {
  const input = { ...args, conversationId: callId };
  if (name !== "create_booking") return input;

  if (!input.eventTypeSlug && ledger.eventTypeSlug) input.eventTypeSlug = ledger.eventTypeSlug;
  if (!input.attendeeName && ledger.attendeeName) input.attendeeName = ledger.attendeeName;
  if (!input.attendeePhone && ledger.attendeePhone) input.attendeePhone = ledger.attendeePhone;

  const requestedStart = String(input.start || "");
  const canonicalStart = ledger.offeredSlots?.find(
    (slot) => Number.isFinite(Date.parse(requestedStart)) &&
      Date.parse(slot) === Date.parse(requestedStart),
  );
  if (canonicalStart) input.start = canonicalStart;

  if (!input.idempotencyKey) {
    const fingerprint = JSON.stringify({
      callId,
      eventTypeSlug: input.eventTypeSlug || "",
      start: input.start || "",
      attendeeName: String(input.attendeeName || "").trim().toLowerCase(),
      attendeePhone: String(input.attendeePhone || "").replace(/\D/g, ""),
    });
    input.idempotencyKey = `runtime-booking:${
      createHash("sha256").update(fingerprint).digest("hex")
    }`;
  }
  return input;
}

function withConversationState(result: unknown, ledger: BookingLedger): unknown {
  if (!Object.keys(ledger).length) return result;
  if (result && typeof result === "object" && !Array.isArray(result)) {
    return { ...result as Record<string, unknown>, conversationState: { ...ledger } };
  }
  return { result, conversationState: { ...ledger } };
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
