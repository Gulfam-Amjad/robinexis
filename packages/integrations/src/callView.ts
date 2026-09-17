import type {
  CallSession,
  ToolHistoryEntry,
  TranscriptTurn,
} from "@robinexis/database";

export type PublicDemoCallView = {
  id: string;
  twilioCallSid?: string;
  direction: string;
  status: string;
  outcome?: string;
  contactPhone?: string;
  transcript: TranscriptTurn[];
  toolHistory: ToolHistoryEntry[];
  createdAt: string;
  updatedAt: string;
};

export function publicDemoCallView(call: CallSession): PublicDemoCallView {
  return {
    id: call.id,
    twilioCallSid: call.twilioCallSid,
    direction: call.direction,
    status: call.status,
    outcome: call.outcome,
    contactPhone: call.contactPhone,
    transcript: call.transcript,
    toolHistory: call.toolHistory,
    createdAt: call.createdAt,
    updatedAt: call.updatedAt,
  };
}
