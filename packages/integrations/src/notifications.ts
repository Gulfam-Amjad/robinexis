import { twilioClient } from "./twilioOutbound.js";
import { structuredLog } from "@robinexis/database";

export async function sendNotification(input: {
  channel: "sms" | "email" | "whatsapp";
  to: string;
  template: string;
  bookingUid?: string;
  idempotencyKey?: string;
  payload?: Record<string, unknown>;
}): Promise<{ providerId: string }> {
  if (input.channel === "email") {
    if (process.env.EMAIL_DELIVERY_MODE === "log") {
      structuredLog("customer_email_captured", { to: input.to, template: input.template.slice(0, 80) });
      return { providerId: `captured_${Date.now()}` };
    }
    const apiKey = process.env.RESEND_API_KEY || "";
    const from = process.env.NOTIFICATION_FROM_EMAIL || "";
    if (!apiKey || !from) throw new Error("email_provider_not_configured");
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(input.idempotencyKey ? { "Idempotency-Key": input.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from,
        to: [input.to],
        subject: input.template.split("\n")[0].slice(0, 160),
        text: input.template,
      }),
    });
    if (!response.ok) throw new Error(`email_delivery_failed_${response.status}`);
    const result = await response.json() as { id?: string };
    if (!result.id) throw new Error("email_delivery_id_missing");
    return { providerId: result.id };
  }
  const client = twilioClient();
  const from = input.channel === "whatsapp"
    ? String(input.payload?.from || "")
    : process.env.TWILIO_SMS_NUMBER || process.env.TWILIO_PHONE_NUMBER || "";
  if (!client || !from) throw new Error(`twilio_${input.channel}_not_configured`);
  const to = input.channel === "whatsapp" && !input.to.startsWith("whatsapp:")
    ? `whatsapp:${input.to}`
    : input.to;
  const normalizedFrom = input.channel === "whatsapp" && !from.startsWith("whatsapp:")
    ? `whatsapp:${from}`
    : from;
  const contentSid = typeof input.payload?.contentSid === "string" ? input.payload.contentSid : undefined;
  const contentVariables = input.payload?.contentVariables &&
    typeof input.payload.contentVariables === "object"
    ? JSON.stringify(input.payload.contentVariables)
    : undefined;
  const callbackBase = (process.env.API_PUBLIC_BASE_URL || "").replace(/\/$/, "");
  const notificationId = typeof input.payload?.notificationId === "string"
    ? input.payload.notificationId
    : undefined;
  const clientId = typeof input.payload?.clientId === "string" ? input.payload.clientId : undefined;
  const message = await client.messages.create({
    to,
    from: normalizedFrom,
    ...(contentSid
      ? { contentSid, contentVariables }
      : { body: input.template }),
    ...(input.channel === "whatsapp" && callbackBase && notificationId && clientId
      ? {
          statusCallback: `${callbackBase}/webhooks/twilio/whatsapp/status?clientId=${encodeURIComponent(clientId)}&notificationId=${encodeURIComponent(notificationId)}`,
        }
      : {}),
  });
  return { providerId: message.sid };
}
