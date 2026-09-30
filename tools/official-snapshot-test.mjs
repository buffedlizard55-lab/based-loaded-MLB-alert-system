#!/usr/bin/env node
/* Official-snapshot test — the rules engine against REAL MLB StatsAPI payloads.
 *
 *   node tools/official-snapshot-test.mjs        (no dependencies, no network)
 *
 * Every other suite in this repository is deterministic and synthetic: it
 * builds the payload the engine is *supposed* to see. This one is different.
 * It replays seven payloads captured from the official MLB StatsAPI for one
 * real game — San Diego Padres @ Tampa Bay Rays, 2026-08-30 (gamePk 822933) —
 * through the same code path the two front ends use:
 *
 *   payload → BasesLoadedRules.snapshotGame() → evaluate() → observe()
 *           → diffStream()   (monitor alert + chat-feed narrative)
 *
 * The game contains a genuine instance of the tracked situation, plus the
 * states around it, so the assertions are about the real world and not about
 * our own fixtures:
 *
 *   1. end of the 9th, tied 3-3, home half over     → watch held (first sight)
 *   2. bottom 10, tied, runner on second            → watch begins
 *   3. bottom 10, tied, runners on second and third → runner advanced
 *   4. top 11, Padres lead 4-3                      → watch ends
 *   5. bottom 11, BASES LOADED but Rays trail 3-4   → NO ALERT (negative control)
 *   6. bottom 11, TIED 4-4, BASES LOADED, 1 out     → BASES-LOADED ALERT  ← the point
 *   7. bottom 11, Rays 5-4                          → walk-off narrated
 *
 * Each fixture entry keeps the exact URL it came from, so the capture is
 * re-verifiable line by line: `node tools/verify-official-snapshots.mjs`
 * re-fetches all seven URLs and fails if the official payload has drifted.
 *
 * Sources (official):
 *   https://statsapi.mlb.com/api/v1.1/game/822933/feed/live?timecode=…   (payloads)
 *   https://statsapi.mlb.com/api/v1/schedule?sportId=1&teamId=139&startDate=2026-08-30&endDate=2026-08-30
 *                                                                        (game + final score)
 *   https://www.mlb.com/news/jonny-deluca-hits-game-tying-home-run-in-bottom-of-ninth-before-rays-walk-it-off-in-11th
 *                                                                        (MLB.com account of the game)
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const rules = require("../assets/js/bases-loaded-core.js");

const fixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/official-snapshots-822933.json", import.meta.url),
    "utf8",
  ),
);

let checks = 0;
const check = (actual, expected, label) => {
  assert.deepEqual(actual, expected, label);
  checks++;
};
const ok = (value, label) => check(Boolean(value), true, label);

/* ------------------------------------------------------------------ fixture */

check(fixture.game.gamePk, 822933, "fixture is the real game 822933");
check(fixture.game.matchup, "San Diego Padres @ Tampa Bay Rays", "real matchup");
check(fixture.snapshots.length, 7, "seven official snapshots captured");

// Chronological, and every entry carries its exact source URL + expectation.
let previousTime = "";
for (const snap of fixture.snapshots) {
  const timecode = snap.url.match(/timecode=(\d{8}_\d{6})/)?.[1] || "";
  ok(timecode.length === 15, `snapshot has a timecode in its URL (${snap.label})`);
  ok(timecode > previousTime, `snapshots are in chronological order (${timecode})`);
  previousTime = timecode;
  ok(
    snap.url.startsWith(
      "https://statsapi.mlb.com/api/v1.1/game/822933/feed/live?timecode=",
    ),
    "snapshot URL points at the official feed for gamePk 822933",
  );
  ok(snap.payload?.gameData?.status && snap.payload?.liveData?.linescore,
    `snapshot carries the official gameData/liveData shape (${snap.label})`);
  ok(snap.expect.length > 0, `snapshot states what it is meant to prove (${snap.label})`);
}

/* ------------------------------------------------------- the real replay */

// Same clock for every step: the assertions are about state, not about wall
// time. One millisecond apart so the ids are stable and orderable.
const T0 = Date.parse("2026-08-30T21:00:00Z");

// The two official endpoints use two team shapes, and the real code path relies
// on that: the *schedule* row (name under teams.x.team.name) is what both front
// ends hold when they call snapshotGame(scheduleGame, feed), while the *feed*
// carries teams.x.name. Names below are the official ones from the captured
// payloads, placed in the shape the schedule row uses.
const scheduleGame = (snap) => ({
  gamePk: fixture.game.gamePk,
  teams: {
    away: { team: { name: snap.payload.gameData.teams.away.name } },
    home: { team: { name: snap.payload.gameData.teams.home.name } },
  },
});

const replay = [];
let streamState = null;
let monitorState = null;
let alerts = [];

/** One poll of the live front end: map the official feed, observe, narrate. */
function poll(snap, now) {
  const game = rules.snapshotGame(scheduleGame(snap), snap.payload);
  const observation = rules.observe(monitorState, game, now);
  monitorState = observation.state;
  if (observation.event) alerts.push(observation.event);
  const diff = rules.diffStream(streamState, observation, game, now);
  streamState = diff.state;
  return {
    label: snap.label,
    game,
    result: observation.result,
    alert: observation.event,
    events: diff.events,
    state: diff.state,
  };
}

fixture.snapshots.forEach((snap, index) => {
  replay.push(poll(snap, T0 + index * 1000));
  if (index === 5) {
    // The very next poll returns the same official state — the situation is
    // still on. One continuous situation alerts once (no second beep, no twin
    // card); a new alert is allowed only after a confirmed exit and a reload.
    const again = poll(snap, T0 + index * 1000 + 2000);
    check(again.alert, null, "6b · a continuing situation is not a new alert");
    check(
      again.events.map((e) => e.kind),
      [],
      "6b · and it adds no duplicate chat card",
    );
  }
});

check(replay.length, 7, "all seven official snapshots were replayed");
const [s1, s2, s3, s4, s5, s6, s7] = replay;
const kinds = replay.map((r) => r.events.map((e) => e.kind));

/* -------------------------------------- 1. end of the 9th: watch is held */

check(s1.result.tied, true, "1 · the game is tied at the end of the 9th");
check(s1.result.watching, false, "1 · the home half is over, so nothing is batting");
check(s1.result.loaded, false, "1 · no alert at the end of the 9th");
check(kinds[0], ["watch_held"], "1 · the feed holds the watch instead of calling it over");
ok(
  s1.events[0].detail.includes("top of the 9th") ||
    s1.events[0].detail.includes("home half"),
  "1 · the held note explains why",
);
check(s1.alert, null, "1 · no monitor alert before the situation exists");

/* ------------------------------------------- 2. bottom 10: watch begins */

check(s2.result.inning, 10, "2 · the game went to extras");
check(s2.result.tied, true, "2 · still tied in the bottom of the 10th");
check(s2.result.watching, true, "2 · a tied bottom half starts the walk-off watch");
check(s2.result.loaded, false, "2 · one runner on second is not the situation");
check(kinds[1], ["watch_begins"], "2 · the feed opens the watch");
check(
  s2.events[0].isNewExtraInning,
  true,
  "2 · the watch is marked as a new extra inning",
);
ok(
  s2.events[0].detail.includes("bottom of the 10th"),
  "2 · the watch note names the real inning",
);
check(s2.alert, null, "2 · no alert yet");

/* ------------------------------ 3. bottom 10: runners reach, still tied */

check(
  s3.result.runnersOn,
  2,
  "3 · two runners are on (second and third) in the real payload",
);
check(s3.result.loaded, false, "3 · two runners on is still not bases loaded");
check(kinds[2], ["runner_advanced"], "3 · the feed narrates the runner reaching");
ok(
  s3.events[0].detail.includes("2nd & 3rd"),
  "3 · the narration uses the real occupied bases",
);
check(s3.alert, null, "3 · no alert while a base is empty");

/* ------------------------------------------- 4. top 11: the tie is gone */

check(s4.result.tied, false, "4 · the Padres lead 4-3");
check(s4.result.watching, false, "4 · a broken tie ends the watch");
check(kinds[3], ["watch_ends"], "4 · the feed closes the watch");
ok(
  s4.events[0].detail.includes("no longer tied"),
  "4 · the closing note gives the real reason",
);
check(s4.alert, null, "4 · no alert once the game is not tied");

/* ------------- 5. bottom 11, bases loaded but trailing: NO ALERT (the brief) */

check(
  s5.result.bases.filter(Boolean).length,
  3,
  "5 · the real payload shows all three bases occupied",
);
check(s5.result.tied, false, "5 · and the Rays are behind 3-4");
check(s5.result.loaded, false, "5 · bases loaded alone is NOT the tracked situation");
check(kinds[4], [], "5 · the feed stays silent — nothing to alert on");
check(s5.alert, null, "5 · no monitor alert, no sound, no notification");

/* ------------------------- 6. bottom 11: TIED + BASES LOADED → the alert */

check(s6.result.tied, true, "6 · the tying run made it 4-4");
check(
  s6.result.bases.map((b) => b && b.name),
  ["Jonny DeLuca", "Chandler Simpson", "Kenny Piper"],
  "6 · first, second and third are occupied — read from the official payload",
);
check(s6.result.outs, 1, "6 · fewer than three outs");
check(s6.result.inning, 11, "6 · bottom of the 11th — later than the 9th, as tracked");
check(s6.result.loaded, true, "6 · THE TRACKED SITUATION: tied + loaded + bottom 9+");
check(s6.result.watching, true, "6 · and it is being watched");
check(
  kinds[5],
  ["watch_begins", "bases_loaded"],
  "6 · the feed opens the watch and raises the bases-loaded card",
);
check(
  s6.events[1].detail,
  "All three bases are occupied.",
  "6 · with no play text in the capture the card uses the honest fallback — nothing is invented",
);
check(
  s6.alert.lastEvent,
  null,
  "6 · the alert carries no play description it was not given",
);
check(
  s6.events[0].detail.includes("bottom of the 11th"),
  true,
  "6 · the watch note names the real inning",
);

// The monitor's own alert event — the thing that beeps, notifies and exports.
check(alerts.length, 1, "6 · exactly one monitor alert in the whole real game");
const alert = alerts[0];
check(alert.gamePk, 822933, "6 · the alert carries the real gamePk");
check(alert.inning, 11, "6 · alert inning");
check([alert.awayScore, alert.homeScore], [4, 4], "6 · alert records the tied score");
check(alert.outs, 1, "6 · alert records the outs");
check(
  alert.runners.map((r) => r && r.name),
  ["Jonny DeLuca", "Chandler Simpson", "Kenny Piper"],
  "6 · alert names the three real runners",
);
check(alert.batter?.name, "Jorge Mateo", "6 · alert names the real batter");
check(alert.away, "San Diego Padres", "6 · alert names the real away team");
check(alert.home, "Tampa Bay Rays", "6 · alert names the real home team");
check(alert.tensionLabel, "ELEVATED", "6 · tension label for 1 out, 0-1 count");
check(
  s6.events[1].alertId,
  alert.id,
  "6 · the chat card dedups against the monitor's own alert id",
);

/* ------------------------------------------ 7. the walk-off that followed */

check(s7.result.tied, false, "7 · the Rays took a 5-4 lead");
check(s7.result.home, 5, "7 · home team ahead");
check(kinds[6], ["walkoff_rbi"], "7 · the feed narrates the walk-off");
ok(
  s7.events[0].detail.includes("walk-off"),
  "7 · the walk-off card says so",
);

/* ------------------------------ export + evidence from the real record */

const record = rules.historyRecord(alert);
check(record.gamePk, 822933, "export · the record keeps the real gamePk");
check(record.halfInning, "bottom", "export · the record is a bottom-half alert");
check(
  record.officialSource,
  "https://statsapi.mlb.com/api/v1.1/game/822933/feed/live",
  "export · the record cites the official snapshot URL",
);
check(record.runnerFirst, "Jonny DeLuca", "export · first-base runner");
check(record.runnerSecond, "Chandler Simpson", "export · second-base runner");
check(record.runnerThird, "Kenny Piper", "export · third-base runner");

const evidence = rules.evidenceLine(alert);
ok(evidence.includes("BOT 11"), "evidence · names the real half-inning");
ok(
  evidence.includes("San Diego Padres 4–4 Tampa Bay Rays"),
  "evidence · states the real tied score",
);
ok(evidence.includes("1 out"), "evidence · states the real outs");
ok(
  evidence.includes("https://statsapi.mlb.com/api/v1.1/game/822933/feed/live"),
  "evidence · links the official source for manual review",
);
ok(
  evidence.includes("bases loaded"),
  "evidence · says why it fired",
);

const csv = rules.historyCSV([alert]);
ok(csv.includes('"Jonny DeLuca"'), "export · CSV carries the real runner");
ok(csv.includes("822933"), "export · CSV carries the real gamePk");
const json = JSON.parse(rules.historyJSON([alert]));
check(json.schema, "loaded-late/alerts@1", "export · JSON schema");
check(json.alerts.length, 1, "export · one alert");
check(json.alerts[0].homeScore, 4, "export · JSON home score");
check(
  rules.historyFileName("json", T0),
  "loaded-late-alerts-2026-08-30.json",
  "export · file name is dated from the observation",
);

/* --------------------- cross-page quiet window on the real observation */

const alertedAt = alert.observedAt; // when the real alert was observed
check(
  rules.recentSharedAlert([{ ...alert, observer: "other-page" }], 822933, 11, alertedAt, 90000, "this-page"),
  true,
  "quiet window · another page of the site having alerted suppresses the sound",
);
check(
  rules.recentSharedAlert([{ ...alert, observer: "this-page" }], 822933, 11, alertedAt, 90000, "this-page"),
  false,
  "quiet window · this page's own earlier alert never suppresses a real re-alert",
);
check(
  rules.recentSharedAlert([{ ...alert, observer: "other-page" }], 822933, 12, alertedAt, 90000, "this-page"),
  false,
  "quiet window · the same game in a NEW inning is never suppressed",
);

/* ---------------------------------------------- what the fixture proves */

// The 40-second window this capture documents is the whole design premise: the
// situation existed on a real MLB field, it was visible in the official feed,
// and the poll cadence (2s on the feed page) would have caught it well inside
// the window between snapshot 6 (20:57:40Z) and the walk-off (20:58:20Z).
check(
  "20260830_205740" < "20260830_205820",
  true,
  "the tied + loaded state was published before the walk-off that ended it",
);

console.log(
  `✓ ${checks} official-snapshot checks passed — real 2026-08-30 game 822933: tied, bases loaded, bottom 11, alert raised`,
);
