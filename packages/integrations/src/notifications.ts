import { twilioClient } from "./twilioOutbound.js";

export async function sendNotification(input: {
  channel: "sms" | "email";
  to: string;
  template: string;
  bookingUid?: string;
}): Promise<{ providerId: string }> {
  if (input.channel !== "sms") throw new Error("email_provider_not_configured");
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
