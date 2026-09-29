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
    const entering = state === "middle" || (state === "top" && outs === 3);
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

    // Current play description
    const currentPlay = ls.currentPlay?.result?.description ||
      game.linescore?.currentPlay?.result?.description || null;
    const lastEvent = ls.currentPlay?.result?.event || null;

    // Three outs can leave runners in the feed, but there is no longer a live threat.
    const watching =
      eligible &&
      (entering || (bottom && outs !== null && outs >= 0 && outs < 3));
    const loaded = watching && bottom && outs < 3 && bases.every(Boolean);

    // Tension level (only meaningful when loaded or watching with runners on)
    const tension = loaded
      ? calculateTension(outs, balls, strikes)
      : watching
        ? Math.max(0, calculateTension(outs, balls, strikes) - 1)
        : 0;

    // Number of runners on base (for watch display)
    const runnersOn = bases.filter(Boolean).length;

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
   */
  function recentSharedAlert(
    history,
    gamePk,
    inning,
    now = Date.now(),
    windowMs = 90000,
  ) {
    const target = number(inning);
    if (!Array.isArray(history) || target === null) return false;
    return history.some((entry) => {
      if (!entry || entry.gamePk !== gamePk || entry.inning !== target)
        return false;
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

  return {
    evaluate,
    observe,
    snapshotGame,
    scheduleDates,
    isLive,
    calculateTension,
    tensionLabel,
    scanTarget,
    pollCadence,
    recentSharedAlert,
    occupancyLabel,
  };
})();
if (typeof module !== "undefined" && module.exports)
  module.exports = BasesLoadedRules;
