import type { ClientConfig } from "@robinexis/database";

export function inCallingWindow(client: ClientConfig, at = new Date()): boolean {
  const { tz, startHour, endHour, skipSunday } = client.callingWindow;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "numeric",
    hour12: false,
    weekday: "short",
  }).formatToParts(at);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  if (skipSunday && weekday === "Sun") return false;
  return hour >= startHour && hour < endHour;
}

/** UK PECR/outbound: document review — block dials outside window and without suppression check. */
export const COMPLIANCE_NOTES = {
  jurisdiction: "UK",
  outbound: "Consent/lawful basis and opt-out must be checked before every dial. Calling window default 08:00-21:00 Europe/London, skip Sunday.",
  retention: "Call recordings/transcripts retained per client policy; default 90 days then delete from call_sessions.",
};
