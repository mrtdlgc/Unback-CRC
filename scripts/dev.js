#!/usr/bin/env node
/**
 * Zero-dependency static file server for local development.
 *
 * The production deployment is plain static hosting (Vercel), so this only has
 * to do what a CDN does: serve files with the right Content-Type. ES modules
 * are refused by browsers unless the JavaScript MIME type is correct, which is
 * the one thing `python3 -m http.server` gets wrong often enough to matter.
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PORT = Number(process.env.PORT || 5173);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

/** Resolve a URL path to a file inside ROOT, or null if it escapes the root. */
function resolvePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0].split("#")[0]);
  const relative = normalize(decoded).replace(/^([/\\])+/, "");
  if (relative.split(sep).includes("..")) return null;
  return join(ROOT, relative || "index.html");
}

const server = createServer(async (req, res) => {
  let filePath = resolvePath(req.url || "/");
  if (!filePath) {
    res.writeHead(403).end("Forbidden");
    return;
  }

  try {
    const info = await stat(filePath).catch(() => null);
    if (info?.isDirectory()) filePath = join(filePath, "index.html");

    const body = await readFile(filePath);
    res.writeHead(200, {
      "content-type": MIME[extname(filePath).toLowerCase()] || "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(body);
  } catch {
    // Single-page app: unknown paths fall back to the entry document.
    try {
      const fallback = await readFile(join(ROOT, "index.html"));
      res.writeHead(200, { "content-type": MIME[".html"], "cache-control": "no-store" });
      res.end(fallback);
    } catch {
      res.writeHead(404).end("Not found");
    }
  }
});

server.listen(PORT, () => {
  console.log(`Circles Backing Ledger — http://localhost:${PORT}`);
});
