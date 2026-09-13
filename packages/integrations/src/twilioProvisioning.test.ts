import { describe, expect, it } from "vitest";
import { findOwnedTwilioNumber } from "./twilioProvisioning.js";

describe("Twilio SaaS number provisioning", () => {
  it("rejects malformed pasted numbers before contacting Twilio", async () => {
    await expect(findOwnedTwilioNumber("0113 496 0001"))
      .rejects.toThrow("valid_e164_phone_number_required");
  });
});
