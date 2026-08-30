import type { CallSession } from "@robinexis/database";

/** Verified transcript + tool results only; strip likely payment data. */
export function noteFromCall(call: CallSession): { crmSummary: string; calendarSummary: string } {
  const tools = call.toolHistory
    .filter((t) => !t.error)
    .map((t) => `${t.name}: ${summarise(t.result)}`)
    .join("; ");
  const callerBits = call.transcript.filter((t) => t.role === "caller").map((t) => t.text);
  const cleaned = callerBits.map(redactSensitiveText).join(" | ");
  const crmSummary = [
    `Direction: ${call.direction}. Objective: ${call.objective}. Outcome: ${call.outcome ?? call.status}.`,
    cleaned ? `Caller: ${cleaned}` : "",
    tools ? `Actions: ${tools}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const calendarSummary = `Call ${call.id}: ${call.outcome ?? call.status}. ${tools || "No calendar tool result."}`.slice(
    0,
    500,
  );
  return { crmSummary, calendarSummary };
}

function summarise(result: unknown): string {
  try {
    const s = JSON.stringify(result);
    return s.length > 180 ? s.slice(0, 177) + "..." : s;
  } catch {
    return "";
  }
}

export function redactSensitiveText(text: string): string {
  return text
    .replace(/\b(?:\d[ -]*?){13,19}\b/g, "[card redacted]")
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[id redacted]");
}
