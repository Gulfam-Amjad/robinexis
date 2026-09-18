import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const script = fileURLToPath(new URL("./verify-web-production-env.mjs", import.meta.url));

function run(env) {
  return spawnSync(process.execPath, [script], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

test("rejects production auth bypass and missing public configuration", () => {
  const result = run({
    WEB_PRODUCTION_BUILD: "true",
    VITE_SKIP_AUTH: "true",
    VITE_API_BASE_URL: "",
    VITE_SUPABASE_URL: "",
    VITE_SUPABASE_ANON_KEY: "",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /VITE_SKIP_AUTH/);
  assert.match(result.stderr, /VITE_API_BASE_URL/);
});

test("accepts a fully configured production build", () => {
  const result = run({
    WEB_PRODUCTION_BUILD: "true",
    VITE_SKIP_AUTH: "false",
    VITE_API_BASE_URL: "https://api.example.com",
    VITE_SUPABASE_URL: "https://project.supabase.co",
    VITE_SUPABASE_ANON_KEY: "public-anon-test-value",
  });
  assert.equal(result.status, 0, result.stderr);
});
