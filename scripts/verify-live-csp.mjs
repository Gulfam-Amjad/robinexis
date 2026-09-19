import {
  connectSourcesFromHeader,
  verifyApiOrigin,
  verifyVoiceOrigin,
} from "./verify-csp-api-origin.mjs";

const target = (process.env.WEB_APP_URL || "https://app.robinexis.com").trim();
const apiBaseUrl = (process.env.VITE_API_BASE_URL || "https://api.robinexis.com").trim();
const liveKitUrl = (process.env.VITE_LIVEKIT_URL || process.env.LIVEKIT_URL || "").trim();

export function liveKitSourcesFor(sources) {
  const hosts = sources.filter((source) => source.includes("livekit."));
  return {
    websocket: hosts.filter((source) => source.startsWith("wss://")),
    https: hosts.filter((source) => source.startsWith("https://")),
  };
}

async function main() {
  const response = await fetch(target, { redirect: "follow" });
  const policy = response.headers.get("content-security-policy");
  if (!policy) throw new Error(`${target} served no Content-Security-Policy header`);
  const asConfig = {
    headers: [{ headers: [{ key: "Content-Security-Policy", value: policy }] }],
  };
  const allowed = [verifyApiOrigin(apiBaseUrl, asConfig)];
  if (liveKitUrl) {
    allowed.push(...verifyVoiceOrigin(liveKitUrl, asConfig));
  } else {
    // Without runtime credentials we can still prove the Cost Saver browser call
    // is not blocked: both LiveKit schemes must be present in connect-src.
    const livekit = liveKitSourcesFor(connectSourcesFromHeader(policy));
    if (!livekit.websocket.length || !livekit.https.length) {
      throw new Error(`${target} connect-src is missing a LiveKit wss:// and https:// source`);
    }
    allowed.push(...livekit.websocket, ...livekit.https);
  }
  console.log(JSON.stringify({ ok: true, target, allowed }));
}

main().catch((error) => {
  console.error(`Live CSP check failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
