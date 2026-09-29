# Loaded Late: detection contract

## Scope

> Checkable summary of every requirement and source: [`verification.html`](../verification.html).

The default page (`index.html`, also available at `bases-loaded.html`) runs **only** the tied / bases-loaded / bottom-9-or-later monitor. It does not load the legacy replay, scoring-change, forecast or scoreboard controllers. The copied original site's other pages are still available through navigation, and they additionally run the site-wide strip described below. The original scoreboard is `scoreboard.html`.

## Site-wide strip (scoreboard, replay feed, game view)

The dashboard is only useful when it is the tab you are looking at, so the same single situation is also watched from the other pages of this copy of the site. `scoreboard.html`, `reviews.html` and `game.html` load `assets/css/bases-loaded-strip.css`, `assets/js/bases-loaded-core.js` and `assets/js/bases-loaded-strip.js`; the strip mounts itself as the first element of `<body>`. It is not a second rule set — it calls the same `evaluate` / `observe` functions and the same scan-target rule as the monitor page. `index.html` and `bases-loaded.html` deliberately do **not** load it, so the dashboard never runs two watchers.

| Observed state | Strip |
| --- | --- |
| Nothing late | One line: no tied bottom-9 situation, games on radar, last check time. Discovery only — no per-game requests. |
| Tied game at the changeover into bottom 9+, or in a qualifying bottom half with one or two runners | Amber `WATCHING n` line and a row per game with inning, outs, count and exactly which bases are occupied (`1st & 2nd`, `2 bases to fill`), so progress toward loaded bases is visible rather than a binary. |
| All three bases occupied, tied, bottom 9 or later | Red bar naming the situation and the inning, a fixed alert card (score, outs, count, batter/pitcher, tension, and the observed play that loaded them when the feed exposes it), plus the chime and one desktop notification when those are enabled. |
| Unconfirmed, stale or failed snapshot | Counted on the bar with the reason in words; never shown as an all-clear, and never treated as "nothing is happening". |
| Delayed or suspended while tied in the 9th or later | `WATCH HELD` on the bar plus a `PAUSED` detail row. The episode stays armed, so resuming play cannot create a duplicate alert and the situation cannot be lost while play is stopped. |

Shared state and de-duplication:

- Same storage keys as the dashboard: `loaded-late:v3` (`history`, `states`) and `loaded-late:preferences` (`notifications`). A situation observed on any page appears in every page's history, and the notification opt-in is one setting for the whole site in that browser.
- The shared log is re-read and merged by alert id at the moment an alert is about to be announced **and again before every save**, so two open pages cannot both beep for one situation and neither page's records are ever clobbered: the first observer chimes and notifies, the second records the same game + inning with `crossPage: true` and stays silent. Every record carries an `observer` id identifying the page instance that wrote it; `recentSharedAlert` only counts records from *other* observers, so a single page's own confirmed exit and reload still alerts again inside the window. A **new inning is never suppressed**, and a future-dated log entry cannot suppress anything.
- `?ll-demo=1` on any wired page runs six scripted snapshots (changeover → walk → single → intentional walk → bottom 12, two outs, full count → cleared) through the production rules engine. Demo mode makes no MLB requests and never writes the shared log, so it cannot pollute live history.

Budget: two schedule requests (today and yesterday, America/New_York) every 30 seconds while no game is late, every 15 seconds once one is; one lean `feed/live` snapshot per late game every 5 seconds with four workers maximum; no per-game requests for early innings at all. A hidden tab stops polling and is labelled paused; returning scans immediately. The same practical limits as the monitor page apply — an open, visible tab is required, and a situation shorter than the polling interval can be missed.

## Live slate (monitor page)

The monitor also renders one row per game on the slate so nothing has to be checked by
hand. Each row carries the official score and half-inning, a tracking reason
(`BASES LOADED · ALERT`, `ON WATCH · 1st & 2nd · 1 to fill`, `TIED · TOP HALF · HOME
STILL TO BAT`, `PAUSED · STILL TIED · WATCH HELD`, `NOT YET INNING 9`, `FINAL`,
`SCHEDULED`), and the provenance and age of its numbers (`live snapshot · 3s ago`,
`official schedule scan`, or the failure reason). Alerting games sort first. A game
that has no coherent snapshot yet is labelled *late inning · awaiting the first live
snapshot* and is **never** given occupancy the schedule scan does not carry — the slate
shows the scan's own fields (score, inning, half, outs) and defers the rest.

Clicking a desktop notification focuses the monitor and outlines the card for that
game (`HIGHLIGHT_MS`, 8 s) without navigating away, so the watcher keeps running.

## Decision table

| Official state | Behavior |
| --- | --- |
| Top 9+, tied, 0–2 outs | Scan but do not put on watch or alert, even if loaded |
| Top 9+, tied, third out / Middle 9+ | On watch; do not use leftover top-half runners for an alert |
| Bottom 9+, tied, 0–2 outs, zero to two bases occupied | On watch |
| Bottom 9+, tied, 0–2 outs, all three bases occupied | Alert |
| Bottom 10, 11, 12, 13, 14… | Exactly the same rule, without an upper limit |
| Score becomes tied during a qualifying bottom half | Enter watch or alert immediately based on occupancy |
| Bottom 8 or earlier (including a seven-inning game's bottom eighth) | Never alert |
| Unequal scores, three outs / End, final / game over | No active alert; confirmed exits re-arm |
| Delayed / suspended | No active alert during the pause; preserve the episode so resumption alone does not re-alert |
| Postponed / cancelled | No active alert |
| Missing score, inning, outs, offense, malformed runner, contradictory half-inning or unknown game status | Unconfirmed; never infer zero, tie or loaded bases; preserve prior dedup state |
| Fetch failure / snapshot older than 12 seconds | Do not show it as live; retain saved history and dedup state |

The rule requires nonnegative integer scores, a valid inning, explicit `Bottom`, and a valid positive player ID on each occupied base. Occupied bases must have distinct player IDs; offense must be an object, innings must be positive, and outs must be between zero and three. Contradictory half-inning flags are rejected in either direction. A missing base property inside a valid offense object means that base is unoccupied; a missing offense object is unknown.

`Middle` and top-half third-out states allow the earliest observed changeover watch. `End` does not: that is the end of the home half. A tied bottom-half snapshot qualifies even if the monitor never observed the preceding changeover.

## Every way the bases can load

There is deliberately **no event-description whitelist**. Hits, walks, intentional walks, hit-by-pitches, fielding errors, fielder's choices, catcher interference, obstruction, an uncaught third strike, runner advances, placed extra-inning runners and scorer/replay corrections all converge on the same official base-occupancy check.

- A walk with first and second occupied can fill all three bases without changing the score.
- Wild pitches, passed balls, steals and balks move existing runners; by themselves they cannot increase the number of occupied bases. An uncaught third strike can put a batter on only when the rules permit it (first base unoccupied, or two outs). A play label is never enough to trigger.
- A fielder's choice can replace a runner while keeping the bases loaded. That remains one continuous situation, not a new alert.
- A pinch runner changes player identity, not base occupancy; it does not retrigger.
- An automatic runner on second is only one occupied base. Two additional runners must reach the other bases before an alert.
- A tying play can leave all three bases occupied. No requirement that the game was already tied at the start of the inning.
- A walk-off run ends the tie: leftover loaded runner data does not qualify.
- A review/scorer correction triggers only if the new official state actually meets the rule. The monitor never predicts a ruling.

## Data flow and polling budget

1. Discover MLB (`sportId=1`) games from today's and yesterday's America/New_York schedule, every 15 seconds. Today's full slate appears in Games on Radar; yesterday contributes only live carryovers. Deduplicate by `gamePk`, which also distinguishes doubleheaders.
2. For every live game at inning 9+ (not only tied games), fetch a **single projected `feed/live` response** containing official status, linescore *and* the official current/last play result (`liveData.plays.currentPlay.result` — what the cards show as "LAST PLAY" / "loaded on"). This avoids combining a new score with bases/outs from a separately timed request. A previously active game remains a candidate even if the schedule inning momentarily regresses.
3. Four request workers maximum; wait two seconds after a scan before the next scan. Manual refresh cannot overlap an in-flight scan. No heavy rosters, boxscores or full play-by-play are requested by this monitor.
4. Two schedule requests per 15 seconds, plus one lean snapshot per late-inning game per scan; no per-game requests for early innings. Schedule failures use the same discovery cadence. All calls use the existing API client's timeout and host-wide HTTP-429 `Retry-After` backoff.
5. Pausing the tab stops new requests and marks displayed snapshots unconfirmed. Returning triggers discovery and a live scan. Closed pages do not run anything.

`getAlertSnapshot()` lives in `assets/js/api.js`; pure rules — including the scan-target, cadence, occupancy-label and shared-log helpers both front ends use — live in `bases-loaded-core.js`; the dashboard's orchestration, rendering, controls and persistence live in `bases-loaded.js`; the site-wide strip described above lives in `bases-loaded-strip.js`.

The exact production projection was re-checked against the official API on 2026-09-29 using the final-game response from [MLB game 823001](https://statsapi.mlb.com/api/v1.1/game/823001/feed/live?fields=gamePk,gameData,status,abstractGameState,detailedState,statusCode,liveData,plays,currentPlay,result,description,event,eventType,rbi,awayScore,homeScore,linescore,currentInning,inningState,isTopInning,outs,teams,away,home,runs,offense,defense,first,second,third,id,fullName,balls,strikes,batter,pitcher,onDeck,inHole): it returns `gameData.status`, the complete `linescore` (score, inning, half, outs, count, offense/defense occupants) and `liveData.plays.currentPlay.result` — the official current/last play the alert cards quote as "LAST PLAY" / "loaded on". Note the result lives under `plays.currentPlay`, **not** under the linescore; both `first`/`second`/`third` and `defense`-side keys verified in the same response, and empty bases are absent keys (not nulls), which is exactly how the occupancy check reads them. The unfiltered shape of the same linescore was cross-checked against [`GET /api/v1/game/823001/linescore`](https://statsapi.mlb.com/api/v1/game/823001/linescore). Qualifying live cases are tested with synthetic official-shaped fixtures, not claimed as observed live alerts.

## Alert lifecycle and storage

A first observed matching snapshot creates an immutable record containing game ID, names, tied score, inning, outs, runner IDs/names, and local observation time. Records created by the site-wide strip are the same records: the dashboard and the strip write one shared log, so a game observed from the replay feed shows up in the monitor's history and vice versa. Repeated polls do not create new records. The dedup state is game-specific and inning-specific. A **confirmed** exit from the condition re-arms the next match; an error or incomplete snapshot does not. A new qualifying inning is a new situation even if the monitor missed the intervening exit.

The monitor can export that history as **JSON** or **CSV** (`Export JSON` / `Export CSV`), and each record carries the exact official snapshot URL it was read from (`https://statsapi.mlb.com/api/v1.1/game/{gamePk}/feed/live`), which is also linked on every history card. `Copy newest evidence line` puts one citation line — inning, tied score, outs, count, matchup, observation time, official link, game link — on the clipboard. Serialization lives in `bases-loaded-core.js` (`historyCSV`, `historyJSON`, `evidenceLine`, `historyFileName`) and is covered by `tools/bases-loaded-test.mjs`; a shareable link points at the official record, because browser history cannot be shared.

`localStorage['loaded-late:v3']` stores history and last observed dedup states. History retains up to 200 records within the past seven days. Restoring history never replays notifications. Original score/runner snapshots are never reconstructed from the game's current score. Storage failures do not disable live detection; the UI warns that persistence is unavailable.

A fresh browser with no dedup state alerts on an already-active matching situation. The app does **not** invent episodes that may have cleared/reloaded while it was closed. Multiple open tabs share the cross-page quiet window — a situation beeps once across them — but each tab still polls and displays independently, so keep one monitor tab open. History is local to this browser/origin, not the replay feed's backend log and not cross-device storage.

## Notifications and practical limits

On-page alerts always work while monitoring. Desktop notifications require a separate user opt-in for this monitor, browser support and permission; global permission previously granted to another page does not automatically opt this monitor in. Unsupported constructors/denied permission are handled without interrupting polling. Sound is off until enabled by a gesture each session, which unlocks AudioContext and plays a preview. Several games matching in one scan share one chime, but have separate alert records/desktop notices.

An optional server-side watcher ships with this repository: `tools/watcher.mjs` requires the same `assets/js/bases-loaded-core.js`, polls the official endpoints with the same cadences, de-duplicates across restarts (state file), appends every alert to a JSONL log whose records carry the exact official snapshot URL, and can push to a phone through `WATCHER_WEBHOOK_URL` (JSON POST) or `WATCHER_NTFY_TOPIC` (ntfy). It still needs an always-on machine to run on — the repository hosts nothing for you — and its coverage is only as good as that machine's uptime and network.

As a static client, the page is **not** guaranteed background delivery, push, SMS or email monitoring. It does not run with a hidden/closed tab. It relies on publication timing in MLB's feed. Short-lived situations between polls, network outages and time away from the monitor can be missed. History is only what this browser observed, not a reconstruction of every plate appearance. Always-on monitoring therefore means running `tools/watcher.mjs` (or an equivalent) yourself; the page remains the zero-setup option.

MLB data-use terms and the inherited application's compliance notes still apply; see [api-compliance.md](api-compliance.md).

## Always-on watcher (no browser)

```bash
node tools/watcher.mjs                                  # watch until stopped
WATCHER_ONCE=1 node tools/watcher.mjs                   # one cycle, then exit (cron)
WATCHER_NTFY_TOPIC=my-loaded-late node tools/watcher.mjs  # push to the ntfy phone app
WATCHER_WEBHOOK_URL=https://… node tools/watcher.mjs      # or POST JSON to your own hook
```

Same discovery (today + yesterday in America/New_York, 15 s), same late-inning cadence (2 s), same target rule (`scanTarget`) and same situation logic as the pages — the only difference is that it does not need a browser. Alerts go to stdout, to `data/watcher-alerts.jsonl` (one JSON record per line, each carrying `officialSource`), and to whichever push channels are configured. Dedup state lives in `data/watcher-state.json`, so restarting or running it from cron never re-alerts the same situation. A failed channel is reported with its reason; it is never reported as delivered. `node tools/watcher-test.mjs` drives all of that with a stubbed network and clock.

## Tests and demo

```sh
node tools/bases-loaded-test.mjs
node tools/bases-loaded-monitor-test.mjs
node tools/bases-loaded-strip-test.mjs
```

Tests include an exhaustive 11,520-case matrix (innings 1–30 × four half-inning states × 0–3 outs × trailing/tied/leading × eight occupancy patterns), malformed/duplicate runner data, delay/resumption continuity, and cover inning/half/score/outs boundaries, all eight occupancy combinations, all listed routes without keyword inference, changeovers, walk-offs, final/delay status, incomplete data, immutable snapshots, dedup/re-arm/refresh, API projection, Eastern midnight/DST, failed polls, hidden-tab pause/resume, stale-state expiry, overlapping refresh, storage failures, opt-in notifications and isolated demo mode. The strip suite adds the shared helpers (`scanTarget`, `pollCadence`, `recentSharedAlert`, `occupancyLabel`), the page-wiring contract (which pages mount the strip, which intentionally do not, and that `api.js` loads first), and a deterministic DOM/clock/API-stub run of the controller: watch line, partial occupancy, first alert, repeat polls, cleared-and-reloaded, extra innings 10–17, cross-page quiet window, fresh page load mid-situation, hidden-tab pause, cadence 30s/5s, stale and failed snapshots, blocked storage, a missing api client, dismissal and demo mode.

`/?demo=1` or `bases-loaded.html?demo=1` runs seventeen manually advanced synthetic scenarios using the production rule engine. No MLB requests or live-history writes occur. The labeled demo includes a bottom-14 loaded tie, an automatic runner on second, and a bottom-15 bases-loaded walk that ties the game. Counts reset for the next batter after a walk or hit-by-pitch. Demo notifications require explicit opt-in and carry a DEMO prefix.
