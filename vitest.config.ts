import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/evaluations/**/*.test.ts",
      "packages/integrations/src/**/*.test.ts",
      "packages/database/src/**/*.test.ts",
      "apps/api/src/**/*.test.ts",
    ],
    environment: "node",
  },
});
