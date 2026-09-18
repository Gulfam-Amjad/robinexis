import { describe, expect, it } from "vitest";
import {
  DEFAULT_UPGRADE_FEATURE_FLAGS,
  type Client,
  type Usage,
} from "./index.js";

describe("messaging and overage API contracts", () => {
  it("keeps upgrade features off by default", () => {
    expect(DEFAULT_UPGRADE_FEATURE_FLAGS).toEqual({
      whatsappEnabled: false,
      autoMinuteBlocksEnabled: false,
    });
  });

  it("keeps new response fields optional for old clients", () => {
    const client: Client = {
      id: "client-a",
      slug: "client-a",
      businessName: "Client A",
      published: true,
      serviceStatus: "active",
    };
    const usage: Usage = {
      clientId: client.id,
      month: "2026-09",
      inboundMinutes: 10,
      outboundMinutes: 5,
    };
    expect(client.featureFlags).toBeUndefined();
    expect(usage.messaging).toBeUndefined();
    expect(usage.overage).toBeUndefined();
  });
});
