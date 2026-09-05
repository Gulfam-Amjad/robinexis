import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./apps/web/e2e",
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", testMatch: "product-flow.spec.ts", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", testMatch: "product-flow.spec.ts", use: { ...devices["Pixel 7"] } },
    {
      name: "auth",
      testMatch: "auth-flow.spec.ts",
      use: { ...devices["Desktop Chrome"], baseURL: "http://127.0.0.1:5174" },
    },
  ],
  webServer: [
    {
      command: "npm run dev -w @robinexis/web -- --host 127.0.0.1 --port 5173",
      url: "http://127.0.0.1:5173",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: { VITE_SKIP_AUTH: "true" },
    },
    {
      command: "npm run dev -w @robinexis/web -- --host 127.0.0.1 --port 5174",
      url: "http://127.0.0.1:5174",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        VITE_SKIP_AUTH: "false",
        VITE_API_BASE_URL: "",
        VITE_SUPABASE_URL: "https://test.supabase.co",
        VITE_SUPABASE_ANON_KEY: "test-anon-key",
      },
    },
  ],
});
