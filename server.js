import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseAssignments, parseTermEnd } from "./src/feed.js";
import { loadConfig, saveConfig, loadState, saveState } from "./src/store.js";
import { sendNtfy, formatDue } from "./src/notify.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");

let config = loadConfig();
let state = loadState();
let pollTimer = null;
let digestTimer = null;
let lastDigestDate = "";
let polling = false;

/** @type {Set<import('node:http').ServerResponse>} */
const clients = new Set();

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function broadcast(payload) {
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const client of clients) {
    try {
      client.write(data);
    } catch {
      clients.delete(client);
    }
  }
}

function publicState() {
  return {
    lastPoll: state.lastPoll,
    lastError: state.lastError,
    lastAck: state.lastAck,
    termEnd: state.termEnd || null,
    assignments: state.assignments,
    config: {
      ntfyTopic: config.ntfyTopic,
      pollMinutes: config.pollMinutes,
      dailyDigest: config.dailyDigest,
      feedUrlSet: Boolean(config.feedUrl),
      feedHost: config.feedUrl ? new URL(config.feedUrl).host : null,
    },
  };
}

function daysUntil(due) {
  const ms = new Date(due).getTime() - Date.now();
  return Math.ceil(ms / 86_400_000);
}

async function notifyNew(items) {
  if (!items.length) return;

  if (items.length === 1) {
    const item = items[0];
    const days = daysUntil(item.due);
    await sendNtfy(config.ntfyTopic, {
      title: "New STI assignment",
      body: `${item.title}\n${item.course}\nDue ${formatDue(item.due, item.allDay)}${days <= 3 ? ` (${days} day${days === 1 ? "" : "s"})` : ""}`,
      priority: days <= 3 ? "high" : "default",
      tags: days <= 3 ? "warning,books" : "books",
      click: `http://localhost:${config.port}/`,
    });
  } else {
    const lines = items
      .slice(0, 6)
      .map((item) => `- ${item.title} (${formatDue(item.due, item.allDay)})`)
      .join("\n");
    await sendNtfy(config.ntfyTopic, {
      title: `${items.length} new STI assignments`,
      body: lines,
      priority: "high",
      tags: "books",
      click: `http://localhost:${config.port}/`,
    });
  }
}

async function poll() {
  if (polling) return { skipped: true };
  if (!config.feedUrl) {
    state.lastError = "No eLMS feed URL configured.";
    saveState(state);
    return { ok: false, error: state.lastError };
  }

  polling = true;
  try {
    const res = await fetch(config.feedUrl, {
      headers: { "user-agent": "STI-Pulse/1.0 (personal study dashboard)" },
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`eLMS feed returned HTTP ${res.status}`);
    const text = await res.text();
    const items = parseAssignments(text);
    const termEnd = parseTermEnd(text);
    if (!items.length) throw new Error("Feed parsed but contained no assignments; not replacing data.");

    const isBaseline = !state.lastPoll;
    const fresh = [];
    const now = Date.now();

    for (const item of items) {
      const existing = state.seen[item.uid];
      if (!existing) {
        state.seen[item.uid] = {
          title: item.title,
          due: item.due,
          firstSeen: new Date(now).toISOString(),
        };
        if (!isBaseline) fresh.push(item);
      } else {
        existing.title = item.title;
        existing.due = item.due;
      }
    }

    state.assignments = items.map((item) => ({
      ...item,
      firstSeen: state.seen[item.uid]?.firstSeen || new Date(now).toISOString(),
    }));
    state.lastPoll = new Date(now).toISOString();
    state.lastError = null;
    if (termEnd) state.termEnd = termEnd;
    if (isBaseline) state.lastAck = now;
    saveState(state);

    broadcast({ type: "state", lastPoll: state.lastPoll });
    if (fresh.length) {
      broadcast({ type: "new", items: fresh });
      await notifyNew(fresh);
    }
    return { ok: true, count: items.length, fresh: fresh.length, baseline: isBaseline };
  } catch (error) {
    state.lastError = String(error.message || error);
    saveState(state);
    broadcast({ type: "error", message: state.lastError });
    return { ok: false, error: state.lastError };
  } finally {
    polling = false;
  }
}

async function maybeDigest() {
  if (!config.dailyDigest) return;
  const now = new Date();
  if (now.getHours() !== 8) return;
  const today = now.toDateString();
  if (lastDigestDate === today) return;
  lastDigestDate = today;

  const soon = state.assignments.filter((item) => {
    const days = daysUntil(item.due);
    return days >= 0 && days <= 3;
  });
  if (!soon.length) return;

  const lines = soon
    .slice(0, 8)
    .map((item) => `- ${item.title} (${formatDue(item.due, item.allDay)})`)
    .join("\n");
  await sendNtfy(config.ntfyTopic, {
    title: `STI Pulse: ${soon.length} deadline${soon.length === 1 ? "" : "s"} in 3 days`,
    body: lines,
    priority: "default",
    tags: "alarm_clock,books",
    click: `http://localhost:${config.port}/`,
  });
}

function schedule() {
  if (pollTimer) clearInterval(pollTimer);
  const minutes = Math.max(2, Number(config.pollMinutes) || 10);
  pollTimer = setInterval(poll, minutes * 60_000);
  if (digestTimer) clearInterval(digestTimer);
  digestTimer = setInterval(maybeDigest, 60_000);
}

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 100_000) reject(new Error("Body too large"));
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (url.pathname === "/api/state" && req.method === "GET") {
    return json(res, 200, publicState());
  }

  if (url.pathname === "/api/events" && req.method === "GET") {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    res.write(`data: ${JSON.stringify({ type: "hello", lastPoll: state.lastPoll })}\n\n`);
    clients.add(res);
    const keepAlive = setInterval(() => {
      try {
        res.write(": ping\n\n");
      } catch {
        /* ignore */
      }
    }, 25_000);
    req.on("close", () => {
      clearInterval(keepAlive);
      clients.delete(res);
    });
    return;
  }

  if (url.pathname === "/api/refresh" && req.method === "POST") {
    const result = await poll();
    return json(res, 200, { ...result, state: publicState() });
  }

  if (url.pathname === "/api/ack" && req.method === "POST") {
    state.lastAck = Date.now();
    saveState(state);
    broadcast({ type: "ack", lastAck: state.lastAck });
    return json(res, 200, { ok: true });
  }

  if (url.pathname === "/api/config" && req.method === "POST") {
    try {
      const body = await readJson(req);
      if (typeof body.feedUrl === "string" && body.feedUrl.trim()) {
        const parsed = new URL(body.feedUrl.trim());
        if (!/^https?:$/.test(parsed.protocol)) throw new Error("Feed URL must use http or https.");
        config.feedUrl = parsed.toString();
      }
      if (typeof body.ntfyTopic === "string" && body.ntfyTopic.trim()) {
        config.ntfyTopic = body.ntfyTopic.trim().replace(/\s+/g, "-");
      }
      if (body.pollMinutes != null) {
        config.pollMinutes = Math.min(120, Math.max(2, Number(body.pollMinutes) || 10));
      }
      if (body.dailyDigest != null) config.dailyDigest = Boolean(body.dailyDigest);
      saveConfig(config);
      schedule();
      broadcast({ type: "config", config: publicState().config });
      return json(res, 200, { ok: true, config: publicState().config });
    } catch (error) {
      return json(res, 400, { ok: false, error: String(error.message || error) });
    }
  }

  if (url.pathname === "/api/test-notify" && req.method === "POST") {
    const result = await sendNtfy(config.ntfyTopic, {
      title: "STI Pulse test",
      body: "If you can read this, notifications are working.",
      tags: "white_check_mark",
      click: `http://localhost:${config.port}/`,
    });
    return json(res, 200, result);
  }

  if (url.pathname === "/health") {
    return json(res, 200, { ok: true, lastPoll: state.lastPoll, lastError: state.lastError });
  }

  // Static files
  let filePath = path.join(publicDir, decodeURIComponent(url.pathname));
  if (url.pathname === "/") filePath = path.join(publicDir, "index.html");
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(publicDir))) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  fs.readFile(resolved, (error, data) => {
    if (error) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      return res.end("Not found");
    }
    res.writeHead(200, {
      "content-type": MIME[path.extname(resolved)] || "application/octet-stream",
      "cache-control": resolved.endsWith("index.html") ? "no-cache" : "public, max-age=300",
    });
    res.end(data);
  });
});

const port = Number(process.env.PORT || config.port || 3030);
server.listen(port, "0.0.0.0", async () => {
  console.log(`STI Pulse running at http://localhost:${port}`);
  console.log(`ntfy topic: ${config.ntfyTopic}`);
  schedule();
  await poll();
});
