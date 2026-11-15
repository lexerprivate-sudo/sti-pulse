const $ = (id) => document.getElementById(id);
const DONE_KEY = "sti-done-v1";
const DATA_CACHE = "sti-data-cache";

const storage = {
  get(key) { try { return storage.get(key); } catch { return null; } },
  set(key, value) { try { storage.set(key, value); } catch { /* full or blocked */ } },
};

const els = {
  pill: $("status-pill"),
  statusText: $("status-text"),
  list: $("assignment-list"),
  empty: $("empty"),
  listTitle: $("list-title"),
  listNote: $("list-note"),
  lastChecked: $("last-checked"),
  feedHost: $("feed-host"),
  feedLast: $("feed-last"),
  feedNext: $("feed-next"),
  termEnd: $("term-end"),
  feedError: $("feed-error"),
  nextClass: $("next-class"),
  week: $("week"),
  ntfyTopic: $("ntfy-topic"),
  ntfyLink: $("ntfy-link"),
  ntfyInput: $("topic-set"),
  topicForm: $("topic-form"),
  enableNotifs: $("enable-notifs"),
  installBtn: $("install-btn"),
  installHint: $("install-hint"),
  updateToast: $("update-toast"),
};

const IS_LOCAL = ["localhost", "127.0.0.1"].includes(location.hostname);
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const FILTER_TITLES = {
  upcoming: "Upcoming deadlines",
  overdue: "Overdue work",
  week: "Due in 7 days",
  new: "New since your last look",
  done: "Done & submitted",
  all: "All assignments",
};

const state = {
  assignments: [],
  filter: "upcoming",
  staticMode: true,
  termEnd: null,
  lastPoll: null,
  lastError: null,
  lastAck: Number(storage.get("sti-last-ack") || 0),
  ntfyTopic: storage.get("sti-ntfy-topic") || "",
  done: loadDone(),
  submitted: {},
  submittedAt: null,
};

function loadDone() {
  try { return JSON.parse(storage.get(DONE_KEY) || "{}") || {}; } catch { return {}; }
}
function saveDone() {
  try { storage.set(DONE_KEY, JSON.stringify(state.done)); } catch { /* ignore */ }
}
function submittedInElms(item) { return Boolean(state.submitted[item.uid]?.submitted); }
function isDone(item) {
  const m = state.done[item.uid];
  if (m === false) return false;
  if (m) return true;
  return submittedInElms(item);
}
function toggleDone(item) {
  if (isDone(item)) state.done[item.uid] = false;
  else state.done[item.uid] = new Date().toISOString();
  saveDone();
}
function doneDate(item) {
  const m = state.done[item.uid];
  if (typeof m === "string") return m;
  if (submittedInElms(item)) return state.submittedAt;
  return null;
}

function daysUntil(due) { return Math.ceil((new Date(due).getTime() - Date.now()) / 86_400_000); }
function isOverdue(item) { return new Date(item.due).getTime() < Date.now(); }
function isNew(item) { return new Date(item.firstSeen).getTime() > (state.lastAck || 0); }
function needsAttention(item) { return isOverdue(item) && !isDone(item); }

function fmtDue(item) {
  const d = new Date(item.due);
  const date = d.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
  if (item.allDay) return date;
  return `${date}, ${d.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })}`;
}
function fmtRelative(iso) {
  if (!iso) return "—";
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  return new Date(iso).toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function badgeFor(item) {
  if (isDone(item)) return { cls: "done", text: submittedInElms(item) && !state.done[item.uid] ? "Submitted" : "Done" };
  if (isOverdue(item)) {
    const days = Math.abs(daysUntil(item.due));
    return days > 30 ? { cls: "past", text: `${days}d ago` } : { cls: "overdue", text: days <= 1 ? "Overdue" : `${days}d late` };
  }
  const days = daysUntil(item.due);
  if (days <= 0) return { cls: "today", text: "Today" };
  if (days === 1) return { cls: "soon", text: "Tomorrow" };
  if (days <= 7) return { cls: "soon", text: `${days}d left` };
  return { cls: "", text: `${days}d left` };
}

function visibleItems() {
  const now = Date.now();
  const week = now + 7 * 86_400_000;
  let items = [...state.assignments];
  switch (state.filter) {
    case "overdue":
      items = items.filter(needsAttention).sort((a, b) => new Date(a.due) - new Date(b.due));
      break;
    case "week":
      items = items.filter((i) => { const t = new Date(i.due).getTime(); return t >= now && t <= week && !isDone(i); });
      break;
    case "new":
      items = items.filter((i) => isNew(i) && !isDone(i)).sort((a, b) => new Date(b.firstSeen) - new Date(a.firstSeen));
      break;
    case "done":
      items = items.filter(isDone).sort((a, b) => new Date(doneDate(b) || 0) - new Date(doneDate(a) || 0));
      break;
    case "all":
      items.sort((a, b) => new Date(b.due) - new Date(a.due));
      break;
    default:
      items = items
        .filter((i) => new Date(i.due).getTime() >= now - 86_400_000 && !isDone(i))
        .sort((a, b) => new Date(a.due) - new Date(b.due));
  }
  return items;
}

function renderStats() {
  const now = Date.now();
  const week = now + 7 * 86_400_000;
  const overdue = state.assignments.filter(needsAttention).length;
  const weekCount = state.assignments.filter((i) => { const t = new Date(i.due).getTime(); return t >= now && t <= week && !isDone(i); }).length;
  const newCount = state.assignments.filter((i) => isNew(i) && !isDone(i)).length;
  $("stat-overdue").textContent = overdue;
  $("stat-week").textContent = weekCount;
  $("stat-new").textContent = newCount;
  $("stat-total").textContent = state.assignments.length;
}

function renderList() {
  const items = visibleItems();
  els.listTitle.textContent = FILTER_TITLES[state.filter] || "Assignments";
  els.list.innerHTML = "";
  if (!items.length) { els.empty.hidden = false; return; }
  els.empty.hidden = true;

  const frag = document.createDocumentFragment();
  for (const item of items) {
    const done = isDone(item);
    const badge = badgeFor(item);
    const row = document.createElement("article");
    row.className = `row ${isOverdue(item) && !done ? "overdue" : ""} ${done ? "done" : ""}`.trim();

    const badgeEl = document.createElement("span");
    badgeEl.className = `badge ${badge.cls}`.trim();
    badgeEl.textContent = badge.text;

    const body = document.createElement("div");
    body.className = "row-body";
    const title = document.createElement("h3");
    title.className = "row-title";
    title.textContent = item.title;
    const meta = document.createElement("div");
    meta.className = "row-meta";
    const course = document.createElement("span");
    course.className = "course";
    course.textContent = item.course || "eLMS";
    const due = document.createElement("span");
    due.textContent = `Due ${fmtDue(item)}`;
    meta.append(course, due);
    if (done) {
      const when = doneDate(item);
      const status = document.createElement("span");
      status.textContent = submittedInElms(item) && !state.done[item.uid]
        ? "Submitted in eLMS"
        : when ? `Marked done ${new Date(when).toLocaleDateString("en-PH", { month: "short", day: "numeric" })}` : "Marked done";
      meta.append(status);
    }
    body.append(title, meta);

    const check = document.createElement("button");
    check.type = "button";
    check.className = `row-check${done ? " on" : ""}`;
    check.title = done ? "Mark as not done" : "Mark as done";
    check.setAttribute("aria-pressed", done ? "true" : "false");
    check.setAttribute("aria-label", `${done ? "Unmark" : "Mark"} ${item.title} as ${done ? "not done" : "done"}`);
    check.dataset.uid = item.uid;
    check.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 12.5l5 5L19.5 6.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    check.addEventListener("click", () => { toggleDone(item); renderAll(); els.list.querySelector(`[data-uid="${item.uid}"]`)?.focus(); });

    row.append(badgeEl, body, check);
    frag.append(row);
  }
  els.list.append(frag);
}

function minutes(hhmm) { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; }
function fmtClock(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

let SCHEDULE = {};

function nextClass(now = new Date()) {
  for (let offset = 0; offset < 8; offset += 1) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    const classes = [...(SCHEDULE[day.getDay()] || [])].sort((a, b) => minutes(a.from) - minutes(b.from));
    for (const item of classes) {
      const start = new Date(day);
      start.setMinutes(minutes(item.from), 0, 0);
      if (start.getTime() > now.getTime()) return { start, ...item };
    }
  }
  return null;
}

function renderSchedule() {
  const now = new Date();
  const today = now.getDay();
  const next = nextClass(now);
  if (next) {
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfNext = new Date(next.start.getFullYear(), next.start.getMonth(), next.start.getDate()).getTime();
    const days = Math.round((startOfNext - startOfToday) / 86_400_000);
    const when = days === 0 ? "Today" : days === 1 ? "Tomorrow" : DAY_NAMES[next.start.getDay()];
    const strong = document.createElement("strong");
    strong.textContent = next.course;
    els.nextClass.replaceChildren("Next: ", strong, ` · ${when} ${next.start.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })}${next.room ? ` · ${next.room}` : ""}`);
  } else {
    els.nextClass.textContent = "No classes in the next week.";
  }

  const frag = document.createDocumentFragment();
  for (const day of [1, 2, 3, 4, 5, 6, 0]) {
    const li = document.createElement("li");
    if (day === today) li.className = "today";
    const head = document.createElement("div");
    head.className = "day";
    head.textContent = DAY_NAMES[day];
    const col = document.createElement("div");
    const classes = SCHEDULE[day] || [];
    if (!classes.length) {
      const none = document.createElement("div");
      none.className = "none";
      none.textContent = "Free";
      col.append(none);
    } else {
      for (const item of classes) {
        const row = document.createElement("div");
        row.className = "cls";
        const time = document.createElement("span");
        time.className = "time";
        time.textContent = `${fmtClock(item.from)}–${fmtClock(item.to)}`;
        const title = document.createElement("span");
        title.textContent = item.course;
        const room = document.createElement("span");
        room.className = "room";
        room.textContent = item.room || "";
        row.append(time, title, room);
        col.append(row);
      }
    }
    li.append(head, col);
    frag.append(li);
  }
  els.week.replaceChildren(frag);
}

function renderStatus() {
  const ok = !state.lastError && state.lastPoll;
  els.pill.classList.toggle("ok", Boolean(ok));
  els.pill.classList.toggle("bad", Boolean(state.lastError));
  els.statusText.textContent = state.lastError ? "Feed problem" : ok ? "Connected" : "Connecting…";
  els.feedLast.textContent = state.lastPoll ? fmtRelative(state.lastPoll) : "—";
  els.feedNext.textContent = state.staticMode ? "every 15 min" : "—";
  els.feedError.hidden = !state.lastError;
  els.feedError.textContent = state.lastError || "";
  els.termEnd.textContent = state.termEnd ? new Date(state.termEnd).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" }) : "—";
  els.lastChecked.textContent = state.lastPoll ? `Checked ${fmtRelative(state.lastPoll)}` : "Checking…";
  els.listNote.textContent = state.submittedAt
    ? `Submission status from eLMS snapshot checked ${new Date(state.submittedAt).toLocaleDateString("en-PH", { month: "short", day: "numeric" })}.`
    : "Submission status unavailable — tap a row's check to mark done.";
}

function renderTopic() {
  const topic = state.ntfyTopic;
  els.ntfyTopic.textContent = topic || "Not set on this device";
  els.ntfyLink.href = topic ? `https://ntfy.sh/${encodeURIComponent(topic)}` : "https://ntfy.sh";
  els.ntfyInput.value = topic;
  const copyBtn = $("copy-topic");
  if (copyBtn) copyBtn.disabled = !topic;
}

function renderAll() { renderStats(); renderSchedule(); renderList(); renderStatus(); renderTopic(); }

async function loadSchedule() {
  try {
    const res = await fetch(`schedule.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error("schedule unavailable");
    SCHEDULE = (await res.json()).days || {};
  } catch { /* keep cached */ }
}
async function loadSubmitted() {
  try {
    const res = await fetch(`submitted.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error("snapshot unavailable");
    const data = await res.json();
    state.submitted = data.items || {};
    state.submittedAt = data.checkedAt || null;
  } catch { state.submitted = {}; state.submittedAt = null; }
}

async function loadData() {
  let data;
  try {
    const res = await fetch(`data.json?t=${Date.now()}`, { cache: "no-store" });
    const text = await res.text();
    if (!res.ok || text.trim().startsWith("<")) throw new Error("data.json unavailable (got a web page instead of data)");
    data = JSON.parse(text);
    try { storage.set(DATA_CACHE, text); } catch { /* full */ }
  } catch (error) {
    try {
      const cached = JSON.parse(storage.get(DATA_CACHE) || "null");
      if (cached && Array.isArray(cached.assignments)) {
        data = cached;
        state.lastError = `Offline copy — updated ${new Date(cached.generatedAt || cached.lastPoll).toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`;
      } else throw error;
    } catch { throw error; }
  }
  state.assignments = data.assignments || [];
  state.lastPoll = data.lastPoll || null;
  state.lastError = data.lastError || null;
  state.termEnd = data.termEnd || null;
  els.feedHost.textContent = IS_LOCAL ? "eLMS (local)" : "eLMS (via GitHub)";
  if (!state.ntfyTopic) state.ntfyTopic = storage.get("sti-ntfy-topic") || "";
  if (els.topicForm) els.topicForm.hidden = false;
  if (!state.lastAck && state.assignments.length) {
    const newest = Math.max(
      0,
      ...state.assignments.map((a) => new Date(a.firstSeen).getTime()).filter(Number.isFinite)
    );
    if (newest) {
      state.lastAck = newest;
      storage.set("sti-last-ack", String(state.lastAck));
    }
  }
}

async function load() {
  await Promise.all([loadSchedule(), loadSubmitted()]);
  await loadData();
  renderAll();
}

function renderNotifState() {
  const btn = els.enableNotifs;
  if (!btn) return;
  if (!("Notification" in window)) { btn.textContent = "Not supported"; btn.disabled = true; return; }
  if (Notification.permission === "granted") { btn.textContent = "Alerts on ✓"; btn.disabled = true; return; }
  if (Notification.permission === "denied") {
    btn.textContent = "Permission denied";
    btn.disabled = true;
    els.installHint.textContent = "Alerts blocked — enable them for this site in browser settings.";
  }
}

/* ---------- Bind events ---------- */
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => {
      t.classList.toggle("active", t === tab);
      t.setAttribute("aria-pressed", t === tab ? "true" : "false");
    });
    state.filter = tab.dataset.filter;
    renderList();
  });
});

$("refresh-btn").addEventListener("click", async () => {
  const btn = $("refresh-btn");
  btn.disabled = true;
  try {
    const res = await fetch(`data.json?t=${Date.now()}`, { cache: "no-store" });
    const text = await res.text();
    if (!res.ok || text.trim().startsWith("<")) throw new Error("refresh failed");
    const data = JSON.parse(text);
    storage.set(DATA_CACHE, text);
    state.assignments = data.assignments || [];
    state.lastPoll = data.lastPoll || null;
    state.lastError = data.lastError || null;
    state.termEnd = data.termEnd || null;
    renderAll();
  } catch (e) {
    state.lastError = String(e?.message || e);
    renderStatus();
  } finally { btn.disabled = false; }
});

$("ack-btn").addEventListener("click", () => {
  state.lastAck = Date.now();
  storage.set("sti-last-ack", String(state.lastAck));
  renderAll();
});

$("copy-topic").addEventListener("click", async () => {
  const btn = $("copy-topic");
  if (!state.ntfyTopic) { btn.textContent = "Set topic first"; setTimeout(() => (btn.textContent = "Copy"), 1600); return; }
  const done = () => { btn.textContent = "Copied ✓"; setTimeout(() => (btn.textContent = "Copy"), 1600); };
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(state.ntfyTopic);
    else {
      const ta = document.createElement("textarea");
      ta.value = state.ntfyTopic;
      ta.style.cssText = "position:fixed;opacity:0";
      document.body.append(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    done();
  } catch { btn.textContent = "Failed"; setTimeout(() => (btn.textContent = "Copy"), 1600); }
});

els.topicForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const topic = els.ntfyInput.value.trim();
  if (!topic) return;
  state.ntfyTopic = topic;
  storage.set("sti-ntfy-topic", topic);
  renderTopic();
  els.ntfyInput.blur();
});

$("test-notify").addEventListener("click", async () => {
  const btn = $("test-notify");
  if (!state.ntfyTopic) { btn.textContent = "Set a topic"; setTimeout(() => (btn.textContent = "Send test"), 1800); return; }
  btn.disabled = true;
  try {
    const res = await fetch(`https://ntfy.sh/${encodeURIComponent(state.ntfyTopic)}`, {
      method: "POST",
      body: "STI Pulse test — if you see this, alerts work.",
    });
    btn.textContent = res.ok ? "Sent ✓" : "Failed";
  } catch { btn.textContent = "Failed"; }
  setTimeout(() => { btn.disabled = false; btn.textContent = "Send test"; }, 1800);
});

els.enableNotifs.addEventListener("click", async () => {
  if (!("Notification" in window)) { els.enableNotifs.textContent = "Not supported"; return; }
  const perm = await Notification.requestPermission();
  renderNotifState();
  if (perm === "granted") new Notification("STI Pulse", { body: "Alerts are on for this device.", icon: "icon-192.png" });
});

/* ---------- Install prompt ---------- */
let deferredPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  els.installBtn.hidden = false;
});
els.installBtn.addEventListener("click", async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  if (outcome === "accepted") els.installBtn.hidden = true;
});
if (window.matchMedia("(display-mode: standalone)").matches) {
  els.installBtn.hidden = true;
  els.installHint.textContent = "Installed. Open it like any app.";
}

/* ---------- Service worker + update toast ---------- */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register("sw.js");
      const notify = () => { els.updateToast.removeAttribute("hidden"); els.updateToast.classList.add("show"); };
      if (reg.waiting) notify();
      reg.addEventListener("updatefound", () => {
        const installing = reg.installing;
        if (!installing) return;
        installing.addEventListener("statechange", () => {
          if (installing.state === "installed" && navigator.serviceWorker.controller) notify();
        });
      });
      navigator.serviceWorker.addEventListener("controllerchange", () => window.location.reload());
    } catch { /* ignore */ }
  });
  $("update-reload").addEventListener("click", () => window.location.reload());
}

renderNotifState();
load().catch((error) => { state.lastError = String(error?.message || error); renderAll(); });

/* Keep data fresh while the app is open */
setInterval(() => {
  if (!state.staticMode) return;
  fetch(`data.json?t=${Date.now()}`, { cache: "no-store" })
    .then((r) => (r.ok ? r.text() : null))
    .then((text) => {
      if (!text || text.trim().startsWith("<")) return;
      const data = JSON.parse(text);
      const before = new Set(state.assignments.map((a) => a.uid));
      const fresh = (data.assignments || []).filter((a) => !before.has(a.uid));
      if (fresh.length) {
        storage.set(DATA_CACHE, text);
        state.assignments = data.assignments;
        state.lastPoll = data.lastPoll || null;
        renderAll();
      }
    })
    .catch(() => {});
}, 60_000);
