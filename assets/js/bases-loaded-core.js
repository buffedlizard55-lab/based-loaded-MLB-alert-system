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
    // The hitter after the on-deck hitter. `offense.*` is the batting side's own
    // upcoming order — verified live on 2026-09-29 (game 849849): with the White
    // Sox batting, `offense.batter/onDeck/inHole` were three White Sox while
    // `defense.batter/onDeck/inHole` were the Astros' next three. Reading the
    // defensive copy here would name the wrong team's lineup.
    const inHole = ls.offense?.inHole?.id
      ? { id: ls.offense.inHole.id, name: ls.offense.inHole.fullName || "In the hole" }
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
      inHole,
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

  /**
   * The buzz a phone gives when the situation appears, in milliseconds.
   *
   * Two short pulses then one long: distinct from a message (single buzz) and
   * from a call (continuous), so a phone in a pocket says "bases loaded"
   * without being looked at. Shared by the monitor, the strip and the service
   * worker's push handler; `sw.js` repeats the same numbers because a service
   * worker cannot import this file, and tools/icons-test.mjs fails if the two
   * ever disagree.
   */
  const vibratePattern = Object.freeze([350, 120, 350, 120, 800]);

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
            inHole: result.inHole,
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
    "inHole",
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
      inHole: personName(entry?.inHole),
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

  /* ------------------------------------------------------------------------
   * Stream diff — chat-style timeline events.
   *
   * observe() above returns ONE event ("bases loaded, alert!") which is what
   * the monitor page uses for its primary alert. A chat-style feed wants to
   * narrate every meaningful step along the way: the watch window opening,
   * runners advancing, the bases loading, tension rising, the situation
   * resolving (walk-off / 3rd out / bases clearing), and rain delays.
   *
   * diffStream(previous, observation, game, now) returns an ARRAY of events
   * (0..N) to append to the feed. `previous` is the last stream state for
   * that game (persist the returned `state`); `observation` is the return of
   * observe() — which already carries the current evaluate() result and the
   * one-shot alert event. This keeps every decision tied to one evaluate()
   * call and to the existing rules, so the feed cannot disagree with the
   * monitor about what counts.
   *
   * Event kinds (stable strings — tests pin them):
   *   watch_begins        — a tied game enters the bottom of the 9th (or later),
   *                         so we start watching for a walk-off opportunity.
   *   watch_ends          — a previously-watched game leaves the watch window
   *                         (no longer tied / final / out of a qualifying half).
   *   watch_held          — the game is STILL tied and still in the 9th or
   *                         later, but the home team is not batting right now
   *                         (top half, or the changeover after its half). The
   *                         watch is not over: the next bottom half re-opens
   *                         it. This is the same state the monitor's slate
   *                         labels "TIED · TOP HALF · HOME STILL TO BAT" /
   *                         "TIED · HOME HALF OVER · WATCH CONTINUES", so the
   *                         two front ends can never contradict each other.
   *   runner_advanced     — a runner reached or advanced while on watch.
   *   bases_loaded        — the exact alert: tied, bottom 9+, all three bases
   *                         occupied, <3 outs. Fires once per continuous
   *                         loaded situation (same as observe()'s event).
   *   tension_update      — outs/count changed while still loaded; carries the
   *                         new tension. Fires only on tension-increasing
   *                         transitions so steady-state noise stays quiet.
   *   walkoff_rbi         — the third out never happened: the home team took
   *                         the lead (away !== home, home ahead) in a
   *                         previously-loaded bottom 9+ half — a walk-off.
   *   bases_cleared       — loaded situation ended without a walk-off (third
   *                         out, or a runner retired/erased).
   *   half_change         — entering the next inning's top half (still tied
   *                         → watch continues into extras); or entering a new
   *                         bottom half with the game still tied (new watch).
   *   paused              — rain delay / suspension, watch held.
   *   resumed             — play resumed after a pause.
   *   final               — game went final while on watch.
   *   data_unavailable    — a snapshot arrived incomplete or errored; the
   *                         watch is held, shown but not cleared.
   * --------------------------------------------------------------------- */

  const STREAM_EVENT_KINDS = Object.freeze([
    "watch_begins",
    "watch_ends",
    "watch_held",
    "runner_advanced",
    "bases_loaded",
    "tension_update",
    "walkoff_rbi",
    "bases_cleared",
    "half_change",
    "paused",
    "resumed",
    "final",
    "data_unavailable",
  ]);

  /**
   * Chat-feed tabs — the same shape as the replay feed's category tabs
   * (`reviews.html`): one pill per category with a live count, "all" first.
   * `kinds: null` means "every kind". The list partitions STREAM_EVENT_KINDS
   * exactly once, which `tools/bases-loaded-test.mjs` asserts, so a new event
   * kind can never silently fall out of every tab.
   */
  const feedTabs = Object.freeze([
    Object.freeze({ key: "all", label: "All", kinds: null }),
    Object.freeze({
      key: "loaded",
      label: "⚾ Bases Loaded",
      kinds: Object.freeze(["bases_loaded", "tension_update"]),
    }),
    Object.freeze({
      key: "watch",
      label: "👀 On Watch",
      kinds: Object.freeze([
        "watch_begins",
        "watch_held",
        "runner_advanced",
        "half_change",
      ]),
    }),
    Object.freeze({
      key: "walkoff",
      label: "🎉 Walk-offs",
      kinds: Object.freeze(["walkoff_rbi", "bases_cleared", "final", "watch_ends"]),
    }),
    Object.freeze({
      key: "warnings",
      label: "⚠️ Warnings",
      kinds: Object.freeze(["data_unavailable", "paused", "resumed"]),
    }),
  ]);

  /** Does an event of `kind` belong on the tab `tab`? */
  function matchesTab(tab, kind) {
    return !tab || tab.kinds === null || tab.kinds.includes(kind);
  }

  function mkEvent(kind, game, result, now, extra = {}) {
    return {
      id: `${game.gamePk}:${kind}:${now}:${Math.random().toString(36).slice(2, 8)}`,
      kind,
      gamePk: game.gamePk,
      away: game.teams?.away?.team?.name || "Away",
      home: game.teams?.home?.team?.name || "Home",
      awayScore: result?.away ?? null,
      homeScore: result?.home ?? null,
      inning: result?.inning ?? null,
      outs: result?.outs ?? null,
      balls: result?.balls ?? null,
      strikes: result?.strikes ?? null,
      runners: Array.isArray(result?.bases) ? result.bases.map((r) => (r ? { ...r } : null)) : [null, null, null],
      runnersOn: result?.runnersOn ?? 0,
      tied: !!result?.tied,
      entering: !!result?.entering,
      tension: result?.tension ?? 0,
      tensionLabel: result?.tensionLabel ?? "",
      lastEvent: result?.lastEvent || null,
      currentPlay: result?.currentPlay || null,
      batter: result?.batter || null,
      pitcher: result?.pitcher || null,
      onDeck: result?.onDeck || null,
      inHole: result?.inHole || null,
      observedAt: now,
      ...extra,
    };
  }

  function basesSame(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== 3 || b.length !== 3) return false;
    for (let i = 0; i < 3; i++) {
      const ai = a[i]?.id ?? null;
      const bi = b[i]?.id ?? null;
      if (ai !== bi) return false;
    }
    return true;
  }

  function diffStream(prevState, observation, game, now, errorMsg = "") {
    const events = [];
    const result = observation?.result || {};
    const prev = prevState || null;
    const paused =
      game.status?.abstractGameState === "Live" &&
      /delay|suspend/i.test(game.status?.detailedState || "");
    const isFinal = game.status?.abstractGameState === "Final";
    const known = !!result.known;
    const watching = !!result.watching;
    const loaded = !!result.loaded;
    const wasWatching = !!(prev?.watching || prev?.loaded);
    const wasLoaded = !!prev?.loaded;
    const wasPaused = !!prev?.paused;
    const wasHeld = !!prev?.held;
    // "Held": a live, tied game in the 9th or later whose home team is not
    // batting right now (top half, or the changeover after its half). The
    // monitor's slate labels these two states "TIED · TOP HALF · HOME STILL TO
    // BAT" and "TIED · HOME HALF OVER · WATCH CONTINUES" — the situation is
    // still being tracked, so the chat feed must not call it over.
    const lateInning = Number.isInteger(result.inning) && result.inning >= 9;
    const tiedLate = result.tied === true && lateInning;
    const held = known && !paused && isLive(game.status) && tiedLate && !watching;
    const homeHalfOver = String(game.linescore?.inningState || "").toLowerCase() === "bottom" && result.outs === 3;
    /** One sentence for a held watch, matching the monitor's own wording. */
    const holdDetail = () => {
      const half = String(game.linescore?.inningState || "").toLowerCase();
      if (half === "top")
        return `Still tied in the top of the ${result.inning}th — the home team still has to bat. Watch held.`;
      if (half === "end" || homeHalfOver)
        return `Still tied after the home half of the ${result.inning}th — going on. Watch held.`;
      return `Still tied in the ${result.inning}th — the home team still has to bat. Watch held.`;
    };
    const brokeTheTie = result.tied === false && lateInning;

    // 1. Data unavailability / pause / resume are surfaced as transitions.
    if (errorMsg && (!prev || !prev.error)) {
      events.push(
        mkEvent("data_unavailable", game, result, now, { message: errorMsg }),
      );
    }
    if (paused && !wasPaused && wasWatching) {
      events.push(
        mkEvent("paused", game, result, now, {
          detail: game.status?.detailedState || "Delayed",
        }),
      );
    }
    if (wasPaused && !paused && wasWatching) {
      events.push(mkEvent("resumed", game, result, now));
    }

    if (!known) {
      return {
        events,
        state: {
          ...(prev || {}),
          paused,
          error: errorMsg || prev?.error || "",
          observedAt: now,
        },
      };
    }

    // 2. Final: if we were watching and the game is now final, report the
    // outcome. The official home/away scores tell us whether the home team
    // walked off (home > away) or the away team won (away > home in the top
    // half or after a half-inning flip).
    if (isFinal && wasWatching) {
      const homeWalkedOff = Number.isInteger(result.home) && Number.isInteger(result.away) && result.home > result.away;
      events.push(
        mkEvent(
          homeWalkedOff ? "walkoff_rbi" : "final",
          game,
          result,
          now,
          {
            detail: homeWalkedOff
              ? "Home team wins — walk-off."
              : "Game ended without a walk-off from this situation.",
            finalScore: { away: result.away, home: result.home },
          },
        ),
      );
    }

    // 3. Watch window starts / stops.
    if (watching && !wasWatching && !isFinal) {
      // Distinguish first watch of the game (entering bottom 9) from "new
      // extra inning, still tied" (half_change + watching).
      const isNewInning =
        prev && Number.isInteger(prev.inning) && Number.isInteger(result.inning) &&
        result.inning > prev.inning;
      events.push(
        mkEvent("watch_begins", game, result, now, {
          detail: result.entering
            ? `Tied going to the bottom of the ${result.inning}th.`
            : `Tied in the bottom of the ${result.inning}th — walk-off watch is on.`,
          isNewExtraInning: !!isNewInning,
        }),
      );
    }

    if (wasWatching && !watching && !isFinal && !paused) {
      // If the game is no longer tied and home is ahead while in/after a
      // loaded bottom half, that's a walk-off.
      const homeLeading = Number.isInteger(result.home) && Number.isInteger(result.away) && result.home > result.away;
      const halfIsBottom =
        String(game.linescore?.inningState || "").toLowerCase() === "bottom";
      if (homeLeading && halfIsBottom && wasLoaded) {
        events.push(
          mkEvent("walkoff_rbi", game, result, now, {
            detail: "Home team takes the lead — walk-off.",
          }),
        );
      } else if (result.outs === 3 && wasLoaded) {
        events.push(
          mkEvent("bases_cleared", game, result, now, {
            detail: "Three outs — the side is retired. Bases cleared.",
          }),
        );
      } else if (tiedLate) {
        // Still tied, still in the 9th or later, still live: the home team is
        // simply not batting *this half*. The watch is held, not over — the
        // monitor's slate already says so, and the chat feed must never call
        // it "over" while the other front end says it continues. Only a
        // genuine end (the tie broken, or the game out of the window) falls
        // through to watch_ends below.
        events.push(
          mkEvent("watch_held", game, result, now, {
            detail: holdDetail(),
            half: String(game.linescore?.inningState || "").toLowerCase(),
          }),
        );
      } else {
        events.push(
          mkEvent("watch_ends", game, result, now, {
            detail: brokeTheTie
              ? "The game is no longer tied — the walk-off watch is over."
              : "No longer in a qualifying situation.",
          }),
        );
      }
    }

    // 3b. Held watch, both directions.
    //
    //   - First sight of a held game (tied, 9th or later, home team not
    //     batting): narrate it once. This is literally the project brief's
    //     "begin tracking when there is a tie game going to the bottom of the
    //     9th or later" — on the first poll after the page opens, and on each
    //     later hold, never repeating while the hold lasts. The persisted
    //     stream state (`held`) is what keeps a reload from repeating it.
    //   - A hold that ends without the home team batting again means the tie
    //     is gone (or the game left the window): the watch really is over, and
    //     the feed must say so instead of leaving a stale "watch held" card as
    //     the last word.
    if (held && !wasHeld && !wasWatching && !isFinal) {
      events.push(
        mkEvent("watch_held", game, result, now, {
          detail: holdDetail(),
          half: String(game.linescore?.inningState || "").toLowerCase(),
          firstSight: !prev,
        }),
      );
    } else if (wasHeld && !held && !watching && !isFinal && !paused) {
      events.push(
        mkEvent("watch_ends", game, result, now, {
          detail: brokeTheTie
            ? "The game is no longer tied — the walk-off watch is over."
            : "No longer in a qualifying situation.",
        }),
      );
    }

    // 4. Half-inning changeover while still watching (e.g. top 10 / bot 10
    // after a scoreless bot 9 that stays tied).
    if (
      watching && wasWatching && !isFinal &&
      Number.isInteger(result.inning) && Number.isInteger(prev?.inning) &&
      result.inning !== prev.inning
    ) {
      events.push(
        mkEvent("half_change", game, result, now, {
          detail: `Moving to the ${result.inning}th inning, game still tied.`,
        }),
      );
    }

    // 5. Bases loaded alert.
    if (loaded && !wasLoaded && !isFinal) {
      // If observe() already produced a rich alert event for this moment,
      // reuse its id so the chat row dedups cleanly with the monitor's alert.
      const ob = observation.event;
      events.push(
        mkEvent("bases_loaded", game, result, now, {
          alertId: ob?.id || null,
          detail: result.lastEvent
            ? `Bases loaded on: ${result.lastEvent}.`
            : "All three bases are occupied.",
        }),
      );
    }

    // 6. Bases cleared while still in the same watching half (out, runner
    // erased, run scores with <3 outs that clears third, etc.) — but NOT when
    // already covered by watch_ends/bases_cleared above.
    if (loaded && wasLoaded && !isFinal && !watching) {
      // covered by watch_ends / bases_cleared path
    } else if (wasLoaded && !loaded && watching && !isFinal) {
      // Still watching but bases no longer loaded (runner retired / force /
      // run scored leaving <3 occupied).
      events.push(
        mkEvent("bases_cleared", game, result, now, {
          detail: "Bases are no longer loaded — watching continues.",
        }),
      );
    }

    // 7. Runner advance / additional runner reached while on watch but not
    // yet loaded, so the chat narrates "one away" → "two away" progression.
    if (
      watching && !loaded && !isFinal && wasWatching && !wasLoaded &&
      Array.isArray(prev?.runners) && !basesSame(prev.runners, result.bases)
    ) {
      const prevCount = prev.runners.filter(Boolean).length;
      const nowCount = result.bases.filter(Boolean).length;
      if (nowCount > prevCount) {
        events.push(
          mkEvent("runner_advanced", game, result, now, {
            detail: result.lastEvent
              ? `${result.lastEvent} — ${occupancyLabel(result.bases.map(Boolean))}.`
              : `Runner reaches — ${occupancyLabel(result.bases.map(Boolean))}.`,
          }),
        );
      }
    }

    // 8. Tension update while loaded (outs/count changed). Only fires when
    // the new tension is strictly higher than the last pinned value, so a
    // normal count reset between batters doesn't spam the feed.
    if (loaded && wasLoaded && !isFinal) {
      const pinned = Number.isInteger(prev?.tensionPinned) ? prev.tensionPinned : (prev?.tension ?? 0);
      if ((result.tension || 0) > pinned) {
        events.push(
          mkEvent("tension_update", game, result, now, {
            detail: `${result.outs} out${result.outs === 1 ? "" : "s"} · count ${result.balls}-${result.strikes} — tension ${result.tensionLabel}.`,
          }),
        );
      }
    }

    return {
      events,
      state: {
        watching,
        loaded,
        held,
        paused,
        inning: result.inning,
        runners: result.bases,
        runnersOn: result.runnersOn,
        tension: result.tension,
        tensionPinned:
          loaded && wasLoaded
            ? Math.max(
                Number.isInteger(prev?.tensionPinned) ? prev.tensionPinned : (prev?.tension ?? 0),
                result.tension || 0,
              )
            : loaded
              ? result.tension
              : 0,
        outs: result.outs,
        balls: result.balls,
        strikes: result.strikes,
        tied: result.tied,
        awayScore: result.away,
        homeScore: result.home,
        error: "",
        observedAt: now,
      },
    };
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
    vibratePattern,
    historyColumns,
    historyRecord,
    historyCSV,
    historyJSON,
    evidenceLine,
    historyFileName,
    diffStream,
    STREAM_EVENT_KINDS,
    feedTabs,
    matchesTab,
  };
})();
if (typeof module !== "undefined" && module.exports)
  module.exports = BasesLoadedRules;
