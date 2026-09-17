import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["apps/web/src/lib/**/*.test.ts"],
    environment: "node",
  },
});
