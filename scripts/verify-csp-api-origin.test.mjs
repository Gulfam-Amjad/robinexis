import assert from "node:assert/strict";
import test from "node:test";
import {
  connectSources,
  sourceAllowsOrigin,
  verifyApiOrigin,
  verifyVoiceOrigin,
} from "./verify-csp-api-origin.mjs";

function config(value) {
  return {
    headers: [{
      source: "/(.*)",
      headers: [{ key: "Content-Security-Policy", value }],
    }],
  };
}

test("accepts an exact connect-src origin", () => {
  const vercel = config("default-src 'self'; connect-src 'self' https://api.example.com");
  assert.equal(verifyApiOrigin("https://api.example.com/v1", vercel), "https://api.example.com");
});

test("accepts a matching wildcard but not its apex", () => {
  assert.equal(sourceAllowsOrigin("https://*.supabase.co", "https://tenant.supabase.co"), true);
  assert.equal(sourceAllowsOrigin("https://*.supabase.co", "https://supabase.co"), false);
});

test("rejects an API origin absent from connect-src", () => {
  const vercel = config("default-src 'self'; connect-src 'self' https://api.example.com");
  assert.throws(
    () => verifyApiOrigin("https://unexpected.example.net", vercel),
    /missing from vercel\.json CSP connect-src/,
  );
});

test("requires one connect-src policy", () => {
  assert.throws(() => connectSources(config("default-src 'self'")), /no connect-src/);
});

test("accepts a wss wildcard for the LiveKit host", () => {
  assert.equal(sourceAllowsOrigin("wss://*.livekit.cloud", "wss://robin-rq64w99n.livekit.cloud"), true);
  assert.equal(sourceAllowsOrigin("wss://*.livekit.cloud", "wss://livekit.cloud"), false);
});

test("requires both the wss and https LiveKit origins", () => {
  const vercel = config(
    "default-src 'self'; connect-src 'self' https://*.livekit.cloud wss://*.livekit.cloud",
  );
  assert.deepEqual(
    verifyVoiceOrigin("wss://robin-rq64w99n.livekit.cloud", vercel),
    ["wss://robin-rq64w99n.livekit.cloud", "https://robin-rq64w99n.livekit.cloud"],
  );
  assert.throws(
    () => verifyVoiceOrigin("wss://robin-rq64w99n.livekit.cloud", config(
      "default-src 'self'; connect-src 'self' wss://*.livekit.cloud",
    )),
    /https:\/\/robin-rq64w99n\.livekit\.cloud is missing/,
  );
});

test("rejects a LiveKit URL that is not a websocket origin", () => {
  const vercel = config("default-src 'self'; connect-src 'self' wss://*.livekit.cloud");
  assert.throws(() => verifyVoiceOrigin("https://robin.livekit.cloud", vercel), /must use ws or wss/);
});
