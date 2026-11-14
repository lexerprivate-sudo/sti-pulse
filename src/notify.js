function ascii(value) {
  return String(value).replace(/[^\x20-\x7E]/g, "-");
}

/**
 * Publish to ntfy.sh. The topic is public; treat it like a secret.
 * Returns { ok, status } and never throws.
 */
export async function sendNtfy(topic, { title, body, priority = "default", tags = "calendar", click } = {}) {
  if (!topic) return { ok: false, status: 0, error: "no topic" };
  const headers = {
    Title: ascii(title || "STI Pulse"),
    Priority: priority,
    Tags: tags,
  };
  if (click) headers.Click = click;

  try {
    const res = await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
      method: "POST",
      headers,
      body: body || "",
    });
    return { ok: res.ok, status: res.status };
  } catch (error) {
    return { ok: false, status: 0, error: String(error.message || error) };
  }
}

export function formatDue(due, allDay) {
  const d = new Date(due);
  const date = d.toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  if (allDay) return date;
  const time = d.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" });
  return `${date}, ${time}`;
}
