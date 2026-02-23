import http from "http";
import { readFile, stat } from "fs/promises";
import { join, extname } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";
import { loadAllKatas } from "./kata-parser.js";
import { createApiRouter } from "./routes.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

function resolveDir(envKey, candidates) {
  if (process.env[envKey]) return process.env[envKey];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return candidates[0];
}

const PORT = process.argv[2] || process.env.PORT || "6001";

const katasDir = resolveDir("KATAS_DIR", [
  join(__dirname, "../../katas"),
  join(__dirname, "../katas"),
]);

const frontendDir = resolveDir("FRONTEND_DIR", [
  join(__dirname, "../../frontend/dist"),
  join(__dirname, "../frontend/dist"),
]);

console.log(`Loading katas from: ${katasDir}`);
const katas = await loadAllKatas(katasDir);
console.log(`Loaded ${katas.length} katas`);

const apiRouter = createApiRouter(katas);

const MIME_TYPES = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

async function serveStatic(req, res) {
  const url = new URL(req.url ?? "/", "http://localhost");
  const filePath = join(
    frontendDir,
    url.pathname === "/" ? "index.html" : url.pathname
  );

  try {
    const content = await readFile(filePath);
    const ext = extname(filePath);
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] ?? "application/octet-stream",
    });
    res.end(content);
  } catch {
    // SPA fallback
    try {
      const index = await readFile(join(frontendDir, "index.html"));
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(index);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  }
}

const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const handled = await apiRouter(req, res);
  if (!handled) {
    await serveStatic(req, res);
  }
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
