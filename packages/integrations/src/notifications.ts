import { twilioClient } from "./twilioOutbound.js";
import { structuredLog } from "@robinexis/database";

export async function sendNotification(input: {
  channel: "sms" | "email";
  to: string;
  template: string;
  bookingUid?: string;
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
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
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
  const from = process.env.TWILIO_SMS_NUMBER || process.env.TWILIO_PHONE_NUMBER;
  if (!client || !from) throw new Error("twilio_sms_not_configured");
  const message = await client.messages.create({
    to: input.to,
    from,
    body: input.template,
  });
  return { providerId: message.sid };
}
