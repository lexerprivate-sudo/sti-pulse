const $ = (id) => document.getElementById(id);
const DONE_KEY = "sti-done-v1";
const DATA_CACHE = "sti-data-cache";
const SCHEDULE_CACHE = "sti-schedule-cache";

const storage = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { logWarn("storage set", key); } },
  remove(key) { try { localStorage.removeItem(key); } catch { /* ignore */ } },
};

function logWarn(context, error) {
  try { console.warn(`[STI Pulse] ${context}:`, error); } catch { /* never throw */ }
}

function isPlainObject(v) { return typeof v === "object" && v !== null && !Array.isArray(v); }
function isValidDate(t) { return Number.isFinite(t); }

/* ---------- load / save helpers ---------- */
function loadDone() {
  try {
    const parsed = JSON.parse(storage.get(DONE_KEY) || "{}");
    if (!isPlainObject(parsed)) return {};
    const out = {};
    for (const [uid, value] of Object.entries(parsed)) {
      if (typeof value === "string" || value === false) out[uid] = value;
    }
    return out;
  } catch { return {}; }
}
function saveDone() { storage.set(DONE_KEY, JSON.stringify(state.done)); }

function loadCachedJson() {
  try {
    const parsed = JSON.parse(storage.get(DATA_CACHE) || "null");
    if (parsed && isPlainObject(parsed) && Array.isArray(parsed.assignments)) return parsed;
    return null;
  } catch { return null; }
}

/* ---------- Element handles ---------- */
const els = {
  pill: $("status-pill"),
  statusText: $("status-text"),
  list: $("assignment-list"),
  empty: $("empty"),
  emptyTitle: $("empty-title"),
  emptySub: $("empty-sub"),
  errorPanel: $("error-panel"),
  errorPanelText: $("error-panel-text"),
  errorRetry: $("error-retry"),
  offlineBanner: $("offline-banner"),
  listTitle: $("list-title"),
  listNote: $("list-note"),
  lastChecked: $("last-checked"),
  listStatus: $("list-status"),
  feedHost: $("feed-host"),
  feedLast: $("feed-last"),
  feedNext: $("feed-next"),
  termEnd: $("term-end"),
  feedError: $("feed-error"),
  nextClass: $("next-class"),
  week: $("week"),
  ntfyTopic: $("ntfy-topic"),
  ntfyLink: $("ntfy-link"),
  topicForm: $("topic-form"),
  topicInput: $("topic-input"),
  topicSetWrap: $("topic-set"),
  topicShowWrap: $("topic-show"),
  changeTopicBtn: $("change-topic-btn"),
  copyTopicBtn: $("copy-topic"),
  testNotifyBtn: $("test-notify"),
  enableNotifs: $("enable-notifs"),
  installBtn: $("install-btn"),
  installHint: $("install-hint"),
  updateToast: $("update-toast"),
  updateReload: $("update-reload"),
  updateDismiss: $("update-dismiss"),
  ackBtn: $("ack-btn"),
  refreshBtn: $("refresh-btn"),
};

const DAY_NAMES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const FILTER_TITLES = {
  upcoming: "Upcoming deadlines",
  overdue: "Overdue work",
  week: "Due in 7 days",
  new: "New since you last looked",
  done: "Done & submitted",
  all: "All assignments",
};
const EMPTY_STATES = {
  upcoming: { title: "All clear", sub: "New eLMS posts will appear here automatically." },
  overdue: { title: "Nothing overdue", sub: "Everything past its due date is submitted or checked off." },
  week: { title: "Nothing due this week", sub: "Your next 7 days are clear." },
  new: { title: "All caught up", sub: "Nothing new since your last look." },
  done: { title: "Nothing marked done yet", sub: "Tap the checkmark on any row to mark it done." },
  all: { title: "No assignments yet", sub: "The eLMS feed will fill this in on the next poll." },
};

const state = {
  assignments: [],
  filter: "upcoming",
  staticMode: true,
  termEnd: null,
  lastPoll: null,
  lastError: null,
  offlineMode: false,
  scheduleError: false,
  lastAck: Number.isFinite(Number(storage.get("sti-last-ack"))) ? Number(storage.get("sti-last-ack")) : 0,
  ntfyTopic: storage.get("sti-ntfy-topic") || "",
  done: loadDone(),
  submitted: {},
  submittedAt: null,
  pollFailures: 0,
};

function submittedInElms(item) { return Boolean(state.submitted[item.uid]?.submitted); }
function isDone(item) {
  const m = state.done[item.uid];
  if (m === false) return false;
  if (typeof m === "string") return true;
  return submittedInElms(item);
}
function toggleDone(item) {
  if (isDone(item)) state.done[item.uid] = false;
  else state.done[item.uid] = new Date().toISOString();
  saveDone();
}
function doneDate(item) {
  const m = state.done[item.uid];
  if (typeof m === "string" && Number.isFinite(new Date(m).getTime())) return m;
  if (submittedInElms(item)) return state.submittedAt;
  return null;
}

function daysUntil(due) { return Math.trunc((new Date(due).getTime() - Date.now()) / 86_400_000); }
function isOverdue(item) { return new Date(item.due).getTime() < Date.now(); }
function isNew(item) { return new Date(item.firstSeen).getTime() > (state.lastAck || 0); }
function needsAttention(item) { return isOverdue(item) && !isDone(item); }

function fmtDue(item) {
  const d = new Date(item.due);
  if (!Number.isFinite(d.getTime())) return "unknown date";
  const date = d.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
  if (item.allDay) return date;
  return `${date}, ${d.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })}`;
}
function fmtRelative(iso) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  const min = Math.round((Date.now() - t) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  return new Date(t).toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function badgeFor(item) {
  if (isDone(item)) {
    return { cls: "done", text: submittedInElms(item) && !state.done[item.uid] ? "Submitted" : "Done" };
  }
  if (isOverdue(item)) {
    const days = Math.abs(daysUntil(item.due));
    if (!Number.isFinite(days)) return { cls: "", text: "?" };
    return days > 30 ? { cls: "past", text: `${days}d ago` } : { cls: "overdue", text: days <= 1 ? "Overdue" : `${days}d late` };
  }
  const days = daysUntil(item.due);
  if (!Number.isFinite(days)) return { cls: "", text: "?" };
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

/* ---------- live region updates ---------- */
function setText(node, value) { if (node && node.textContent !== value) node.textContent = value; }
function setHidden(node, hidden) { if (node.hidden !== hidden) node.hidden = hidden; }

/* ---------- render ---------- */
const statEls = {
  overdue: $("stat-overdue"),
  week: $("stat-week"),
  newCount: $("stat-new"),
  total: $("stat-total"),
};
const statBoxes = {
  overdue: statEls.overdue.closest(".stat"),
  week: statEls.week.closest(".stat"),
  newCount: statEls.newCount.closest(".stat"),
  total: statEls.total.closest(".stat"),
};

function renderStats() {
  const now = Date.now();
  const week = now + 7 * 86_400_000;
  const noData = state.lastError && !state.assignments.length;
  const overdue = state.assignments.filter(needsAttention).length;
  const weekCount = state.assignments.filter((i) => { const t = new Date(i.due).getTime(); return t >= now && t <= week && !isDone(i); }).length;
  const newCount = state.assignments.filter((i) => isNew(i) && !isDone(i)).length;
  statEls.overdue.textContent = noData ? "–" : overdue;
  statEls.week.textContent = noData ? "–" : weekCount;
  statEls.newCount.textContent = noData ? "–" : newCount;
  statEls.total.textContent = noData ? "–" : state.assignments.length;
  statBoxes.overdue.classList.toggle("danger", overdue > 0);
  statBoxes.week.classList.toggle("warn", weekCount > 0);
}

const rowCache = new Map();

function renderList() {
  const items = visibleItems();
  setText(els.listTitle, FILTER_TITLES[state.filter] || "Assignments");
  setText(els.listStatus, items.length ? `${items.length} shown` : "Empty");

  const failedAndNoData = state.lastError && !state.assignments.length;
  setHidden(els.errorPanel, !failedAndNoData);
  setHidden(els.empty, items.length > 0 || failedAndNoData);

  if (failedAndNoData) {
    setText(els.errorPanelText, state.lastError.includes("web page")
      ? "The feed responded with a page instead of data — the site may be misconfigured. Try Refresh in a bit."
      : "Could not reach the eLMS feed. Check your connection, then retry.");
    rowCache.clear();
    els.list.innerHTML = "";
    return;
  }
  if (!items.length) {
    const copy = EMPTY_STATES[state.filter] || EMPTY_STATES.upcoming;
    setText(els.emptyTitle, copy.title);
    setText(els.emptySub, copy.sub);
    rowCache.clear();
    els.list.innerHTML = "";
    return;
  }

  const liveIds = new Set();
  const frag = document.createDocumentFragment();
  for (const item of items) {
    if (!item || typeof item.uid !== "string") continue;
    liveIds.add(item.uid);
    const done = isDone(item);
    let row = rowCache.get(item.uid);
    if (row) {
      // Update classes and contents in place
      const badge = badgeFor(item);
      const badgeEl = row.querySelector(".badge");
      badgeEl.className = `badge ${badge.cls}`.trim();
      badgeEl.textContent = badge.text;
      row.className = `row ${isOverdue(item) && !done ? "overdue" : ""} ${done ? "is-done" : ""}`.trim();
      const metaCourse = row.querySelector(".course");
      const metaDue = row.querySelector(".row-due");
      const metaStatus = row.querySelector(".row-status");
      if (metaCourse) metaCourse.textContent = item.course || "eLMS";
      if (metaDue) metaDue.textContent = new Date(item.due).toLocaleDateString("en-PH", { month: "short", day: "numeric" });
      const newIsDone = done;
      if (newIsDone) {
        const when = doneDate(item);
        if (!metaStatus) {
          const s = document.createElement("span");
          s.className = "row-status";
          row.querySelector(".row-meta").append(s);
        }
        row.querySelector(".row-status").textContent = submittedInElms(item) && !state.done[item.uid]
          ? "Submitted in eLMS"
          : when ? `Marked done ${new Date(when).toLocaleDateString("en-PH", { month: "short", day: "numeric" })}` : "Marked done";
      } else if (metaStatus) {
        metaStatus.remove();
      }
      const check = row.querySelector(".row-check");
      check.classList.toggle("on", done);
      check.setAttribute("aria-pressed", done ? "true" : "false");
      check.setAttribute("aria-label", `Mark "${item.title}" as ${done ? "not done" : "done"}`);
      frag.append(row);
    } else {
      row = document.createElement("article");
      const badge = badgeFor(item);
      row.className = `row ${isOverdue(item) && !done ? "overdue" : ""} ${done ? "is-done" : ""}`.trim();

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
        status.className = "row-status";
        status.textContent = submittedInElms(item) && !state.done[item.uid]
          ? "Submitted in eLMS"
          : when ? `Marked done ${new Date(when).toLocaleDateString("en-PH", { month: "short", day: "numeric" })}` : "Marked done";
        meta.append(status);
      }
      body.append(title, meta);

      const rowDue = document.createElement("span");
      rowDue.className = "row-due";
      rowDue.textContent = new Date(item.due).toLocaleDateString("en-PH", { month: "short", day: "numeric" });

      const check = document.createElement("button");
      check.type = "button";
      check.className = `row-check${done ? " on" : ""}`;
      check.title = done ? "Mark as not done" : "Mark as done";
      check.setAttribute("aria-pressed", done ? "true" : "false");
      check.setAttribute("aria-label", `Mark "${item.title}" as ${done ? "not done" : "done"}`);
      check.dataset.uid = item.uid;
      check.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4" fill="none" stroke="currentColor" stroke-width="2"/><path class="check-path" d="M8.5 12.5l2.5 2.5L15.5 9.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      check.addEventListener("click", () => {
        toggleDone(item);
        renderList();
        renderStats();
        const btn = els.list.querySelector(`[data-uid="${CSS.escape(item.uid)}"]`);
        if (btn) btn.focus({ preventScroll: true });
      });

      row.append(badgeEl, body, rowDue, check);
      rowCache.set(item.uid, row);
      frag.append(row);
    }
  }
  // Drop cache entries for items no longer visible
  for (const uid of [...rowCache.keys()]) {
    if (!liveIds.has(uid)) rowCache.delete(uid);
  }
  els.list.replaceChildren(frag);
}

function minutes(hhmm) { const [h, m] = String(hhmm).split(":").map(Number); return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0); }
function fmtClock(hhmm) {
  const [h, m] = String(hhmm).split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return String(hhmm);
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

  if (state.scheduleError) {
    setText(els.nextClass, "Class schedule unavailable — check back later.");
  } else {
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
      setText(els.nextClass, "No classes in the next week.");
    }
  }

  const frag = document.createDocumentFragment();
  if (state.scheduleError) {
    const li = document.createElement("li");
    const none = document.createElement("div");
    none.className = "none";
    none.textContent = "Couldn't load schedule";
    li.append(none);
    frag.append(li);
  } else {
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
        for (const item of [...(SCHEDULE[day] || [])].sort((a, b) => minutes(a.from) - minutes(b.from))) {
          const row = document.createElement("div");
          row.className = "cls";
          const time = document.createElement("span");
          time.className = "time";
          time.textContent = `${fmtClock(item.from)}–${fmtClock(item.to)}`;
          const course = document.createElement("span");
          course.className = "course-name";
          course.textContent = item.course;
          const room = document.createElement("span");
          room.className = "room";
          room.textContent = item.room || "";
          row.append(time, course, room);
          col.append(row);
        }
      }
      li.append(head, col);
      frag.append(li);
    }
  }
  els.week.replaceChildren(frag);
}

function renderStatus() {
  const stale = Boolean(state.lastError) || !state.lastPoll;
  const pollAgeMin = state.lastPoll ? (Date.now() - new Date(state.lastPoll).getTime()) / 60_000 : Infinity;
  const isStale = pollAgeMin > 60;
  els.pill.classList.toggle("ok", !stale && !isStale);
  els.pill.classList.toggle("bad", Boolean(state.lastError));
  els.pill.classList.toggle("warn", !state.lastError && isStale);
  const statusDot = els.pill.querySelector(".pill-dot");
  if (statusDot) {
    statusDot.classList.toggle("ok", !stale && !isStale);
    statusDot.classList.toggle("warn", !state.lastError && isStale);
    statusDot.classList.toggle("bad", Boolean(state.lastError));
  }
  setText(els.statusText, state.lastError
    ? "eLMS problem"
    : isStale ? "Stale data"
    : state.lastPoll ? "Connected" : "Connecting…");
  setText(els.feedLast, state.lastPoll ? fmtRelative(state.lastPoll) : "—");
  setText(els.feedNext, isStale ? "Delayed — GitHub skipped runs" : "Every 15 min (best effort)");
  setHidden(els.feedError, !state.lastError);
  if (state.lastError) els.feedError.textContent = "eLMS is not responding right now — showing your last copy.";
  els.termEnd.textContent = state.termEnd && Number.isFinite(new Date(state.termEnd).getTime())
    ? new Date(state.termEnd).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })
    : "—";
  setText(els.lastChecked, state.lastPoll ? `Checked ${fmtRelative(state.lastPoll)}` : "Checking…");
  setText(els.listNote, state.submittedAt
    ? `Done status from the latest eLMS sync (${new Date(state.submittedAt).toLocaleDateString("en-PH", { month: "short", day: "numeric" })}). Tap a checkmark to override.`
    : "Submission status unavailable — tap the checkmark to mark done.");
  setHidden(els.offlineBanner, !state.offlineMode);
}

function renderTopic() {
  const topic = state.ntfyTopic;
  const isAndroid = /android/i.test(navigator.userAgent);
  setText(els.ntfyTopic, topic || "Not set on this device");
  els.ntfyLink.href = topic
    ? (isAndroid ? `ntfy://ntfy.sh/${encodeURIComponent(topic)}` : `https://ntfy.sh/${encodeURIComponent(topic)}`)
    : "https://ntfy.sh";
  if (document.activeElement !== els.topicInput) {
    els.topicInput.value = topic;
  }
  if (els.copyTopicBtn) els.copyTopicBtn.disabled = !topic;
  if (els.testNotifyBtn) els.testNotifyBtn.disabled = !topic;
  setHidden(els.topicSetWrap, Boolean(topic));
  setHidden(els.topicShowWrap, !topic);
}

function renderAll() {
  renderStats();
  renderSchedule();
  renderList();
  renderStatus();
  renderTopic();
}

/* ---------- Data loading ---------- */
async function loadSchedule() {
  try {
    const res = await fetch("schedule.json", { cache: "no-cache" });
    const text = await res.text();
    if (text.trim().startsWith("<")) throw new Error("got a web page instead of data");
    const data = JSON.parse(text);
    if (!isPlainObject(data.days)) throw new Error("bad schedule shape");
    SCHEDULE = data.days;
    storage.set(SCHEDULE_CACHE, text);
    state.scheduleError = false;
  } catch (error) {
    logWarn("schedule load", error);
    state.scheduleError = true;
    try {
      const cached = JSON.parse(storage.get(SCHEDULE_CACHE) || "null");
      if (isPlainObject(cached?.days)) {
        SCHEDULE = cached.days;
        state.scheduleError = false;
      }
    } catch { /* keep empty */ }
  }
}

async function loadSubmitted() {
  try {
    const res = await fetch("submitted.json", { cache: "no-cache" });
    const text = await res.text();
    if (text.trim().startsWith("<")) throw new Error("got a web page instead of data");
    const data = JSON.parse(text);
    if (!isPlainObject(data.items)) throw new Error("bad snapshot shape");
    state.submitted = data.items;
    state.submittedAt = data.checkedAt || null;
  } catch (error) {
    logWarn("submission snapshot load", error);
  }
}

async function fetchDataJson() {
  const res = await fetch("data.json", { cache: "no-cache" });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (text.trim().startsWith("<")) throw new Error("data.json unavailable (got a web page instead of data)");
  const data = JSON.parse(text);
  if (!isPlainObject(data) || !Array.isArray(data.assignments)) {
    throw new Error("data.json has an unexpected shape");
  }
  return data;
}

async function loadData() {
  try {
    const data = await fetchDataJson();
    storage.set(DATA_CACHE, JSON.stringify(data));
    state.assignments = data.assignments.filter((a) => a && typeof a.uid === "string");
    state.lastPoll = data.lastPoll || null;
    state.lastError = data.lastError || null;
    state.termEnd = data.termEnd || null;
    state.offlineMode = false;
    state.pollFailures = 0;
    els.feedHost.textContent = "eLMS";
  } catch (error) {
    logWarn("data load", error);
    state.pollFailures += 1;
    const cached = loadCachedJson();
    if (cached) {
      state.assignments = cached.assignments;
      state.lastPoll = cached.generatedAt || cached.lastPoll || null;
      state.lastError = String(error?.message || error);
      state.termEnd = cached.termEnd || null;
      state.offlineMode = true;
    } else {
      state.assignments = [];
      state.lastPoll = null;
      state.lastError = String(error?.message || error);
      state.offlineMode = true;
    }
    els.feedHost.textContent = "eLMS";
  }
}

async function load() {
  try {
    const params = new URLSearchParams(location.search);
    const ntfy = params.get("ntfy");
    if (ntfy) {
      state.ntfyTopic = ntfy.trim();
      storage.set("sti-ntfy-topic", state.ntfyTopic);
      params.delete("ntfy");
      const clean = location.pathname + (params.toString() ? "?" + params.toString() : "");
      history.replaceState(null, "", clean);
    }
  } catch { /* ignore */ }
  els.list.setAttribute("aria-busy", "true");
  await Promise.all([loadSchedule(), loadSubmitted(), loadData()]);
  els.feedHost.textContent = "eLMS";
  els.list.setAttribute("aria-busy", "false");
  pruneDoneKeys();
  renderAll();
}

function pruneDoneKeys() {
  if (state.lastError) return; // don't wipe state during a failed poll
  const feedUids = new Set(state.assignments.map((a) => a.uid));
  if (!feedUids.size) return; // don't wipe when we have no healthy data
  let changed = false;
  for (const uid of Object.keys(state.done)) {
    if (!feedUids.has(uid)) {
      delete state.done[uid];
      changed = true;
    }
  }
  if (changed) saveDone();
}

/* ---------- UI events ---------- */
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => {
      const on = t === tab;
      t.classList.toggle("active", on);
      t.setAttribute("aria-checked", on ? "true" : "false");
    });
    state.filter = tab.dataset.filter;
    renderList();
  });
});

els.refreshBtn.addEventListener("click", async () => {
  els.refreshBtn.disabled = true;
  els.refreshBtn.setAttribute("aria-busy", "true");
  try {
    const data = await fetchDataJson();
    storage.set(DATA_CACHE, JSON.stringify(data));
    state.assignments = data.assignments.filter((a) => a && typeof a.uid === "string");
    state.lastPoll = data.lastPoll || null;
    state.lastError = data.lastError || null;
    state.termEnd = data.termEnd || null;
    state.offlineMode = false;
    state.pollFailures = 0;
    renderAll();
  } catch (error) {
    logWarn("manual refresh", error);
    state.pollFailures += 1;
    state.lastError = String(error?.message || error);
    renderStatus();
    renderList();
  } finally {
    els.refreshBtn.disabled = false;
    els.refreshBtn.setAttribute("aria-busy", "false");
  }
});

els.errorRetry.addEventListener("click", () => { load(); });

/* Undo "mark all seen" path */
let ackUndoTimer = null;
let previousLastAck = 0;
els.ackBtn.addEventListener("click", () => {
  previousLastAck = state.lastAck;
  state.lastAck = Date.now();
  storage.set("sti-last-ack", String(state.lastAck));
  renderAll();
  els.ackBtn.textContent = "Undo";
  clearTimeout(ackUndoTimer);
  ackUndoTimer = setTimeout(() => {
    els.ackBtn.textContent = "Mark all seen";
  }, 5000);
});
els.ackBtn.addEventListener("click", () => {
  if (els.ackBtn.textContent !== "Undo") return;
  state.lastAck = previousLastAck;
  storage.set("sti-last-ack", String(state.lastAck));
  renderAll();
  els.ackBtn.textContent = "Mark all seen";
});

els.copyTopicBtn.addEventListener("click", async () => {
  const btn = els.copyTopicBtn;
  if (!state.ntfyTopic) {
    btn.textContent = "Set topic first";
    setTimeout(() => (btn.textContent = "Copy"), 1600);
    return;
  }
  const done = () => {
    btn.textContent = "Copied ✓";
    btn.classList.add("flash-ok");
    setTimeout(() => { btn.textContent = "Copy"; btn.classList.remove("flash-ok"); }, 1600);
  };
  const copyWith = async () => {
    if (navigator.clipboard?.writeText) {
      try { await navigator.clipboard.writeText(state.ntfyTopic); return true; } catch { /* fall through */ }
    }
    const ta = document.createElement("textarea");
    ta.value = state.ntfyTopic;
    ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;";
    document.body.append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    ta.remove();
    return ok;
  };
  try {
    const ok = await copyWith();
    if (ok) done(); else throw new Error("copy failed");
  } catch (error) {
    logWarn("clipboard copy", error);
    btn.textContent = "Failed";
    btn.classList.add("flash-err");
    setTimeout(() => { btn.textContent = "Copy"; btn.classList.remove("flash-err"); }, 1600);
  }
});

els.topicForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const topic = els.topicInput.value.trim();
  if (!topic) return;
  state.ntfyTopic = topic;
  storage.set("sti-ntfy-topic", topic);
  renderTopic();
  els.topicInput.blur();
});

els.changeTopicBtn.addEventListener("click", () => {
  storage.remove("sti-ntfy-topic");
  state.ntfyTopic = "";
  renderTopic();
  els.topicInput.focus();
});

els.testNotifyBtn.addEventListener("click", async () => {
  const btn = els.testNotifyBtn;
  if (!state.ntfyTopic) {
    btn.textContent = "Set a topic first";
    setTimeout(() => (btn.textContent = "Send test"), 1800);
    return;
  }
  btn.disabled = true;
  try {
    const res = await fetch(`https://ntfy.sh/${encodeURIComponent(state.ntfyTopic)}`, {
      method: "POST",
      body: "STI Pulse test — if you see this, alerts work.",
    });
    const data = await res.json().catch(() => null);
    if (res.ok && data?.id) {
      btn.textContent = "Sent ✓";
      btn.classList.add("flash-ok");
    } else {
      btn.textContent = "Failed";
      btn.classList.add("flash-err");
    }
  } catch (error) {
    logWarn("test notification", error);
    btn.textContent = "Failed";
    btn.classList.add("flash-err");
  }
  setTimeout(() => { btn.disabled = false; btn.textContent = "Send test"; btn.classList.remove("flash-ok", "flash-err"); }, 1800);
});

els.enableNotifs.addEventListener("click", async () => {
  if (!("Notification" in window)) {
    els.enableNotifs.textContent = "Not supported";
    els.enableNotifs.disabled = true;
    return;
  }
  try {
    const perm = await Notification.requestPermission();
    renderNotifState();
    if (perm === "granted") {
      try { new Notification("STI Pulse", { body: "Alerts are on for this device.", icon: "icon-192.png" }); } catch { /* platform-blocked */ }
    }
  } catch (error) {
    logWarn("notification permission", error);
  }
});

function renderNotifState() {
  const btn = els.enableNotifs;
  if (!btn) return;
  if (!("Notification" in window)) { btn.textContent = "Not supported"; btn.disabled = true; return; }
  if (Notification.permission === "granted") {
    btn.textContent = "Alerts on ✓";
    btn.disabled = true;
    els.installHint.textContent = "Browser pushes are on for this device.";
    return;
  }
  if (Notification.permission === "denied") {
    btn.textContent = "Alerts blocked";
    btn.title = "Enable in browser settings — site permissions";
    els.installHint.textContent = "Alerts are blocked for this site. Enable them in your browser settings.";
    return;
  }
  els.installHint.textContent = "On phone: browser menu → “Add to Home screen”.";
}

/* ---------- Install prompt ---------- */
let deferredPrompt = null;
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredPrompt = event;
  els.installBtn.hidden = false;
});
els.installBtn.addEventListener("click", async () => {
  if (!deferredPrompt) return;
  try {
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") els.installBtn.hidden = true;
  } catch (error) {
    logWarn("install prompt", error);
  }
});
window.addEventListener("appinstalled", () => { els.installBtn.hidden = true; });
if (window.matchMedia("(display-mode: standalone)").matches) {
  els.installBtn.hidden = true;
  els.installHint.textContent = "Installed. Open it like any app.";
}

/* ---------- Service worker + update toast ---------- */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register("sw.js");
      const notify = () => { els.updateToast.hidden = false; els.updateToast.classList.add("show"); };
      reg.addEventListener("updatefound", () => {
        const installing = reg.installing;
        if (!installing) return;
        installing.addEventListener("statechange", () => {
          if (installing.state === "installed" && navigator.serviceWorker.controller) notify();
        });
      });
    } catch (error) {
      logWarn("service worker registration", error);
    }
  });
  els.updateReload.addEventListener("click", () => window.location.reload());
  els.updateDismiss.addEventListener("click", () => {
    els.updateToast.classList.remove("show");
    els.updateToast.hidden = true;
  });
  // If a new SW takes control mid-session, reload once to serve fresh assets
  if (navigator.serviceWorker.controller) {
    navigator.serviceWorker.addEventListener("controllerchange", () => window.location.reload());
  }
}

/* ---------- Tab overflow cue ---------- */
function updateTabsCue() {
  const tabs = document.querySelector(".tabs");
  if (tabs) tabs.classList.toggle("scrollable", tabs.scrollWidth > tabs.clientWidth + 4);
}
window.addEventListener("resize", updateTabsCue);

renderNotifState();
load().catch((error) => {
  logWarn("load", error);
  state.lastError = String(error?.message || error);
  renderAll();
});
updateTabsCue();

/* Keep data fresh while the app is open */
setInterval(() => {
  if (document.hidden) return;
  refreshData();
}, 60_000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshData(); });

async function refreshData() {
  try {
    const data = await fetchDataJson();
    const changed = data.lastPoll !== state.lastPoll || (data.assignments?.length ?? -1) !== state.assignments.length;
    if (!changed) {
      setText(els.lastChecked, `Checked ${fmtRelative(data.lastPoll)}`);
      state.pollFailures = 0;
      return;
    }
    state.assignments = data.assignments.filter((a) => a && typeof a.uid === "string");
    state.lastPoll = data.lastPoll || null;
    state.lastError = data.lastError || null;
    state.termEnd = data.termEnd || null;
    state.offlineMode = false;
    state.pollFailures = 0;
    storage.set(DATA_CACHE, JSON.stringify(data));
    renderAll();
  } catch (error) {
    logWarn("background refresh", error);
    state.pollFailures += 1;
    if (state.pollFailures >= 2) state.lastError = "Background refresh failed repeatedly.";
    renderStatus();
    renderList();
  }
}
