/* Pure rules shared by the browser and deterministic tests. No event-name whitelist.
 * Enhanced: tracks count, batter/pitcher, tension level, and base-loading path.
 *
 * Shared by two front ends, which is why the polling decisions live here too:
 *   - bases-loaded.js       — the full monitor page (index.html / bases-loaded.html)
 *   - bases-loaded-strip.js — the site-wide strip on scoreboard / replay feed / game
 * Keeping one implementation means the strip and the dashboard can never disagree
 * about what counts as the situation or about which game to poll next.
 */
"use strict";
const BasesLoadedRules = (() => {
  const number = (value) =>
    typeof value === "number" && Number.isInteger(value) && value >= 0
      ? value
      : null;

  function isLive(status) {
    return (
      status?.abstractGameState === "Live" &&
      !/delay|suspend|postpon|cancel|final|game over/i.test(
        status.detailedState || "",
      )
    );
  }

  /**
   * A live game whose play is stopped (rain delay, suspension). It is neither
   * an active situation nor an all-clear: `observe` holds the episode so that
   * resuming cannot create a duplicate, and both front ends label the pause
   * instead of silently dropping the game from the page.
   */
  function isPaused(status) {
    return (
      status?.abstractGameState === "Live" &&
      /delay|suspend/i.test(status?.detailedState || "")
    );
  }

  /**
   * Tension level calculation.
   * In a tied, bases-loaded, bottom 9+ situation, tension rises with:
   * - More outs (2 outs = last chance)
   * - Fuller counts (3-2 = one pitch decides it)
   * Returns 0-5 scale: 0=low, 5=maximum tension.
   */
  function calculateTension(outs, balls, strikes) {
    let tension = 0;
    // Outs: 0 outs = +1, 1 out = +2, 2 outs = +3
    if (outs === 2) tension += 3;
    else if (outs === 1) tension += 2;
    else if (outs === 0) tension += 1;
    // Count: full count (3-2) = +2, 2-strike or 3-ball = +1
    if (balls === 3 && strikes === 2) tension += 2;
    else if (strikes === 2 || balls === 3) tension += 1;
    return Math.min(tension, 5);
  }

  function tensionLabel(level) {
    if (level >= 5) return "MAXIMUM";
    if (level >= 4) return "EXTREME";
    if (level >= 3) return "HIGH";
    if (level >= 2) return "ELEVATED";
    if (level >= 1) return "RISING";
    return "BASELINE";
  }

  function evaluate(game) {
    const ls = game.linescore || {};
    const inning = number(ls.currentInning);
    const away = number(ls.teams?.away?.runs),
      home = number(ls.teams?.home?.runs);
    const outs = number(ls.outs);
    const bases = ["first", "second", "third"].map((base) => {
      const runner = ls.offense?.[base];
      return number(runner?.id) > 0
        ? { id: runner.id, name: runner.fullName || "Runner" }
        : null;
    });
    const state = String(ls.inningState || "").toLowerCase();
    const bottom = state === "bottom" && ls.isTopInning !== true;
    const entering =
      state === "middle" ||
      (state === "top" && ls.isTopInning !== false && outs === 3);
    const tied = away !== null && home !== null && away === home;
    const eligible =
      isLive(game.status) && inning !== null && inning >= 9 && tied;

    // Count
    const balls = number(ls.balls);
    const strikes = number(ls.strikes);

    // Current batter and pitcher
    const batter = ls.offense?.batter?.id
      ? { id: ls.offense.batter.id, name: ls.offense.batter.fullName || "Batter" }
      : null;
    const pitcher = ls.defense?.pitcher?.id
      ? { id: ls.defense.pitcher.id, name: ls.defense.pitcher.fullName || "Pitcher" }
      : null;
    const onDeck = ls.offense?.onDeck?.id
      ? { id: ls.offense.onDeck.id, name: ls.offense.onDeck.fullName || "On Deck" }
      : null;

    // Current play description. The live projection carries the official
    // result under liveData.plays.currentPlay (verified against the StatsAPI);
    // demo/synthetic feeds attach the same result object to the linescore.
    const playResult = game.lastPlay || ls.currentPlay?.result || null;
    const currentPlay = playResult?.description || null;
    const lastEvent = playResult?.event || null;

    // An incomplete live snapshot must not re-arm a previously active alert.
    const offenseKnown =
      ls.offense !== null &&
      typeof ls.offense === "object" &&
      !Array.isArray(ls.offense);
    const occupiedIds = bases.filter(Boolean).map((runner) => runner.id);
    const occupancyKnown =
      offenseKnown &&
      new Set(occupiedIds).size === occupiedIds.length &&
      ["first", "second", "third"].every(
        (base) => ls.offense[base] == null || number(ls.offense[base].id) > 0,
      );
    const statusKnown = ["Live", "Final", "Preview"].includes(
      game.status?.abstractGameState,
    );
    const known =
      statusKnown &&
      (!isLive(game.status) ||
        (inning !== null &&
          inning >= 1 &&
          away !== null &&
          home !== null &&
          outs !== null &&
          outs <= 3 &&
          ["top", "middle", "bottom", "end"].includes(state) &&
          !(state === "bottom" && ls.isTopInning === true) &&
          !(state === "top" && ls.isTopInning === false) &&
          occupancyKnown));

    // Unknown data must never appear as a confirmed watch/alert. Three outs can
    // leave runners in the feed, but there is no longer a live threat.
    const watching =
      known && eligible &&
      (entering || (bottom && outs !== null && outs < 3));
    const loaded = watching && bottom && outs < 3 && bases.every(Boolean);

    // Tension level (only meaningful when loaded or watching with runners on)
    const tension = loaded
      ? calculateTension(outs, balls, strikes)
      : watching
        ? Math.max(0, calculateTension(outs, balls, strikes) - 1)
        : 0;

    // Number of runners on base (for watch display)
    const runnersOn = bases.filter(Boolean).length;

    return {
      inning,
      away,
      home,
      outs,
      balls,
      strikes,
      bases,
      tied,
      entering,
      watching,
      loaded,
      known,
      batter,
      pitcher,
      onDeck,
      currentPlay,
      lastEvent,
      runnersOn,
      tension,
      tensionLabel: tensionLabel(tension),
      phase: loaded ? "loaded" : watching ? "watching" : "other",
    };
  }

  /**
   * Which live game deserves its own live snapshot this cycle.
   *
   * Inning 9+ covers every case we alert on: the changeover out of a tied top
   * half (`Middle`, or a third out still reported as `Top`) and every later
   * bottom half without an upper bound. A game the monitor already has on watch
   * stays a target even if the published inning momentarily regresses, so a
   * feed hiccup cannot silently drop an active situation. Early-inning games
   * are never polled individually at all.
   */
  function scanTarget(game, state) {
    if (game?.status?.abstractGameState !== "Live") return false;
    return number(game?.linescore?.currentInning) >= 9 || state?.active === true;
  }

  /**
   * Loop pacing, in milliseconds, shared by both front ends.
   *
   * Nothing is late yet: we only pay for schedule discovery (`slow`). As soon as
   * any live game reaches inning 9 (or a watch is already active) the loop
   * tightens to `fast`, because a tied, loaded situation can appear on the very
   * next pitch. Accepts a Map (the controllers keep games in one) or an array.
   */
  function pollCadence(games, states, { fast = 5000, slow = 30000 } = {}) {
    const list =
      games instanceof Map
        ? [...games.values()]
        : Array.isArray(games)
          ? games
          : [];
    const late = list.some(
      (game) => scanTarget(game, states?.[game.gamePk]) === true,
    );
    return late ? fast : slow;
  }

  /**
   * Cross-page quiet window.
   *
   * The monitor page and the site-wide strip share one alert log, so a
   * continuous situation can be observed twice in the same browser (two tabs,
   * or a page switch). If this exact game + inning was already logged inside
   * the quiet window, the second observation is recorded but must not beep or
   * raise another desktop notice. Same game in a *new* inning is a new
   * situation and is never suppressed.
   *
   * `observerId` identifies the page instance recording the observation.
   * Entries this same page wrote are never counted: its own dedup state
   * (`observe`'s `continuing` flag) already governs continuity, so a
   * confirmed exit and reload inside the quiet window must still alert again
   * — exactly as a single page always has. Only *other* observers (the other
   * page of the site, or another tab) can suppress the sound.
   */
  function recentSharedAlert(
    history,
    gamePk,
    inning,
    now = Date.now(),
    windowMs = 90000,
    observerId = null,
  ) {
    const target = number(inning);
    if (!Array.isArray(history) || target === null) return false;
    return history.some((entry) => {
      if (!entry || entry.gamePk !== gamePk || entry.inning !== target)
        return false;
      if (observerId != null && entry.observer === observerId) return false;
      const age = now - entry.observedAt;
      return Number.isFinite(entry.observedAt) && age >= 0 && age < windowMs;
    });
  }

  /** "2nd & 3rd" / "Loaded" / "Bases empty" — labels only, never invented occupancy. */
  function occupancyLabel(bases, loadedWord = "Loaded") {
    const order = ["1st", "2nd", "3rd"];
    const occupied = order.filter((_, index) => !!bases?.[index]);
    if (!occupied.length) return "Bases empty";
    if (occupied.length === 3) return loadedWord;
    return occupied.join(" & ");
  }

  function snapshotGame(scheduleGame, feed) {
    // Never fall back to stale schedule bases/status if the live payload is incomplete.
    if (
      !["Live", "Final", "Preview"].includes(
        feed?.gameData?.status?.abstractGameState,
      ) ||
      !feed?.liveData?.linescore
    )
      throw new Error("Incomplete live snapshot");
    return {
      ...scheduleGame,
      status: feed.gameData.status,
      linescore: feed.liveData.linescore,
      // Official result of the current/last play, when the projection exposes
      // it. Never inferred: absent plays.currentPlay stays null.
      lastPlay: feed.liveData?.plays?.currentPlay?.result || null,
    };
  }

  function observe(previous, game, now = Date.now()) {
    const result = evaluate(game);
    const inningKey = `${game.gamePk}:${result.inning}`;
    // A rain delay/suspension pauses play; it does not prove the bases cleared.
    // Keep the episode armed as before so resumption does not create a duplicate.
    const paused =
      game.status?.abstractGameState === "Live" &&
      /delay|suspend/i.test(game.status?.detailedState || "");
    if (!result.known || paused) return { state: previous, event: null, result };
    const continuing = previous?.active && previous.inningKey === inningKey;
    const serial = previous?.serial || 0;
    const event =
      result.loaded && !continuing
        ? {
            id: `${inningKey}:${now}:${serial + 1}`,
            gamePk: game.gamePk,
            inning: result.inning,
            awayScore: result.away,
            homeScore: result.home,
            outs: result.outs,
            balls: result.balls,
            strikes: result.strikes,
            runners: result.bases,
            batter: result.batter,
            pitcher: result.pitcher,
            onDeck: result.onDeck,
            tension: result.tension,
            tensionLabel: result.tensionLabel,
            lastEvent: result.lastEvent,
            away: game.teams?.away?.team?.name || "Away",
            home: game.teams?.home?.team?.name || "Home",
            observedAt: now,
          }
        : null;
    return {
      result,
      event,
      state: {
        inningKey,
        active: result.loaded,
        serial: serial + (event ? 1 : 0),
        observedAt: now,
      },
    };
  }

  function scheduleDates(now = new Date()) {
    // MLB calendar, not UTC: include yesterday for games continuing after midnight.
    const format = (date) =>
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/New_York",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(date);
    const today = format(now);
    // Calendar subtraction at noon avoids DST midnight edge cases.
    return [
      today,
      new Date(Date.parse(`${today}T12:00:00Z`) - 86400000)
        .toISOString()
        .slice(0, 10),
    ];
  }

  /* ------------------------------------------------------------------------
   * Alert-history export (pure).
   *
   * The monitor records every situation it observes. These functions turn
   * those records into a file a person can keep, diff or hand to a reviewer,
   * and into one line they can paste into a message — without touching the
   * DOM, so the exact bytes are covered by tools/bases-loaded-test.mjs.
   * --------------------------------------------------------------------- */

  const historyColumns = [
    "observedAt",
    "observedAtIso",
    "gamePk",
    "away",
    "home",
    "awayScore",
    "homeScore",
    "inning",
    "halfInning",
    "outs",
    "balls",
    "strikes",
    "tension",
    "tensionLabel",
    "loadedOnEvent",
    "runnerFirst",
    "runnerSecond",
    "runnerThird",
    "batter",
    "pitcher",
    "onDeck",
    "officialSource",
    "gameUrl",
  ];

  const officialFeed = (gamePk) =>
    `https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live`;
  const localGameUrl = (gamePk) => `game.html?gamePk=${gamePk}`;
  const personName = (value) =>
    typeof value === "string" ? value : value?.name || value?.fullName || "";
  const asText = (value) => (value == null ? "" : String(value));

  /**
   * One flat record per alert. Every value is read from the record the monitor
   * saved when it observed the situation; the only derived fields are
   * `halfInning`, which is what this alert *is* (the system only ever alerts in
   * a bottom half), and the two source links, which are built from the gamePk.
   * Nothing is inferred about the play itself.
   */
  function historyRecord(entry, link = localGameUrl) {
    const runners = Array.isArray(entry?.runners) ? entry.runners : [];
    const pk = number(entry?.gamePk);
    const observedAt = Number.isFinite(entry?.observedAt) ? entry.observedAt : null;
    return {
      observedAt,
      observedAtIso: observedAt === null ? "" : new Date(observedAt).toISOString(),
      gamePk: pk,
      away: asText(entry?.away),
      home: asText(entry?.home),
      awayScore: number(entry?.awayScore),
      homeScore: number(entry?.homeScore),
      inning: number(entry?.inning),
      halfInning: "bottom",
      outs: number(entry?.outs),
      balls: number(entry?.balls),
      strikes: number(entry?.strikes),
      tension: number(entry?.tension),
      tensionLabel: asText(entry?.tensionLabel),
      loadedOnEvent: asText(entry?.lastEvent),
      runnerFirst: personName(runners[0]),
      runnerSecond: personName(runners[1]),
      runnerThird: personName(runners[2]),
      batter: personName(entry?.batter),
      pitcher: personName(entry?.pitcher),
      onDeck: personName(entry?.onDeck),
      officialSource: pk === null ? "" : officialFeed(pk),
      gameUrl: pk === null ? "" : link(pk),
    };
  }

  /** CSV cell: numbers bare, strings quoted (RFC 4180), empty for nothing. */
  function csvCell(value) {
    if (value === null || value === undefined || value === "") return "";
    if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
    return `"${String(value).replace(/"/g, '""')}"`;
  }

  /** RFC 4180 export: CRLF line endings, doubled quotes, one row per alert. */
  function historyCSV(entries = [], link = localGameUrl) {
    const rows = [...entries].map((entry) => {
      const record = historyRecord(entry, link);
      return historyColumns.map((column) => csvCell(record[column])).join(",");
    });
    return `${[historyColumns.join(","), ...rows].join("\r\n")}\r\n`;
  }

  /** JSON export: the records plus the definition and the sources they mean. */
  function historyJSON(entries = [], options = {}) {
    const link = options.link || localGameUrl;
    const now = Number.isFinite(options.now) ? options.now : Date.now();
    return `${JSON.stringify(
      {
        schema: "loaded-late/alerts@1",
        generatedAt: new Date(now).toISOString(),
        alertDefinition:
          "Tied score with all three bases occupied in the bottom of the 9th inning or later, fewer than three outs — the walk-off condition in Official Baseball Rules 5.08(b).",
        sources: {
          official:
            "https://statsapi.mlb.com/api/v1.1/game/{gamePk}/feed/live (the snapshot each record was read from)",
          rules:
            "https://img.mlbstatic.com/mlb-images/image/upload/mlb/wqn5ah4c3qtivwx3jatm.pdf (Official Baseball Rules, 2023)",
        },
        alerts: [...entries].map((entry) => historyRecord(entry, link)),
      },
      null,
      2,
    )}\n`;
  }

  /**
   * One line a person can paste into a message: what was seen, when it was
   * seen, and the official source that proves it. History itself is per
   * browser and cannot be shared, so the link points at the official record —
   * which is the same thing the alert was read from.
   */
  function evidenceLine(entry, link = localGameUrl) {
    const record = historyRecord(entry, link);
    const scored =
      record.awayScore !== null && record.homeScore !== null && record.away && record.home;
    const parts = [
      record.inning === null ? "" : `BOT ${record.inning}`,
      scored
        ? `${record.away} ${record.awayScore}–${record.homeScore} ${record.home}`
        : [record.away, record.home].filter(Boolean).join(" at "),
      record.outs === null ? "" : `${record.outs} out${record.outs === 1 ? "" : "s"}`,
      record.balls === null || record.strikes === null
        ? ""
        : `count ${record.balls}-${record.strikes}`,
      "bases loaded",
      record.batter && record.pitcher
        ? `${record.batter} vs ${record.pitcher}`
        : record.batter,
      record.tensionLabel ? `tension ${record.tensionLabel}` : "",
      record.observedAtIso ? `observed ${record.observedAtIso}` : "",
      record.officialSource ? `official ${record.officialSource}` : "",
      record.gameUrl ? `game ${record.gameUrl}` : "",
    ].filter(Boolean);
    return parts.join(" · ");
  }

  /** File name for an export, dated in UTC so two machines agree. */
  function historyFileName(kind = "json", now = Date.now()) {
    const stamp = new Date(Number.isFinite(now) ? now : Date.now())
      .toISOString()
      .slice(0, 10);
    return `loaded-late-alerts-${stamp}.${kind === "csv" ? "csv" : "json"}`;
  }

  return {
    evaluate,
    observe,
    snapshotGame,
    scheduleDates,
    isLive,
    isPaused,
    calculateTension,
    tensionLabel,
    scanTarget,
    pollCadence,
    recentSharedAlert,
    occupancyLabel,
    historyColumns,
    historyRecord,
    historyCSV,
    historyJSON,
    evidenceLine,
    historyFileName,
  };
})();
if (typeof module !== "undefined" && module.exports)
  module.exports = BasesLoadedRules;
