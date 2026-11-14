/**
 * GitHub Actions poller for STI Pulse.
 * Reads the tokenized eLMS iCal feed, writes public/data.json,
 * keeps data/state.json, and pushes new-assignment alerts to ntfy.
 */
import fs from "node:fs";
import path from "node:path";
import { parseAssignments, parseTermEnd } from "../src/feed.js";

const root = process.cwd();
const statePath = path.join(root, "data", "state.json");
const dataPath = path.join(root, "public", "data.json");

const FEED_URL = process.env.FEED_URL;
const NTFY_TOPIC = process.env.NTFY_TOPIC;
const PHT_OFFSET = 8 * 3600_000;

if (!FEED_URL) {
  console.error("FEED_URL secret is missing.");
  process.exit(1);
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

function phtParts(date = new Date()) {
  const shifted = new Date(date.getTime() + PHT_OFFSET);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    dateKey: shifted.toISOString().slice(0, 10),
  };
}

function formatDue(due, allDay) {
  const d = new Date(due);
  const date = d.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila" });
  if (allDay) return date;
  const time = d.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" });
  return `${date}, ${time}`;
}

function ascii(value) {
  return String(value).replace(/[^\x20-\x7E]/g, "-");
}

async function ntfy({ title, body, priority = "default", tags = "books" }) {
  if (!NTFY_TOPIC) return;
  try {
    const res = await fetch(`https://ntfy.sh/${encodeURIComponent(NTFY_TOPIC)}`, {
      method: "POST",
      headers: { Title: ascii(title), Priority: priority, Tags: tags },
      body,
    });
    console.log(`ntfy -> ${res.status}`);
  } catch (error) {
    console.error("ntfy failed:", error.message);
  }
}

function daysUntil(due) {
  return Math.ceil((new Date(due).getTime() - Date.now()) / 86_400_000);
}

const state = readJson(statePath, { lastPoll: null, lastAck: 0, seen: {}, lastDigestDate: "" });
state.seen ||= {};

let feedText;
try {
  const res = await fetch(FEED_URL, {
    headers: { "user-agent": "STI-Pulse/1.0 (GitHub Actions)" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`eLMS feed returned HTTP ${res.status}`);
  feedText = await res.text();
} catch (error) {
  console.error("Feed fetch failed:", error.message);
  process.exit(1);
}

const assignments = parseAssignments(feedText);
const termEnd = parseTermEnd(feedText);
if (!assignments.length) {
  console.error("Feed parsed but contained no assignments.");
  process.exit(1);
}

const baseline = !state.lastPoll;
const now = Date.now();
const fresh = [];
let seenChanged = false;

for (const item of assignments) {
  const existing = state.seen[item.uid];
  if (!existing) {
    state.seen[item.uid] = { title: item.title, due: item.due, firstSeen: new Date(now).toISOString() };
    seenChanged = true;
    if (!baseline) fresh.push(item);
  } else {
    if (existing.title !== item.title || existing.due !== item.due) seenChanged = true;
    existing.title = item.title;
    existing.due = item.due;
  }
}

if (state.termEnd !== termEnd) seenChanged = true;

const enriched = assignments.map((item) => ({
  ...item,
  firstSeen: state.seen[item.uid]?.firstSeen || new Date(now).toISOString(),
}));

state.lastPoll = new Date(now).toISOString();
state.lastError = null;
state.termEnd = termEnd;
if (baseline) state.lastAck = now;
if (!state.lastAck) state.lastAck = now;

writeJson(statePath, state);
writeJson(dataPath, {
  lastPoll: state.lastPoll,
  lastError: null,
  lastAck: state.lastAck || 0,
  termEnd: termEnd || null,
  generatedAt: state.lastPoll,
  assignments: enriched,
});

console.log(`Parsed ${assignments.length} assignments, ${fresh.length} new.`);

if (fresh.length) {
  if (fresh.length === 1) {
    const item = fresh[0];
    const days = daysUntil(item.due);
    await ntfy({
      title: "New STI assignment",
      body: `${item.title}\n${item.course}\nDue ${formatDue(item.due, item.allDay)}${days <= 3 ? ` (${days} day${days === 1 ? "" : "s"})` : ""}`,
      priority: days <= 3 ? "high" : "default",
      tags: days <= 3 ? "warning,books" : "books",
    });
  } else {
    await ntfy({
      title: `${fresh.length} new STI assignments`,
      body: fresh
        .slice(0, 8)
        .map((item) => `- ${item.title} (${formatDue(item.due, item.allDay)})`)
        .join("\n"),
      priority: "high",
      tags: "books",
    });
  }
}

// Daily digest at 8 AM PHT.
const pht = phtParts();
if (state.lastDigestDate !== pht.dateKey && pht.hour === 8) {
  const soon = enriched.filter((item) => {
    const days = daysUntil(item.due);
    return days >= 0 && days <= 3;
  });
  if (soon.length) {
    await ntfy({
      title: `STI Pulse: ${soon.length} deadline${soon.length === 1 ? "" : "s"} in 3 days`,
      body: soon
        .slice(0, 8)
        .map((item) => `- ${item.title} (${formatDue(item.due, item.allDay)})`)
        .join("\n"),
      tags: "alarm_clock,books",
    });
  }
  state.lastDigestDate = pht.dateKey;
  seenChanged = true;
  writeJson(statePath, state);
}

// Only commit data/state.json when something meaningful changed, so the
// repository does not gain a commit every 15 minutes.
if (process.env.GITHUB_ENV) {
  fs.appendFileSync(process.env.GITHUB_ENV, `STATE_CHANGED=${seenChanged ? "1" : "0"}\n`);
}
