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
let lastFetchError = null;
for (let attempt = 1; attempt <= 3; attempt += 1) {
  try {
    const res = await fetch(FEED_URL, {
      headers: { "user-agent": "STI-Pulse/1.0 (GitHub Actions)" },
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`eLMS feed returned HTTP ${res.status}`);
    feedText = await res.text();
    lastFetchError = null;
    break;
  } catch (error) {
    lastFetchError = error;
    console.error(`Feed fetch attempt ${attempt}/3 failed:`, error.message);
    if (attempt < 3) {
      const until = Date.now() + 5000;
      while (Date.now() < until) {
        /* busy-wait; timers are unavailable in this runtime */
      }
    }
  }
}
if (lastFetchError) {
  console.error("Feed fetch failed:", lastFetchError.message);
  process.exit(1);
}

const assignments = parseAssignments(feedText);
const termEnd = parseTermEnd(feedText);
if (!assignments.length) {
  const hasPrior = state.seen && Object.keys(state.seen).length > 0;
  if (hasPrior) {
    console.warn("Feed parsed but contained no assignments; treating as transient and keeping existing data.json.");
    process.exit(0);
  }
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

// Heartbeat: commit at least once per PHT day so GitHub never treats the
// repository as inactive and disables the schedule.
const phtDay = (value) => new Date(new Date(value).getTime() + PHT_OFFSET).toISOString().slice(0, 10);
if (!state.lastPoll || phtDay(state.lastPoll) !== phtDay(now)) seenChanged = true;

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

// Class reminders: one push per class, LEAD minutes before it starts (PHT).
const schedule = readJson(path.join(root, "public", "schedule.json"), { days: {} });
const CLASS_LEAD_MINUTES = Number(process.env.CLASS_LEAD_MINUTES || 180);
state.classNotified ||= {};

for (const key of Object.keys(state.classNotified)) {
  if (key.slice(0, 10) < phtDay(now - 2 * 86_400_000)) {
    delete state.classNotified[key];
    seenChanged = true;
  }
}

function fmtClock(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

const leadMs = CLASS_LEAD_MINUTES * 60_000;
const reminders = [];
const nowPht = new Date(now + PHT_OFFSET);

for (let offset = 0; offset < 2; offset += 1) {
  const day = new Date(nowPht.getTime() + offset * 86_400_000);
  const keyDate = day.toISOString().slice(0, 10);
  for (const cls of schedule.days?.[day.getUTCDay()] || []) {
    const [h, m] = cls.from.split(":").map(Number);
    const startUtc = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), h - 8, m, 0, 0);
    const key = `${keyDate}|${cls.course}|${cls.from}`;
    if (now >= startUtc - leadMs && now < startUtc && !state.classNotified[key]) {
      state.classNotified[key] = new Date(now).toISOString();
      seenChanged = true;
      reminders.push({ cls, startUtc });
    }
  }
}

writeJson(statePath, state);

if (reminders.length) {
  for (const { cls, startUtc } of reminders) {
    const minutes = Math.max(1, Math.round((startUtc - now) / 60_000));
    const label = minutes >= 60 ? `${Math.round(minutes / 60)} hr${minutes >= 120 ? "s" : ""}` : `${minutes} min`;
    await ntfy({
      title: `Class in ${label}`,
      body: `${cls.course}\n${fmtClock(cls.from)} to ${fmtClock(cls.to)}\n${cls.room}`,
      tags: "school,alarm_clock",
    });
  }
}

// Only commit data/state.json when something meaningful changed, so the
// repository does not gain a commit every 15 minutes.
if (process.env.GITHUB_ENV) {
  fs.appendFileSync(process.env.GITHUB_ENV, `STATE_CHANGED=${seenChanged ? "1" : "0"}\n`);
}
