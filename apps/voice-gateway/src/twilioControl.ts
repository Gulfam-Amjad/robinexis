import twilio from "twilio";
import { config, FRONT_DESK_PLACEHOLDER } from "./config.js";
import { structuredLog } from "@robinexis/database";

const client = twilio(config.twilioAccountSid, config.twilioAuthToken);

function xmlEscape(value: string): string {
  return value.replace(/[<>&'"]/g, (c) =>
    c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === "&" ? "&amp;" : c === "'" ? "&apos;" : "&quot;",
  );
}

export function frontDeskConfigured(): boolean {
  return Boolean(config.frontDeskPhoneNumber) && config.frontDeskPhoneNumber !== FRONT_DESK_PLACEHOLDER;
}

/**
 * Immediately redirects a LIVE call away from the media stream to a TwiML
 * <Dial> to the front desk. Twilio's call-update API interrupts whatever
 * TwiML is currently executing (the <Connect><Stream> from /twiml) right
 * away — no need to wait for the WebSocket to close first.
 *
 * With no real front desk number configured, dialling the placeholder just
 * drops the call after the transfer prompt, so apologise and hang up instead.
 */
export async function transferCallToFrontDesk(
  callSid: string,
  reason: string,
  opts?: { callbackNumber?: string },
): Promise<void> {
  if (!frontDeskConfigured()) {
    structuredLog("transfer_without_front_desk", { callSid, reason });
    const apology = opts?.callbackNumber
      ? `Sorry, I can't complete this call right now. Please call us back on ${opts.callbackNumber}.`
      : "Sorry, I can't complete this call right now. Please try again shortly.";
    await client.calls(callSid).update({
      twiml:
        `<?xml version="1.0" encoding="UTF-8"?>` +
        `<Response><Say>${xmlEscape(apology)}</Say><Hangup/></Response>`,
    });
    return;
  }
  console.log(`[twilio] transferring call=${callSid} to front desk, reason="${reason}"`);
  const twiml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Response><Say>Connecting you now, one moment.</Say><Dial>${xmlEscape(config.frontDeskPhoneNumber)}</Dial></Response>`;
  await client.calls(callSid).update({ twiml });
}
