import { describe, expect, it } from "vitest";
import {
  contentTemplateCreateBody,
  findExistingContentSid,
  managedWhatsAppWebhookUrls,
  ROBINEXIS_WHATSAPP_TEMPLATES,
  upsertEnvAssignments,
  whatsappEnvUpdates,
} from "./whatsappProvisioning.js";

describe("managed WhatsApp provider provisioning helpers", () => {
  it("builds HTTPS webhook URLs and rejects non-public bases", () => {
    expect(managedWhatsAppWebhookUrls("https://api.robinexis.com")).toEqual({
      inbound: "https://api.robinexis.com/webhooks/twilio/whatsapp/inbound",
      status: "https://api.robinexis.com/webhooks/twilio/whatsapp/status",
    });
    expect(managedWhatsAppWebhookUrls("http://localhost:8081")).toBeUndefined();
    expect(managedWhatsAppWebhookUrls("not-a-url")).toBeUndefined();
  });

  it("defines the four utility templates used for confirmations and follow-ups", () => {
    expect(ROBINEXIS_WHATSAPP_TEMPLATES.map((item) => item.key)).toEqual([
      "confirmation", "reminder", "cancellation", "outsideWindow",
    ]);
    expect(contentTemplateCreateBody(ROBINEXIS_WHATSAPP_TEMPLATES[0]).types["twilio/text"].body)
      .toContain("{{1}}");
    expect(findExistingContentSid(
      [{ sid: "HXabc", friendly_name: "robinexis_booking_reminder" }],
      ROBINEXIS_WHATSAPP_TEMPLATES[1],
    )).toBe("HXabc");
  });

  it("fills blank env keys without overwriting existing SIDs", () => {
    const source = "WHATSAPP_ENABLED=false\nWHATSAPP_BOOKING_CONFIRMATION_CONTENT_SID=HXkeep\n";
    const updated = upsertEnvAssignments(source, whatsappEnvUpdates({
      sids: { confirmation: "HXnew", reminder: "HXreminder" },
      enabled: true,
    }));
    expect(updated).toContain("WHATSAPP_BOOKING_CONFIRMATION_CONTENT_SID=HXkeep");
    expect(updated).toContain("WHATSAPP_BOOKING_REMINDER_CONTENT_SID=HXreminder");
    expect(updated).toContain("WHATSAPP_ENABLED=false");
    expect(upsertEnvAssignments("", whatsappEnvUpdates({ sids: {}, enabled: false })))
      .toContain("WHATSAPP_ENABLED=false");
    expect(updated).toContain("WHATSAPP_BOOKING_REMINDER_LEAD_HOURS=1");
    expect(updated).toContain("WHATSAPP_BRAIN_PROCESSOR_ENABLED=true");
  });
});
