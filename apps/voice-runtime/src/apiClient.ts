import { createHmac } from "node:crypto";
import type { PostCallPayload, RuntimeConfig } from "./contracts.js";

export function signPostCall(rawBody: string, secret: string, timestamp: number): string {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

export class RuntimeApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly internalSecret: string,
    private readonly signingSecret: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async getPublishedConfig(tenantId: string, deploymentId: string): Promise<RuntimeConfig> {
    const query = new URLSearchParams({ deploymentId });
    const response = await this.fetchImpl(
      `${this.baseUrl.replace(/\/$/, "")}/internal/voice-runtime/config/${encodeURIComponent(tenantId)}?${query}`,
      { headers: { "x-voice-runtime-secret": this.internalSecret } },
    );
    if (!response.ok) throw new Error(`runtime_config_failed:${response.status}`);
    return await response.json() as RuntimeConfig;
  }

  async sendPostCall(payload: PostCallPayload): Promise<void> {
    const rawBody = JSON.stringify(payload);
    const timestamp = Math.floor(Date.now() / 1000);
    const response = await this.fetchImpl(
      `${this.baseUrl.replace(/\/$/, "")}/internal/voice-runtime/post-call`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-voice-runtime-timestamp": String(timestamp),
          "x-voice-runtime-signature": signPostCall(rawBody, this.signingSecret, timestamp),
        },
        body: rawBody,
      },
    );
    if (!response.ok) throw new Error(`runtime_post_call_failed:${response.status}`);
  }
}
