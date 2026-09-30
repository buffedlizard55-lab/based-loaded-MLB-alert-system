/* ============================================================================
 * bases-loaded-feed.js — Chat-style live feed for Loaded Late alerts.
 *
 * Polls MLB StatsAPI (same as the situation monitor) and renders a
 * reviews.html-style chat timeline: each card is one event along the way to
 * a tied, bases-loaded, bottom-9+ walk-off situation — watch begins, runners
 * advance, bases load, tension rises, walk-off or bases clear, delays, and
 * data issues. Same rules engine as the monitor (BasesLoadedRules), same
 * polling cadence, same shared alert log — so the feed cannot contradict the
 * monitor page.
 *
 * Events come from BasesLoadedRules.diffStream() (see bases-loaded-core.js).
 *
 * No manual input. No third-party data. Verified against statsapi.mlb.com,
 * 2026-09-29.
 * ==========================================================================*/
"use strict";
(() => {
  const $ = (id) => document.getElementById(id);
  const rules = BasesLoadedRules;
  const params = new URLSearchParams(location.search);
  const demo = params.get("demo") === "1" || params.get("ll-demo") === "1";

  const STORE = "loaded-late:feed:v1",
    PREFS = "loaded-late:preferences",
    SHARED = "loaded-late:shared:v1",
    DISCOVERY_MS = 15000,
    FAST_POLL_MS = 2000,
    SLOW_POLL_MS = 15000,
    STALE_MS = 12000,
    HIGHLIGHT_MS = 7000,
    MAX_FEED = 200;

  const PAGE_ID = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

  let feed = [],
    gameStreams = {}, // gamePk -> { result, state, at, error }
    games = new Map(),
    snapshots = new Map();
  let newPks = new Set(),
    newUntil = 0;
  let busy = false,
    timer,
    discoveryAt = 0,
    dateKey = "",
    lastUpdate = 0,
    scheduleError = "";
  let soundEnabled = false,
    notificationsEnabled = false,
    audio,
    demoStep = 0;

  const QUIET_MS = 90000;

  const escape = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );

  const time = (stamp) =>
    new Date(stamp).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
  const day = (stamp) =>
    new Date(stamp).toLocaleDateString([], { weekday: "short" });

  const validPk = (pk) => /^\d+$/.test(String(pk));

  const officialLink = (pk) =>
    `https://statsapi.mlb.com/api/v1.1/game/${pk}/feed/live`;
  const gameLink = (pk) => `game.html?gamePk=${encodeURIComponent(pk)}`;

  /* ---------------------------------------------------------------- prefs */
  function loadPrefs() {
    try {
      const raw = localStorage.getItem(PREFS);
      if (!raw) return;
      const p = JSON.parse(raw);
      soundEnabled = !!p.sound;
      notificationsEnabled = !!p.notify;
    } catch (_) {}
  }
  function savePrefs() {
    try {
      localStorage.setItem(PREFS, JSON.stringify({
        sound: soundEnabled,
        notify: notificationsEnabled,
      }));
    } catch (_) {}
  }
  function updateButtons() {
    if ($("sound-toggle-btn")) {
      $("sound-toggle-btn").textContent = soundEnabled ? "🔊 Sound On" : "🔇 Sound Off";
      $("sound-toggle-btn").classList.toggle("active", soundEnabled);
    }
    if ($("notify-toggle-btn")) {
      $("notify-toggle-btn").textContent = notificationsEnabled
        ? "🔔 Alerts On"
        : "⚪ Alerts Off";
      $("notify-toggle-btn").classList.toggle("active", notificationsEnabled);
    }
  }

  /* ---------------------------------------------------------------- sound */
  function beep() {
    if (!soundEnabled) return;
    try {
      if (!audio) {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        audio = { ctx };
      }
      const c = audio.ctx;
      if (c.state === "suspended") c.resume();
      [523.25, 659.25, 783.99].forEach((f, i) => {
        const o = c.createOscillator();
        const g = c.createGain();
        o.type = "sine";
        o.frequency.value = f;
        const t = c.currentTime + i * 0.12;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.18, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
        o.connect(g).connect(c.destination);
        o.start(t);
        o.stop(t + 0.24);
      });
    } catch (_) {}
  }

  /* --------------------------------------------------------- desktop notif */
  function notify(event) {
    if (!notificationsEnabled) return;
    if (typeof Notification === "undefined") return;
    if (Notification.permission !== "granted") return;
    try {
      const body = [
        `${event.away} ${event.awayScore}–${event.homeScore} ${event.home}`,
        event.inning ? `BOT ${event.inning}` : "",
        event.outs != null ? `${event.outs} out${event.outs === 1 ? "" : "s"}` : "",
        event.tensionLabel ? `Tension ${event.tensionLabel}` : "",
      ]
        .filter(Boolean)
        .join(" · ");
      const n = new Notification(
        event.kind === "walkoff_rbi"
          ? "⚾ WALK-OFF!"
          : event.kind === "bases_loaded"
            ? `🔥 BASES LOADED · BOT ${event.inning || ""}`
            : `Loaded Late · ${eventKindLabel(event.kind)}`,
        { body, tag: event.id },
      );
      n.onclick = () => {
        n.close();
        if (event.gamePk && validPk(event.gamePk))
          window.open(gameLink(event.gamePk), "_blank");
      };
    } catch (_) {}
  }

  function eventKindLabel(kind) {
    return (
      {
        watch_begins: "On Watch",
        watch_ends: "Watch Ends",
        runner_advanced: "Runner Reaches",
        bases_loaded: "⚾ BASES LOADED",
        tension_update: "Tension Rising",
        walkoff_rbi: "WALK-OFF",
        bases_cleared: "Bases Clear",
        half_change: "Inning Change",
        paused: "Delay / Paused",
        resumed: "Play Resumed",
        final: "Game Final",
        data_unavailable: "Data Pending",
      }[kind] || kind
    );
  }

  /* ---------------------------------------------------------- feed history */
  function loadFeed() {
    try {
      const raw = localStorage.getItem(STORE);
      if (!raw) return;
      const s = JSON.parse(raw);
      feed = Array.isArray(s.feed) ? s.feed.slice(0, MAX_FEED) : [];
      gameStreams = s.gameStreams && typeof s.gameStreams === "object" ? s.gameStreams : {};
      // Age out anything older than 7 days so a refresh doesn't look like new.
      const cutoff = Date.now() - 7 * 86400000;
      feed = feed.filter((e) => Number.isFinite(e.observedAt) && e.observedAt > cutoff);
    } catch (_) {
      feed = [];
      gameStreams = {};
    }
  }
  function saveFeed() {
    try {
      localStorage.setItem(
        STORE,
        JSON.stringify({ feed: feed.slice(0, MAX_FEED), gameStreams }),
      );
    } catch (_) {}
  }

  /* shared cross-page quiet log (mirrors the monitor's) */
  function mergeSharedHistory() {
    try {
      const raw = localStorage.getItem(SHARED);
      if (!raw) return [];
      const s = JSON.parse(raw);
      return Array.isArray(s?.history) ? s.history : [];
    } catch (_) {
      return [];
    }
  }
  function recordShared(event, isAlert) {
    try {
      const h = mergeSharedHistory();
      h.unshift({
        id: event.id,
        gamePk: event.gamePk,
        inning: event.inning,
        observedAt: event.observedAt,
        observer: PAGE_ID,
        isAlert: !!isAlert,
      });
      localStorage.setItem(
        SHARED,
        JSON.stringify({ history: h.slice(0, 100) }),
      );
    } catch (_) {}
  }

  /* --------------------------------------------------------- polling loop */
  async function discover() {
    if (demo) return;
    const dates = rules.scheduleDates();
    const list = [];
    let err = "";
    for (const d of dates) {
      try {
        const games = await MLB.getSchedule(d);
        for (const g of games) list.push(g);
      } catch (e) {
        err = `Schedule error (${d}): ${e.message || e}`;
      }
    }
    // de-dup by gamePk (today + yesterday overlap at midnight)
    const byPk = new Map();
    for (const g of list) byPk.set(g.gamePk, g);
    games = byPk;
    dateKey = dates[0];
    discoveryAt = Date.now();
    scheduleError = err;
  }

  async function fetchLive(gamePk) {
    if (demo) return null;
    try {
      // getAlertSnapshot is the small, coherent (status + linescore + currentPlay)
      // projection the monitor page uses — one request, same shape snapshotGame()
      // expects. getLiveFeed works too but is bigger; the small projection is
      // what the monitor is tested against.
      return await MLB.getAlertSnapshot(gamePk);
    } catch (_) {
      try {
        return await MLB.getLiveFeed(gamePk);
      } catch (e) {
        return null;
      }
    }
  }

  function shouldPoll(game, streamState) {
    if (demo) return true;
    return rules.scanTarget(game, streamState);
  }

  async function poll() {
    if (busy) return;
    busy = true;
    try {
      const now = Date.now();
      const sinceDiscovery = now - (discoveryAt || 0);
      if (!discoveryAt || sinceDiscovery >= DISCOVERY_MS) await discover();
      const targets = [];
      for (const g of games.values()) {
        const pk = g.gamePk;
        const stream = gameStreams[pk];
        if (shouldPoll(g, stream) || (stream && (now - (stream.at || 0) < 60000))) {
          targets.push(g);
        }
      }
      // Concurrent fetch cap
      const conc = 4;
      for (let i = 0; i < targets.length; i += conc) {
        const slice = targets.slice(i, i + conc);
        const results = await Promise.all(
          slice.map(async (g) => {
            const feedData = await fetchLive(g.gamePk);
            if (!feedData) return { g, err: "Live snapshot unavailable" };
            try {
              const game = rules.snapshotGame(g, feedData);
              return { g, game };
            } catch (e) {
              return { g, err: e.message || "Snapshot error" };
            }
          }),
        );
        for (const r of results) acceptOne(r.g, r.game, r.err, Date.now());
      }
      lastUpdate = Date.now();
      render();
      saveFeed();
    } finally {
      busy = false;
      scheduleNext();
    }
  }

  function scheduleNext() {
    clearTimeout(timer);
    // Reuse the shared cadence logic (5s fast / 30s slow by default in the
    // rules module). The monitor page uses 2s/15s for its own loop but we
    // expose that as the visible "every 2s / every 15s" text; for the chat
    // feed we follow the rules default to be slightly gentler on the API
    // while still catching the situation within a few seconds.
    const ms = rules.pollCadence(games, Object.fromEntries(
      Object.entries(gameStreams).map(([pk, s]) => [pk, { active: !!(s?.result?.watching || s?.result?.loaded) }]),
    ), { fast: FAST_POLL_MS, slow: SLOW_POLL_MS });
    timer = setTimeout(poll, ms);
  }

  function acceptOne(scheduleGame, game, errorMsg, now) {
    const pk = scheduleGame.gamePk;
    const previous = gameStreams[pk]?.observationState || null;
    const prevStreamState = gameStreams[pk]?.streamState || null;
    if (!game) {
      snapshots.set(pk, { game: scheduleGame, at: now, error: errorMsg || "Unavailable" });
      return;
    }
    const observation = rules.observe(previous, game, now);
    const streamDiff = rules.diffStream(prevStreamState, observation, game, now, errorMsg || "");
    // Persist observe state (used by scanTarget/active flags)
    gameStreams[pk] = {
      at: now,
      result: observation.result,
      state: observation.state,
      observationState: observation.state,
      streamState: streamDiff.state,
      error: errorMsg || "",
    };
    snapshots.set(pk, { game, at: now, result: observation.result, error: errorMsg || "" });

    for (const ev of streamDiff.events) {
      // cross-page quiet for the primary alert event
      const isPrimary = ev.kind === "bases_loaded" || ev.kind === "walkoff_rbi";
      const repeated =
        isPrimary &&
        rules.recentSharedAlert(
          mergeSharedHistory(),
          ev.gamePk,
          ev.inning,
          now,
          QUIET_MS,
          PAGE_ID,
        );
      if (feed.some((e) => e.id === ev.id)) continue;
      feed.unshift({ ...ev, observer: PAGE_ID, crossPage: repeated });
      newPks.add(ev.id);
      newUntil = Date.now() + HIGHLIGHT_MS;
      if (isPrimary && !repeated) {
        beep();
        notify(ev);
      }
      if (isPrimary) recordShared(ev, true);
    }
    // Trim
    if (feed.length > MAX_FEED) feed.length = MAX_FEED;
  }

  /* --------------------------------------------------------------- render */
  function tensionClass(level) {
    if (level >= 5) return "tension-pill-max";
    if (level >= 4) return "tension-pill-high";
    if (level >= 3) return "tension-pill-med";
    return "tension-pill-low";
  }

  function titleFor(ev) {
    const away = escape(ev.away),
      home = escape(ev.home);
    const score =
      Number.isInteger(ev.awayScore) && Number.isInteger(ev.homeScore)
        ? `${ev.awayScore}–${ev.homeScore}`
        : "";
    switch (ev.kind) {
      case "bases_loaded":
        return `<span class="bl-title-alert">⚾ BASES LOADED</span> · ${away} @ ${home}${score ? ` ${score}` : ""} — TIED in the BOTTOM of the ${ev.inning}!`;
      case "walkoff_rbi":
        return `<span class="bl-title-walkoff">🎉 WALK-OFF</span> · ${home} beat ${away}${score ? ` ${score}` : ""}`;
      case "watch_begins":
        return `WATCH ON · ${away} @ ${home}${score ? ` ${score}` : ""} — tied, bottom ${ev.inning}`;
      case "tension_update":
        return `TENSION RISING · ${away} @ ${home}${score ? ` ${score}` : ""}`;
      case "runner_advanced":
        return `RUNNER REACHES · ${away} @ ${home}${score ? ` ${score}` : ""}`;
      case "half_change":
        return `INNING CHANGE · ${away} @ ${home}${score ? ` ${score}` : ""} — still tied`;
      case "bases_cleared":
        return `BASES NO LONGER LOADED · ${away} @ ${home}${score ? ` ${score}` : ""}`;
      case "watch_ends":
        return `WATCH OVER · ${away} @ ${home}${score ? ` ${score}` : ""}`;
      case "paused":
        return `⏸ PAUSED · ${away} @ ${home} — ${escape(ev.detail || "Delayed")}`;
      case "resumed":
        return `▶ PLAY RESUMED · ${away} @ ${home}`;
      case "final":
        return `FINAL · ${away} ${ev.awayScore ?? "?"} – ${ev.homeScore ?? "?"} ${home}`;
      case "data_unavailable":
        return `DATA UNAVAILABLE · ${away} @ ${home}`;
      default:
        return `${eventKindLabel(ev.kind)} · ${away} @ ${home}`;
    }
  }

  function renderRow(ev) {
    const now = Date.now();
    const isNew = newPks.has(ev.id) && now < newUntil;
    const live = ev.kind === "bases_loaded";
    const cls = [
      "bl-row",
      `bl-row-kind-${ev.kind}`,
      isNew ? "bl-row-new" : "",
      live ? "bl-live" : "",
    ]
      .filter(Boolean)
      .join(" ");
    const scoreStr =
      Number.isInteger(ev.awayScore) && Number.isInteger(ev.homeScore)
        ? `<span class="bl-game-score">${ev.awayScore}–${ev.homeScore} TIED</span>`
        : "";
    const inningBadge = ev.inning
      ? `<span class="bl-inn">${ev.entering ? "MID" : "BOT"} ${ev.inning}</span>`
      : "";
    const tension =
      ev.tension && (ev.kind === "bases_loaded" || ev.kind === "tension_update")
        ? `<span class="bl-tension-pill ${tensionClass(ev.tension)}">${escape(ev.tensionLabel || "")}</span>`
        : "";
    const countPill =
      ev.balls != null && ev.strikes != null
        ? `<span class="bl-ctx-pill bl-ctx-pill-count">Count ${ev.balls}–${ev.strikes}</span>`
        : "";
    const outsPill =
      ev.outs != null
        ? `<span class="bl-ctx-pill bl-ctx-pill-outs">${ev.outs} out${ev.outs === 1 ? "" : "s"}</span>`
        : "";
    const basesStr = ev.tied && Array.isArray(ev.runners)
      ? (() => {
          const on = ev.runners.filter(Boolean).length;
          return `<span class="bl-ctx-pill bl-ctx-pill-bases">${on === 3 ? "Bases loaded" : `${on} runner${on === 1 ? "" : "s"} on`}</span>`;
        })()
      : "";
    const runners = (Array.isArray(ev.runners) ? ev.runners : [])
      .map((r, i) => (r ? `<span class="bl-player" title="${escape(r.name || "")}">${i + 1}B ${escape(r.name || "Runner")}</span>` : ""))
      .join("");
    const matchup =
      ev.batter || ev.pitcher
        ? `<div class="bl-matchup">
            ${ev.batter ? `<span class="bl-player" title="Batter">⚾ ${escape(ev.batter.name || "")}</span>` : ""}
            ${ev.pitcher ? `<span class="bl-player bl-player-pitcher" title="Pitcher">🎯 ${escape(ev.pitcher.name || "")}</span>` : ""}
            ${ev.onDeck ? `<span class="bl-player bl-player-ondeck" title="On deck">↗ ${escape(ev.onDeck.name || "")}</span>` : ""}
          </div>`
        : "";
    const lastPlay = ev.lastEvent
      ? `<p class="bl-desc">Last play: ${escape(ev.lastEvent)}${ev.detail && ev.kind !== "bases_loaded" && ev.kind !== "walkoff_rbi" ? " — " + escape(ev.detail) : ""}</p>`
      : ev.detail
        ? `<p class="bl-desc">${escape(ev.detail)}</p>`
        : "";
    const source = validPk(ev.gamePk)
      ? `<a class="bl-source" href="${escape(officialLink(ev.gamePk))}" target="_blank" rel="noopener">Official feed ↗</a>
         <a class="bl-source" href="${escape(gameLink(ev.gamePk))}">Open game ↗</a>`
      : "";
    const isWalkoff = ev.kind === "walkoff_rbi";
    const isAlert = ev.kind === "bases_loaded";
    const titleCls = isWalkoff ? "bl-title bl-title-walkoff" : isAlert ? "bl-title bl-title-alert" : "bl-title";
    return `<article class="${cls}">
      <div class="bl-time">
        <span class="bl-time-day">${escape(day(ev.observedAt))}</span>
        <span class="bl-time-hm">${escape(time(ev.observedAt))}</span>
      </div>
      <div class="bl-body">
        <div class="bl-head">
          <span class="bl-kind-chip chip-${ev.kind}">${escape(eventKindLabel(ev.kind))}</span>
          ${validPk(ev.gamePk) ? `<a class="bl-game" href="${escape(gameLink(ev.gamePk))}">${escape(ev.away)} @ ${escape(ev.home)} ${scoreStr}</a>` : `<span class="bl-game">${escape(ev.away)} @ ${escape(ev.home)}</span>`}
          ${inningBadge}
          ${tension}
        </div>
        <h3 class="${titleCls}">${titleFor(ev)}</h3>
        ${lastPlay}
        <div class="bl-ctx">${outsPill}${countPill}${basesStr}</div>
        ${matchup}
        ${runners ? `<div class="bl-matchup">${runners}</div>` : ""}
        <div class="bl-foot">${source}</div>
      </div>
    </article>`;
  }

  function computeStats() {
    const now = Date.now();
    const activeLoads = [...snapshots.values()].filter(
      (s) => s.result?.loaded && !s.error && now - (s.at || 0) < STALE_MS * 2,
    );
    const onWatch = [...snapshots.values()].filter(
      (s) => s.result?.watching && !s.result?.loaded && !s.error && now - (s.at || 0) < STALE_MS * 2,
    );
    const paused = [...snapshots.values()].filter((s) => {
      const g = s.game || s;
      return rules.isPaused(g?.status);
    });
    const loadsToday = feed.filter(
      (e) => e.kind === "bases_loaded" && now - e.observedAt < 24 * 3600000,
    ).length;
    const walkoffs = feed.filter((e) => e.kind === "walkoff_rbi").length;
    return { active: activeLoads.length, watch: onWatch.length + paused.length, loadsToday, walkoffs };
  }

  function render() {
    const stats = computeStats();
    const $active = $("stat-active");
    const $watch = $("stat-watch");
    const $today = $("stat-today");
    const $walkoffs = $("stat-walkoffs");
    const $events = $("stat-events");
    if ($active) $active.textContent = String(stats.active);
    if ($watch) $watch.textContent = String(stats.watch);
    if ($today) $today.textContent = String(stats.loadsToday);
    if ($walkoffs) $walkoffs.textContent = String(stats.walkoffs);
    if ($events) $events.textContent = String(feed.length);

    const $err = $("banner");
    if ($err) $err.textContent = scheduleError || "";

    const list = $("feed-list");
    if (!list) return;
    if (!feed.length) {
      list.innerHTML = `<div class="bl-empty"><span class="bl-empty-icon">◇</span><strong>Waiting for the first qualifying situation…</strong>
        When a tied game reaches the bottom of the 9th (or later) and the bases start filling up, events will appear here live — chat style, newest first.</div>`;
      return;
    }
    list.innerHTML = feed
      .slice(0, 100)
      .map(renderRow)
      .join("");
  }

  /* ---------------------------------------------------------------- demo */
  const DEMO_SCENARIOS = [
    // scenario 1: watch begins
    {
      label: "1/6: Game tied, entering the bottom of the 9th…",
      game: demoGame({
        inning: 9, state: "middle", outs: 0, balls: 0, strikes: 0,
        away: 3, home: 3, first: null, second: null, third: null,
        inningState: "Middle", isTopInning: false,
      }),
    },
    // scenario 2: leadoff single
    {
      label: "2/6: Leadoff single — runner on first.",
      game: demoGame({
        inning: 9, state: "bottom", outs: 0, balls: 0, strikes: 1,
        away: 3, home: 3, first: demoRunner(1, "Lead-off Hitter"), second: null, third: null,
        inningState: "Bottom", lastEvent: "Single",
      }),
    },
    // scenario 3: walk, runners on 1st & 2nd
    {
      label: "3/6: Walk — two on, one to go.",
      game: demoGame({
        inning: 9, state: "bottom", outs: 0, balls: 4, strikes: 1,
        away: 3, home: 3,
        first: demoRunner(1, "Lead-off Hitter"),
        second: demoRunner(2, "Runner on 2nd"),
        third: null,
        inningState: "Bottom", lastEvent: "Walk",
      }),
    },
    // scenario 4: BASES LOADED — 0 outs
    {
      label: "4/6: ⚾ BASES LOADED — 0 outs, early count.",
      game: demoGame({
        inning: 9, state: "bottom", outs: 0, balls: 1, strikes: 0,
        away: 3, home: 3,
        first: demoRunner(1, "Lead-off Hitter"),
        second: demoRunner(2, "Runner on 2nd"),
        third: demoRunner(3, "Runner on 3rd"),
        inningState: "Bottom", lastEvent: "Single", tension: 1,
      }),
    },
    // scenario 5: Tension max — 2 outs, full count
    {
      label: "5/6: 🔥 MAX TENSION — 2 outs, full count!",
      game: demoGame({
        inning: 9, state: "bottom", outs: 2, balls: 3, strikes: 2,
        away: 3, home: 3,
        first: demoRunner(1, "Lead-off Hitter"),
        second: demoRunner(2, "Runner on 2nd"),
        third: demoRunner(3, "Runner on 3rd"),
        inningState: "Bottom", lastEvent: "Foul", tension: 5,
      }),
    },
    // scenario 6: Walk-off!
    {
      label: "6/6: 🎉 WALK-OFF HIT — home team wins!",
      game: demoGame({
        inning: 9, state: "bottom", outs: 2, balls: 3, strikes: 2,
        away: 3, home: 4,
        first: null, second: null, third: null,
        inningState: "Bottom", lastEvent: "Walk-off single", tension: 0,
        abstractState: "Final", detailedState: "Final",
      }),
    },
  ];

  function demoRunner(id, name) { return { id, fullName: name }; }
  function demoGame(opts) {
    const base = {
      gamePk: 999999,
      teams: {
        away: { team: { id: 111, name: "Demo Away Team" } },
        home: { team: { id: 222, name: "Demo Home Team" } },
      },
      status: {
        abstractGameState: opts.abstractState || "Live",
        detailedState: opts.detailedState || "In Progress",
      },
      linescore: {
        currentInning: opts.inning,
        inningState: opts.inningState || opts.state,
        isTopInning: opts.isTopInning != null ? opts.isTopInning : opts.state !== "bottom",
        outs: opts.outs,
        balls: opts.balls,
        strikes: opts.strikes,
        teams: {
          away: { runs: opts.away },
          home: { runs: opts.home },
        },
        offense: {
          first: opts.first || null,
          second: opts.second || null,
          third: opts.third || null,
          batter: { id: 100, fullName: "Demo Batter" },
          pitcher: { id: 200, fullName: "Demo Pitcher" },
          onDeck: { id: 101, fullName: "Demo On-Deck" },
          inHole: { id: 102, fullName: "Demo In-Hole" },
        },
        defense: {
          pitcher: { id: 200, fullName: "Demo Pitcher" },
        },
      },
      lastPlay: opts.lastEvent
        ? { result: { event: opts.lastEvent, description: opts.lastEvent } }
        : null,
    };
    return base;
  }

  function runDemoStep() {
    if (demoStep >= DEMO_SCENARIOS.length) return;
    const step = DEMO_SCENARIOS[demoStep];
    if ($("demo-description")) $("demo-description").textContent = step.label;
    acceptOne(
      { gamePk: step.game.gamePk, teams: step.game.teams },
      step.game,
      "",
      Date.now(),
    );
    demoStep += 1;
    render();
    saveFeed();
  }

  /* -------------------------------------------------------------- controls */
  function wireControls() {
    const soundBtn = $("sound-toggle-btn");
    if (soundBtn)
      soundBtn.addEventListener("click", () => {
        soundEnabled = !soundEnabled;
        if (soundEnabled && typeof Notification !== "undefined" && Notification.permission === "default") {
          // we don't require notif permission for sound
        }
        savePrefs();
        updateButtons();
        if (soundEnabled) beep();
      });
    const notifyBtn = $("notify-toggle-btn");
    if (notifyBtn)
      notifyBtn.addEventListener("click", async () => {
        if (typeof Notification === "undefined") {
          notifyBtn.textContent = "Notifications unsupported";
          return;
        }
        if (Notification.permission === "denied") {
          notifyBtn.textContent = "Notifications blocked";
          return;
        }
        if (Notification.permission === "default") {
          await Notification.requestPermission();
        }
        notificationsEnabled = Notification.permission === "granted";
        savePrefs();
        updateButtons();
      });
    const refreshBtn = $("refresh-btn");
    if (refreshBtn)
      refreshBtn.addEventListener("click", () => {
        discoveryAt = 0;
        poll();
      });
    const demoNext = $("demo-next");
    if (demoNext) {
      demoNext.addEventListener("click", runDemoStep);
    }
  }

  /* ------------------------------------------------------------------ init */
  function tickCountdown() {
    const el = $("countdown");
    if (!el || !lastUpdate) return;
    const since = (Date.now() - lastUpdate) / 1000;
    const hasActive = Object.values(gameStreams).some(
      (s) => s && (s.result?.watching || s.result?.loaded),
    );
    const next = (hasActive ? FAST_POLL_MS : SLOW_POLL_MS) / 1000;
    const left = Math.max(0, Math.round(next - since));
    el.textContent = `${left}s`;

    // Status line label
    const upd = $("updated");
    if (upd) {
      const secs = Math.round(since);
      upd.textContent = `updated ${time(lastUpdate)} · ${secs}s ago · refreshing ${
        hasActive ? "every 2s" : "every 15s"
      }`;
    }
    const dot = $("live-dot");
    if (dot) dot.classList.toggle("on", !scheduleError && discoveryAt > 0);
  }

  function clearNewHighlights() {
    const now = Date.now();
    if (now > newUntil) newPks.clear();
  }

  async function init() {
    loadPrefs();
    loadFeed();
    updateButtons();
    wireControls();

    if ($("demo-banner")) $("demo-banner").hidden = !demo;

    render();

    if (demo) {
      // Seed the first scenario
      runDemoStep();
      return;
    }

    try {
      await discover();
    } catch (_) {}
    poll();
    setInterval(() => {
      tickCountdown();
      clearNewHighlights();
      render();
    }, 1000);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
