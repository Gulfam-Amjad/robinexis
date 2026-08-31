import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/server.ts"],
  format: ["esm"],
  platform: "node",
  target: "node24",
  sourcemap: true,
  clean: true,
  dts: false,
  splitting: false,
  treeshake: true,
  minify: false,
  outDir: "dist",
  noExternal: [/^@robinexis\//],
  external: ["pg", "pg-native"],
});
