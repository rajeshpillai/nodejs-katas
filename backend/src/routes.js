import { executeNodeCode } from "./executor.js";

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function buildPhaseGroups(katas) {
  const phaseMap = new Map();
  for (const k of katas) {
    if (!phaseMap.has(k.phase)) {
      phaseMap.set(k.phase, {
        phase: k.phase,
        title: k.phaseTitle,
        katas: [],
      });
    }
    phaseMap.get(k.phase).katas.push({
      id: k.id,
      sequence: k.sequence,
      title: k.title,
    });
  }
  return Array.from(phaseMap.values()).sort((a, b) => a.phase - b.phase);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

export function createApiRouter(katas) {
  const kataMap = new Map(katas.map((k) => [k.id, k]));
  const phaseGroups = buildPhaseGroups(katas);

  return async function apiRouter(req, res) {
    const url = new URL(req.url, "http://localhost");
    const path = url.pathname;

    if (req.method === "GET" && path === "/api/health") {
      sendJson(res, 200, { status: "ok", katas: katas.length });
      return true;
    }

    if (req.method === "GET" && path === "/api/katas") {
      sendJson(res, 200, { phases: phaseGroups });
      return true;
    }

    const kataMatch = path.match(/^\/api\/katas\/(.+)$/);
    if (req.method === "GET" && kataMatch) {
      const kata = kataMap.get(decodeURIComponent(kataMatch[1]));
      if (!kata) {
        sendJson(res, 404, { error: "kata not found" });
        return true;
      }
      sendJson(res, 200, kata);
      return true;
    }

    if (req.method === "POST" && path === "/api/playground/run") {
      try {
        const body = await readBody(req);
        const { code } = JSON.parse(body);
        if (!code || typeof code !== "string") {
          sendJson(res, 400, { error: "code is required" });
          return true;
        }
        const result = await executeNodeCode(code);
        sendJson(res, 200, {
          stdout: result.stdout,
          stderr: result.stderr,
          success: result.success,
          execution_time_ms: result.executionTimeMs,
          error: result.error,
        });
      } catch {
        sendJson(res, 400, { error: "invalid request body" });
      }
      return true;
    }

    if (path.startsWith("/api/")) {
      sendJson(res, 404, { error: "not found" });
      return true;
    }

    return false;
  };
}
