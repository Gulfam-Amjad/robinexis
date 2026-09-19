import { config as loadEnv } from "dotenv";
import twilio from "twilio";

loadEnv({ path: ".env", quiet: true });
if (process.env.CONFIRM_STAGING_CALL !== "true") {
  throw new Error("CONFIRM_STAGING_CALL=true is required");
}
const to = process.argv[2];
if (!to?.match(/^\+[1-9]\d{7,14}$/) || to === "+447446868067") {
  throw new Error("a non-protected E.164 staging number is required");
}
const from = process.env.STAGING_CANARY_CALLER_ID || to;
if (!from.match(/^\+[1-9]\d{7,14}$/) || from === "+447446868067") {
  throw new Error("a non-protected staging caller ID is required");
}
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const call = await client.calls.create({
  to,
  from,
  twiml: `<Response>
    <Pause length="3"/>
    <Say voice="Polly.Amy">Hello. I would like to book an appointment. What times are available tomorrow afternoon?</Say>
    <Pause length="8"/>
    <Say voice="Polly.Amy">Please book the first available appointment. My name is Robin Test.</Say>
    <Pause length="12"/>
  </Response>`,
  timeout: 30,
});
let current = call;
for (let attempt = 0; attempt < 24 && !["completed", "busy", "failed", "no-answer", "canceled"].includes(current.status); attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 2_500));
  current = await client.calls(call.sid).fetch();
}
console.log(JSON.stringify({
  ok: current.status === "completed",
  callSid: call.sid,
  status: current.status,
  durationSeconds: Number(current.duration || 0),
  direction: current.direction,
}));
if (current.status !== "completed") process.exitCode = 1;
