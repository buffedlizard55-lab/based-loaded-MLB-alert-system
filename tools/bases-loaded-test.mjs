#!/usr/bin/env node
/* node tools/bases-loaded-test.mjs — no dependencies or MLB network access. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import vm from "node:vm";
const require = createRequire(import.meta.url);
const rules = require("../assets/js/bases-loaded-core.js");
let checks = 0;
function check(value, expected, message) {
  assert.deepEqual(value, expected, message);
  checks++;
}
function game(overrides = {}) {
  return {
    gamePk: 123,
    status: { abstractGameState: "Live", detailedState: "In Progress" },
    teams: {
      away: { team: { name: "Visitors" } },
      home: { team: { name: "Home" } },
    },
    linescore: {
      currentInning: 9,
      inningState: "Bottom",
      isTopInning: false,
      outs: 1,
      teams: { away: { runs: 4 }, home: { runs: 4 } },
      offense: {
        first: { id: 1, fullName: "First Runner" },
        second: { id: 2, fullName: "Second Runner" },
        third: { id: 3, fullName: "Third Runner" },
      },
      ...overrides,
    },
  };
}
for (const inning of [9, 10, 11, 12, 13, 14, 18, 25, 100]) {
  for (const outs of [0, 1, 2])
    check(
      rules.evaluate(game({ currentInning: inning, outs })).loaded,
      true,
      `Bot ${inning}, ${outs} outs`,
    );
}
for (let mask = 0; mask < 8; mask++) {
  const offense = Object.fromEntries(
    ["first", "second", "third"].flatMap((base, i) =>
      mask & (1 << i) ? [[base, { id: i + 1 }]] : [],
    ),
  );
  check(
    rules.evaluate(game({ offense })).loaded,
    mask === 7,
    `base mask ${mask}`,
  );
}
for (const state of ["Top", "Middle", "End", "", null])
  check(
    rules.evaluate(game({ inningState: state })).loaded,
    false,
    `Never alert during ${state}`,
  );
for (const inning of [1, 7, 8, 9.5, null, undefined, "9"])
  check(
    rules.evaluate(game({ currentInning: inning })).loaded,
    false,
    `Not a valid ninth+ inning: ${inning}`,
  );
for (const outs of [3, null, undefined, -1, 1.5])
  check(
    rules.evaluate(game({ outs })).loaded,
    false,
    `Invalid/finished outs ${outs}`,
  );
for (const score of [undefined, null, "", NaN, "4", 5])
  check(
    rules.evaluate(
      game({ teams: { away: { runs: 4 }, home: { runs: score } } }),
    ).loaded,
    false,
    `No tie from ${score}`,
  );
check(
  rules.evaluate(game({ teams: { away: { runs: 0 }, home: { runs: 0 } } }))
    .loaded,
  true,
  "0–0 is a valid tie",
);
for (const state of ["Preview", "Final"]) {
  const g = game();
  g.status.abstractGameState = state;
  check(rules.evaluate(g).loaded, false, state);
}
for (const detailedState of [
  "Game Over",
  "Final",
  "Delayed",
  "Suspended",
  "Postponed",
  "Cancelled",
]) {
  const g = game();
  g.status.detailedState = detailedState;
  check(rules.evaluate(g).loaded, false, detailedState);
}
check(
  rules.evaluate({ ...game(), status: {} }).known,
  false,
  "Absent status is not an authoritative exit",
);
check(
  rules.evaluate(game({ isTopInning: true })).known,
  false,
  "Conflicting half-inning is unknown",
);
check(
  rules.evaluate(game({ isTopInning: true })).loaded,
  false,
  "Conflicting half-inning never alerts",
);
check(
  rules.evaluate(game({ inningState: "Middle", outs: 3 })).watching,
  true,
  "Watch at tied changeover, ignore leftover top runners",
);
check(
  rules.evaluate(game({ inningState: "Top", isTopInning: true, outs: 3 }))
    .watching,
  true,
  "Watch as third out lands in tied top 9",
);
check(
  rules.evaluate(game({ inningState: "Top", isTopInning: true, outs: 2 }))
    .watching,
  false,
  "Do not watch ongoing top half",
);
check(
  rules.evaluate(game({ inningState: "End", outs: 3 })).watching,
  false,
  "End of bottom is not next home half",
);
check(
  rules.evaluate(game({ currentInning: 8, inningState: "Middle", outs: 3 }))
    .watching,
  false,
  "Bottom eighth changeover excluded",
);
// The event description is intentionally irrelevant. All paths converge on occupancy.
for (const event of [
  "Single",
  "Double",
  "Walk",
  "Intent Walk",
  "Hit By Pitch",
  "Field Error",
  "Fielder’s Choice",
  "Catcher Interference",
  "Batter Interference",
  "Obstruction",
  "Dropped Third Strike",
  "Wild Pitch",
  "Passed Ball",
  "Stolen Base",
  "Balk",
  "Runner Placed",
  "Official Correction",
]) {
  const g = game();
  g.description = event;
  check(
    rules.observe(null, g, 1000).event?.inning,
    9,
    `Accept authoritative loaded state after ${event}`,
  );
  delete g.linescore.offense.third;
  check(
    rules.observe(null, g, 1000).event,
    null,
    `Do not infer loaded from ${event} alone`,
  );
}
// Exhaustive situation matrix: no inning cap, count requirement, or out preference.
for (let inning = 1; inning <= 30; inning++) {
  for (const inningState of ["Top", "Middle", "Bottom", "End"]) {
    for (let outs = 0; outs <= 3; outs++) {
      for (const home of [3, 4, 5]) {
        for (let mask = 0; mask < 8; mask++) {
          const offense = Object.fromEntries(
            ["first", "second", "third"].flatMap((base, i) =>
              mask & (1 << i) ? [[base, { id: i + 1 }]] : []),
          );
          const g = game({ currentInning: inning, inningState, outs, offense,
            isTopInning: inningState === "Top",
            teams: { away: { runs: 4 }, home: { runs: home } } });
          check(!!rules.observe(null, g, 1000).event,
            inning >= 9 && inningState === "Bottom" && outs < 3 && home === 4 && mask === 7,
            `${inningState} ${inning}, ${outs} outs, 4–${home}, occupancy ${mask}`);
        }
      }
    }
  }
}
let initial = rules.observe(null, game(), 1000);
for (const incomplete of [
  { offense: [] }, { offense: "unavailable" }, { offense: true },
  { offense: { first: { id: 1 }, second: { id: 1 }, third: { id: 3 } } },
  { outs: 4 }, { currentInning: 0 },
  { inningState: "Top", isTopInning: false, outs: 3 },
]) {
  const result = rules.observe(initial.state, game(incomplete), 1500);
  check(result.result.known, false, "Invalid official snapshot is unknown");
  check(result.result.watching, false, "Unknown snapshot is not a confirmed watch");
  check(result.result.loaded, false, "Unknown snapshot is not a confirmed alert");
  check(result.state, initial.state, "Invalid snapshot cannot re-arm episode");
  check(rules.observe(result.state, game(), 1600).event, null, "Recovery stays quiet");
}
for (const detailedState of ["Delayed", "Suspended"] ) {
  const paused = { ...game(), status: { abstractGameState: "Live", detailedState } };
  const observation = rules.observe(initial.state, paused, 1700);
  check(observation.result.loaded, false, "Paused play is not an active alert");
  check(observation.state, initial.state, "Pause preserves previous episode");
  check(rules.observe(observation.state, game(), 1800).event, null, "Resumption is not a reload");
}
// A loaded walk can tie the game without ever clearing the bases.
const trailing = rules.observe(null, game({ teams: { away: { runs: 4 }, home: { runs: 3 } } }), 100);
check(trailing.event, null, "Loaded but trailing never alerts");
check(!!rules.observe(trailing.state, game(), 200).event, true, "Tying run plus loaded bases alerts immediately");

check(!!initial.event, true, "Initial observation alerts");
check(
  rules.observe(initial.state, game(), 2000).event,
  null,
  "Repeated poll deduped",
);
const replacement = game();
replacement.linescore.offense.first = { id: 99, fullName: "Pinch Runner" };
check(
  rules.observe(initial.state, replacement, 2001).event,
  null,
  "Pinch runner does not retrigger continuous loaded situation",
);
const restored = JSON.parse(JSON.stringify(initial.state));
check(
  rules.observe(restored, game(), 3000).event,
  null,
  "Deduplication survives refresh",
);
const unknown = rules.observe(initial.state, game({ teams: {} }), 4000);
check(unknown.state, initial.state, "Incomplete score preserves dedup state");
check(
  rules.observe(unknown.state, game(), 5000).event,
  null,
  "Recovery from missing data does not re-alert",
);
const malformed = rules.observe(
  initial.state,
  game({ offense: { first: {}, second: { id: 2 }, third: { id: 3 } } }),
  5500,
);
check(
  malformed.state,
  initial.state,
  "Malformed runner object does not re-arm",
);
const cleared = rules.observe(
  initial.state,
  game({ offense: { second: { id: 2 }, third: { id: 3 } }, outs: 2 }),
  6000,
);
check(cleared.state.active, false, "Clear when base empties");
check(
  !!rules.observe(cleared.state, game({ outs: 2 }), 7000).event,
  true,
  "Reload in same inning retriggers",
);
check(
  !!rules.observe(initial.state, game({ currentInning: 10 }), 8000).event,
  true,
  "Next extra inning is new situation",
);
check(
  !!rules.observe(initial.state, { ...game(), gamePk: 456 }, 8000).event,
  true,
  "Game identity participates in dedup",
);
const winning = game({ teams: { away: { runs: 4 }, home: { runs: 5 } } });
check(
  rules.observe(initial.state, winning, 9000).state.active,
  false,
  "Walk-off lead clears even if runners remain",
);
check(initial.event.awayScore, 4, "History immutable");
check(
  initial.event.homeScore,
  4,
  "History keeps original tie, not final score",
);
const tieRestored = rules.observe(
  rules.observe(initial.state, winning, 9000).state,
  game(),
  9500,
);
check(
  !!tieRestored.event,
  true,
  "Official correction restoring exact condition alerts",
);
const feed = {
  gameData: { status: game().status },
  liveData: { linescore: game({ currentInning: 14 }).linescore },
};
check(
  rules.snapshotGame(game(), feed).linescore.currentInning,
  14,
  "Use one live snapshot, not stale schedule",
);
assert.throws(
  () => rules.snapshotGame(game(), { liveData: feed.liveData }),
  /Incomplete/,
);
checks++;
assert.throws(
  () =>
    rules.snapshotGame(game(), {
      gameData: { status: {} },
      liveData: feed.liveData,
    }),
  /Incomplete/,
);
checks++;
// The official current/last play travels with the snapshot (live feed shape:
// liveData.plays.currentPlay.result — verified against the StatsAPI), and
// evaluate prefers it over any linescore-attached result.
const playFeed = {
  gameData: { status: game().status },
  liveData: {
    linescore: game().linescore,
    plays: {
      currentPlay: {
        result: { event: "Intentional Walk", description: "Intentional walk." },
      },
    },
  },
};
const snap = rules.snapshotGame(game(), playFeed);
check(
  snap.lastPlay.event,
  "Intentional Walk",
  "Snapshot carries the official current play result",
);
check(
  rules.evaluate(snap).lastEvent,
  "Intentional Walk",
  "Evaluate reads the projected play result",
);
check(
  rules.evaluate({
    ...game(),
    lastPlay: { event: "Error" },
    linescore: {
      ...game().linescore,
      currentPlay: { result: { event: "Walk" } },
    },
  }).lastEvent,
  "Error",
  "Snapshot lastPlay wins over linescore-attached results",
);
check(
  rules.evaluate({
    ...game(),
    linescore: {
      ...game().linescore,
      currentPlay: { result: { event: "Walk" } },
    },
  }).lastEvent,
  "Walk",
  "Synthetic linescore-attached result still works as a fallback",
);
check(
  rules.evaluate(game()).lastPlay === undefined &&
    rules.evaluate(game()).lastEvent === null,
  true,
  "No play context stays null, never invented",
);
check(
  rules.snapshotGame(game(), {
    gameData: { status: game().status },
    liveData: { linescore: game().linescore },
  }).lastPlay,
  null,
  "A feed without plays leaves lastPlay null",
);

// Cross-page quiet window: only OTHER observers suppress; this page's own
// earlier episode never silences a confirmed exit + reload.
const quietEntry = (observer) => ({
  id: `123:9:${observer}`,
  gamePk: 123,
  inning: 9,
  observedAt: 1_000_000,
  observer,
});
check(
  rules.recentSharedAlert([quietEntry("strip")], 123, 9, 1_050_000, 90000, "monitor"),
  true,
  "Another page's recent alert suppresses this page's chime",
);
check(
  rules.recentSharedAlert([quietEntry("monitor")], 123, 9, 1_050_000, 90000, "monitor"),
  false,
  "This page's own earlier alert never suppresses its reload",
);
check(
  rules.recentSharedAlert([quietEntry("strip")], 123, 9, 1_050_000, 90000, "strip"),
  false,
  "Matching observer is recognized in either direction",
);
check(
  rules.recentSharedAlert([quietEntry(undefined)], 123, 9, 1_050_000, 90000, "monitor"),
  true,
  "Legacy entries without an observer still suppress",
);
check(
  rules.recentSharedAlert([quietEntry("strip")], 123, 10, 1_050_000, 90000, "monitor"),
  false,
  "A new inning is never suppressed, own or shared",
);

check(
  rules.scheduleDates(new Date("2026-09-29T02:00:00Z")),
  ["2026-09-28", "2026-09-27"],
  "UTC rollover does not advance MLB date",
);
check(
  rules.scheduleDates(new Date("2026-09-29T06:00:00Z")),
  ["2026-09-29", "2026-09-28"],
  "Yesterday retained after Eastern midnight",
);
check(
  rules.scheduleDates(new Date("2026-03-09T05:00:00Z")),
  ["2026-03-09", "2026-03-08"],
  "DST calendar subtraction",
);
// Verify the actual API wrapper requests a lean, coherent status + linescore feed.
let requested;
const apiContext = vm.createContext({
  fetch: async (url) => {
    requested = url;
    return { ok: true, json: async () => feed };
  },
  AbortController,
  setTimeout,
  clearTimeout,
  console,
});
vm.runInContext(
  readFileSync(new URL("../assets/js/api.js", import.meta.url), "utf8") +
    "\nglobalThis.api=MLB;",
  apiContext,
);
await apiContext.api.getAlertSnapshot(123);
check(
  requested.includes("/api/v1.1/game/123/feed/live?fields="),
  true,
  "Snapshot uses shared rate-limited client",
);
for (const field of [
  "status",
  "abstractGameState",
  "linescore",
  "currentInning",
  "inningState",
  "isTopInning",
  "outs",
  "runs",
  "offense",
  "defense",
  "first",
  "second",
  "third",
  "id",
  "fullName",
  "balls",
  "strikes",
  "batter",
  "pitcher",
  "plays",
  "currentPlay",
]) {
  check(
    new URL(requested).searchParams.get("fields").split(",").includes(field),
    true,
    `Projection includes ${field}`,
  );
}
check(
  readFileSync(new URL("../index.html", import.meta.url), "utf8"),
  readFileSync(new URL("../bases-loaded.html", import.meta.url), "utf8"),
  "Both alert entrypoints stay identical",
);
console.log(`✓ ${checks} bases-loaded rule/API checks passed`);
