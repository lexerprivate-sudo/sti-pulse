# STI Pulse

A small, installable dashboard that watches the STI eLMS calendar feed and
pushes a notification when a teacher posts a new assignment.

- **No password is stored.** It reads the tokenized iCal feed from eLMS.
- **Runs without your PC on** when deployed to GitHub (Actions + Pages).
- **Phone + desktop alerts** through [ntfy](https://ntfy.sh) (free app).
- **Installable PWA** on Android, iPhone, Windows and macOS.

## How it works

```
eLMS iCal feed ──> poller every 15 min ──> public/data.json ──> GitHub Pages (PWA)
                                   └────> ntfy.sh topic ────> phone / desktop push
```

The first poll is a silent "baseline" — it records what exists and notifies
nothing. Every run after that pushes for brand-new assignments only.

## Prerequisites

- A GitHub account (the repo and the Pages site are **public by default** —
  see [Privacy](#privacy)).
- For local development: **Node.js ≥ 20** (GitHub Actions runs the poller).
- The **ntfy** app on your phone and/or desktop.

## One-time setup

1. Create a GitHub repository and push this folder.
2. Add two repository secrets (Settings → Secrets and variables → Actions):
   - `FEED_URL` — the eLMS iCal URL (Calendar → Share).
   - `NTFY_TOPIC` — a long random topic, e.g. `sti-you-<random>`.
3. Enable Pages: Settings → Pages → Source: **GitHub Actions**.
4. Run the **Poll eLMS** workflow once (Actions → Poll eLMS → Run workflow).

The site appears at `https://<user>.github.io/<repo>/`.

> The poller pushes only on real changes. Bot commits land on `main` in
> `data/state.json`; that is normal.

## Get alerts

1. Install **ntfy** on your phone and/or desktop.
2. Subscribe to the same `NTFY_TOPIC`.
3. Notifications you will receive:
   - **New assignment** — when a teacher posts one.
   - **Daily digest** — 8 AM PHT, what's due within 3 days + overdue items.
   - **Deadline moved** — when eLMS changes a due date.
   - **Class reminder** — 3 hours before each class in `public/schedule.json`
     (set `CLASS_LEAD_MINUTES` in the workflow `env:` to change; the default is
     `180`. A repository *variable* does nothing — the workflow must read it.)
   - **Feed failure** — if the eLMS feed goes empty, partial or unreachable.
   - **Re-check nudge** — every 14 days, a reminder to re-scrape
     `submitted.json`.

## Class reminders & schedule.json

`public/schedule.json` is the source for both the dashboard **Week** tab and
the 3-hour reminders. Format:

```json
{
  "term": "SY 2026-2027 · 1st Term",
  "days": {
    "0": [],
    "1": [ { "from": "13:00", "to": "15:00", "course": "PE / PATHFIT 1", "room": "GYM04" } ]
  }
}
```

- Keys `"0"`–`"6"` are **days of the week, 0 = Sunday**.
- Times are **24-hour, Philippine Time (UTC+8)**.
- Edit this file each term and push; reminders follow automatically.

## Submission status

The eLMS iCal feed publishes due dates only. To stop showing submitted work as
overdue, `public/submitted.json` holds a snapshot of the **Submitted** column
from `elms.sti.edu/student_assignments/list/<class id>`, keyed by assignment
uid. Anything marked `"submitted": true` is treated as done automatically.

Schema (all 31 assignments need entries — unmatched items show as not done):

```json
{
  "source": "eLMS student_assignments/list snapshot",
  "checkedAt": "2026-11-15T08:00:00.000+08:00",
  "items": {
    "AssignmentEvent-58569127": { "submitted": false, "course": "Computer Programming 1", "title": "05 Laboratory Exercise 1 - ARG" }
  }
}
```

The snapshot is a point-in-time check (see `checkedAt`), not a live sync — the
GitHub poller cannot log in to eLMS. When you submit new work, ask for a fresh
re-scrape, or tap the check on the row yourself.

## Marking work done

Tap the checkmark on any row. Overrides are stored in that browser only
(`localStorage`) and take priority over `submitted.json`; the **Done** tab
lists everything so you can undo.

## Updating & redeploying

Pushing code does **not** redeploy Pages — runs only on the 15-minute cron or
when you manually trigger the workflow. After editing the frontend, run:
Actions → Poll eLMS → Run workflow.

To change poll cadence, edit the `cron:` line in
`.github/workflows/pulse.yml` (requires the `workflow` scope to push).
To rotate `FEED_URL`/`NTFY_TOPIC`, update the repository secret and re-run the
workflow.

## Local development

```bash
node server.js
```

Open <http://127.0.0.1:3030>. The local server reads `data/config.json`
(created on first run) and polls every 10 minutes. It does not use GitHub and
has **no class reminders** (those exist only in the cloud poller). It binds to
loopback only; `HOST=0.0.0.0` overrides, but every endpoint is unauthenticated
— do not expose it to a network you do not trust.

## Privacy

**This repository and the deployed Pages site are public.** That means anyone
with the URL can read: assignment titles and due dates, course names, your
class schedule (`public/schedule.json`), your per-assignment submission
status (`public/submitted.json`), and your poll state (`data/state.json`).
`noindex` + `robots.txt` discourage search indexing but are not access
control. If that is not acceptable, make the repository private (Pages then
requires a paid plan for private repos) or accept the exposure knowingly.

The feed URL is a bearer token: anyone with it can read your assignment
calendar. Keep it in a repository secret. The ntfy topic is public to anyone
who knows it, so keep it private too. `data/config.json` (with the topic and
feed URL) is gitignored and never committed.

## Troubleshooting

- **Dashboard shows old assignments** — check the Actions tab; if the feed
  went empty or partial, the poller deliberately keeps the last good data and
  warns via ntfy instead of wiping your dashboard.
- **The app looks stale or old** — force-reload (Ctrl+Shift+R) or close and
  reopen the installed PWA; the service worker shows a "new version" toast.
- **No pushes arriving** — confirm you're subscribed to the same `NTFY_TOPIC`
  in the ntfy app, and check the workflow logs under Actions.
- **First run sends nothing** — expected: the first poll is a silent baseline.
