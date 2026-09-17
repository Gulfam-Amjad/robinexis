import { beforeEach, describe, expect, it } from "vitest";
import {
  createTwilioOAuthState,
  decryptTwilioCredential,
  encryptTwilioCredential,
  verifyTwilioOAuthState,
} from "./twilioOAuth.js";

beforeEach(() => {
  process.env.TWILIO_OAUTH_STATE_SECRET = "state-secret-for-tests";
  process.env.TWILIO_OAUTH_ENCRYPTION_KEY = "encryption-secret-for-tests";
});

describe("Twilio OAuth security", () => {
  it("round-trips encrypted credentials without exposing plaintext", () => {
    const encrypted = encryptTwilioCredential("api-key-secret");
    expect(encrypted).not.toContain("api-key-secret");
    expect(decryptTwilioCredential(encrypted)).toBe("api-key-secret");
  });

  it("signs tenant state and rejects tampering or expiry", () => {
    const now = new Date("2026-09-07T08:00:00.000Z");
    const state = createTwilioOAuthState({
      clientId: "client_test",
      returnTo: "https://app.robinexis.com/onboarding",
      now,
    });
    expect(verifyTwilioOAuthState(state, now)).toEqual({
      clientId: "client_test",
      returnTo: "https://app.robinexis.com/onboarding",
    });
    expect(() => verifyTwilioOAuthState(`${state}x`, now)).toThrow("invalid_twilio_oauth_state");
    expect(() => verifyTwilioOAuthState(state, new Date(now.getTime() + 11 * 60_000)))
      .toThrow("expired_twilio_oauth_state");
  });
});
