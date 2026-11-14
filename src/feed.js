import { COURSE_BY_UID } from "./courses.js";

/**
 * Unfold iCalendar lines (RFC 5545 allows long lines to be split with
 * CRLF followed by a single space or tab).
 */
function unfold(text) {
  return text.replace(/\r?\n[ \t]/g, "");
}

/**
 * Parse a DTSTART value into an ISO string plus an all-day flag.
 * NEO LMS emits either:
 *   DTSTART;VALUE=DATE:20261028
 *   DTSTART;TZID=Asia/Taipei:20260813T235900
 * Asia/Taipei is UTC+8 all year, same as Asia/Manila.
 */
function parseStart(line) {
  const dateOnly = line.match(/VALUE=DATE:(\d{4})(\d{2})(\d{2})/);
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    return { iso: `${y}-${m}-${d}T23:59:00+08:00`, allDay: true };
  }
  const timed = line.match(/:(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/);
  if (timed) {
    const [, y, m, d, hh, mm, ss] = timed;
    return { iso: `${y}-${m}-${d}T${hh}:${mm}:${ss}+08:00`, allDay: false };
  }
  return null;
}

function getField(block, name) {
  const re = new RegExp(`^${name}([;:][^\\r\\n]*)?$`, "m");
  const m = block.match(re);
  return m ? m[0] : null;
}

/**
 * Return only the "Assignment due: ..." events, newest last.
 * Each item: { uid, title, due, allDay, course }
 */
export function parseAssignments(icsText) {
  const text = unfold(icsText);
  const blocks = text.split("BEGIN:VEVENT").slice(1);
  const items = [];

  for (const raw of blocks) {
    const block = raw.split("END:VEVENT")[0];
    const summaryLine = getField(block, "SUMMARY");
    if (!summaryLine) continue;

    const summary = summaryLine.replace(/^SUMMARY[^:]*:/, "").trim();
    const prefix = "Assignment due: ";
    if (!summary.startsWith(prefix)) continue;

    const startLine = getField(block, "DTSTART");
    if (!startLine) continue;
    const start = parseStart(startLine);
    if (!start) continue;

    const uidLine = getField(block, "UID");
    const uid = uidLine ? uidLine.replace(/^UID:/, "").trim() : `${summary}-${start.iso}`;

    items.push({
      uid,
      title: summary.slice(prefix.length).trim(),
      due: start.iso,
      allDay: start.allDay,
      course: COURSE_BY_UID[uid] || "eLMS",
    });
  }

  items.sort((a, b) => new Date(a.due) - new Date(b.due));
  return items;
}

/**
 * The latest "Course ends:" date in the feed, as an ISO date string.
 */
export function parseTermEnd(icsText) {
  const text = unfold(icsText);
  const blocks = text.split("BEGIN:VEVENT").slice(1);
  const ends = [];

  for (const raw of blocks) {
    const block = raw.split("END:VEVENT")[0];
    const summaryLine = getField(block, "SUMMARY");
    if (!summaryLine) continue;
    const summary = summaryLine.replace(/^SUMMARY[^:]*:/, "").trim();
    if (!summary.startsWith("Course ends: ")) continue;

    const startLine = getField(block, "DTSTART");
    if (!startLine) continue;
    const start = parseStart(startLine);
    if (start) ends.push(start.iso);
  }

  if (!ends.length) return null;
  ends.sort();
  return ends[ends.length - 1];
}
