# Loaded Late — tied, bases-loaded MLB alerts

This repository is a separate copy of [MLB Live PBP](https://buffedlizard55-lab.github.io/MLB-Live-PBP/reviews.html), now focused on **one alert condition only**:

> **Live MLB game + tied score + bottom of inning 9 or later + runners on all three bases + fewer than three outs.**

- **Home (`index.html`) / `bases-loaded.html`:** the situation monitor. No replay, challenge, scoring-change or hit-probability alerts run on this page.
- **On watch:** begins at the tied changeover into bottom 9+ (including the third out at the top), or whenever a game becomes tied during a qualifying bottom half. There is no maximum inning.
- **Route-independent:** reads official first/second/third base occupants, not event descriptions. Walks, hits, errors, interference, automatic extra-inning runners and official corrections all use the same rule.
- **Alerts:** highlighted live cards, optional sound and opt-in desktop notifications. A continuous loaded situation alerts once; a confirmed exit and reload can alert again, even in the same inning.
- **History:** immutable score, outs and runner snapshots, retained in this browser for seven days (maximum 200 entries). Refreshing the page restores history and deduplication state. Not shared across devices or a complete historical replay.
- **Site-wide strip:** the scoreboard, replay feed (`reviews.html`) and game view mount a slim "Loaded Late" watcher, so the same one situation is tracked from whichever page of this copy you are on. The strip reuses the same rules engine, the same alert log and the same notification opt-in as the dashboard; a continuous situation never alerts twice just because you changed pages. The monitor page itself does not load it, so no page ever runs two watchers.
- **Live slate (no manual checking):** the monitor also lists **every game on the slate** — score, half-inning, outs, and one line saying why it is or is not tracked (`BASES LOADED · ALERT`, `ON WATCH · 1st & 2nd · 1 to fill`, `TIED · TOP HALF · HOME STILL TO BAT`, `PAUSED · STILL TIED · WATCH HELD`, `NOT YET INNING 9`, …) plus the provenance and age of the numbers on that row (`live snapshot · 3s ago` or `official schedule scan`). Nothing on the page has to be worked out by hand.
- **A delay cannot lose the situation:** a rain delay or suspension pauses play without proving the bases cleared, so the watch is **held** and labelled as paused instead of the game silently disappearing.
- **Verified, checkable claims:** [`verification.html`](verification.html) maps every requirement of the brief to where it is implemented and how to check it, lists every route to loaded bases with its rule number, and links the official sources for each claim.
- **Original pages preserved:** `scoreboard.html`, `game.html`, and `reviews.html`. Their legacy features remain separate from this narrow monitor.

**New here?** [docs/loaded-late-quickstart.md](docs/loaded-late-quickstart.md) is the short version: which page to open, how to arm sound and notifications, what triggers an alert, and what the limits are.

## 📌 Project prompt — read this first, every session

> **Every work session on this repository starts by reading the prompt below.** It is the
> source of truth for what we are building: use it as the starting point to confirm the
> work aims at the right target, as the strong base to keep building and improving
> something useful for everyday use, and as the acceptance checklist before finishing.
> When in doubt, re-read it line by line against the code.

```text
Review the repo.

I want to add functionality to this site

https://buffedlizard55-lab.github.io/MLB-Live-PBP/reviews.html

Clone the repo and create a copy of the website and then add a way to track when any MLB game has a tied game bases loaded situation in the bottom of the 9th or later.  10th, 11th, 12th, 13th, etc.  that should be the main focus of this alert system only.  Only want to track this situation.  We should think of all the different ways a bases loaded situation can happen and track it.  We should begin tracking when there is a tie game going to the bottom of the 9th or later so that we can be alerted to when the bases are loaded in the bottom 9th or innings occuring anytime after the 9th, like bot 9 bot 10 bot 11 bot 12 bot 13 bot 14 etc.  TIED GAME BOTTOM OF THE INNING THAT COULD END THE GAME SUCH AS BOTTOM OF 9TH, 10TH, 11TH, HOME TEAM COULD WALK OFF WHEN THE BASES ARE LOADED ALERT

Put this prompt into the repo readme and read it everytime we work on the project as a starting point to make sure we are building what we are aiming for and have a strong base to continue building and improving on making something useful for everyday use.  It should solve the problem of having to manually check everything ourselves and having an up to date current feed.

Review the repo.

The following is taken from the Arena AI team and I think it makes a good point on building a successful project, so let's keep the Core Values and Own the Outcome as a focal point when building, developing, researching, suggesting upgrades, and implementing the work.

Our Core Values

Maximize P(Win)

"Maximize the Probability of Winning": our decision making framework. In every decision, we weigh tradeoffs, assess risk, and choose the path that maximizes the probability that Arena succeeds. We set aside our emotions and make tough decisions in order to maximize P(Win). "Maximize P(Win)" frees us from constraints and clarifies that we must put Arena first.

Own the Outcome

We own results end to end — not just our individual slice of the work. When problems arise and we have the means to act, we do so without waiting for permission or assignment. We treat failure and success as signals and use them to improve. At Arena, we stay accountable to the final outcome.

Work line by line verifying from official verified trusted sources, provide links for manual review.  There should be no manual input, work on your own to complete tasks.  Flag any irregularities for review.  No hallucinations.

Verify no hallucinations.

The goal of this project is to get a full list that follow our requirements.  No hallucinations.  Verify line by line.

Site creation

Create a github page for this repo that has clean ui, user friendly, simple and easy to use.

It should be organized and clean.  It should include all relevant information in an easy to read format with official verified links as sources for review.  Work line by line verify everything no hallucinations.

Go ahead and create a pull request and then merge the pull request onto the main. Make suggestions for what work still needs to be done and any limitations that is in the way of a successful project.  It should be worked on in this next session or the next session.  Work line by line verify everything no hallucinations.

Run this task through multiple passes.

Pass 1: Implement the task completely and verify the result.

Pass 2: Review your work for bugs, missing requirements, incorrect assumptions, and edge cases. Fix everything you find.

Pass 3: Re-check the entire implementation against the original request. Improve accuracy, reliability, completeness, and code quality. Fix any remaining issues.

Do not stop after the first pass. Each pass must build on the previous one. Before finishing, verify that the final result fully satisfies the original request.  Work line by line verify everything no hallucinations.
```

## Run / preview

No build or dependencies are required:

```bash
node server.mjs
# http://localhost:8000/ — live monitor
# http://localhost:8000/?demo=1 — guided, offline synthetic scenarios
# http://localhost:8000/reviews.html — replay feed + the site-wide strip
# http://localhost:8000/reviews.html?ll-demo=1 — strip demo, no live data
# http://localhost:8000/scoreboard.html — original scoreboard
# http://localhost:8000/verification.html — requirements, routes and sources
```

The server binds `0.0.0.0`; any static host (including GitHub Pages) also works.
The alert monitor uses only the public MLB API and browser storage, not the optional replay-log backend.
Both alert HTML entrypoints are intentionally identical; update both when changing the markup.

## Monitoring limits

**Keep one monitor tab open and visible.** Hidden tabs pause and closing the browser stops monitoring. This is not a server-side, always-on push/SMS service. Notifications need browser support and permission; sound must be enabled with a click each session.

Schedule discovery checks today and yesterday in America/New_York every 15 seconds, retaining live overnight games. All live games in inning 9+ are checked using coherent status + linescore snapshots, even if not yet tied, every two seconds **after** each scan (four concurrent requests maximum). Upstream delays, errors and brief between-poll situations can cause missed alerts. Network failures and stale snapshots are visibly marked, not treated as an all-clear. The shared API client honors HTTP 429 backoff.

See [the detection rules, coverage and limitations](docs/bases-loaded-alerts.md).

## Test the alert system

```bash
node tools/bases-loaded-test.mjs         # rules engine
node tools/bases-loaded-monitor-test.mjs # monitor page controller
node tools/bases-loaded-strip-test.mjs   # site-wide strip + page wiring
node tools/site-links-test.mjs           # pages, links, citations, CI wiring
node tools/deployed-site-test.mjs        # the published site itself (network)
```

These deterministic tests need neither external packages nor live MLB games. The 17-step guided demo tests top-half exclusion, the changeover watch, partial occupancy, first alert, repeated poll, bases clearing/reloading, a walk-off, an automatic runner, bottom 14, and a tying bases-loaded walk in bottom 15. Rule tests also exhaustively check 11,520 inning/half/outs/score/base combinations and verify incomplete data and rain delays do not re-arm an existing episode. The strip suite additionally drives the site-wide watcher through a deterministic DOM, clock and API stub: extra innings 10–17, partial occupancy labels, opt-in sound/notifications, the cross-page quiet window, hidden-tab pause, 30s/5s cadence, stale and failed snapshots, blocked storage, and a page with no api client. Demo data never enters live history. The site suite checks that every page and every internal
link target exists, that no page uses a root-absolute path (the copy has to work under a
project Pages subpath), that outbound links are HTTPS and no third-party scripts are loaded,
that the monitor and the sources page still accept no manual input, that the project
prompt and the verbatim Rule 5.08(b) sentence are still present in this README, that the
documented alert projection still matches `api.js`, and that the repository ships no
competing Pages deployment. The last suite, `tools/deployed-site-test.mjs`, is the only
network test of the four plus one: it fetches the published URL, its pages and its alert
assets and fails if the deployed site drifts from this repository. CI runs it after every
merge to `main` and nightly, never on a pull request.

## Deploy this copy

The repository root **is** the site — no build step, no server requirement — and it is
published: **[buffedlizard55-lab.github.io/based-loaded-MLB-alert-system](https://buffedlizard55-lab.github.io/based-loaded-MLB-alert-system/)**.
GitHub Pages serves it with the built-in *Deploy from a branch* build (branch `main`,
folder `/ (root)`), so every merge to `main` republishes it in about a minute.

There is deliberately **no** Actions deployment workflow. GitHub's built-in build already
publishes the root and a second publisher would race it; the presence of a Pages
workflow is now a test failure. Verified 2026-09-29: the Pages API reports
`status: "built"` with `source: main /`, the built-in `pages-build-deployment` run for
`main` succeeded, and the published pages were fetched and compared against this
repository. If the setting is ever switched off, the one-time fallback is
**Settings → Pages → Deploy from a branch → `main` / `/ (root)`**.

[`.github/workflows/smoke.yml`](.github/workflows/smoke.yml) runs every deterministic
suite on each push and pull request, checks the published site after every merge to
`main` and nightly ([`tools/deployed-site-test.mjs`](tools/deployed-site-test.mjs)), and
runs a nightly live-API check against `statsapi.mlb.com`. This copy does **not** change
the original `MLB-Live-PBP` deployment; this repository has its own Pages site. API
usage remains subject to MLB's terms; this is an unofficial, personal-use project.

## Sources for manual review

Every claim in this project is checkable against these links (the monitor page also
carries them in its **Sources for manual review** panel):

| What we rely on | Official / verified link | Verified |
| --- | --- | --- |
| The site this repo is a copy of | [buffedlizard55-lab.github.io/MLB-Live-PBP/reviews.html](https://buffedlizard55-lab.github.io/MLB-Live-PBP/reviews.html) | Source copy, PR #1 |
| Game discovery (all MLB games, any date) | [`GET /api/v1/schedule?sportId=1&date=YYYY-MM-DD`](https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=2026-09-29) | Re-checked 2026-09-29 |
| One coherent status + linescore + current play snapshot (the exact projection `getAlertSnapshot` sends) | [`GET /api/v1.1/game/823001/feed/live?fields=…`](https://statsapi.mlb.com/api/v1.1/game/823001/feed/live?fields=gamePk,gameData,status,abstractGameState,detailedState,statusCode,liveData,plays,currentPlay,result,description,event,eventType,rbi,awayScore,homeScore,linescore,currentInning,inningState,isTopInning,outs,teams,away,home,runs,offense,defense,first,second,third,id,fullName,balls,strikes,batter,pitcher,onDeck,inHole) | Verified 2026-09-29 |
| Unfiltered shape of the same linescore (occupancy, count, defense/offense) | [`GET /api/v1/game/823001/linescore`](https://statsapi.mlb.com/api/v1/game/823001/linescore) | Verified 2026-09-29 |
| Same games as MLB displays them (side-by-side review) | [MLB Gameday](https://www.mlb.com/gameday) | Reference |
| Walk-off ending, bases full — **Rule 5.08(b)**, quoted verbatim: *"When the winning run is scored in the last half-inning of a regulation game, or in the last half of an extra inning, as the result of a base on balls, hit batter or any other play with the bases full which forces the batter and all other runners to advance without liability of being put out, the umpire shall not declare the game ended until the runner forced to advance from third has touched home base and the batter-runner has touched first base."* | [Official Baseball Rules, 2023 edition (PDF, MLB)](https://img.mlbstatic.com/mlb-images/image/upload/mlb/wqn5ah4c3qtivwx3jatm.pdf) · [Rule 5.08 text listing](https://baseballrulesacademy.com/official-rule/mlb/5-08-how-a-team-scores/) · [Rule 5.0 text mirror](https://www.umpirebible.com/OBR16/5.0.htm) | Text checked 2026-09-29 (all three) |
| How a runner is added — walks, hit-by-pitch, catcher/fielder interference, uncaught third strike — **Rule 5.05(a)–(b)** | [Official Baseball Rules PDF](https://img.mlbstatic.com/mlb-images/image/upload/mlb/wqn5ah4c3qtivwx3jatm.pdf) · [Rule 5.0 text mirror](https://www.umpirebible.com/OBR16/5.0.htm) | Text checked 2026-09-29 |
| Routes that cannot add a runner on their own — balks (**6.02(a)**), obstruction awards (**6.01(h)**), wild pitches / passed balls (**9.13**), stolen bases (**9.07**), substitutions (**5.10**) | [Official Baseball Rules PDF](https://img.mlbstatic.com/mlb-images/image/upload/mlb/wqn5ah4c3qtivwx3jatm.pdf) | Rule numbers checked 2026-09-29 |
| Extra-inning automatic runner on second — **Rule 7.01(b)**, quoted from the 2023 summary of changes: *"Amended Rule 7.01(b) to incorporate the parameters of the Extra Innings Rule, which includes starting each half-inning following the ninth inning with a runner on second base."* | [Official Baseball Rules, 2023 edition (PDF, MLB)](https://img.mlbstatic.com/mlb-images/image/upload/mlb/wqn5ah4c3qtivwx3jatm.pdf) · [MLB-family announcement](https://www.milb.com/news/major-league-baseball-extra-inning-rule) | Text checked 2026-09-29 |
| Review/challenge rules inherited by the original pages | [MLB instant replay FAQ](https://www.mlb.com/news/instant-replay-review-faq/c-70189582) | Reference |
| Our own detection contract (decision table, routes, limits) | [docs/bases-loaded-alerts.md](docs/bases-loaded-alerts.md) | This repo |

## Where this still needs work — known limitations and the next sessions' list

Carried forward from the project prompt ("make suggestions for what work still needs to
be done and any limitations"), reviewed line by line against the code on 2026-09-29.

**Limitations standing between this and a fully reliable everyday service**

1. **Browser-bound monitoring.** The alert only exists while a page of this site is open
   and visible. Hidden tabs pause; closing the browser stops it. There is no server-side
   watcher, push, SMS or email — this is the single biggest gap for "use it every day"
   (full details: [docs/bases-loaded-alerts.md](docs/bases-loaded-alerts.md) → *Notifications and practical limits*).
2. **Polling gaps.** Schedule discovery runs every 15 s (30 s on the strip when nothing
   is late); a late-inning game gets a fresh official snapshot every 2 s on the monitor
   and every 5 s on the strip. A situation that appears and resolves inside one gap, or
   upstream publication delays, can be missed. Nothing is back-filled.
3. **Per-browser history.** Alerts live in this browser's `localStorage` (7 days, max 200
   entries). Not cross-device, not a full historical replay of every game.
4. **Unofficial data source.** The MLB StatsAPI has no SLA and no published rate limit;
   terms are ambiguous for public deployments ([docs/api-compliance.md](docs/api-compliance.md)).
   The client self-limits and degrades visibly instead of guessing.
5. **Live end-to-end proof still pending.** Deterministic suites cover 11,727 rule states
   plus 74 monitor, 160 strip and 258 site checks, and a published-site check verifies the
   deployment itself (counts as of 2026-09-29), but a live qualifying game has not yet
   been observed end-to-end from this deployment — the next live tied bottom-9+ game is
   the real acceptance test.
6. **Development-sandbox network limit (flagged, open).** The sandbox used for the
   2026-09-29 session cannot reach `statsapi.mlb.com` (TLS egress is blocked: curl exits
   with `SSL_ERROR_SYSCALL`, HTTP 000). The API projections documented here were verified
   in the session earlier the same day and must be re-confirmed from a networked machine
   or by the CI smoke workflow. **No live-alert claim in this repository is based on a
   response that was not fetched from the official API.**
7. **Cross-page quiet window is 90 seconds by design.** Another page's recent alert
   silences this page's chime for the same game + inning; a confirmed exit and reload
   still alerts (observer-scoped). If field use shows double beeps or missed beeps, tune
   `QUIET_MS` / `CROSS_PAGE_QUIET_MS` in the two controllers.

**Suggested work, in priority order (next session / the session after)**

1. **Confirm the published site after the next merge (in progress).** The site is live
   and the deployment is verified; the remaining check is that the *content* published
   from `main` after the next merge matches this repository, which
   `tools/deployed-site-test.mjs` now asserts in CI on every merge to `main` and nightly.
   Watch the first `published-site` run on `main` and read its log — a red run there is
   the only signal that the public copy drifted.
2. **Live-fire verification:** on the next tied game entering bot 9+, keep the monitor
   visible and record watch → load → chime → notification with the game link as proof.
   The new live slate makes this easy to document (the row shows the exact snapshot age).
3. **Always-on delivery (the big one):** a small Node watcher reusing
   `assets/js/bases-loaded-core.js` verbatim (it is dependency-free on purpose) that
   pushes Web Push notifications when nobody has a tab open.
4. **Wider alert context** (due-up hitters, pitcher line) only after verifying the
   extra projection fields against a live payload first — never widen a projection on
   assumption. The extra-inning `linescore.offense` shape used by the slate board is the
   same occupied-base object already verified for the alert snapshot; anything new must
   be fetched and checked the same way.
5. **History export** (CSV/JSON) and a shareable per-alert link.
6. **Mobile daily-driver polish:** installable PWA manifest, vibration on alert.

## Session log — 2026-09-29 (three verification passes)

Kept in the repository on purpose: the brief asks for the work to be verified line by
line, so what was checked, what was corrected and what is still open is written down.

**Pass 1 — implement and verify**

- Reviewed the whole alert stack against the brief: `bases-loaded-core.js` (rules),
  `bases-loaded.js` (monitor), `bases-loaded-strip.js` (site-wide strip),
  `api.js → getAlertSnapshot`, the two identical monitor entrypoints, the detection
  contract, and the three deterministic suites.
- Added the **live slate** (every game, its tracking reason, and the provenance/age of
  each number), the **held watch** for delays and suspensions, and **notification-click
  focus** that highlights the alerting card without navigating away from the monitor.
- Added [`verification.html`](verification.html) — requirement-by-requirement mapping,
  every route to loaded bases with its rule number, the official data sources, the
  polling budget, the limitations and this log.
- Added `tools/site-links-test.mjs` (255 checks: pages, links, structure, citations,
  no-manual-input, CI wiring) and moved both workflows into
  `.github/workflows/` so CI runs the suites on every push.

**Pass 2 — bugs, missing requirements, edge cases**

- Fixed: the slate gave an early-inning live game the label *awaiting the first live
  snapshot* instead of *not yet inning 9*, and a no-snapshot late game was labelled as
  unknown rather than *late inning · awaiting the first live snapshot*.
- Fixed the mismatch between the tied top half label and the actual half-inning state
  (top / middle / home-half-over are now three distinct, honest labels).
- Confirmed the held-watch path: a delayed tied game in the 10th is neither alerted nor
  dropped, and the rules engine's `isPaused` helper is now shared by both front ends
  instead of being duplicated.
- Added coverage for the new paths: monitor suite 54 → 74 checks, strip suite 151 → 160,
  including the paused-game row, the slate ordering/provenance, and that a game with a
  live snapshot is never left in an unknown state.

**Pass 3 — re-check against the brief, improve accuracy**

- **Irregularity found and fixed (correctness):** the README quoted Rule 5.08(b) as
  *"When the winning run is scored in the last half-inning … with the bases full"*, which
  is a paraphrase presented as a quotation. The README and the site now carry the
  **verbatim** sentence, and `tools/site-links-test.mjs` fails if the two ever differ.
- **Citations verified** against live official/text sources on 2026-09-29: Rule 5.08(b)
  (2023 OBR PDF + Rule 5.08 text listing), Rule 7.01(b) extra-innings runner (2023 OBR
  summary of changes), Rule 5.05(a)–(b) (walks, hit by pitch, catcher/fielder
  interference, uncaught third strike), 6.01(h), 6.02(a), 9.07, 9.13, 5.10.
- **Flagged irregularities (open):** the development sandbox cannot reach the MLB API
  (limitation 6 above), and the published Pages URL is still 404 with the automation
  token refused for the Pages endpoint (suggested work 1 above).

**Session 2 — deployment verified end to end, redundant publisher retired (2026-09-29)**

- **Irregularity found and fixed (deployment):** the first session added
  `.github/workflows/pages.yml` (Actions deployment with `enablement: true`) while this
  repository *already* published the `main` root through GitHub's built-in Pages build.
  Two publishers for one site race each other, and the Actions route could never have
  enabled Pages by itself — the automation token is refused by the Pages API. The
  workflow was removed and the test suite now fails if one is re-added.
- **Deployment verified (not assumed):** `GET /repos/…/pages` reports
  `status: "built"` with `source: main /`; the built-in `pages-build-deployment` run for
  `main` completed successfully; and the published pages were fetched and compared with
  this repository. The live site is https://buffedlizard55-lab.github.io/based-loaded-MLB-alert-system/
- **New guard:** `tools/deployed-site-test.mjs` fetches the published root,
  `bases-loaded.html`, `verification.html`, `scoreboard.html`, `reviews.html`,
  `game.html` and the alert assets, and asserts the published wording is this
  repository's wording (including the verbatim Rule 5.08(b) sentence). CI runs it after
  every merge to `main` and nightly; the deterministic CI job is asserted to stay
  offline.
- Deterministic suites after the change: rules 11,727 · monitor 74 · strip 160 · site
  255.

## Original MLB Live PBP documentation

The following describes the preserved scoreboard, game and replay pages. The original scoreboard is now `scoreboard.html`, not `index.html`; the home page is the alert monitor.

A zero-dependency, static web app that pulls **live MLB game data** straight from the
public MLB StatsAPI and renders it in a **Gameday-style scoreboard** — exactly the data
mlb.com uses, re-implemented from scratch in vanilla HTML/CSS/JS.

- **Scoreboard** (like [MLB.com](https://www.mlb.com/scoreboard)) — every game for any
  date, with live scores, inning, count, probable pitchers, and W/L/S decisions.
- **Game view** (like [MLB.com Gameday](https://www.mlb.com/gameday)) — **who's at bat,
  who's pitching, the count, outs, runners on base**, on-deck / in-the-hole hitters,
  pitch counts, last play, inning-by-inning linescore, full box score, and the complete
  play-by-play timeline with pitch-by-pitch details.
- **Instant Replay Reviews & Challenge Alerts** — real-time alerts and dedicated tracking
  for **Manager Challenges**, **Crew Chief Reviews**, **Umpire Reviews**, and **ABS**
  (Automated Ball-Strike system) pitch challenges across both the Scoreboard and Game views:
  - **All-Games "Replay Feed" page** (`reviews.html`) — a live, chat-style feed that pulls
    review events from **every game on the schedule** (not just one game): new manager
    challenges, crew chief reviews, umpire reviews, ABS pitch challenges and
    boundary-call reviews (potential home runs / fair-foul at the wall) appear at the
    top of the feed as they happen, with game link, inning, challenging team, reason,
    outcome, batter/pitcher context, and a three-row **review score tracker**:
    **Before review** (the call-on-field score when the active review is first
    observed), **Possible after** (call stands plus any conditional run-removal
    scenario supported by the reviewed scoring movements), and **Actual after**
    (the official score after the resolved reviewed play/action, when exposed).
    For example: `NYY 6 – BOS 5`, possible
    `NYY 5 – BOS 5` if the reviewed safe-at-home run is removed, then the actual
    official score after the ruling. The possible score is **not a prediction**:
    on a home-run/boundary review MLB may instead place runners. A boundary review
    with no currently credited run says “score impact pending” and does not invent
    an alternate score. If the page opens only after resolution, it shows an
    attributable official Actual-after score when available and honestly marks
    Before/Possible as not observed. A later end-of-plate-appearance score is not
    assigned to an earlier pitch review. For ABS,
    the feed also shows the pitch count before the challenge, who challenged (batter /
    catcher / pitcher, from official play text or the challenging team's batting/
    fielding side), and the count after the call is overturned or stands.
    Every ABS-challenge and manager-challenge row also carries a
    **challenges-remaining tracker**: the challenging team's current official
    counter (e.g. `CIN: 2 ABS challenges left now (2 successful · 0 failed)` or
    `PIT: 1 manager challenge left now (0 used)`), with the both-teams summary
    (`Challenges left: CIN 1 MGR · 2 ABS — CHC 1 MGR · 2 ABS`) on hover and on
    the Under-Review live strip. The numbers are the **official StatsAPI
    counters read as-is** — `review.away/home.used/remaining` (manager
    challenges, from the schedule's `hydrate=review` and feed/live
    `gameData.review`) and `gameData.absChallenges.away/home.usedSuccessful/
    usedFailed/remaining` (ABS, feed/live only; verified live 2026-08-28) —
    never counts derived from feed events, never zero-filled when absent
    (pre-ABS seasons have no `absChallenges` object at all), and a used-counter
    that moves backwards between polls is flagged on the row as an
    irregularity instead of being silently corrected. Crew-chief, umpire and
    boundary reviews are not charged to a team's counter, so those rows show
    no counter line by design. Includes
    an "Under Review" live strip, per-type
    filters — **All** (every category except ABS pitch challenges:
    challenges, reviews, boundary calls, under review, runs at risk),
    **ABS** (ABS challenges stay fully tracked here, in the **ABS
    Challenges** stat, and in the challenges-remaining counters),
    **Challenges**, **Reviews**, **Boundary Calls**, **Under Review**,
    **⚠️ Runs at Risk** —,
    summary stats for the whole day, and an optional **sound alert** — a gentle
    synthesized raindrop chime (three soft drops blooming into a warm two-note
    chime, ~1.2s, pure sine tones with a light echo) when a new challenge, review,
    or boundary call lands. It is off by default, remembers your choice per
    browser, and never fires for routine ABS pitch challenges (the run-at-risk
    case below is the one exception, and it uses this exact same chime).
  - **⚠️ Runs at Risk — "could this review take a run OFF the board?"** The feed
    tracks, per review, whether the call on the field credited runs to the very
    event now under review, so an overturn could remove them from the score. When
    it can, you get, immediately: the **same gentle raindrop chime** used for any
    new review (one alert sound for the whole page — it is literally the same
    audio graph, and shares its 2.5s cooldown), an
    optional **desktop notification**, a persistent **red banner** at the top of
    the page listing every affected game with the call-stands score and — only
    when the payload actually supports it — the score if the runs come off,
    a **⚠️ N RUN(S) AT RISK** badge and glow on the feed row,
    a **Runs at Risk** stat, and a dedicated filter tab. It fires once per review
    (not once per poll), clears the moment the review resolves, and applies to
    every review type — manager challenge, crew chief/umpire review, boundary call,
    "under review", and ABS — because it is decided by the *data*, not the type: a
    run counts only when the official payload has a `runners[]` record with
    `details.isScoringEvent:true` whose `details.playIndex` matches the reviewed
    event. A score change elsewhere in the plate appearance (a steal of home, a
    wild pitch) never counts, and the ruling itself is **never predicted**.
    Note that browsers block audio until you have interacted with the page, so a
    run-at-risk chime on the very first page load may be silent until you click
    something; the desktop notification is not affected.
  - **Scoreboard Live Ticker & Alert Badges** — surfaces any game currently in review or challenge,
    with a link straight to the all-games Replay Feed.
  - **Live Game Review Alert Banner** — eye-catching alert at the top of the game and live module when a call is under review.
  - **Dedicated "Challenges & Reviews" Tab** — full breakdown of every review event with summary stats (overturn rate, breakdown by challenge type and team), call reasons, and outcomes (Overturned, Stands, Confirmed).
  - **Play-by-Play Chips** — highlighted review outcome chips directly on affected plays.
  - All review parsing is validated against the real StatsAPI shapes (`reviewDetails`
    with codes `MJ` = ABS pitch challenge, `MA`/`MF` = manager challenges, and
    `NH` = boundary-call review, plus
    `feed.gameData.review` / `feed.gameData.absChallenges` challenge counters) — see
    `docs/verification-report.md` and `tools/review-test.mjs`.
- **Two-sided hit forecast** — a transparent per-plate-appearance hit probability that
  compounds the batter's and pitcher's season rates (log5), real platoon splits,
  recent form, head-to-head history, same-game familiarity, and the live count into a
  single number with a matchup tier (Elite → Pitcher's edge) and per-driver point
  adjustments. It appears in the live at-bat card, the Props & Matchup tab, and
  completed PBP rows.
- Auto-refreshes: on a live game page the full feed lands every **500ms**, while
  a dedicated **125ms status watcher** catches a brand-new challenge/review the
  instant MLB flips the official game status — and paints the review banner from
  the lean probe (~3 KB) while the 1–2MB full feed is still downloading (and
  while a review is in flight the page probes the lean play-by-play endpoint
  every **250ms**, pulling the full feed only when the review state flips). The
  Replay Feed scans every live game's play-by-play every **250ms** and sweeps the
  whole slate's official status every **125ms**; a game that flips into a review
  *during* a scan is fetched out of band instead of waiting for that scan to
  finish. The scoreboard keeps its 500ms hydrated-schedule poll and adds the same
  **125ms status sweep** for the review ticker. When the persistence server is running, a **live push**
  (server-sent events) delivers every tracked entry recorded by another tab or
  browser as soon as it is written — the Replay Feed is the only writer of that
  log, and its write is coalesced at ≤1/s — while the periodic pull stays as the
  fallback (and for static hosting). Post-Final scorer rulings are re-scanned every **1s** for the
  first two minutes, then 2.5s to five minutes, then 15s inside a bounded
  30-minute grace. Works on desktop and mobile.
- **"Under review" is detected from the official game status, not from play
  text.** All three surfaces run a dedicated **125ms review-status watcher**
  (`GET /api/v1/schedule` with a `fields` projection and no hydrations — the
  whole slate's `gamePk` + `status` in ~2.4 KB, ~1/8th the size of the schedule
  the rest of the page uses); the Replay Feed and the scoreboard use it for
  the whole slate, and the game page sweeps a ~150-byte per-game status
  projection on the same cadence. MLB flips `status.statusCode` the instant a
  review is **called**, while the play description is written when it
  **resolves** — so this cuts the worst-case wait from ~3s (the schedule cache)
  to ~125ms plus one round trip, and it surfaces the official review reason
  ("Tag play", "Home run", "Pitch Result", …) before any play text exists.
  Detection reads the API's own status registry (`GET /api/v1/gameStatus`:
  `M*` manager challenge, `N*` umpire review, `IH` instant replay, `MJ`/`NJ`
  ABS pitch challenge) instead of matching the words "challenge"/"review" —
  which silently missed crew-chief reviews, whose official `detailedState` is
  **"Instant Replay"**. See `docs/verification-report.md` §16.
- No build step, no frameworks, no API keys — it runs on **GitHub Pages** (or any static
  host, or even `file://`).

> **Live demo:** [buffedlizard55-lab.github.io/MLB-Live-PBP](https://buffedlizard55-lab.github.io/MLB-Live-PBP/)

---

## How it works — reverse-engineering MLB.com Gameday

MLB.com's Gameday is a JavaScript app. It reads JSON from a public, undocumented API at
**`https://statsapi.mlb.com/api/v1/`** (plus `v1.1` for live game feeds) and pulls
images (logos, headshots) from **`mlbstatic.com`**. No login, no API key, and the API
sends CORS headers, so any static page can call it directly from the browser.

This project does the same thing with its own front end. The API calls we make:

| What we need | Endpoint |
| --- | --- |
| Games for a date (scoreboard cards, probables, live count) | `GET /api/v1/schedule?sportId=1&date=YYYY-MM-DD&hydrate=probablePitcher,linescore,decisions,review` |
| **Review status for the whole slate** (Replay Feed's 250ms watcher) | `GET /api/v1/schedule?sportId=1&date=YYYY-MM-DD&fields=dates,games,gamePk,season,status,abstractGameState,codedGameState,detailedState,statusCode,reason,startTimeTBD,abstractGameCode` |
| **Review status for one game** (game page's 250ms status watcher, ~150 B) | `GET /api/v1.1/game/{gamePk}/feed/live?fields=gameData,status,abstractGameState,codedGameState,detailedState,statusCode,reason,startTimeTBD,abstractGameCode` |
| Official game-status registry (source of every review `statusCode` + `reason`) | `GET /api/v1/gameStatus` |
| Full game state — play-by-play, current at-bat, linescore, box score, decisions, rosters | `GET /api/v1.1/game/{gamePk}/feed/live` |
| Fallback feed (older games) | `GET /api/v1/game/{gamePk}/feed/live` |
| Fallback bundle (if the feed 404s) | `GET /api/v1/game/{gamePk}/playByPlay` + `/boxscore` + `/linescore` |
| Play-by-play only (all-games Replay Feed scans this per game) | `GET /api/v1/game/{gamePk}/playByPlay` |
| Team logos | `https://www.mlbstatic.com/team-logos/team-cap-on-dark/{teamId}.svg` |
| Player headshots | `https://img.mlbstatic.com/mlb-photos/image/upload/.../v1/people/{playerId}/headshot/67/current` |
| Batter / pitcher season inputs for the forecast | `GET /api/v1/people/{playerId}/stats?stats=expectedStatistics,season,statSplits,gameLog&group=hitting&sitCodes=vl,vr&season=YYYY` (same CSV for `group=pitching`). **Note:** the `statcast` stat is rejected with HTTP 400 for `group=hitting` on the live API (verified 2026-08-19), so it is deliberately not requested — xBA comes from `expectedStatistics`. |
| Career head-to-head for the live forecast | `GET /api/v1/people/{batterId}/stats?stats=vsPlayer&group=hitting&opposingPlayerId={pitcherId}` |

The live feed is the heart of it — one response contains everything Gameday shows:

```
liveData.plays.allPlays[]      → every at-bat: result, description, count, outs,
                                 batter/pitcher matchup, runner movement, pitch events
liveData.plays.currentPlay     → the at-bat happening RIGHT NOW (batter, pitcher, count)
liveData.linescore             → inning state, inning-by-inning runs/hits/errors
liveData.boxscore              → per-player batting & pitching lines, batting order
liveData.decisions             → winning/losing/saving pitcher
gameData.players / teams       → names, positions, records, venue, weather, status
```

The app polls `feed/live` every 500ms while a game is in progress (every 250ms
while a review is in flight, via a lean play-by-play probe that fetches the
full feed only when the review state flips) and only rebuilds the DOM when the
baseball state changes
(count, pitch event, score, inning, play, or review outcome). The heavy box-score
table is lazy-rendered only when its tab is open. Preview and final games use
slower cadences, and polling pauses automatically while the tab is hidden.

## Two-sided hit forecast

The hit percentage is a **transparent, per-plate-appearance estimate** — not an MLB
projection or a betting line. It is built to *discriminate*: great spots and terrible
spots land far apart instead of clustering around the league average. Two numbers are
shown, and they intentionally live in different bands:

- **Per-PA headline ("Hit this PA")** — the chance the batter gets a hit in *this*
  plate appearance. For **real MLB matchups this typically reads 22–30%** (league hit
  rates cluster around `.245`, and real batters/pitchers do too); the model's full
  clamp band is 13–62% per-PA (10–78% with live count), reached only by stacked
  synthetic edges like an overmatched call-up vs an ace (~13%) or an elite hitter on
  a hitter's count vs a weak arm (~50%). A single-PA hit rate can't honestly reach
  80%: even a perfect .400 hitter vs a .150-allowed pitcher resolves to ~55% before
  clamps. See `tools/model-calibration-report.mjs` for the archetype grid.
- **"≥1 hit in next N PAs" projection** — the *wide* number, and where the promised
  16–95% spread actually lives. It is `1 − (1 − per-PA)^remaining PAs`, so during a
  live game it naturally reads **50–95%** (the broadcast-style graphic number most
  fans expect). It is shown on the live at-bat card and in the Props & Matchup tab;
  on a **Final game there are no PAs left, so it reads "—"/0%** and the per-PA rate is
  the relevant number. Both are per-batter and per-pitcher.

The model:

1. **Season level (both sides):** the batter's xBA/AVG hit-production signal and the
   pitcher's xBA-allowed/opponent-AVG signal are each regressed toward a `.245` league
   baseline (light regression so a full-season signal can move the forecast by
   ~10-14 points), then compounded in log-odds space — a generalized **log5** (Bill
   James's odds-ratio method), so extreme signals push the estimate toward the
   extremes rather than canceling toward the mean. Total evidence is capped at
   ±1.9 logits from the league prior.
2. **Platoon splits:** each player's real `vs LHP` / `vs RHP` (pitchers: `vs LHB` /
   `vs RHB`) split enters as a shrunken *differential* against their own season rate.
   Without split data, a small flat handedness adjustment is used instead.
3. **Recent form:** the player's game-log window (last ~8 games, strictly before the
   modeled game's date, so a forecast never leaks the game's own result) nudges the
   estimate with a meaningful weight (capped so a single hot/cold week cannot dominate
   the season signal).
4. **Head-to-head:** the career batter/pitcher line is a bounded but real nudge
   (~up to 5.5 pts of weighted signal).
5. **Same-game familiarity:** each repeat plate appearance against the same pitcher
   adds a small times-through-the-order bump (~+0.75 pts/pass, capped at the third look).
6. **Live count:** mid-at-bat, the fresh-count estimate is multiplied in odds space by
   an empirically anchored count factor (3-1 » 0-0 » 0-2); walks are *not* hits, so
   3-ball factors deliberately exclude the walk's value (see
   `tools/count-model-derivation.mjs` for the derivation and anchors).

The headline number is the **hit probability for this plate appearance**; the chance
of at least one more hit across the remaining expected plate appearances is shown as a
secondary projection. A **matchup tier** (Elite matchup / Favorable / Neutral / Tough /
Pitcher's edge) and per-driver **adjustment chips** (season, platoon, form, history,
familiarity, count — in percentage points) make every forecast explainable.

If one player has no usable season data, the forecast remains available but labels the
fallback (for example, “Batter input; pitcher baseline fallback”). If neither side has
data, it shows the league baseline instead of pretending the estimate is personalized.
The same cached model powers the live at-bat card, Props & Matchup tab, and PBP chips;
for archived games the request is scoped to the feed's game season.

## Project structure

```
.
├── index.html                 # ALERT MONITOR (tied / bases-loaded / bottom 9+)
├── bases-loaded.html          # identical second entrypoint for the monitor
├── verification.html          # requirements, routes to loaded bases, sources
├── game.html                  # Game page (?gamePk=<id>) — mounts the strip
├── reviews.html               # All-games Replay Feed — mounts the strip
├── scoreboard.html            # Original scoreboard — mounts the strip
├── 404.html
├── assets/
│   ├── css/
│   │   ├── style.css                 # inherited dark Gameday theme
│   │   ├── bases-loaded.css          # monitor + documentation styling
│   │   └── bases-loaded-strip.css    # site-wide strip styling
│   └── js/
│       ├── api.js                    # MLB StatsAPI client (incl. getAlertSnapshot)
│       ├── bases-loaded-core.js      # THE RULES: tied + loaded + bottom 9+ (shared)
│       ├── bases-loaded.js           # monitor controller (slate, alerts, history)
│       ├── bases-loaded-strip.js     # site-wide strip controller (other pages)
│       ├── ui.js                     # inherited shared UI helpers
│       ├── reviews.js / reviews-feed.js / scoreboard.js / props.js / game.js
│       └── …
├── tools/                     # deterministic test suites (no packages, no network)
├── docs/                      # detection contract, verification reports, quickstart
├── .github/workflows/         # smoke.yml — checks in CI (Pages publishes from main)
└── server.mjs                 # optional local static + replay-log server
```

## Run it locally

Run the built-in persistence server (recommended — persists scoring changes and reviews to disk across browsers):

```bash
# Node built-in server (multi-browser persistent logging backend)
node server.mjs

# or any static file server
python3 -m http.server 8000
# or
npx serve .
```

Then open <http://localhost:8000>. You can also open `index.html` directly in a browser
(`file://` works — the app uses plain scripts, no modules).

To run the deterministic, network-free checks:

```bash
node tools/hit-model-test.mjs                  # two-sided hit forecast model
node tools/review-test.mjs                     # challenge / replay review parser (incl. real API shapes)
node tools/reviews-feed-test.mjs               # all-games Replay Feed diff helpers
node tools/replay-feed-render-test.mjs         # end-to-end Replay Feed render (captured live payloads)
node tools/review-probe-test.mjs               # in-review lean-probe signature (game.js)
node tools/review-status-test.mjs              # official gameStatus registry + review detection (all 4 copies)
node tools/review-watcher-test.mjs             # 125ms review-status watcher + mid-wave flip + live log push (real boot path)
node tools/page-status-watcher-test.mjs        # 125ms watchers on game page + scoreboard, probe-first banner, pushed badges
node tools/api-rate-limit-test.mjs             # HTTP-429 self-throttle (Retry-After aware, 60s default)
node tools/official-scoring-test.mjs           # official-scorer pending rulings
node tools/api-fields-test.mjs                 # playByPlay `fields` projection coverage
node tools/scoring-change-test.mjs             # official scoring-change tracker (hit ↔ error ↔ out)
node tools/feed-log-persistence-test.mjs       # replay feed log: every entry survives refresh/revisit
node tools/cross-browser-persistence-test.mjs  # cross-browser persistence + the server's live SSE push
```

Every entry tracked (challenges, reviews, scoring-pending rulings, scoring
changes) is persistent across the website:
- **Across browsers & sessions**: saved to the backend disk store (`data/feed-log-<date>.json`)
  via `POST /api/feed-log` and cached in `localStorage`, so opening the website on
  another browser immediately restores all tracked entries and baselines. Every accepted
  write is also pushed to the other open pages over
  `GET /api/feed-log/stream?date=<date>` (server-sent events, ~3s reconnect hint,
  20s heartbeat), so a challenge, review, pending ruling or scoring change recorded in
  one browser (a Replay Feed must be open somewhere — it is the only writer) shows up
  in the others as soon as that write lands, instead of on their next poll; the
  periodic pull remains the fallback when the stream is unavailable (static
  hosting, no `EventSource`, blocked connection).
- **Across the website**:
  - `reviews.html`: renders the All feed and dedicated ✏️ Scoring Changes tab.
  - `game.html`: dedicated **Challenges & Reviews** tab displays official scoring changes
    with full initial-call-to-final-ruling breakdown, and updates the tab badge.
  - `index.html`: scoreboard cards display the `✏️ N Scoring Change(s)` indicator.
  (see `docs/scoring-changes.md`).

To *see and hear* the ⚠️ Runs at Risk surfaces without waiting for a live review,
serve the repo and open the offline, fixture-driven preview — it stubs the API with
the exact same deterministic payload the render test uses and makes no network
request:

```bash
python3 -m http.server 8000
# then open http://localhost:8000/tools/run-risk-preview.html
```

## Deploy to GitHub Pages

The site is 100% static (repo root = site root), so GitHub Pages serves it directly
with no build step and no workflow permissions:

1. **Push this project to GitHub** (any repo — e.g. `yourname/MLB-Live-PBP`).
2. In the repo: **Settings → Pages → Source → "Deploy from a branch"** → branch
   `main` → folder `/ (root)` → **Save**.
3. Your site is live at **`https://<your-username>.github.io/<repo-name>/`** —
   e.g. [`MLB-Live-PBP`](https://buffedlizard55-lab.github.io/MLB-Live-PBP/) or, for this
   copy, **[https://buffedlizard55-lab.github.io/based-loaded-MLB-alert-system](https://buffedlizard55-lab.github.io/based-loaded-MLB-alert-system/)**. Every push to
   `main` republishes it automatically (takes ~1 minute).

### Continuous checks (no deployment workflow needed)

Publishing needs no workflow at all in this copy — GitHub's built-in *Deploy from a
branch* build publishes the repository root of `main`. What does ship in
[`.github/workflows/`](.github/workflows/) is `smoke.yml`:

- every deterministic suite (rules, monitor, strip, site integrity, replay review,
  scoring changes, model calibration) on each push and pull request;
- `tools/deployed-site-test.mjs` after each merge to `main` and on the nightly schedule
  — it fetches **https://buffedlizard55-lab.github.io/based-loaded-MLB-alert-system/** and fails if the published pages or their alert wording
  differ from this repository;
- a nightly live check that the upstream MLB StatsAPI still matches our parsers.

This repository has no `pages.yml`: the built-in build already publishes the root, and a
second publisher would race it (`tools/site-links-test.mjs` fails if one is added back).

### Customizing

- **Season / league:** `SPORT_ID` in `assets/js/api.js` (1 = MLB). Minor-league IDs
  (11–14) also work.
- **Refresh rate:** `LIVE_POLL_MS`, `REVIEW_POLL_MS`, `PREVIEW_POLL_MS`, and `FINAL_POLL_MS` in
  `assets/js/game.js` (the 250ms in-review probe uses `REVIEW_POLL_MS` against the
  lean `playByPlay` endpoint); `LIVE_POLL_MS` / `REVIEW_POLL_MS` / `IDLE_POLL_MS`
  in `assets/js/scoreboard.js` and `assets/js/reviews-feed.js`;
  `FETCH_CONCURRENCY` in `assets/js/reviews-feed.js` (how many games the all-games
  feed fetches in parallel per scan).
- **Team colors:** `TEAM_COLORS` in `assets/js/ui.js`.

## Notes & etiquette

- The MLB StatsAPI is **unofficial and may change without notice**. The client is
  written defensively (fallbacks for every endpoint and missing fields) and the app
  degrades gracefully if a field disappears.
- **Terms & budget:** the binding rules for this data, the request rate of every
  polling surface, and the code paths that enforce them are written down in
  [`docs/api-compliance.md`](docs/api-compliance.md) — including the two clauses
  that pull in different directions (the API's own notice permits "individual,
  non-commercial, non-bulk use"; MLB.com's Terms of Use §1 forbids automated
  collection and any display beyond personal, non-commercial home use) and the
  open question of public deployment. There is no published rate limit for the
  StatsAPI and no written authorization either way.
- Be a good citizen: the app needs **no API key** (the StatsAPI is keyless and
  open-CORS) and it self-limits — every page pauses when the tab is hidden,
  backs off on preview/final games, bounds post-Final re-scans to a 30-minute
  grace window, and the shared client honours **HTTP 429** with a quiet period
  (the server's own `Retry-After` when it sends one, clamped to 1s–5min;
  otherwise 60 seconds), so it can never hammer a host that has asked it to
  slow down. The live push is server-side (same-origin `EventSource`) and adds
  no requests to MLB's API. The Replay Feed scans live games'
  playByPlay (the light, `fields`-projected endpoint — no boxscore/rosters)
  every 250ms, subtracts scan time from the next wait, fetches in-review games
  first, and only re-renders when a review event actually changes. Worst case
  on a full ~15-game slate that is ~60 playByPlay requests/s plus ~4 tiny
  status sweeps/s (~68 req/s, single client, since the sweep went 250ms → 125ms)
  — far below "thousands of requests per second", and the same cadence the page
  already used whenever any review was in flight. The 1s post-Final tier adds
  ~70 requests per finished game
  across its 30-minute grace (~292 total, up from ~220) — bounded, and only for
  games that have just gone final. The StatsAPI is
  pull-only — a shorter poll only reduces how long a landed event sits unseen.
- This is a **personal, non-commercial project** (no ads, no analytics, no data resale — see the
  request budget and the governing terms in [`docs/api-compliance.md`](docs/api-compliance.md)).
  It lives in a public repository and is served from GitHub Pages; that is hosting, not a service
  offered to others.
- Review/challenge data shapes were verified against the live API on 2026-08-19
  (schedule `hydrate=review`, `reviewDetails` codes `MJ`/`MA`/`MF`, and
  `gameData.absChallenges`); see `docs/verification-report.md`.
- Team logos, headshots, and the underlying data are © MLB Advanced Media / MLB and
  their respective owners. This is an unofficial fan project — not affiliated with
  or endorsed by MLB.

## License

[MIT](LICENSE)
