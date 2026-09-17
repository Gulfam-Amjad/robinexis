import { afterEach, describe, expect, it, vi } from "vitest";
import { sendNotification } from "./notifications.js";

describe("customer email delivery", () => {
  afterEach(() => {
    delete process.env.EMAIL_DELIVERY_MODE;
    delete process.env.RESEND_API_KEY;
    delete process.env.NOTIFICATION_FROM_EMAIL;
    vi.unstubAllGlobals();
  });

  it("captures branded staging emails without sending externally", async () => {
    process.env.EMAIL_DELIVERY_MODE = "log";
    await expect(sendNotification({
      channel: "email", to: "stage@example.test", template: "Setup received\nWe are reviewing your receptionist.",
    })).resolves.toMatchObject({ providerId: expect.stringMatching(/^captured_/) });
  });

  it("delivers production email through the configured provider", async () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.NOTIFICATION_FROM_EMAIL = "Robinexis <hello@example.test>";
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "email_1" }) });
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendNotification({
      channel: "email", to: "owner@example.test", template: "Payment needs attention\nUpdate your card securely.",
      idempotencyKey: "invoice:event_1",
    })).resolves.toEqual({ providerId: "email_1" });
    expect(fetchMock).toHaveBeenCalledWith("https://api.resend.com/emails", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ "Idempotency-Key": "invoice:event_1" }),
    }));
  });
});
