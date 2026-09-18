import twilio from "twilio";

async function jsonRequest(name, url, init) {
  const response = await fetch(url, init);
  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {}
  if (!response.ok) return { ok: false, status: response.status };
  return { ok: true, status: response.status, body };
}

const result = {};

try {
  const client = twilio(process.env.TWILIO_ACCOUNT_SID || "", process.env.TWILIO_AUTH_TOKEN || "");
  const [account, numbers] = await Promise.all([
    client.api.v2010.accounts(process.env.TWILIO_ACCOUNT_SID).fetch(),
    client.incomingPhoneNumbers.list({ limit: 20 }),
  ]);
  result.twilio = {
    ok: account.status === "active",
    active: account.status === "active",
    numberCount: numbers.length,
    containsProtectedBladesNumber: numbers.some((number) => number.phoneNumber === "+447446868067"),
  };
} catch (error) {
  result.twilio = { ok: false, error: error instanceof Error ? error.name : "TwilioError" };
}

const eleven = await jsonRequest("elevenlabs", "https://api.elevenlabs.io/v1/user/subscription", {
  headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY || "" },
});
result.elevenlabs = {
  ok: eleven.ok,
  status: eleven.status,
  tier: eleven.ok ? eleven.body.tier : undefined,
};

const cal = await jsonRequest("calcom", "https://api.cal.com/v2/event-types", {
  headers: {
    Authorization: `Bearer ${process.env.CALCOM_API_KEY || ""}`,
    "cal-api-version": "2024-06-14",
  },
});
result.calcom = {
  ok: cal.ok,
  status: cal.status,
  eventTypeCount: cal.ok && Array.isArray(cal.body.data) ? cal.body.data.length : undefined,
};

const stripe = await jsonRequest("stripe", "https://api.stripe.com/v1/account", {
  headers: {
    Authorization: `Basic ${Buffer.from(`${process.env.STRIPE_SECRET_KEY || ""}:`).toString("base64")}`,
  },
});
result.stripe = {
  ok: stripe.ok,
  status: stripe.status,
  livemode: stripe.ok ? Boolean(stripe.body.charges_enabled && !process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_")) : undefined,
  testMode: Boolean(process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_")),
};

console.log(JSON.stringify(result));
if (Object.values(result).some((provider) => !provider.ok)) process.exitCode = 1;
