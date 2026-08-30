import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/evaluations/**/*.test.ts",
      "apps/voice-gateway/src/**/*.test.ts",
    ],
    environment: "node",
  },
});
