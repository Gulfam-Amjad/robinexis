import { defineConfig } from "tsup";

export default defineConfig({
  entry: { migrate: "src/migrate.cli.ts" },
  format: ["esm"],
  platform: "node",
  target: "node24",
  sourcemap: true,
  clean: true,
  dts: false,
  splitting: false,
  outDir: "dist",
  external: ["pg", "dotenv"],
});
