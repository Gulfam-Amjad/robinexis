import type { PlatformStore, ProviderDeployment } from "@robinexis/database";

type TwimlResult = { status: number; body: string };

export async function liveKitInboundTwiml(
  store: PlatformStore,
  tenantId: string,
): Promise<TwimlResult> {
  const client = await store.getPublishedClient(tenantId);
  if (!client) return xmlError(404, "tenant_not_found");
  const deployments = await store.listProviderDeployments(tenantId);
  const deployment = selectDeployment(deployments, client.voicePipeline === "livekit-cascade");
  if (!deployment) return xmlError(409, "livekit_deployment_not_ready");
  const sipUri = String(
    (deployment.config.ingress as Record<string, unknown> | undefined)?.sipUri || "",
  );
  if (!/^sips?:[^@\s]+@[^;\s]+(?:;transport=(?:tcp|tls|udp))?$/i.test(sipUri)) {
    return xmlError(409, "livekit_sip_uri_invalid");
  }
  return {
    status: 200,
    body: `<?xml version="1.0" encoding="UTF-8"?><Response><Dial answerOnBridge="true"><Sip>${escapeXml(sipUri)}</Sip></Dial></Response>`,
  };
}

function selectDeployment(
  deployments: ProviderDeployment[],
  liveKitActive: boolean,
): ProviderDeployment | undefined {
  if (liveKitActive) {
    return deployments.find((item) =>
      item.provider === "livekit-cascade" && item.status === "active");
  }
  return deployments.find((item) =>
    item.provider === "livekit-cascade" && item.status === "staged");
}

function xmlError(status: number, code: string): TwimlResult {
  return {
    status,
    body: `<?xml version="1.0" encoding="UTF-8"?><Response><Reject reason="busy"/><!-- ${escapeXml(code)} --></Response>`,
  };
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
