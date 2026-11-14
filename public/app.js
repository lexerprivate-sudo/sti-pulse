const $ = (id) => document.getElementById(id);

const DONE_KEY = "sti-done-v1";

const state = {
  assignments: [],
  lastPoll: null,
  lastError: null,
  lastAck: 0,
  filter: "upcoming",
  staticMode: false,
  termEnd: null,
  ntfyTopic: localStorage.getItem("sti-ntfy-topic") || "",
  pollMinutes: 10,
  // Manual overrides: uid -> ISO date (marked done) or false (unmarked).
  done: loadDone(),
  // Submission status scraped from eLMS: uid -> { submitted, course, title }.
  submitted: {},
  submittedAt: null,
};

function loadDone() {
  try {
    return JSON.parse(localStorage.getItem(DONE_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

function saveDone() {
  try {
    localStorage.setItem(DONE_KEY, JSON.stringify(state.done));
  } catch {
    /* storage full or blocked; keep the in-memory value */
  }
}

function submittedInElms(item) {
  return Boolean(state.submitted[item.uid]?.submitted);
}

function isDone(item) {
  const manual = state.done[item.uid];
  if (manual === false) return false;
  if (manual) return true;
  return submittedInElms(item);
}

function toggleDone(item) {
  if (isDone(item)) state.done[item.uid] = false;
  else state.done[item.uid] = new Date().toISOString();
  saveDone();
}

function doneDate(item) {
  const manual = state.done[item.uid];
  if (typeof manual === "string") return manual;
  if (submittedInElms(item)) return state.submittedAt;
  return null;
}

const els = {
  list: $("assignment-list"),
  empty: $("empty"),
  listTitle: $("list-title"),
  listNote: $("list-note"),
  lastChecked: $("last-checked"),
  statusPill: $("status-pill"),
  statusText: $("status-text"),
  statusDot: $("status-dot"),
  feedHost: $("feed-host"),
  nextClass: $("next-class"),
  week: $("week"),
  feedLast: $("feed-last"),
  feedNext: $("feed-next"),
  feedError: $("feed-error"),
  termEnd: $("term-end"),
  ntfyTopic: $("ntfy-topic"),
  ntfyLink: $("ntfy-link"),
  installBtn: $("install-btn"),
  installHint: $("install-hint"),
  settingsForm: $("settings-form"),
  settingsMsg: $("settings-msg"),
  digest: $("digest"),
  pollMinutes: $("poll-minutes"),
  ntfyInput: $("ntfy-input"),
  feedUrl: $("feed-url"),
};

const IS_LOCAL = ["localhost", "127.0.0.1"].includes(location.hostname);

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// Weekly class schedule, loaded from schedule.json (shared with the poller).
let SCHEDULE = {};


const FILTER_TITLES = {
  upcoming: "Upcoming deadlines",
  overdue: "Overdue work",
  week: "Due in the next 7 days",
  new: "New since your last check",
  done: "Done & submitted in eLMS",
  all: "All tracked assignments",
};

function daysUntil(due) {
  return Math.ceil((new Date(due).getTime() - Date.now()) / 86_400_000);
}

function isOverdue(item) {
  return new Date(item.due).getTime() < Date.now();
}

// Genuinely late and not yet accounted for: these are the ones that matter.
function needsAttention(item) {
  return isOverdue(item) && !isDone(item);
}

function fmtDue(item) {
  const d = new Date(item.due);
  const date = d.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
  if (item.allDay) return date;
  return `${date}, ${d.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })}`;
}

function fmtRelative(iso) {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  return new Date(iso).toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function badgeFor(item) {
  if (isDone(item)) {
    return { cls: "done", text: submittedInElms(item) && !state.done[item.uid] ? "Submitted" : "Done" };
  }
  if (isOverdue(item)) {
    const days = Math.abs(daysUntil(item.due));
    if (days > 30) return { cls: "past", text: `${days}d ago` };
    return { cls: "overdue", text: days <= 1 ? "Overdue" : `${days}d late` };
  }
  const days = daysUntil(item.due);
  if (days <= 0) return { cls: "today", text: "Today" };
  if (days === 1) return { cls: "soon", text: "Tomorrow" };
  if (days <= 7) return { cls: "soon", text: `${days}d left` };
  return { cls: "", text: `${days}d left` };
}

function isNew(item) {
  return new Date(item.firstSeen).getTime() > (state.lastAck || 0);
}

function visibleItems() {
  const now = Date.now();
  const week = now + 7 * 86_400_000;
  let items = [...state.assignments];
  switch (state.filter) {
    case "overdue":
      items = items.filter(needsAttention);
      items.sort((a, b) => new Date(a.due) - new Date(b.due));
      break;
    case "week":
      items = items.filter((i) => {
        const t = new Date(i.due).getTime();
        return t >= now && t <= week && !isDone(i);
      });
      break;
    case "new":
      items = items
        .filter((i) => isNew(i) && !isDone(i))
        .sort((a, b) => new Date(b.firstSeen) - new Date(a.firstSeen));
      break;
    case "done":
      items = items
        .filter(isDone)
        .sort((a, b) => new Date(doneDate(b) || 0) - new Date(doneDate(a) || 0));
      break;
    case "all":
      items.sort((a, b) => new Date(b.due) - new Date(a.due));
      break;
    default:
      items = items.filter((i) => new Date(i.due).getTime() >= now - 86_400_000 && !isDone(i));
      items.sort((a, b) => new Date(a.due) - new Date(b.due));
  }
  return items;
}

function minutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function fmtClock(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" });
}

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
  if (!els.week) return;
  const now = new Date();
  const today = now.getDay();

  const next = nextClass(now);
  if (next) {
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfNext = new Date(next.start.getFullYear(), next.start.getMonth(), next.start.getDate()).getTime();
    const days = Math.round((startOfNext - startOfToday) / 86_400_000);
    const when = days === 0 ? "Today" : days === 1 ? "Tomorrow" : DAY_NAMES[next.start.getDay()];
    const label = document.createElement("strong");
    label.textContent = next.course;
    els.nextClass.replaceChildren(
      `Next: `,
      label,
      ` · ${when} ${next.start.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })}${next.room ? ` · ${next.room}` : ""}`
    );
  } else {
    els.nextClass.textContent = "No classes in the next week.";
  }

  const frag = document.createDocumentFragment();
  for (const day of [1, 2, 3, 4, 5, 6, 0]) {
    const li = document.createElement("li");
    if (day === today) li.className = "today";

    const head = document.createElement("div");
    head.className = "day";
    head.textContent = DAY_NAMES[day].toUpperCase().slice(0, 3) + (day === today ? " · TODAY" : "");
    li.append(head);

    const classesWrap = document.createElement("div");
    classesWrap.className = "classes";

    const classes = SCHEDULE[day] || [];
    if (!classes.length) {
      const none = document.createElement("div");
      none.className = "none";
      none.textContent = "Free day";
      classesWrap.append(none);
    } else {
      for (const item of classes) {
        const row = document.createElement("div");
        row.className = "cls";
        const time = document.createElement("span");
        time.className = "time";
        time.textContent = `${fmtClock(item.from)}–${fmtClock(item.to)}`;
        const title = document.createElement("span");
        title.className = "title";
        title.textContent = item.course;
        title.title = `${item.course} · ${item.room}`;
        const room = document.createElement("span");
        room.className = "room";
        room.textContent = item.room;
        row.append(time, title, room);
        classesWrap.append(row);
      }
    }
    li.append(classesWrap);
    frag.append(li);
  }
  els.week.replaceChildren(frag);
}

function renderStats() {
  const now = Date.now();
  const week = now + 7 * 86_400_000;
  const overdue = state.assignments.filter(needsAttention).length;
  const weekCount = state.assignments.filter((i) => {
    const t = new Date(i.due).getTime();
    return t >= now && t <= week && !isDone(i);
  }).length;
  const newCount = state.assignments.filter((i) => isNew(i) && !isDone(i)).length;
  const total = state.assignments.length;
  $("stat-overdue").textContent = overdue;
  $("stat-week").textContent = weekCount;
  $("stat-new").textContent = newCount;
  $("stat-total").textContent = total;
}

function renderList() {
  const items = visibleItems();
  els.listTitle.textContent = FILTER_TITLES[state.filter] || "Assignments";
  els.list.innerHTML = "";

  if (!items.length) {
    els.empty.hidden = false;
    return;
  }
  els.empty.hidden = true;

  const frag = document.createDocumentFragment();
  for (const item of items) {
    const done = isDone(item);
    const badge = badgeFor(item);
    const card = document.createElement("article");
    card.className = `card ${badge.cls} ${isNew(item) && !done ? "new" : ""} ${done ? "done" : ""}`;
    card.style.animationDelay = `${Math.min(items.indexOf(item), 8) * 25}ms`;

    const badgeEl = document.createElement("span");
    badgeEl.className = `badge ${badge.cls}`;
    badgeEl.textContent = badge.text;

    const body = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = item.title;
    const meta = document.createElement("div");
    meta.className = "meta";
    const course = document.createElement("span");
    course.className = "course";
    course.textContent = item.course || "eLMS";
    const due = document.createElement("span");
    due.textContent = `Due ${fmtDue(item)}`;
    meta.append(course, due);
    if (done) {
      const status = document.createElement("span");
      status.className = "done-at";
      if (submittedInElms(item) && !state.done[item.uid]) {
        status.textContent = "Submitted in eLMS";
      } else {
        const when = doneDate(item);
        status.textContent = when
          ? `Marked done ${new Date(when).toLocaleDateString("en-PH", { month: "short", day: "numeric" })}`
          : "Marked done";
      }
      meta.append(status);
    }
    body.append(title, meta);

    const flag = document.createElement("span");
    flag.className = "new-flag";
    flag.textContent = "NEW";
    flag.style.visibility = isNew(item) && !done ? "visible" : "hidden";

    const check = document.createElement("button");
    check.type = "button";
    check.className = `done-btn${done ? " on" : ""}`;
    check.title = done ? "Mark as not done" : "Mark as done";
    check.setAttribute("aria-label", `${done ? "Unmark" : "Mark"} ${item.title} as ${done ? "not done" : "done"}`);
    check.setAttribute("aria-pressed", done ? "true" : "false");
    check.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 12.5l5 5L19.5 6.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    check.addEventListener("click", () => {
      toggleDone(item);
      renderAll();
    });

    card.append(badgeEl, body, flag, check);
    frag.append(card);
  }
  els.list.append(frag);
}

function renderStatus() {
  const ok = !state.lastError && state.lastPoll;
  els.statusPill.classList.toggle("ok", Boolean(ok));
  els.statusPill.classList.toggle("bad", Boolean(state.lastError));
  els.statusText.textContent = state.lastError ? "Feed problem" : ok ? "Connected" : "Connecting…";
  els.feedLast.textContent = state.lastPoll ? fmtRelative(state.lastPoll) : "—";
  els.feedNext.textContent = state.staticMode
    ? "every 15 min"
    : state.lastPoll
      ? new Date(new Date(state.lastPoll).getTime() + state.pollMinutes * 60_000).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })
      : "—";
  els.feedError.hidden = !state.lastError;
  els.feedError.textContent = state.lastError || "";
  els.termEnd.textContent = state.termEnd
    ? new Date(state.termEnd).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })
    : "—";
  els.lastChecked.textContent = state.lastPoll ? `Checked ${fmtRelative(state.lastPoll)}` : "Checking eLMS…";
  if (els.listNote) {
    els.listNote.textContent = state.submittedAt
      ? `Submission status from an eLMS snapshot checked ${new Date(state.submittedAt).toLocaleDateString("en-PH", { month: "short", day: "numeric" })}. Tap the check to override.`
      : "Tap the check to mark work you have already submitted.";
  }
}

function renderTopic() {
  const topic = state.ntfyTopic;
  els.ntfyTopic.textContent = topic || "Not set on this device";
  els.ntfyLink.href = topic ? `https://ntfy.sh/${encodeURIComponent(topic)}` : "https://ntfy.sh";
  els.ntfyInput.value = topic;
  $("topic-set").value = topic;
}

function renderAll() {
  renderStats();
  renderSchedule();
  renderList();
  renderStatus();
  renderTopic();
}

async function loadLocal() {
  const res = await fetch("/api/state", { cache: "no-store" });
  if (!res.ok) throw new Error("local API unavailable");
  const data = await res.json();
  state.assignments = data.assignments || [];
  state.lastPoll = data.lastPoll;
  state.lastError = data.lastError;
  state.lastAck = data.lastAck || 0;
  state.termEnd = data.termEnd || null;
  state.pollMinutes = data.config?.pollMinutes || 10;
  if (data.config?.ntfyTopic) {
    state.ntfyTopic = data.config.ntfyTopic;
    els.ntfyInput.value = state.ntfyTopic;
  }
  els.feedHost.textContent = data.config?.feedHost || "eLMS";
  els.pollMinutes.value = state.pollMinutes;
  els.digest.checked = Boolean(data.config?.dailyDigest);
  state.staticMode = false;
}

async function loadStatic() {
  const res = await fetch(`data.json?t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error("data.json not found");
  const data = await res.json();
  state.assignments = data.assignments || [];
  state.lastPoll = data.lastPoll;
  state.lastError = data.lastError;
  state.lastAck = Number(localStorage.getItem("sti-last-ack") || 0);
  if (!state.lastAck && state.assignments.length) {
    const newest = Math.max(...state.assignments.map((a) => new Date(a.firstSeen).getTime()));
    state.lastAck = newest;
    localStorage.setItem("sti-last-ack", String(newest));
  }
  state.staticMode = true;
  state.termEnd = data.termEnd || null;
  els.feedHost.textContent = "eLMS (via GitHub)";
  if (!state.ntfyTopic) state.ntfyTopic = localStorage.getItem("sti-ntfy-topic") || "";
  const topicForm = $("topic-form");
  if (topicForm) topicForm.hidden = false;
  document.querySelector(".settings")?.remove();
}

async function loadSchedule() {
  try {
    const res = await fetch(`schedule.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error("schedule unavailable");
    const data = await res.json();
    SCHEDULE = data.days || {};
  } catch {
    /* keep whatever schedule is already loaded */
  }
}

// Submission status snapshot from eLMS, keyed by assignment uid.
async function loadSubmitted() {
  try {
    const res = await fetch(`submitted.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error("submission snapshot unavailable");
    const data = await res.json();
    state.submitted = data.items || {};
    state.submittedAt = data.checkedAt || null;
  } catch {
    state.submitted = {};
    state.submittedAt = null;
  }
}

async function load() {
  await Promise.all([loadSchedule(), loadSubmitted()]);
  if (IS_LOCAL) {
    try {
      await loadLocal();
    } catch {
      await loadStatic();
    }
  } else {
    await loadStatic();
  }
  renderAll();
}

function startEvents() {
  if (!IS_LOCAL) return;
  const source = new EventSource("/api/events");
  source.addEventListener("message", (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    if (msg.type === "new") {
      showBrowserNotification(msg.items);
      load();
    } else if (msg.type === "state") {
      state.lastPoll = msg.lastPoll;
      renderStatus();
    } else if (msg.type === "error") {
      state.lastError = msg.message;
      renderStatus();
    } else if (msg.type === "ack") {
      state.lastAck = msg.lastAck;
      renderAll();
    }
  });
  source.addEventListener("error", () => {
    /* EventSource reconnects automatically. */
  });
}

function showBrowserNotification(items) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  for (const item of items.slice(0, 4)) {
    new Notification("New STI assignment", {
      body: `${item.title}\n${item.course} · due ${fmtDue(item)}`,
      icon: "icon-192.png",
      tag: item.uid,
    });
  }
}

async function refresh() {
  const btn = $("refresh-btn");
  btn.disabled = true;
  try {
    if (state.staticMode) {
      await loadStatic();
    } else {
      const res = await fetch("/api/refresh", { method: "POST" });
      const data = await res.json();
      if (data.state) {
        state.assignments = data.state.assignments || [];
        state.lastPoll = data.state.lastPoll;
        state.lastError = data.state.lastError;
      }
      if (data.error) state.lastError = data.error;
    }
    renderAll();
  } catch (error) {
    state.lastError = String(error.message || error);
    renderStatus();
  } finally {
    btn.disabled = false;
  }
}

function bind() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => {
        t.classList.toggle("active", t === tab);
        t.setAttribute("aria-selected", t === tab ? "true" : "false");
      });
      state.filter = tab.dataset.filter;
      renderList();
    });
  });

  $("refresh-btn").addEventListener("click", refresh);

  $("clear-past").addEventListener("click", () => {
    const btn = $("clear-past");
    const now = Date.now();
    let cleared = 0;
    for (const item of state.assignments) {
      if (!isDone(item) && new Date(item.due).getTime() < now) {
        state.done[item.uid] = new Date().toISOString();
        cleared += 1;
      }
    }
    if (!cleared) {
      btn.textContent = "Nothing past due";
      setTimeout(() => (btn.textContent = "Clear past"), 1800);
      return;
    }
    saveDone();
    renderAll();
    btn.textContent = `Cleared ${cleared}`;
    setTimeout(() => (btn.textContent = "Clear past"), 1800);
  });

  $("ack-btn").addEventListener("click", async () => {
    if (state.staticMode) {
      state.lastAck = Date.now();
      localStorage.setItem("sti-last-ack", String(state.lastAck));
    } else {
      const res = await fetch("/api/ack", { method: "POST" });
      const data = await res.json();
      state.lastAck = data.lastAck || Date.now();
    }
    renderAll();
  });

  $("copy-topic").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(state.ntfyTopic);
      $("copy-topic").textContent = "Copied";
      setTimeout(() => ($("copy-topic").textContent = "Copy"), 1400);
    } catch {
      /* ignore */
    }
  });

  $("test-notify").addEventListener("click", async () => {
    const btn = $("test-notify");
    if (state.staticMode) {
      if (!state.ntfyTopic) {
        btn.textContent = "Set a topic first";
        setTimeout(() => (btn.textContent = "Send test"), 1800);
        return;
      }
      btn.disabled = true;
      try {
        const res = await fetch(`https://ntfy.sh/${encodeURIComponent(state.ntfyTopic)}`, {
          method: "POST",
          headers: { Title: "STI Pulse test", Tags: "white_check_mark", Priority: "default" },
          body: "If this arrived, alerts are wired up on this device.",
        });
        btn.textContent = res.ok ? "Sent ✓" : "Failed";
      } catch {
        btn.textContent = "Failed";
      }
      btn.disabled = false;
      setTimeout(() => (btn.textContent = "Send test"), 2000);
      return;
    }
    const res = await fetch("/api/test-notify", { method: "POST" });
    const data = await res.json();
    btn.textContent = data.ok ? "Sent ✓" : "Failed";
    setTimeout(() => (btn.textContent = "Send test"), 1600);
  });

  $("enable-notifs").addEventListener("click", async () => {
    if (!("Notification" in window)) {
      $("enable-notifs").textContent = "Not supported";
      return;
    }
    const permission = await Notification.requestPermission();
    $("enable-notifs").textContent = permission === "granted" ? "Browser alerts on ✓" : "Permission denied";
    if (permission === "granted") {
      new Notification("STI Pulse", { body: "Browser alerts are on for this device.", icon: "icon-192.png" });
    }
  });

  els.settingsForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = {
      pollMinutes: Number(els.pollMinutes.value) || 10,
      dailyDigest: els.digest.checked,
      ntfyTopic: els.ntfyInput.value.trim(),
    };
    if (els.feedUrl.value.trim()) body.feedUrl = els.feedUrl.value.trim();
    const res = await fetch("/api/config", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    els.settingsMsg.textContent = data.ok ? "Saved. Next check uses the new settings." : data.error;
    if (data.ok) {
      state.ntfyTopic = data.config?.ntfyTopic || state.ntfyTopic;
      els.feedUrl.value = "";
      renderTopic();
    }
  });

  const topicForm = $("topic-form");
  topicForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = $("topic-set").value.trim();
    if (!value) return;
    localStorage.setItem("sti-ntfy-topic", value);
    state.ntfyTopic = value;
    renderTopic();
  });
}

let deferredPrompt = null;

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredPrompt = event;
  const btn = $("install-btn");
  btn.hidden = false;
  btn.addEventListener("click", async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    btn.hidden = true;
  });
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}

if (window.matchMedia("(display-mode: standalone)").matches) {
  $("install-hint").textContent = "Installed. Open it like any app.";
  $("install-btn").hidden = true;
}

bind();
load();
startEvents();

// Static mode has no push channel from the server; poll data.json for changes.
setInterval(() => {
  if (!state.staticMode) return;
  fetch(`data.json?t=${Date.now()}`, { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      if (!data) return;
      const before = new Set(state.assignments.map((a) => a.uid));
      const fresh = (data.assignments || []).filter((a) => !before.has(a.uid));
      if (fresh.length) {
        state.assignments = data.assignments;
        state.lastPoll = data.lastPoll;
        showBrowserNotification(fresh);
        renderAll();
      }
    })
    .catch(() => {});
}, 60_000);
