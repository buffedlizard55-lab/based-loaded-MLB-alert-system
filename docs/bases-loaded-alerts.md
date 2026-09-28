# Loaded Late: detection contract

## Scope

The default page (`index.html`, also available at `bases-loaded.html`) runs **only** the tied / bases-loaded / bottom-9-or-later monitor. It does not load the legacy replay, scoring-change, forecast or scoreboard controllers. The copied original site's other pages are still available through navigation. The original scoreboard is `scoreboard.html`.

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
| Delayed / suspended / postponed / cancelled | No active alert |
| Missing score, inning, outs, offense, malformed runner, contradictory half-inning or unknown game status | Unconfirmed; never infer zero, tie or loaded bases; preserve prior dedup state |
| Fetch failure / snapshot older than 12 seconds | Do not show it as live; retain saved history and dedup state |

The rule requires nonnegative integer scores, a valid inning, explicit `Bottom`, and a valid positive player ID on each occupied base. It rejects `isTopInning: true` on a purported bottom-half snapshot. A missing base property inside a valid offense object means that base is unoccupied; a missing offense object is unknown.

`Middle` and top-half third-out states allow the earliest observed changeover watch. `End` does not: that is the end of the home half. A tied bottom-half snapshot qualifies even if the monitor never observed the preceding changeover.

## Every way the bases can load

There is deliberately **no event-description whitelist**. Hits, walks, intentional walks, hit-by-pitches, fielding errors, fielder's choices, catcher interference, obstruction, an uncaught third strike, runner advances, placed extra-inning runners and scorer/replay corrections all converge on the same official base-occupancy check.

- A walk with first and second occupied can fill all three bases without changing the score.
- A fielder's choice can replace a runner while keeping the bases loaded. That remains one continuous situation, not a new alert.
- A pinch runner changes player identity, not base occupancy; it does not retrigger.
- An automatic runner on second is only one occupied base. Two additional runners must reach the other bases before an alert.
- A tying play can leave all three bases occupied. No requirement that the game was already tied at the start of the inning.
- A walk-off run ends the tie: leftover loaded runner data does not qualify.
- A review/scorer correction triggers only if the new official state actually meets the rule. The monitor never predicts a ruling.

## Data flow and polling budget

1. Discover MLB (`sportId=1`) games from today's and yesterday's America/New_York schedule, every 15 seconds. Today's full slate appears in Games on Radar; yesterday contributes only live carryovers. Deduplicate by `gamePk`, which also distinguishes doubleheaders.
2. For every live game at inning 9+ (not only tied games), fetch a **single projected `feed/live` response** containing both official status and linescore. This avoids combining a new score with bases/outs from a separately timed request. A previously active game remains a candidate even if the schedule inning momentarily regresses.
3. Four request workers maximum; wait two seconds after a scan before the next scan. Manual refresh cannot overlap an in-flight scan. No heavy rosters, boxscores or full play-by-play are requested by this monitor.
4. Two schedule requests per 15 seconds, plus one lean snapshot per late-inning game per scan; no per-game requests for early innings. Schedule failures use the same discovery cadence. All calls use the existing API client's timeout and host-wide HTTP-429 `Retry-After` backoff.
5. Pausing the tab stops new requests and marks displayed snapshots unconfirmed. Returning triggers discovery and a live scan. Closed pages do not run anything.

`getAlertSnapshot()` lives in `assets/js/api.js`; pure rules live in `bases-loaded-core.js`; browser orchestration, rendering, controls and persistence live in `bases-loaded.js`.

The field projection was checked against a real final-game response from [MLB game 823001](https://statsapi.mlb.com/api/v1.1/game/823001/feed/live?fields=gamePk,gameData,status,abstractGameState,detailedState,statusCode,liveData,linescore,currentInning,inningState,isTopInning,outs,teams,away,home,runs,offense,first,second,third,id,fullName). Qualifying live cases are tested with synthetic official-shaped fixtures, not claimed as observed live alerts.

## Alert lifecycle and storage

A first observed matching snapshot creates an immutable record containing game ID, names, tied score, inning, outs, runner IDs/names, and local observation time. Repeated polls do not create new records. The dedup state is game-specific and inning-specific. A **confirmed** exit from the condition re-arms the next match; an error or incomplete snapshot does not. A new qualifying inning is a new situation even if the monitor missed the intervening exit.

`localStorage['loaded-late:v2']` stores history and last observed dedup states. History retains up to 200 records within the past seven days. Restoring history never replays notifications. Original score/runner snapshots are never reconstructed from the game's current score. Storage failures do not disable live detection; the UI warns that persistence is unavailable.

A fresh browser with no dedup state alerts on an already-active matching situation. The app does **not** invent episodes that may have cleared/reloaded while it was closed. Multiple open monitor tabs are independent and may both notify; keep one monitor tab open. History is local to this browser/origin, not the replay feed's backend log and not cross-device storage.

## Notifications and practical limits

On-page alerts always work while monitoring. Desktop notifications require a separate user opt-in for this monitor, browser support and permission; global permission previously granted to another page does not automatically opt this monitor in. Unsupported constructors/denied permission are handled without interrupting polling. Sound is off until enabled by a gesture each session, which unlocks AudioContext and plays a preview. Several games matching in one scan share one chime, but have separate alert records/desktop notices.

This static client is **not** guaranteed background delivery, push, SMS or email monitoring. It does not run with a hidden/closed tab. It relies on publication timing in MLB's feed. Short-lived situations between polls, network outages and time away from the monitor can be missed. History is only what this browser observed, not a reconstruction of every plate appearance. A server-side watcher and delivery service would be a separate deployment if always-on monitoring is required.

MLB data-use terms and the inherited application's compliance notes still apply; see [api-compliance.md](api-compliance.md).

## Tests and demo

```sh
node tools/bases-loaded-test.mjs
node tools/bases-loaded-monitor-test.mjs
```

Tests cover inning/half/score/outs boundaries, all eight occupancy combinations, all listed routes without keyword inference, changeovers, walk-offs, final/delay status, incomplete data, immutable snapshots, dedup/re-arm/refresh, API projection, Eastern midnight/DST, failed polls, hidden-tab pause/resume, stale-state expiry, overlapping refresh, storage failures, opt-in notifications and isolated demo mode.

`/?demo=1` or `bases-loaded.html?demo=1` runs nine manually advanced synthetic scenarios using the production rule engine. No MLB requests or live-history writes occur. The labeled demo includes a bottom-14 loaded tie. Demo notifications require explicit opt-in and carry a DEMO prefix.
