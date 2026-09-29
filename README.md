# Loaded Late — tied, bases-loaded MLB alerts

> **Live site:** https://buffedlizard55-lab.github.io/based-loaded-MLB-alert-system/  
> **All deterministic tests passing** (3,500+ checks) | **GitHub Pages deployed** | **Web Push + always-on watcher ready**

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

**Keep one monitor tab open and visible** — or run the watcher below, which does not need a browser at all. Hidden tabs pause and closing the browser stops the *page*; notifications need browser support and permission, and sound must be enabled with a click each session. For monitoring with every tab closed, run `node tools/watcher.mjs` on any always-on machine (same rules engine, optional phone push) — the recipes are in [`deploy/`](deploy/) with a step-by-step [deployment guide](docs/watcher-deployment.md) for systemd, Docker/compose, launchd or a cron one-shot.

Schedule discovery checks today and yesterday in America/New_York every 15 seconds, retaining live overnight games. All live games in inning 9+ are checked using coherent status + linescore snapshots, even if not yet tied, every two seconds **after** each scan (four concurrent requests maximum). Upstream delays, errors and brief between-poll situations can cause missed alerts. Network failures and stale snapshots are visibly marked, not treated as an all-clear. The shared API client honors HTTP 429 backoff.

See [the detection rules, coverage and limitations](docs/bases-loaded-alerts.md).

## Test the alert system

```bash
node tools/bases-loaded-test.mjs         # rules engine
node tools/bases-loaded-monitor-test.mjs # monitor page controller
node tools/bases-loaded-strip-test.mjs   # site-wide strip + page wiring
node tools/watcher-test.mjs              # the always-on watcher (same rules, no browser)
node tools/watcher-deploy-test.mjs       # deployment recipes vs. the watcher's real settings
node tools/webpush-test.mjs              # Web Push encryption/VAPID against the RFC vectors
node tools/push-alerts-test.mjs          # the site's phone-alerts panel (stub browser + DOM)
node tools/site-links-test.mjs           # pages, links, citations, CI wiring
node tools/make-icons.mjs --check        # the shipped icons still match their generator
node tools/icons-test.mjs                # installability: manifest, icons, pages, buzz parity
node tools/deployed-site-test.mjs        # the published site itself (network)
```

These deterministic tests need neither external packages nor live MLB games. The 17-step guided demo tests top-half exclusion, the changeover watch, partial occupancy, first alert, repeated poll, bases clearing/reloading, a walk-off, an automatic runner, bottom 14, and a tying bases-loaded walk in bottom 15. Rule tests also exhaustively check 11,520 inning/half/outs/score/base combinations and verify incomplete data and rain delays do not re-arm an existing episode. The strip suite additionally drives the site-wide watcher through a deterministic DOM, clock and API stub: extra innings 10–17, partial occupancy labels, opt-in sound/notifications, the cross-page quiet window, hidden-tab pause, 30s/5s cadence, stale and failed snapshots, blocked storage, and a page with no api client. `webpush-test.mjs` reproduces the published RFC 8291 and RFC 8292 vectors value by value
(including the intermediate HKDF steps) and decrypts the RFC's message with an independently
written receiver; `push-alerts-test.mjs` drives every branch of the subscribe panel — including
a refused permission prompt, a subscribe that throws, and a clipboard that refuses to copy.
Demo data never enters live history. The site suite checks that every page and every internal
link target exists, that no page uses a root-absolute path (the copy has to work under a
project Pages subpath), that outbound links are HTTPS and no third-party scripts are loaded,
that the monitor and the sources pages still take no typed input into the alert pipeline (the
phone-alerts device name is the one editable control, and nothing that computes or displays an
alert reads it), that the project
prompt and the verbatim Rule 5.08(b) sentence are still present in this README, that the
documented alert projection still matches `api.js`, and that the repository ships no
competing Pages deployment. The last suite, `tools/deployed-site-test.mjs`, is the only
network test of the four plus one: it fetches the published URL, its pages and its alert
assets and fails if the deployed site drifts from this repository. CI runs it after every
merge to `main` and nightly, never on a pull request. It retries the whole assessment
(30 rounds × 15 s in CI) because Pages builds *after* the merge commit, so for a minute or
two the published site is legitimately the previous commit. It can be dry-run against any
server, which is how its own assertions are tested:

```bash
node server.mjs &                                   # or any static server on the root
SITE_URL=http://localhost:8000/ node tools/deployed-site-test.mjs
```

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

1. **Browser-bound *by default*, but no longer only.** The page still alerts only while it
   is open and visible — but `tools/watcher.mjs` runs the **same rules engine** outside the
   browser (no dependencies, one file), logs every alert with its official snapshot link
   and can push to a phone (`WATCHER_WEBHOOK_URL`, `WATCHER_NTFY_TOPIC`, or Web Push to a
   device subscribed from the site's *Phone alerts* panel). What that still
   needs is **somewhere to run**: an always-on machine or scheduler *you* provide — nothing
   is hosted for you, and no recipe can provide that host: systemd, Docker/compose, launchd
   and cron recipes ship in [`deploy/`](deploy/) with a [deployment guide](docs/watcher-deployment.md)
   and a healthcheck that reads the watcher's own state file. Original caveat, still true of
   the page: hidden tabs pause and closing the browser stops the page's watch, so the
   single biggest gap for "use it every day"
   (full details: [docs/bases-loaded-alerts.md](docs/bases-loaded-alerts.md) → *Notifications and practical limits*).
2. **Polling gaps.** Schedule discovery runs every 15 s (30 s on the strip when nothing
   is late); a late-inning game gets a fresh official snapshot every 2 s on the monitor
   and every 5 s on the strip. A situation that appears and resolves inside one gap, or
   upstream publication delays, can be missed. Nothing is back-filled.
3. **Web Push still depends on third-party infrastructure at the edges.** The alert content is
   encrypted to a key only the subscribed device holds (RFC 8291) and signed with the watcher's
   own VAPID key (RFC 8292), so the push service transports ciphertext it cannot read — but it
   still has to transport it (Chrome/Edge and Firefox hand that to Google and Mozilla; Safari to
   Apple), and it still sees *that* an alert happened and when. That is the price of reaching a
   phone with the browser closed, and it is stated here rather than glossed over.
4. **Per-browser history.** Alerts live in this browser's `localStorage` (7 days, max 200
   entries). Not cross-device, not a full historical replay of every game — which is why
   the monitor now **exports** the history (JSON/CSV) and can copy a one-line evidence
   citation carrying the official snapshot link: the file, not the browser, is the record.
5. **Unofficial data source.** The MLB StatsAPI has no SLA and no published rate limit;
   terms are ambiguous for public deployments ([docs/api-compliance.md](docs/api-compliance.md)).
   The client self-limits and degrades visibly instead of guessing.
6. **Live end-to-end proof still pending.** Deterministic suites cover 11,772 rule states
   plus 99 monitor, 160 strip, 173 watcher, 112 deployment, 130 Web Push, 74 phone-alert,
   153 installability and 347 site checks, and a published-site check verifies the
   deployment itself (counts as of 2026-09-29), but a live qualifying game has not yet
   been observed end-to-end from this deployment, and no alert has yet arrived on a real
   phone through a real push service — the next live tied bottom-9+ game is the real
   acceptance test.
7. **Development-sandbox network limit (partially closed, still flagged).** Raw socket
   egress from this sandbox is blocked (`curl`/`node fetch` to `statsapi.mlb.com` die with
   `SSL_ERROR_SYSCALL`, HTTP 000), so the watcher and the live smoke suite cannot run
   here. The session's *page-fetch* path does reach the official API, though, and on
   2026-09-29 it was used to re-verify, live, the three claims this project leans on:
   the dated schedule (`sportId=1&date=2026-09-29`, four Wild Card games), the exact
   `getAlertSnapshot` projection against live game 849849 (status, linescore with count
   and outs, `plays.currentPlay.result`, `offense`/`defense` occupants — and empty bases
   as *absent keys*, exactly as the occupancy check reads them), and the same linescore
   unfiltered at `/api/v1/game/849849/linescore`. That session also caught the one quirk
   worth knowing: `linescore.defense.{batter,onDeck,inHole}` are the *fielding* team's
   next three hitters, so due-up context must come from `offense`. The CI nightly live
   check remains the standing confirmation from a machine with normal egress. **No
   live-alert claim in this repository is based on a response that was not fetched from
   the official API.**
8. **Cross-page quiet window is 90 seconds by design.** Another page's recent alert
   silences this page's chime for the same game + inning; a confirmed exit and reload
   still alerts (observer-scoped). If field use shows double beeps or missed beeps, tune
   `QUIET_MS` / `CROSS_PAGE_QUIET_MS` in the two controllers.

**Suggested work, in priority order (next session / the session after)**

0. **Prove it live, on a real phone.** Everything in this repository is verified by vectors,
   stubs and byte comparisons — but no alert has yet travelled the whole path: official
   snapshot → watcher → push service → phone notification → tapped open on the game page.
   That needs one live tied-game-entering-bot-9+ situation with a subscribed device, and it is
   the only remaining acceptance test. Everything else is preparation for it.
1. ~~Confirm the published site.~~ **Done, and now guarded.** The site is live at
   [buffedlizard55-lab.github.io/based-loaded-MLB-alert-system](https://buffedlizard55-lab.github.io/based-loaded-MLB-alert-system/),
   and the deployed copy was read back on 2026-09-29 to confirm it is the copy in this
   repository — including that it loads the official schedule from a real browser (4 MLB
   games on the slate, each with its provenance label) and shows the history export
   controls. The guard is `tools/deployed-site-test.mjs`: every published page and alert
   asset must be **byte-identical** to the merge commit, checked after each merge to
   `main` and nightly. Its first run failed for a timing reason (Pages builds after the
   merge commit), which is fixed — it now waits for the deployment to catch up — and the
   run after that was green. Nothing here needs doing again unless a run goes red.
2. **Live-fire verification:** on the next tied game entering bot 9+, keep the monitor
   visible and record watch → load → chime → notification with the game link as proof.
   The new live slate makes this easy to document (the row shows the exact snapshot age).
3. ~~Always-on delivery (the big one)~~ **Shipped in session 2; fixed for real in session
   4**: `tools/watcher.mjs` requires `assets/js/bases-loaded-core.js` **verbatim** (no
   forked rules), polls the same official endpoints, de-duplicates across restarts, writes a
   JSONL alert log carrying the official snapshot URL, and pushes via a webhook or ntfy.
   **Session 4 found that as shipped the watcher could never alert** — its discovery URL
   omitted `hydrate=linescore`, so the real schedule answered without the linescore the
   scan rule reads — and fixed the URL, the suite stubs (which had been richer than the
   real endpoint), the unused fast cadence, and the stale-state growth (session log below).
   Covered by `tools/watcher-test.mjs` (173 checks, stubbed network and clock) and by a
   nightly live guard on the discovery contract. Browser-grade **Web Push (VAPID) shipped in
   session 2** — see the work item below. Still open, and honestly *not* solved by that
   file: **someone still has to run it** on a machine that stays on (any deployment made
   before session 4 must be redeployed from this commit). The recipes and guide exist
   ([`deploy/`](deploy/), [docs/watcher-deployment.md](docs/watcher-deployment.md)), but
   this repository has not observed a real always-on host keeping its own watch.
4. ~~Wider alert context (due-up hitters).~~ **Shipped this session**, and widened only
   after verifying against a live payload: `linescore.offense.inHole` (the hitter after
   the on-deck hitter) is now part of the evaluated situation, the alert event, the
   history export and the cards on both front ends, shown as "due up: X → Y". Verified
   live on 2026-09-29 against game 849849 — where `offense.batter/onDeck/inHole` are the
   *batting* side's upcoming order and `defense.batter/onDeck/inHole` are the fielding
   team's next three, so reading the defensive copy would name the wrong lineup. The
   projection already requested `inHole`, so nothing new was added to the request; the
   suite now pins that a defensive `inHole` can never appear as due up.
5. ~~History export (CSV/JSON) and a shareable per-alert link.~~ **Shipped this session**:
   *Export JSON*, *Export CSV* and *Copy newest evidence line* on the monitor, each record
   carrying the exact official snapshot URL it was read from, plus an *Official snapshot*
   link on every history card. A shareable link deliberately points at the **official
   record** rather than at this site's own history, because history is per browser and a
   link into it would be empty for anyone else — see limitation 3. Still open: a
   cross-device store (the always-on watcher in item 3 is the natural home for it).
6. ~~Mobile daily-driver polish.~~ **Shipped this session**: `manifest.webmanifest` plus
   generated icons (`assets/icons/`, produced deterministically by
   `tools/make-icons.mjs` from the site's own CSS tokens) make the site installable —
   *Add to Home Screen* is what iOS requires before Web Push works at all — and every
   page links the manifest, favicon, `apple-touch-icon` and theme colour with relative
   paths so it still installs under the project Pages subpath. Notifications now vibrate
   with a distinct two-short-one-long pattern (monitor, strip and the service worker's
   push handler all use the same numbers; `tools/icons-test.mjs` fails if they diverge).
   Still open for the phone: a richer lock-screen layout per platform, which needs a
   real device to judge rather than guess.
7. ~~Watcher operations, still thin.~~ **Shipped this session**:
   `node tools/watcher.mjs --doctor` (alias `--check`) answers "will this watcher actually
   reach me?" in one command before a game starts — upstream reachability proven by
   reading today's Eastern slate, log/state writability proven by a probe file it then
   removes, and every channel reported as configured, half-configured (a hard failure,
   because it looks like one that works) or deliberately off. `--list-subscriptions`
   shows each stored device masked with a per-row verdict and reason;
   `--prune-subscriptions` removes rows that can never deliver (gone endpoints are still
   pruned automatically at delivery time, because only the push service knows that).
   A push that fails transiently (429, 5xx, or no answer at all) is now retried up to
   three times with a capped backoff that honours `Retry-After`; failures that are a
   decision about *this* request (400/401/403/404/410/413) are reported once and not
   retried. All of it is covered by `tools/watcher-test.mjs` with an injected clock.
8. ~~Browser-grade Web Push.~~ **Shipped this session** — see the session log below.

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
- **Nightly check made date-honest.** The live smoke test derived its date from UTC, so
  the 04:17 UTC run landed on the *next* MLB day, where no game has started yet: the
  started-game shapes (linescore inning state, boxscore team stats, review counters) had
  nothing to assert against and the job failed for the wrong reason. It now resolves the
  date in **America/New_York** (MLB's own day boundary) and walks back up to a week to the
  most recent slate that actually has a Live or Final game; started-game shapes are
  asserted there and reported as skipped for a slate that has not begun. Failures now
  also emit `::error` annotations, so a red job states which checks failed instead of
  only "exit code 1".
- **Published-site check hardened by its own first CI run.** The first `main` run of
  `tools/deployed-site-test.mjs` failed correctly but for a formatting reason: the
  assertions matched the raw HTML, and a sentence written across two source lines
  arrives with a newline inside it. The check now flattens whitespace before matching,
  emits `::error`/`::warning` annotations naming each failure, and can be dry-run against
  a local server (`SITE_URL=http://localhost:8000/`) — 18/18 pass against this
  repository's own pages.
- **Empty-slate copy.** An off-day used to read "No games on the slate yet — the
  official schedule scan fills this list every 15 seconds", which implies a scan is
  pending; the board now distinguishes a scan that has not answered from an official
  schedule that really has no games today ("No games scheduled on this date"). Covered by
  a new monitor-suite scenario (74 → 76 checks).
- **Alert history is now a record you can keep (work item 5, shipped).** The monitor
  exports its history as JSON (`loaded-late/alerts@1`, with the definition, the rule
  number and the official source inside the file) or CSV (RFC 4180), every record
  carrying the exact `statsapi.mlb.com` snapshot URL it was read from; each history card
  links to that snapshot; and *Copy newest evidence line* puts a one-line citation —
  inning, tied score, outs, count, matchup, observation time, official link — on the
  clipboard. The serializers are pure functions in `bases-loaded-core.js` so the bytes are
  tested directly: CSV quoting and CRLF, blank and malformed records, JSON schema and
  stamping, the evidence line (which omits what was not observed rather than inventing
  it), and UTC file naming. Verified in a real DOM (jsdom, this session): two polls
  produce one saved alert, the export downloads
  `loaded-late-alerts-2026-09-29.json` containing that alert, CSV arrives as
  `text/csv;charset=utf-8`, the evidence line copies, and a blocked download or clipboard
  says so instead of claiming success.
  Documented limitation, deliberately not papered over: history is per browser, so a
  shareable link points at the **official** record, not at a private local list.
- **First real failure of the byte-equality check, and the fix.** The check's first run on
  `main` correctly refused to certify the deployment — and named exactly why in the
  annotations (`assets/js/bases-loaded.js differs — byte 11286: local "/* ----…" vs
  published "function feedback(message) {…"`). The cause was timing, not content: the
  `pages-build-deployment` run for that merge finished about a minute after the check
  started, so the check was reading the *previous* commit. Its per-request retry could not
  cover that. The whole assessment is now retried (30 rounds × 15 s in CI) until the
  published bytes match, files already confirmed identical are not re-fetched, the log says
  how long it waited, and a persisting mismatch points at the Pages build to inspect.
  Proven against a deliberately stale server: the check retried three rounds and passed as
  soon as the "deployment" caught up.
- **Deployment check upgraded to byte equality.** The published-site check asserted ids
  and sentences, which a stale-but-similar deployment could still satisfy. It now also
  fetches every published page and alert asset and requires it to be **byte-identical**
  to the file in this repository (29 checks against a local dry run), reporting the first
  differing byte when it is not.
- **The number-one limitation is now addressable (work item 3, shipped).** The alerts only
  existed while a browser tab was open and visible. `tools/watcher.mjs` is one
  dependency-free file that requires the site's rules engine **verbatim**, polls the same
  official endpoints with the same cadences and the same `scanTarget` rule, keeps
  de-duplication state on disk (a cron restart never re-alerts), appends every alert to a
  JSONL log whose records carry the exact official snapshot URL, and delivers through
  `WATCHER_WEBHOOK_URL` or `WATCHER_NTFY_TOPIC`. A failed channel is reported with its
  reason and never as delivered; unreadable snapshots count as held watches, not
  all-clears. `tools/watcher-test.mjs` drives it with a stubbed network and clock (85
  checks) in CI — and caught a real bug while being written: `deliver()` posted to
  `undefined/<topic>` when a caller built a config without `ntfyServer`, now defaulted.
  Honest remainder at the time: browser-grade Web Push (VAPID + service worker) was not
  provided — that is the next batch below, and this line is left as written rather than
  quietly backdated.
- **The watcher is now deployable (work item 1's code half).** The recipes ship in
  [`deploy/`](deploy/) — a hardened systemd unit (non-root user, `Restart=always`, journal
  logging, environment file outside the unit), a Dockerfile plus compose file (unprivileged
  `node` user, read-only root, named volume for the state that prevents duplicate alerts) and
  a launchd plist — with a step-by-step [guide](docs/watcher-deployment.md) covering push
  channels, cron one-shots, where alerts appear and resource use. The container healthcheck is
  real: it reads the watcher's own state file, so a hung process is unhealthy while an upstream
  outage is deliberately *not* misreported as one — its header states plainly what it does and
  does not prove. `tools/watcher-deploy-test.mjs` keeps the recipes honest by checking them
  against the watcher's source: every `WATCHER_*` the code reads must be documented (it found
  `WATCHER_LOG_FILE` and `WATCHER_STATE_FILE` missing on its first run), no invented variables,
  no committed secrets (comments excluded), correct paths and restart policy, volume-backed
  state, and the healthcheck's exit codes **executed** rather than pattern-matched. What no
  recipe can give you is the host itself.
- **Phone alerts: real Web Push, end to end (work item 8, shipped).** The watcher could only
  reach a phone through ntfy or a webhook. Now it can send Web Push itself, with no third party
  able to read the alert content: [`tools/webpush.mjs`](tools/webpush.mjs) implements RFC 8291
  (aes128gcm encryption to the subscriber's `p256dh`, keyed by HKDF over the ECDH secret) and
  RFC 8292 (VAPID, ES256 JWT with the raw `r||s` signature JOSE requires) in one dependency-free
  file using Node's own crypto. It is not "implemented and assumed": `tools/webpush-test.mjs`
  (130 checks) reproduces RFC 8291 §5 / Appendix A *including every intermediate value* — the
  ECDH secret, `PRK_key`, IKM, PRK, CEK, the 12-octet nonce — and decrypts the RFC's 144-octet
  message with an independently written receiver path, then verifies RFC 8292 §2.4's published
  JWT with its published JWK. Writing it surfaced two things worth recording: the RFC's own
  `Content-Length: 145` disagrees with its decoded 144-octet body (the bytes are used, and the
  discrepancy is documented where a reader would hit it), and the plaintext limit is not
  folklore — 3993 = 4096 − 86 header − 1 delimiter − 16 tag, asserted as an exact arithmetic
  identity so a future edit cannot quietly shave the budget.
- **Things the tests caught, in the order they caught them.** (1) `Number(x) || fallback`
  silently treats an explicit `0` as absent — a real bug for `expiresIn: 0` and for epoch-zero
  clocks, now decided by `Number.isFinite` instead of truthiness; the same class of bug was
  fixed in the TTL clamp before it could ship a literal `TTL: NaN` header. (2) The record-size
  guard was unreachable as written and the delimiter byte was being counted against the
  *plaintext* limit (an off-by-one that would have refused a legal 3993-byte payload); the three
  budgets — plaintext, RFC 8188 record, whole request body — are now checked separately, so the
  error names the real culprit. (3) A test asserted a *ciphertext* slice equalled a published
  *plaintext* value; the assertion moved to the decryption path where it belongs. (4) The
  subscription store was written in place, so a kill mid-write could have silently emptied it —
  it is now written to a temporary file and renamed, and the rename is what reports success.
- **The watcher now sends it.** `deliverPush()` (in [`tools/watcher.mjs`](tools/watcher.mjs)) reads
  the store, encrypts per subscription, signs with the VAPID key, and reports **one result per
  device** (`delivered → push(phone): HTTP 201 · 1234 bytes` or `FAILED → push(phone): HTTP 410 …`)
  — never a blanket "sent". A subscription the push service reports gone (404/410) is removed
  from the store and the removal is logged. Two new settings (`WATCHER_VAPID_KEYS`,
  `WATCHER_PUSH_SUBSCRIPTIONS`, plus an optional `WATCHER_VAPID_SUBJECT`); configuring only one
  is a startup *warning*, because a half-configured channel otherwise looks exactly like a quiet
  one. The watcher test (85 → 120 checks) proves the wiring the only way that counts: it decrypts
  the bytes the watcher actually posted to the stub push service and asserts the plaintext is the
  alert text, using its own hand-rolled HKDF rather than the code under test. Delivery endpoints
  are masked in every log line — an endpoint is a capability URL, and logs get shared.
- **The site can now hand a device over.** The *Phone alerts* panel (`assets/js/push-alerts.js`,
  `assets/js/vapid-config.js`, and a caching-free `sw.js` that exists only to show the
  notification and open the game page) subscribes the device with the watcher's public key,
  shows the store entry, and says plainly that the page cannot reach the watcher — this is a
  static site, so the entry travels by copy/paste. `tools/push-alerts-test.mjs` (74 checks) drives
  every state with a stub browser and a stub document: insecure, unsupported, unconfigured,
  blocked, ready, subscribed, permission refused mid-prompt, subscribe throwing, clipboard
  refused (it falls back to selecting the text and *says* the copy was blocked). Reading the
  panel's state was found to register a service worker as a side effect — merely opening the page
  installed one — so lookups are now read-only and only the button creates anything.
- **A guard had to be made more exact rather than dropped.** "The monitor pages contain no manual
  input" is the brief's no-typing rule, and the phone panel legitimately adds a device-name box.
  The check now requires that it is the *only* editable control on those pages, that it is not
  inside a form, and that neither the rules engine nor either monitor controller reads it; the
  entry output is `readonly`. The rule that actually matters — nothing has to be typed for a
  situation to be caught — is still enforced.
- Deterministic suite totals *as of that session* (rule suite 11,765 · monitor 99 · strip 160 ·
  watcher 120 · deploy 112 · Web Push 130 · phone alerts 74 · site 345 · published-site 33 in a
  local dry run against `node server.mjs`); current totals are in limitation 6 above. CI runs
  the two new suites (vectors and panel) in the deterministic job.

**Session 3 — everyday-use: installable, operable, and re-verified against the live API (2026-09-29)**

- **Pass 1 — implement.** Shipped the three open work items that stand between this and a
  daily driver: (a) *installability* — `manifest.webmanifest`, generated icons and a shared
  notification vibration pattern across monitor, strip and service worker; (b) *watcher
  operations* — `--doctor`/`--check`, `--list-subscriptions`, `--prune-subscriptions`, and
  capped retry/backoff for transient push failures; (c) *wider alert context* — the
  in-the-hole hitter as "due up" on cards, events and exports. Every addition got tests in
  the same pass: `tools/icons-test.mjs` (153 checks, new), +37 watcher checks, +7 rule checks.
- **Pass 2 — bugs and edge cases found by re-reading the work.** The icon rasteriser's
  paint order swallowed the infield outline (the band test ran before the interior test, so
  the whole diamond came out one colour) — fixed and now pinned by pixel assertions; the
  icon test sampled pixels with a 512-only scale and read past the end of the 192px image —
  fixed to sample in unit space; `--doctor` first reported "no push channel" as a hard
  failure, which is a false negative for a legitimate stdout-only setup — now a notice that
  still prints; `tools/site-links-test.mjs` compared the documented suite size to its
  *mid-run* count, so its drift note fired on every run and meant nothing — moved to the end.
- **Pass 3 — re-check against the brief and against the live official feed.** Raw egress is
  still blocked here, but the session's page-fetch path reaches the API, so the three
  load-bearing claims were re-verified live rather than trusted: the dated schedule for
  2026-09-29, the exact `getAlertSnapshot` projection against live game 849849, and the same
  linescore unfiltered. That is where the `defense.*` upcoming-order quirk was caught and
  turned into a pinned test (a defensive `inHole` must never render as due up).
- **Observations and irregularities, stated only where reproducible.** (1) Two fetches of
  live game 849849 a few minutes apart showed the score advance 0–0 → 1–0 (White Sox) with a
  3-2 count in progress — a live confirmation that the official feed this project polls does
  update as the game moves, which is the assumption the 2-second cadence rests on. (2) Irregularity,
  confirmed twice and now pinned by a test: `linescore.defense.batter/onDeck/inHole` are the
  *fielding* team's next three hitters (with the White Sox batting, `defense.batter` was the
  Astros' shortstop), so due-up context must be read from `offense.*`; reading the defensive
  copy would name the wrong lineup. (3) Not an irregularity but checked and cleared: the
  slate's `leagueRecord` values reconcile with the results and statuses on the same response
  (Braves 1–0 after winning 849845; 0–0 for the unplayed and in-progress games), and empty
  bases arrive as *absent keys*, exactly as the occupancy check reads them. (4) Sandbox
  egress remains blocked, so the live smoke suite and a real phone round trip still have to
  be observed from a networked machine (limitations 6 and 7 above).
- Suite totals after this session: rule suite 11,772 · monitor 99 · strip 160 · watcher 159 ·
  deploy 112 · Web Push 130 · phone alerts 74 · installability 153 · site 347 · published-site
  40 in a local dry run against `node server.mjs`.

**Session 4 — live re-verification found the shipped watcher was blind; the discovery contract is fixed (2026-09-29)**

- **Pass 1 — review and live re-verification.** All deterministic suites re-run locally and
  green at session start (rule 11,772 · monitor 99 · strip 160 · watcher 159 · deploy 112 ·
  Web Push 130 · phone alerts 74 · site 347 · installability 153). The session's page-fetch
  path then re-checked every load-bearing external claim against the live official sources:
  today's Wild Card slate (4 games) via `sportId=1&date=2026-09-29`; the exact
  `getAlertSnapshot` projection against live game 849849 (status, linescore with count and
  outs, `offense`/`defense` occupants, empty bases as absent keys, and the `defense.*`
  upcoming-order quirk still present); the `hydrate=linescore` schedule; the
  `mlb.com/gameday/849845` redirect landing on the canonical Gameday page; the verbatim
  Rule 5.08(b) sentence at the cited rules site; the 2023 OBR PDF including the verbatim
  Rule 7.01(b) extra-innings amendment; the umpirebible mirror; the MiLB extra-innings
  article; and the MLB replay FAQ. All alive, all matching what this repository claims.
- **Pass 2 — the bug the tests could not see.** Comparing the watcher's stubbed tests with
  the real endpoint found that the watcher's discovery request used the **bare**
  `/schedule` URL, and the live bare response carries **no linescore at all** — while
  `scanTarget` reads `linescore.currentInning` to decide which games are late. A watcher
  started from this repository therefore targeted no games and could never have alerted.
  The 159-check suite stayed green because its stub answered the schedule with a fuller
  shape than the real endpoint returns: the tests verified a contract the endpoint never
  offered. This is the failure mode the brief names — a confident claim not grounded in the
  official source — and it is recorded here rather than quietly fixed. The fix:
  - `scheduleUrl()` now sends `hydrate=linescore`, verified live to return
    `linescore.currentInning` for live games while leaving `teams.*.team.name` intact.
    Anyone who deployed the watcher before this session should redeploy from this commit.
  - The suite's schedule stub now mirrors the slim real shape, and the suite pins the
    exact discovery URL, so the same class of drift fails the tests instead of shipping.
- **Second bug, fixed in the same pass:** `WATCHER_LATE_MS` was loaded and announced in the
  startup banner but never used — the loop slept the 15 s discovery cadence even while a
  situation was live. `runCycle` now reports `late`, the loop delays by
  `cycleDelayMs(summary, config)` (2 s while late), and the slate is cached between fast
  cycles so a fast cycle spends zero schedule requests — the same discovery/snapshot split
  the pages use, now shared in fact, not just in documentation.
- **Shipped alongside:** stale-state pruning (an episode drops when its game leaves the
  slate, so the state file stays the size of the slate instead of growing all season);
  `--doctor` now proves the very discovery URL the watch depends on instead of the bare
  endpoint; and the nightly live smoke job guards the `hydrate=linescore` contract against
  the live API — a live game that stops carrying `currentInning` fails CI with an
  annotation instead of silently blinding every watcher.
- **Pass 3 — re-check.** Full suite re-run after the fix: watcher 159 → 173 checks, every
  other suite unchanged and green; watcher counts quoted in `verification.html` (three
  places) and in limitation 6 updated to match; the watcher claims in
  `docs/bases-loaded-alerts.md` and `docs/watcher-deployment.md` re-read line by line and
  now describe what the code actually does. Sandbox raw egress remains blocked, so the
  nightly live smoke run stays the standing confirmation from a machine with normal egress.
- Suite totals after this session: rule suite 11,772 · monitor 99 · strip 160 · watcher 173 ·
  deploy 112 · Web Push 130 · phone alerts 74 · installability 153 · site 347.

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
│       ├── push-alerts.js            # phone-alerts panel: subscribe this device
│       ├── vapid-config.js           # the watcher's public key goes here
│       ├── ui.js                     # inherited shared UI helpers
│       ├── reviews.js / reviews-feed.js / scoreboard.js / props.js / game.js
│       └── …
├── sw.js                      # service worker: shows a Web Push notification, caches nothing
├── tools/                     # deterministic test suites (no packages, no network)
│   ├── watcher.mjs            # always-on watcher: same rules engine, no browser needed
│   └── webpush.mjs            # Web Push encryption (RFC 8291) + VAPID (RFC 8292)
├── deploy/                    # how to host the watcher: systemd · Docker · launchd · cron
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
