import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PROTECTED_TWILIO_NUMBER,
  TwilioManagedNeedsAttentionError,
  findOwnedTwilioNumber,
  provisionManagedTwilioNumber,
  type TwilioManagedProvisioningRequest,
  type TwilioManagementAdapter,
} from "./twilioProvisioning.js";

const request: TwilioManagedProvisioningRequest = {
  clientId: "client_test",
  tenantSlug: "test",
  operationKey: "phone-op-1",
  countryCode: "GB",
  numberType: "local",
  selectedPhoneNumber: "+442079460123",
  friendlyName: "Test main line",
  voiceUrl: "https://api.example.test/webhooks/twilio/voice",
  statusCallbackUrl: "https://api.example.test/webhooks/twilio/status",
  confirmedBy: "owner_test",
  confirmsPurchaseCost: true,
  confirmsRegulatoryRequirements: true,
  monthlySpendCapPence: 2_000,
  estimatedMonthlyCostPence: 500,
};

function adapter(overrides: Partial<TwilioManagementAdapter> = {}): TwilioManagementAdapter {
  return {
    findSubaccount: vi.fn(async () => ({ sid: "ACnew", friendlyName: "robinexis:client_test" })),
    createSubaccount: vi.fn(async () => ({ sid: "ACnew", friendlyName: "robinexis:client_test" })),
    searchAvailableNumbers: vi.fn(async () => [{ phoneNumber: "+442079460123" }]),
    purchaseNumber: vi.fn(async () => ({
      sid: "PNnew",
      phoneNumber: "+442079460123",
      accountSid: "ACnew",
    })),
    configureNumber: vi.fn(async () => undefined),
    ...overrides,
  };
}

afterEach(() => {
  delete process.env.TWILIO_MANAGED_PROVISIONING_ENABLED;
});

describe("Twilio SaaS number provisioning", () => {
  it("rejects malformed pasted numbers before contacting Twilio", async () => {
    await expect(findOwnedTwilioNumber("0113 496 0001"))
      .rejects.toThrow("valid_e164_phone_number_required");
  });

  it("does not contact Twilio while managed provisioning is disabled", async () => {
    const provider = adapter();
    await expect(provisionManagedTwilioNumber(request, provider))
      .rejects.toThrow("twilio_managed_provisioning_disabled");
    expect(provider.findSubaccount).not.toHaveBeenCalled();
  });

  it("blocks the protected Blades tenant and number", async () => {
    process.env.TWILIO_MANAGED_PROVISIONING_ENABLED = "true";
    const provider = adapter();
    await expect(provisionManagedTwilioNumber({
      ...request,
      selectedPhoneNumber: PROTECTED_TWILIO_NUMBER,
    }, provider)).rejects.toThrow("protected_blades_twilio_resource");
    await expect(provisionManagedTwilioNumber({
      ...request,
      clientId: "client_blades_hair",
    }, provider)).rejects.toThrow("protected_blades_twilio_resource");
    expect(provider.findSubaccount).not.toHaveBeenCalled();
  });

  it("finds an existing subaccount and purchases only the selected eligible number", async () => {
    process.env.TWILIO_MANAGED_PROVISIONING_ENABLED = "true";
    const provider = adapter();
    const result = await provisionManagedTwilioNumber(request, provider);
    expect(provider.createSubaccount).not.toHaveBeenCalled();
    expect(provider.purchaseNumber).toHaveBeenCalledOnce();
    expect(provider.configureNumber).toHaveBeenCalledWith(expect.objectContaining({
      numberSid: "PNnew",
      voiceUrl: request.voiceUrl,
    }));
    expect(result.purchasedNumber?.phoneNumber).toBe("+442079460123");
  });

  it("returns a needs-attention result and never auto-releases a purchased number", async () => {
    process.env.TWILIO_MANAGED_PROVISIONING_ENABLED = "true";
    const provider = adapter({
      configureNumber: vi.fn(async () => { throw new Error("callback_failed"); }),
    });
    const error = await provisionManagedTwilioNumber(request, provider).catch((reason) => reason);
    expect(error).toBeInstanceOf(TwilioManagedNeedsAttentionError);
    expect(error.result.purchasedNumber.sid).toBe("PNnew");
    expect(provider).not.toHaveProperty("releaseNumber");
  });
});
