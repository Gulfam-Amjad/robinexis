import { describe, expect, it, vi } from "vitest";
import {
  LIVEKIT_RUNTIME_AGENT_NAME,
  LiveKitSipProvisioningClient,
} from "./liveKitSipProvisioning.js";

describe("LiveKit SIP provisioning", () => {
  it("creates a tenant-bound trunk and uniquely-roomed named dispatch", async () => {
    const createSipInboundTrunk = vi.fn(async () => ({
      sipTrunkId: "ST_trunk",
      numbers: ["+447700900123"],
      metadata: "",
    }));
    const createSipDispatchRule = vi.fn(async (_rule, options) => ({
      sipDispatchRuleId: "SD_rule",
      metadata: options?.metadata || "",
    }));
    const sip = {
      listSipInboundTrunk: vi.fn(async () => []),
      createSipInboundTrunk,
      listSipDispatchRule: vi.fn(async () => []),
      createSipDispatchRule,
    } as any;
    const client = new LiveKitSipProvisioningClient(
      "wss://project.livekit.cloud",
      "key",
      "secret",
      sip,
    );

    await expect(client.ensureInboundRoute({
      tenantId: "tenant-a",
      deploymentId: "deployment-a",
      phoneNumber: "+447700900123",
    })).resolves.toEqual({
      trunkId: "ST_trunk",
      dispatchRuleId: "SD_rule",
      sipUri: "sip:+447700900123@project.sip.livekit.cloud;transport=tcp",
    });

    expect(createSipInboundTrunk).toHaveBeenCalledWith(
      "robinexis-tenant-a",
      ["+447700900123"],
      expect.objectContaining({ metadata: expect.stringContaining("deployment-a") }),
    );
    const [rule, options] = createSipDispatchRule.mock.calls[0];
    expect(rule).toMatchObject({ type: "individual", roomPrefix: "robinexis-tenant-a-" });
    expect(options.roomConfig.agents[0]).toMatchObject({
      agentName: LIVEKIT_RUNTIME_AGENT_NAME,
      metadata: expect.stringContaining("\"deploymentId\":\"deployment-a\""),
    });
  });

  it("reuses resources only when their tenant and deployment metadata match", async () => {
    const metadata = JSON.stringify({
      managedBy: "robinexis",
      tenantId: "tenant-a",
      deploymentId: "deployment-a",
    });
    const sip = {
      listSipInboundTrunk: vi.fn(async () => [{
        sipTrunkId: "ST_existing",
        numbers: ["+447700900123"],
        metadata,
      }]),
      createSipInboundTrunk: vi.fn(),
      listSipDispatchRule: vi.fn(async () => [{
        sipDispatchRuleId: "SD_existing",
        metadata,
      }]),
      createSipDispatchRule: vi.fn(),
    } as any;
    const client = new LiveKitSipProvisioningClient(
      "wss://project.livekit.cloud",
      "key",
      "secret",
      sip,
    );
    const result = await client.ensureInboundRoute({
      tenantId: "tenant-a",
      deploymentId: "deployment-a",
      phoneNumber: "+447700900123",
    });
    expect(result).toMatchObject({ trunkId: "ST_existing", dispatchRuleId: "SD_existing" });
    expect(sip.createSipInboundTrunk).not.toHaveBeenCalled();
    expect(sip.createSipDispatchRule).not.toHaveBeenCalled();
  });
});
