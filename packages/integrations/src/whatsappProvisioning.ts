export const ENABLE_MANAGED_WHATSAPP = "ENABLE_MANAGED_WHATSAPP";

export interface WhatsAppContentTemplateSpec {
  key: "confirmation" | "reminder" | "cancellation" | "outsideWindow";
  sidEnv: string;
  textEnv: string;
  friendlyName: string;
  body: string;
  variables: Record<string, string>;
}

export const ROBINEXIS_WHATSAPP_TEMPLATES: readonly WhatsAppContentTemplateSpec[] = [
  {
    key: "confirmation",
    sidEnv: "WHATSAPP_BOOKING_CONFIRMATION_CONTENT_SID",
    textEnv: "WHATSAPP_BOOKING_CONFIRMATION_TEMPLATE_TEXT",
    friendlyName: "robinexis_booking_confirmation",
    body: "Your appointment is confirmed. Booking reference: {{1}}.",
    variables: { "1": "booking_ref" },
  },
  {
    key: "reminder",
    sidEnv: "WHATSAPP_BOOKING_REMINDER_CONTENT_SID",
    textEnv: "WHATSAPP_BOOKING_REMINDER_TEMPLATE_TEXT",
    friendlyName: "robinexis_booking_reminder",
    body: "Reminder: your appointment starts at {{1}}. Booking reference: {{2}}.",
    variables: { "1": "start_time", "2": "booking_ref" },
  },
  {
    key: "cancellation",
    sidEnv: "WHATSAPP_CANCELLATION_FOLLOWUP_CONTENT_SID",
    textEnv: "WHATSAPP_CANCELLATION_FOLLOWUP_TEMPLATE_TEXT",
    friendlyName: "robinexis_cancellation_followup",
    body: "Your appointment {{1}} was cancelled. Reply if you would like help rebooking.",
    variables: { "1": "booking_ref" },
  },
  {
    key: "outsideWindow",
    sidEnv: "WHATSAPP_OUTSIDE_WINDOW_CONTENT_SID",
    textEnv: "WHATSAPP_OUTSIDE_WINDOW_TEMPLATE_TEXT",
    friendlyName: "robinexis_outside_window",
    body: "Please reply to continue this conversation with the salon.",
    variables: {},
  },
];

export function managedWhatsAppWebhookUrls(apiPublicBaseUrl: string): {
  inbound: string;
  status: string;
} | undefined {
  try {
    const publicBase = new URL(apiPublicBaseUrl.trim());
    if (publicBase.protocol !== "https:" || publicBase.pathname !== "/") return undefined;
    const base = `${publicBase.origin}`;
    return {
      inbound: `${base}/webhooks/twilio/whatsapp/inbound`,
      status: `${base}/webhooks/twilio/whatsapp/status`,
    };
  } catch {
    return undefined;
  }
}

export function contentTemplateCreateBody(spec: WhatsAppContentTemplateSpec): {
  friendlyName: string;
  language: string;
  variables: Record<string, string>;
  types: { "twilio/text": { body: string } };
} {
  return {
    friendlyName: spec.friendlyName,
    language: "en",
    variables: spec.variables,
    types: { "twilio/text": { body: spec.body } },
  };
}

export function findExistingContentSid(
  contents: Array<{ sid?: string; friendlyName?: string; friendly_name?: string }>,
  spec: WhatsAppContentTemplateSpec,
): string | undefined {
  const match = contents.find((item) =>
    (item.friendlyName || item.friendly_name) === spec.friendlyName);
  const sid = match?.sid?.trim();
  return sid || undefined;
}

/** Fill blank or missing keys only; never overwrite a non-empty assignment. */
export function upsertEnvAssignments(source: string, updates: Record<string, string>): string {
  const normalized = source.replace(/\r\n/g, "\n");
  const hadTrailingNewline = normalized.endsWith("\n");
  const lines = normalized.split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  const seen = new Set<string>();
  const next = lines.map((line) => {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match || updates[match[1]] === undefined) return line;
    seen.add(match[1]);
    return match[2].trim() === "" ? `${match[1]}=${updates[match[1]]}` : line;
  });
  for (const [key, value] of Object.entries(updates)) {
    if (!seen.has(key)) next.push(`${key}=${value}`);
  }
  return `${next.join("\n")}${hadTrailingNewline || next.length ? "\n" : ""}`;
}

export function whatsappEnvUpdates(input: {
  sids: Partial<Record<WhatsAppContentTemplateSpec["key"], string>>;
  enabled?: boolean;
}): Record<string, string> {
  const updates: Record<string, string> = {};
  for (const spec of ROBINEXIS_WHATSAPP_TEMPLATES) {
    const sid = input.sids[spec.key]?.trim();
    if (sid) updates[spec.sidEnv] = sid;
    updates[spec.textEnv] = spec.body;
  }
  updates.WHATSAPP_BOOKING_REMINDER_LEAD_HOURS = "1";
  if (input.enabled) {
    updates.WHATSAPP_ENABLED = "true";
    updates.WHATSAPP_BRAIN_PROCESSOR_ENABLED = "true";
  } else {
    updates.WHATSAPP_ENABLED = "false";
  }
  return updates;
}
