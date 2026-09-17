import {
  RoomAgentDispatch,
  RoomConfiguration,
  SipClient,
  type SIPDispatchRuleInfo,
  type SIPInboundTrunkInfo,
} from "livekit-server-sdk";

export const LIVEKIT_RUNTIME_AGENT_NAME = "robinexis-alternate-runtime";

export interface LiveKitSipRouteInput {
  tenantId: string;
  deploymentId: string;
  phoneNumber: string;
}

export interface LiveKitSipRoute {
  trunkId: string;
  dispatchRuleId: string;
  sipUri: string;
}

type SipManagement = Pick<
  SipClient,
  | "listSipInboundTrunk"
  | "createSipInboundTrunk"
  | "listSipDispatchRule"
  | "createSipDispatchRule"
>;

export class LiveKitSipProvisioningClient {
  private readonly client: SipManagement;
  private readonly sipHost: string;

  constructor(
    liveKitUrl: string,
    apiKey: string,
    apiSecret: string,
    client?: SipManagement,
  ) {
    if (!liveKitUrl || !apiKey || !apiSecret) throw new Error("livekit_management_not_configured");
    const url = new URL(liveKitUrl);
    const host = url.hostname;
    this.sipHost = host.includes(".livekit.cloud")
      ? host.replace(".livekit.cloud", ".sip.livekit.cloud")
      : host;
    this.client = client || new SipClient(`https://${host}`, apiKey, apiSecret);
  }

  async ensureInboundRoute(input: LiveKitSipRouteInput): Promise<LiveKitSipRoute> {
    const metadata = JSON.stringify({
      managedBy: "robinexis",
      tenantId: input.tenantId,
      deploymentId: input.deploymentId,
    });
    const trunks = await this.client.listSipInboundTrunk({ numbers: [input.phoneNumber] });
    const trunk = matchingTrunk(trunks, input) || await this.client.createSipInboundTrunk(
      `robinexis-${input.tenantId}`,
      [input.phoneNumber],
      { metadata },
    );

    const rules = await this.client.listSipDispatchRule({ trunkIds: [trunk.sipTrunkId] });
    const dispatch = matchingDispatch(rules, input) || await this.client.createSipDispatchRule(
      {
        type: "individual",
        roomPrefix: `robinexis-${safeSegment(input.tenantId)}-`,
      },
      {
        name: `robinexis-${input.tenantId}`,
        metadata,
        trunkIds: [trunk.sipTrunkId],
        hidePhoneNumber: true,
        roomConfig: new RoomConfiguration({
          agents: [
            new RoomAgentDispatch({
              agentName: LIVEKIT_RUNTIME_AGENT_NAME,
              metadata: JSON.stringify({
                tenantId: input.tenantId,
                deploymentId: input.deploymentId,
                direction: "inbound",
                objective: "Receptionist call",
              }),
            }),
          ],
        }),
      },
    );

    return {
      trunkId: trunk.sipTrunkId,
      dispatchRuleId: dispatch.sipDispatchRuleId,
      sipUri: `sip:${input.phoneNumber}@${this.sipHost};transport=tcp`,
    };
  }
}

function matchingTrunk(items: SIPInboundTrunkInfo[], input: LiveKitSipRouteInput) {
  return items.find((item) =>
    item.numbers.includes(input.phoneNumber) &&
    metadataMatches(item.metadata, input),
  );
}

function matchingDispatch(items: SIPDispatchRuleInfo[], input: LiveKitSipRouteInput) {
  return items.find((item) => metadataMatches(item.metadata, input));
}

function metadataMatches(
  raw: string,
  input: Pick<LiveKitSipRouteInput, "tenantId" | "deploymentId">,
): boolean {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    return value.managedBy === "robinexis" &&
      value.tenantId === input.tenantId &&
      value.deploymentId === input.deploymentId;
  } catch {
    return false;
  }
}

function safeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 64);
}
