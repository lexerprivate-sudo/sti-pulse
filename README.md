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

## One-time setup

1. Create a GitHub repository and push this folder.
2. Add two repository secrets (Settings → Secrets and variables → Actions):
   - `FEED_URL` — the eLMS iCal URL (Calendar → Share).
   - `NTFY_TOPIC` — a long random topic such as `sti-lexer-9c41d7b28e5f0a63`.
3. Enable Pages: Settings → Pages → Source: **GitHub Actions**.
4. Run the **Poll eLMS** workflow once (Actions → Poll eLMS → Run workflow).

The site appears at `https://<user>.github.io/<repo>/`.

## Get alerts

1. Install **ntfy** on your phone and/or desktop.
2. Subscribe to the same `NTFY_TOPIC`.
3. New-assignment pushes arrive even when the dashboard is closed.
4. Class reminders fire 3 hours before each session (`CLASS_LEAD_MINUTES`
   repository variable to change, default `180`).

## Submission status

The eLMS iCal feed publishes due dates only. To stop showing submitted work as
overdue, `public/submitted.json` holds a snapshot of the **Submitted** column
from `elms.sti.edu/student_assignments/list/<class id>`, keyed by assignment
uid. Anything marked `"submitted": true` is treated as done automatically.

The snapshot is a point-in-time check (see `checkedAt`), not a live sync — the
GitHub poller cannot log in to eLMS. Re-scrape and update the file when new
work is submitted, or just tap the check on the row.

## Marking work done

Tap the check on any row to override the snapshot. Overrides are stored in that
browser only (`localStorage`) and take priority over `submitted.json`; the
**Done** tab lists everything so you can undo.

## Local development

```bash
node server.js
```

Open <http://localhost:3030>. The local server reads `data/config.json`
(created on first run) and polls every 10 minutes. It does not use GitHub.

## Privacy

The feed URL is a bearer token: anyone with it can read your assignment
calendar. Keep it in a repository secret. `public/data.json` contains only
assignment titles, due dates and course names — no grades, no student ID.
The ntfy topic is public to anyone who knows it, so keep it private too.
