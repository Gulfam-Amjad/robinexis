import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// Vercel resolves the output directory from the repository root, so the bundle is
// emitted to `<repo>/dist` rather than inside this workspace.
export default defineConfig({
  plugins: [react()],
  envDir: repoRoot,
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8081",
        configure: (proxy) => {
          proxy.on("error", (_err, _req, res) => {
            if ("writeHead" in res && !res.headersSent) {
              res.writeHead(502, { "Content-Type": "application/json" });
            }
            if ("end" in res) res.end(JSON.stringify({ error: "api_unavailable" }));
          });
        },
      },
    },
  },
  build: {
    outDir: path.join(repoRoot, "dist"),
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
});
