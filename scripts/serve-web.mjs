import { createReadStream, existsSync, statSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), "../dist");
const port = Number(process.env.PORT) || 4173;
const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

function send(res, file, type) {
  res.writeHead(200, { "Content-Type": type });
  createReadStream(file).pipe(res);
}

http
  .createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const requested = path.normalize(path.join(dist, url.pathname === "/" ? "index.html" : url.pathname));
    if (!requested.startsWith(dist)) {
      res.writeHead(403).end();
      return;
    }
    if (existsSync(requested) && statSync(requested).isFile()) {
      send(res, requested, types[path.extname(requested)] || "application/octet-stream");
      return;
    }
    send(res, path.join(dist, "index.html"), types[".html"]);
  })
  .listen(port, "0.0.0.0", () => {
    console.log(`[web] static host listening on :${port}`);
  });
