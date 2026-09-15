import assert from "node:assert/strict";
import test from "node:test";
import {
  connectSources,
  sourceAllowsOrigin,
  verifyApiOrigin,
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
