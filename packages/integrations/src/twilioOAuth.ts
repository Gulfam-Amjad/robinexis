import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const AUTHORIZE_URL = "https://oauth.twilio.com/v2/authorize";
const TOKEN_URL = "https://oauth.twilio.com/v2/token";

export interface TwilioOAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

function required(name: string): string {
  const value = process.env[name] || "";
  if (!value) throw new Error(`${name.toLowerCase()}_required`);
  return value;
}

function encryptionKey(): Buffer {
  return createHash("sha256").update(required("TWILIO_OAUTH_ENCRYPTION_KEY")).digest();
}

export function encryptTwilioCredential(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

export function decryptTwilioCredential(value: string): string {
  const [version, iv, tag, encrypted] = value.split(".");
  if (version !== "v1" || !iv || !tag || !encrypted) throw new Error("invalid_twilio_credential");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function createTwilioOAuthState(input: {
  clientId: string;
  returnTo: string;
  now?: Date;
}): string {
  const payload = Buffer.from(JSON.stringify({
    clientId: input.clientId,
    returnTo: input.returnTo,
    nonce: randomBytes(16).toString("base64url"),
    exp: Math.floor((input.now?.getTime() || Date.now()) / 1000) + 600,
  })).toString("base64url");
  const signature = createHmac("sha256", required("TWILIO_OAUTH_STATE_SECRET"))
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyTwilioOAuthState(state: string, now = new Date()): {
  clientId: string;
  returnTo: string;
} {
  const [payload, signature] = state.split(".");
  if (!payload || !signature) throw new Error("invalid_twilio_oauth_state");
  const expected = createHmac("sha256", required("TWILIO_OAUTH_STATE_SECRET"))
    .update(payload)
    .digest();
  const actual = Buffer.from(signature, "base64url");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new Error("invalid_twilio_oauth_state");
  }
  const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
    clientId?: string;
    returnTo?: string;
    exp?: number;
  };
  if (!decoded.clientId || !decoded.returnTo || !decoded.exp || decoded.exp < now.getTime() / 1000) {
    throw new Error("expired_twilio_oauth_state");
  }
  return { clientId: decoded.clientId, returnTo: decoded.returnTo };
}

export function twilioOAuthAuthorizeUrl(state: string): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", required("TWILIO_OAUTH_CLIENT_ID"));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "offline_access");
  url.searchParams.set("redirect_uri", required("TWILIO_OAUTH_REDIRECT_URI"));
  url.searchParams.set("state", state);
  return url.toString();
}

async function tokenRequest(params: Record<string, string>): Promise<TwilioOAuthTokens> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: required("TWILIO_OAUTH_CLIENT_ID"),
      client_secret: required("TWILIO_OAUTH_CLIENT_SECRET"),
      ...params,
    }),
  });
  const json = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(`twilio_oauth_token_failed:${String(json.error || response.status)}`);
  return {
    accessToken: String(json.access_token || ""),
    refreshToken: String(json.refresh_token || ""),
    expiresIn: Number(json.expires_in || 3600),
  };
}

export function exchangeTwilioOAuthCode(code: string): Promise<TwilioOAuthTokens> {
  return tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: required("TWILIO_OAUTH_REDIRECT_URI"),
  });
}

export function refreshTwilioOAuthToken(refreshToken: string): Promise<TwilioOAuthTokens> {
  return tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
}

export async function discoverTwilioAccountSid(accessToken: string): Promise<string> {
  let claims: Record<string, unknown> = {};
  try {
    claims = JSON.parse(
      Buffer.from(accessToken.split(".")[1] || "", "base64url").toString("utf8") || "{}",
    ) as Record<string, unknown>;
  } catch {
    claims = {};
  }
  const claimSid = [claims.account_sid, claims.sub].find((value) => String(value || "").startsWith("AC"));
  if (claimSid) return String(claimSid);
  const response = await fetch("https://api.twilio.com/2010-04-01/Accounts.json?PageSize=1", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const json = await response.json() as { accounts?: Array<{ sid?: string }> };
  const sid = json.accounts?.[0]?.sid;
  if (!response.ok || !sid) throw new Error("twilio_oauth_account_discovery_failed");
  return sid;
}
