import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "..", "data");
const configPath = path.join(dataDir, "config.json");
const statePath = path.join(dataDir, "state.json");

const DEFAULT_CONFIG = {
  feedUrl: "",
  ntfyTopic: "sti-pulse-" + crypto.randomBytes(8).toString("hex"),
  pollMinutes: 10,
  dailyDigest: true,
  port: 3030,
};

const EMPTY_STATE = {
  lastPoll: null,
  lastError: null,
  lastAck: 0,
  seen: {},
  assignments: [],
};

function ensureDir() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
}

export function loadConfig() {
  ensureDir();
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2));
    return { ...DEFAULT_CONFIG };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
    return { ...DEFAULT_CONFIG, ...raw };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(config) {
  ensureDir();
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

export function loadState() {
  ensureDir();
  if (!fs.existsSync(statePath)) return { ...EMPTY_STATE, seen: {}, assignments: [] };
  try {
    const raw = JSON.parse(fs.readFileSync(statePath, "utf8"));
    return { ...EMPTY_STATE, ...raw, seen: raw.seen || {}, assignments: raw.assignments || [] };
  } catch {
    return { ...EMPTY_STATE, seen: {}, assignments: [] };
  }
}

export function saveState(state) {
  ensureDir();
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}
