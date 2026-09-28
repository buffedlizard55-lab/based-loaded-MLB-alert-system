/* Pure rules shared by the browser and deterministic tests. No event-name whitelist. */
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
    const entering = state === "middle" || (state === "top" && outs === 3);
    const tied = away !== null && home !== null && away === home;
    const eligible =
      isLive(game.status) && inning !== null && inning >= 9 && tied;
    // Three outs can leave runners in the feed, but there is no longer a live threat.
    const watching =
      eligible &&
      (entering || (bottom && outs !== null && outs >= 0 && outs < 3));
    const loaded = watching && bottom && outs < 3 && bases.every(Boolean);
    // An incomplete live snapshot must not re-arm a previously active alert.
    const occupancyKnown = ["first", "second", "third"].every(
      (base) => ls.offense?.[base] == null || number(ls.offense[base].id) > 0,
    );
    const statusKnown = ["Live", "Final", "Preview"].includes(
      game.status?.abstractGameState,
    );
    const known =
      statusKnown &&
      (!isLive(game.status) ||
        (inning !== null &&
          away !== null &&
          home !== null &&
          outs !== null &&
          ["top", "middle", "bottom", "end"].includes(state) &&
          !(state === "bottom" && ls.isTopInning === true) &&
          !!ls.offense &&
          occupancyKnown));
    return {
      inning,
      away,
      home,
      outs,
      bases,
      tied,
      entering,
      watching,
      loaded,
      known,
      phase: loaded ? "loaded" : watching ? "watching" : "other",
    };
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
    };
  }
  function observe(previous, game, now = Date.now()) {
    const result = evaluate(game);
    const inningKey = `${game.gamePk}:${result.inning}`;
    if (!result.known) return { state: previous, event: null, result };
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
            runners: result.bases,
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
  return { evaluate, observe, snapshotGame, scheduleDates, isLive };
})();
if (typeof module !== "undefined" && module.exports)
  module.exports = BasesLoadedRules;
