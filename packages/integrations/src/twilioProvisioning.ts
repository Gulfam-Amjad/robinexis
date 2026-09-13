import twilio from "twilio";

export interface TwilioNumber {
  phoneNumber: string;
  sid?: string;
}

function managementClient() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID || "";
  const authToken = process.env.TWILIO_AUTH_TOKEN || "";
  if (!accountSid || !authToken) throw new Error("twilio_not_configured");
  return twilio(accountSid, authToken);
}

export async function findOwnedTwilioNumber(
  e164: string,
  credentials?: { accountSid: string; apiKeySid: string; apiKeySecret: string },
): Promise<TwilioNumber | undefined> {
  if (!e164.match(/^\+[1-9]\d{7,14}$/)) throw new Error("valid_e164_phone_number_required");
  const client = credentials
    ? twilio(credentials.apiKeySid, credentials.apiKeySecret, { accountSid: credentials.accountSid })
    : managementClient();
  const numbers = await client.incomingPhoneNumbers.list({ phoneNumber: e164, limit: 1 });
  const number = numbers[0];
  return number ? { phoneNumber: number.phoneNumber, sid: number.sid } : undefined;
}
