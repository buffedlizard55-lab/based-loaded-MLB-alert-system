# Loaded Late — quickstart

One situation, watched across every page of this copy of the site:

> **Live MLB game · tied score · all three bases occupied · bottom of the 9th or later (10th, 11th, 12th … no limit).**

Nothing else triggers an alert.

## Where to watch

| Page | What it does |
| --- | --- |
| `index.html` (or `bases-loaded.html`) | The full monitor: the **live slate** (every game, why it is or is not tracked, and how old each number is), the watch window, live alerts, saved history. |
| `reviews.html` (replay feed) | The **Loaded Late strip** at the top of the page watches the same situation while you use the feed. |
| `scoreboard.html` | Same strip, above the scoreboard. |
| `game.html` | Same strip, above the game view. |
| `verification.html` | Requirements, every route to loaded bases with its rule number, the official sources, the polling budget and the honest limits. |

The strip and the monitor share one alert log and one notification setting, so a continuous situation never alerts twice just because you changed pages.

## Turn the noise on (once per browser)

1. Click **Alerts off** in the strip (or **Enable notifications** on the monitor page) and allow notifications. The choice is remembered for every page of this site in that browser.
2. Click **Sound off** to arm the chime. Browsers only allow sound after a click, so this is per session — you will hear a short preview when it arms.

On-page alerts always work whether or not you enable sound or notifications.

## Install it on your phone (once)

The site is an installable web app: it ships a manifest and generated icons, so
*Add to Home Screen* (iOS Safari: Share → Add to Home Screen; Android Chrome: menu →
Install app) puts a real icon on the home screen and opens it without browser chrome.
On iOS that install is also the precondition for Web Push, so this is the step that
makes phone alerts possible at all. Installed or not, an alert vibrates with a
distinct two-short-one-long buzz in addition to the chime and the notification.

## See it work in ten seconds

- `index.html?demo=1` — seventeen guided scenarios on the monitor (top-half exclusion, the changeover, partial bases, the alert, bases clearing and reloading, a walk-off, the automatic extra-inning runner, bottom 14, and a tying bases-loaded walk in bottom 15).
- `reviews.html?ll-demo=1` — six guided scenarios in the strip: changeover → walk → single → intentional walk → **bottom 12, two outs, full count** → cleared. Demo mode makes no MLB requests and never touches your alert history.

## What you will see

- **Idle** — one quiet line: no tied bottom-9 situation, how many games are on radar, when the last check ran.
- **On watch** — the moment a tied game reaches the changeover into the bottom of the 9th (or any later inning), the game is listed with its inning, outs, count and exactly which bases are occupied (`1st & 2nd`, `2 bases to fill`).
- **Alert** — all three bases occupied, tied, bottom 9+: the bar turns red, a card appears with the score, outs, count, batter/pitcher, a tension rating (2 outs + full count = maximum) and the observed play that loaded them, plus the chime/notification you enabled. Clicking a desktop notification brings the monitor back and outlines the card for that game without navigating away.
- **Held** — a rain delay or suspension pauses play without proving the bases cleared, so the watch is held and labelled (`PAUSED · STILL TIED · WATCH HELD`) instead of the game quietly disappearing.
- **Unconfirmed** — a failed or stale snapshot is labelled with the reason. It is never shown as an all-clear, and it never re-arms a finished alert.

Every route to loaded bases counts, because occupancy is read from the official feed instead of guessed from play text: hits, walks, intentional walks, hit-by-pitches, errors, fielder's choices, catcher's interference, obstruction, an uncaught third strike, wild pitches/passed balls, the automatic extra-inning runner plus two more, and official scorer/replay corrections.

## Practical limits

- Keep one page open and visible, **or** run the always-on watcher if you want the alert with every tab closed:
  ```bash
  node tools/watcher.mjs                                   # same rules engine, no browser
  WATCHER_NTFY_TOPIC=my-loaded-late node tools/watcher.mjs  # push to a phone via ntfy
  ```
  It logs every alert (with the official snapshot link) to `data/watcher-alerts.jsonl` and de-duplicates across restarts. You supply the machine it runs on; the repository hosts nothing.
  Before a game, one command says whether it will actually reach you:
  ```bash
  node tools/watcher.mjs --doctor              # upstream + log/state + every channel, one report
  node tools/watcher.mjs --list-subscriptions  # stored devices, masked, with a verdict each
  node tools/watcher.mjs --prune-subscriptions # drop rows that can never deliver
  ```
  A push that fails transiently (429, 5xx, no answer) is retried up to three times with a
  capped backoff; a failure that is a decision about that request is reported once.
- Schedule discovery runs every 30 s (15 s once a game is late); a game in the 9th or later gets a fresh official snapshot every 5 s on the strip and every 2 s on the monitor.
- Feed delays, brief situations between polls and network outages can be missed. Nothing is back-filled: history is what this browser observed.
- Notifications need browser support and permission; sound needs one click per session.
- The monitor's alert history is exportable (JSON/CSV) and each record carries the official snapshot link it was read from; history itself is per browser, so the exported file is the durable record.

## Publish it

GitHub Pages publishes this repository root with its built-in *Deploy from a branch* build — branch `main`, folder `/ (root)` — so every merge to `main` republishes the site in about a minute. There is deliberately no deployment workflow: the built-in build already publishes the root, and a second publisher would race it. If that setting is ever switched off, the one-time fallback is **Settings → Pages → Source: Deploy from a branch → `main` / `/ (root)`**. The site lands at https://buffedlizard55-lab.github.io/based-loaded-MLB-alert-system/. No build step, no server required.

Status on 2026-09-29: the deployment is **live and verified** — the Pages API reports `status: "built"` with `source: main /`, the built-in `pages-build-deployment` run for `main` succeeded, and [`tools/deployed-site-test.mjs`](../tools/deployed-site-test.mjs) fetches the published pages in CI after every merge and nightly. Run it yourself with `node tools/deployed-site-test.mjs`.

Prefer to run it locally instead:

```bash
node server.mjs
# http://localhost:8000/                        — monitor
# http://localhost:8000/reviews.html            — replay feed + strip
# http://localhost:8000/reviews.html?ll-demo=1  — strip demo
```

Unofficial, personal-use project. Data from the public MLB StatsAPI; not affiliated with MLB.
