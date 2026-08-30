import twilio from "twilio";

export function twilioClient() {
  const sid = process.env.TWILIO_ACCOUNT_SID ?? "";
  const token = process.env.TWILIO_AUTH_TOKEN ?? "";
  if (!sid || !token) return null;
  return twilio(sid, token);
}

export async function placeOutboundCall(opts: {
  to: string;
  from: string;
  twimlUrl: string;
  statusCallback?: string;
}) {
  const client = twilioClient();
  if (!client) throw new Error("twilio_not_configured");
  return client.calls.create({
    to: opts.to,
    from: opts.from,
    url: opts.twimlUrl,
    method: "POST",
    statusCallback: opts.statusCallback,
    statusCallbackEvent: ["completed", "busy", "no-answer", "failed"],
    machineDetection: "Enable",
  });
}

export function validateTwilioWebhook(
  signature: string,
  url: string,
  params: Record<string, string>,
): boolean {
  const token = process.env.TWILIO_AUTH_TOKEN ?? "";
  if (!token) return !process.env.RAILWAY_ENVIRONMENT;
  return twilio.validateRequest(token, signature, url, params);
}
