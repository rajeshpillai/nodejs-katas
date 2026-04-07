import { executeNodeCode, executeNodeCodeStreaming } from "./executor.js";

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

const MAX_BODY_SIZE = 1024 * 1024; // 1 MB

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        req.destroy();
        reject(new Error("Request body too large"));
        return;
      }
      body += chunk;
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function buildNeighborMap(katas) {
  // Sort by (phase, sequence) so prev/next walk the linear progression
  // across phases as the learner sees it in the sidebar.
  const ordered = [...katas].sort(
    (a, b) => a.phase - b.phase || a.sequence - b.sequence
  );
  const neighbors = new Map();
  const summary = (k) =>
    k && {
      id: k.id,
      phase: k.phase,
      sequence: k.sequence,
      title: k.title,
    };
  for (let i = 0; i < ordered.length; i++) {
    neighbors.set(ordered[i].id, {
      prev: summary(ordered[i - 1]),
      next: summary(ordered[i + 1]),
    });
  }
  return neighbors;
}

export function createApiRouter(katas) {
  const kataMap = new Map(katas.map((k) => [k.id, k]));
  const phaseGroups = buildPhaseGroups(katas);
  const neighborMap = buildNeighborMap(katas);

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
      const { prev, next } = neighborMap.get(kata.id) ?? {};
      sendJson(res, 200, { ...kata, prev: prev ?? null, next: next ?? null });
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

    if (req.method === "POST" && path === "/api/playground/run-stream") {
      try {
        const body = await readBody(req);
        const { code } = JSON.parse(body);
        if (!code || typeof code !== "string") {
          sendJson(res, 400, { error: "code is required" });
          return true;
        }
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        await executeNodeCodeStreaming(code, (event) => {
          res.write(`data: ${JSON.stringify(event)}\n\n`);
        });
        res.end();
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
