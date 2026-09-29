/* Alert-only monitor. Schedule discovery is separate from coherent live snapshots.
 * Enhanced: displays count, batter/pitcher, tension level, and base-loading context.
 */
"use strict";
(() => {
  const $ = (id) => document.getElementById(id);
  const rules = BasesLoadedRules;
  const demo = new URLSearchParams(location.search).get("demo") === "1";
  const STORE = "loaded-late:v3",
    PREFS = "loaded-late:preferences";
  const WEEK = 7 * 86400000,
    DISCOVERY_MS = 15000,
    SCAN_MS = 2000,
    QUIET_MS = 90000,
    STALE_MS = 12000,
    HIGHLIGHT_MS = 8000;
  // Identifies this page instance in the shared log, so only *other* pages
  // (the site-wide strip, or another tab) can suppress a chime. A confirmed
  // exit and reload recorded by this same page still alerts again.
  const PAGE_ID =
    Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  let history = [],
    states = {},
    games = new Map(),
    snapshots = new Map();
  let highlightPk = null,
    highlightUntil = 0;
  let busy = false,
    timer,
    discoveryAt = 0,
    discoveryAttempt = 0,
    dateKey = "",
    lastUpdate = 0,
    scheduleError = "";
  let soundEnabled = false,
    notificationsEnabled = false,
    audio,
    demoStep = 0;
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
  const validPk = (pk) => /^\d+$/.test(String(pk));
  const time = (stamp) =>
    new Date(stamp).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    });
  const empty = (title, text, icon = "◇") =>
    `<div class="alert-empty"><span class="empty-icon">${icon}</span><strong>${escape(title)}</strong>${escape(text)}</div>`;

  // Format count as "B-S" (balls-strikes)
  const countDisplay = (balls, strikes) => {
    if (balls == null || strikes == null) return "—";
    return `${balls}–${strikes}`;
  };

  // Count dots visual: ● for present, ○ for absent
  const countDots = (value, max) => {
    if (value == null) return "";
    let s = "";
    for (let i = 0; i < max; i++) s += i < value ? "●" : "○";
    return s;
  };

  // Tension bar: visual indicator 0-5
  const tensionBar = (level) => {
    let s = "";
    for (let i = 0; i < 5; i++) {
      s += i < level
        ? `<span class="tension-pip filled${level >= 4 ? " extreme" : ""}"></span>`
        : `<span class="tension-pip"></span>`;
    }
    return s;
  };

  /* ------------------------------------------------------------- live slate
   * "No manual checking" is the point of this project, so the page also shows
   * the whole slate it is scanning and why each game is (or is not) tracked.
   * Everything on a row is either read straight from the official schedule
   * scan, or from that game's own coherent live snapshot — never inferred.
   * A game with no coherent snapshot yet is labelled as such instead of being
   * given a state we have not observed.
   */

  // One implementation, shared with the site-wide strip (core rules).
  const isPausedStatus = (status) => rules.isPaused(status);

  const ageText = (stamp, now = Date.now()) => {
    if (!Number.isFinite(stamp)) return "";
    const seconds = Math.max(0, Math.round((now - stamp) / 1000));
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.round(seconds / 60);
    return `${minutes}m ago`;
  };

  /** Official score for one side: coherent snapshot first, then schedule. */
  function scoreOfSide(game, result, side) {
    if (result && Number.isInteger(result[side])) return result[side];
    const direct = game.teams?.[side]?.score;
    if (Number.isInteger(direct)) return direct;
    const runs = game.linescore?.teams?.[side]?.runs;
    return Number.isInteger(runs) ? runs : null;
  }

  /** "Bot 9" / "Mid 10" / "Final" — only from fields the payload actually has. */
  function halfText(game) {
    const ls = game.linescore || {};
    const inning = ls.currentInning;
    if (game.status?.abstractGameState === "Final")
      return Array.isArray(ls.innings) && ls.innings.length > 9
        ? `Final/${ls.innings.length}`
        : "Final";
    if (!Number.isInteger(inning)) return "";
    const state = String(ls.inningState || "").toLowerCase();
    const word =
      state === "top"
        ? "Top"
        : state === "bottom"
          ? "Bot"
          : state === "middle"
            ? "Mid"
            : state === "end"
              ? "End"
              : "";
    return `${word ? `${word} ` : ""}${inning}`;
  }

  /**
   * Why this game is on the page, in one label. Ranks double as the sort
   * order, so the games that matter are always at the top of the slate.
   */
  function boardPhase(game, entry, delayed) {
    const result = entry?.result || null;
    const error = entry?.error || "";
    if (result?.loaded && !error)
      return { rank: 0, text: "BASES LOADED · ALERT", cls: "tag-alert" };
    if (result?.watching && !error) {
      const occupancy = rules.occupancyLabel(result.bases.map(Boolean));
      const toFill = 3 - result.runnersOn;
      return {
        rank: 1,
        text: `ON WATCH · ${occupancy} · ${toFill} to fill`,
        cls: "tag-watch",
      };
    }
    if (delayed)
      return {
        rank: 3,
        text: result?.tied && result.inning >= 9
          ? "PAUSED · STILL TIED · WATCH HELD"
          : "PAUSED",
        cls: "tag-paused",
      };
    if (result && !error) {
      if (result.tied && result.inning >= 9) {
        const state = String(game.linescore?.inningState || "").toLowerCase();
        if (state === "top")
          return {
            rank: 2,
            text: "TIED · TOP HALF · HOME STILL TO BAT",
            cls: "tag-tied",
          };
        if (state === "middle")
          return {
            rank: 2,
            text: "TIED · CHANGE OVER · HOME HALF PENDING",
            cls: "tag-tied",
          };
        return {
          rank: 2,
          text: "TIED · HOME HALF OVER · WATCH CONTINUES",
          cls: "tag-tied",
        };
      }
      if (result.inning >= 9)
        return { rank: 2, text: "INNING 9+ · NOT TIED", cls: "tag-late" };
      return { rank: 4, text: "NOT YET INNING 9", cls: "tag-early" };
    }
    if (entry?.error === "Monitoring paused")
      return { rank: 5, text: "PAUSED TAB · LAST STATE HELD", cls: "tag-paused" };
    if (game.status?.abstractGameState === "Final")
      return { rank: 6, text: "FINAL", cls: "tag-final" };
    if (game.status?.abstractGameState === "Preview")
      return { rank: 6, text: "SCHEDULED", cls: "tag-scheduled" };
    // Live, but no coherent snapshot yet: only claim what the schedule shows.
    if (Number.isInteger(game.linescore?.currentInning) && game.linescore.currentInning >= 9)
      return {
        rank: 2,
        text: "LATE INNING · AWAITING THE FIRST LIVE SNAPSHOT",
        cls: "tag-late",
      };
    return { rank: 4, text: "NOT YET INNING 9", cls: "tag-early" };
  }

  function boardRow(game, now) {
    const entry = snapshots.get(game.gamePk);
    const result = entry?.result || null;
    // A paused/delayed game is a live game whose play is stopped; evaluate()
    // deliberately reports no active situation for it, so read the status.
    const delayed = isPausedStatus(game.status);
    const phase = boardPhase(game, entry, delayed);
    const away = game.teams?.away?.team?.name || "Away";
    const home = game.teams?.home?.team?.name || "Home";
    const awayScore = scoreOfSide(game, result, "away");
    const homeScore = scoreOfSide(game, result, "home");
    const score =
      awayScore === null || homeScore === null
        ? "—"
        : `${awayScore}–${homeScore}`;
    const outs =
      result && !entry?.error && Number.isInteger(result.outs) && result.outs < 3
        ? `${result.outs} out${result.outs === 1 ? "" : "s"}`
        : Number.isInteger(game.linescore?.outs) &&
            game.linescore.outs < 3 &&
            game.status?.abstractGameState === "Live" &&
            !delayed
          ? `${game.linescore.outs} out${game.linescore.outs === 1 ? "" : "s"}`
          : "";
    // A scheduled game has no half-inning yet, so show its first pitch instead.
    const firstPitch =
      typeof MLB.localTime === "function" ? MLB.localTime(game.gameDate) : "";
    const fallbackWhen =
      game.status?.abstractGameState === "Preview"
        ? [firstPitch, "first pitch"].filter(Boolean).join(" ")
        : "";
    const when =
      [halfText(game), outs].filter(Boolean).join(" · ") || fallbackWhen;
    // Provenance is part of the row: you can always tell where a number came
    // from and how old it is.
    const source = !entry
      ? demo
        ? "synthetic (demo)"
        : game.status?.abstractGameState === "Live"
          ? "official schedule scan"
          : "official schedule"
      : entry.error
        ? `${entry.error} · last confirmed ${ageText(entry.at, now)}`
        : delayed
          ? `snapshot · play paused · ${ageText(entry.at, now)}`
          : demo
            ? `synthetic snapshot · ${ageText(entry.at, now)}`
            : `live snapshot · ${ageText(entry.at, now)}`;
    return `<div class="board-row ${phase.cls}">
      <span class="board-teams">${escape(away)} <b>${escape(score)}</b> ${escape(home)}</span>
      <span class="board-when">${escape(when || "—")}</span>
      <span class="board-tag">${escape(phase.text)}</span>
      <span class="board-source">${escape(source)}</span>
      ${demo ? "" : `<a href="game.html?gamePk=${encodeURIComponent(game.gamePk)}">open ↗</a>`}
    </div>`;
  }

  function renderBoard() {
    const node = $("board");
    if (!node) return;
    const now = Date.now();
    const list = [...games.values()].map((game) => ({
      game,
      phase: boardPhase(game, snapshots.get(game.gamePk), isPausedStatus(game.status)),
    }));
    list.sort(
      (a, b) =>
        a.phase.rank - b.phase.rank ||
        (b.game.linescore?.currentInning || 0) -
          (a.game.linescore?.currentInning || 0),
    );
    const live = [...games.values()].filter(
      (game) => game.status?.abstractGameState === "Live",
    ).length;
    // An empty slate means one of two very different things: the first scan has
    // not answered yet, or the official schedule really has no games for today
    // (an off-day). Say which one it is instead of implying a scan is pending.
    node.innerHTML = list.length
      ? list.map(({ game }) => boardRow(game, now)).join("")
      : empty(
          discoveryAt ? "No games scheduled on this date" : "No games on the slate yet",
          discoveryAt
            ? "The official schedule scan found no games for today. The next slate is picked up automatically."
            : "The official schedule scan fills this list every 15 seconds.",
          "◇",
        );
    const summary = $("board-summary");
    if (summary)
      summary.textContent = demo
        ? `DEMO · ${games.size} synthetic games · no live requests, no history writes`
        : `${games.size} game${games.size === 1 ? "" : "s"} on radar · ${live} live · schedule scan 15s · late innings 2s · updated ${time(now)}`;
  }

  function feedback(message) {
    $("feedback").textContent = message;
  }

  function restore() {
    if (demo) return;
    try {
      const saved = JSON.parse(localStorage.getItem(STORE) || "{}");
      history = (Array.isArray(saved.history) ? saved.history : [])
        .filter(
          (e) =>
            validPk(e.gamePk) &&
            Number.isFinite(e.observedAt) &&
            e.observedAt > Date.now() - WEEK &&
            Number.isInteger(e.inning) &&
            e.inning >= 9 &&
            Array.isArray(e.runners),
        )
        .slice(0, 200);
      states = Object.fromEntries(
        Object.entries(saved.states || {}).filter(
          ([pk, s]) =>
            validPk(pk) &&
            s &&
            Number.isFinite(s.observedAt) &&
            s.observedAt > Date.now() - WEEK,
        ),
      );
      const prefs = JSON.parse(localStorage.getItem(PREFS) || "{}");
      notificationsEnabled = prefs.notifications === true;
    } catch (_) {
      feedback(
        "Browser storage unavailable or invalid. Alerts will still work for this session.",
      );
    }
  }

  function save() {
    history = history
      .filter((e) => e.observedAt > Date.now() - WEEK)
      .slice(0, 200);
    states = Object.fromEntries(
      Object.entries(states).filter(
        ([, s]) => s?.observedAt > Date.now() - WEEK,
      ),
    );
    if (demo) return;
    // Merge before every write: this monitor saves on each poll, and a strip
    // alert recorded by another page in the meantime must never be clobbered.
    mergeSharedHistory();
    try {
      localStorage.setItem(STORE, JSON.stringify({ history, states }));
    } catch (_) {
      feedback(
        "Could not save history. Live monitoring still works, but history may not survive a refresh.",
      );
    }
  }

  /**
   * Re-read the shared alert log and union it with this page's memory by id.
   * The monitor and the site-wide strip write one log
   * (localStorage 'loaded-late:v3'); merging at decision time means an alert
   * observed on the other page is (a) never dropped by our next save and
   * (b) able to quiet our chime inside the cross-page window.
   */
  function mergeSharedHistory() {
    if (demo) return history;
    try {
      const saved = JSON.parse(localStorage.getItem(STORE) || "{}");
      const byId = new Map();
      for (const entry of [
        ...(Array.isArray(saved.history) ? saved.history : []),
        ...history,
      ])
        if (entry && entry.id) byId.set(entry.id, entry);
      history = [...byId.values()]
        .sort((a, b) => (b.observedAt || 0) - (a.observedAt || 0))
        .slice(0, 200);
    } catch (_) {
      // Unreadable log: fall back to this page's own memory.
    }
    return history;
  }

  function updateNotificationButton() {
    const supported = "Notification" in window;
    if (!supported || Notification.permission !== "granted")
      notificationsEnabled = false;
    $("notify").textContent = !supported
      ? "Notifications unavailable"
      : notificationsEnabled
        ? "Notifications on"
        : Notification.permission === "denied"
          ? "Notifications blocked"
          : "Enable notifications";
    $("notify").setAttribute("aria-pressed", String(notificationsEnabled));
  }

  async function chime() {
    if (!soundEnabled || !audio) return;
    try {
      await audio.resume();
      [659.25, 880, 987.77].forEach((frequency, i) => {
        const oscillator = audio.createOscillator(),
          gain = audio.createGain();
        const start = audio.currentTime + i * 0.15;
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.1, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.5);
        oscillator.connect(gain);
        gain.connect(audio.destination);
        oscillator.start(start);
        oscillator.stop(start + 0.55);
        oscillator.onended = () => {
          oscillator.disconnect();
          gain.disconnect();
        };
      });
    } catch (_) {
      feedback("Audio was blocked. Turn sound off and on to try again.");
    }
  }

  /**
   * Clicking the desktop notification brings the monitor back into view and
   * highlights the card for that game. It deliberately does not navigate: the
   * monitoring tab must survive, so the alert is shown in place.
   */
  function focusGame(gamePk) {
    highlightPk = gamePk;
    highlightUntil = Date.now() + HIGHLIGHT_MS;
    try {
      window.focus();
    } catch (_) {}
    render();
    try {
      $("current")?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    } catch (_) {}
    try {
      setTimeout(() => {
        highlightPk = null;
        render();
      }, HIGHLIGHT_MS);
    } catch (_) {}
  }

  function announce(event) {
    if (
      notificationsEnabled &&
      "Notification" in window &&
      Notification.permission === "granted"
    ) {
      try {
        const countStr =
          event.balls != null && event.strikes != null
            ? `${event.balls}-${event.strikes}`
            : "";
        const batterStr = event.batter?.name || "";
        const body = [
          `${event.away} at ${event.home} · ${event.awayScore}–${event.homeScore}`,
          `${event.outs} out${event.outs === 1 ? "" : "s"}${countStr ? ` · ${countStr} count` : ""}`,
          batterStr ? `Batter: ${batterStr}` : "",
        ]
          .filter(Boolean)
          .join("\n");
        const notice = new Notification(
          `${demo ? "DEMO · " : ""}Tied. Bases loaded. Bottom ${event.inning}.${event.tension >= 4 ? " 🔥 " + event.tensionLabel : ""}`,
          { body, tag: event.id },
        );
        notice.onclick = () => {
          notice.close();
          focusGame(event.gamePk);
        };
      } catch (_) {
        feedback(
          "This browser cannot show desktop notifications. On-page alerts remain active.",
        );
      }
    }
  }

  function accept(game, now) {
    const observation = rules.observe(states[game.gamePk], game, now);
    if (observation.state) states[game.gamePk] = observation.state;
    snapshots.set(game.gamePk, {
      game,
      result: observation.result,
      at: now,
      error: observation.result.known
        ? ""
        : "Incomplete official data — waiting for confirmation",
    });
    if (!observation.event) return false;
    // Cross-page quiet window: if the other page of this site (strip or other
    // tab) already chimed for this exact game + inning moments ago, record the
    // observation but stay silent — entries this page wrote itself never
    // count, so a confirmed exit and reload still alerts again here.
    const repeated = rules.recentSharedAlert(
      mergeSharedHistory(),
      game.gamePk,
      observation.event.inning,
      now,
      QUIET_MS,
      PAGE_ID,
    );
    history.unshift({
      ...observation.event,
      observer: PAGE_ID,
      crossPage: repeated,
    });
    if (!repeated) announce(observation.event);
    return !repeated;
  }

  function card(game, result, options = {}) {
    const { historical, stamp, error, highlight } = options;
    const isLoaded = result.loaded && !error;
    const away = game.teams?.away?.team?.name || "Away",
      home = game.teams?.home?.team?.name || "Home";
    const bases = result.entering
      ? "<span>Home half pending</span>"
      : result.bases
          .map(
            (runner, i) =>
              `<span class="${runner ? "occupied" : ""}" title="${escape(runner?.name || "Empty")}">${i + 1}B ${runner ? "●" : "○"}</span>`,
          )
          .join("");

    // Count display
    const countHTML =
      result.balls != null && result.strikes != null
        ? `<div class="card-count">
            <span class="count-label">COUNT</span>
            <span class="count-value">${escape(countDisplay(result.balls, result.strikes))}</span>
            <span class="count-dots">
              <span class="count-balls" title="Balls">${countDots(result.balls, 4)}</span>
              <span class="count-strikes" title="Strikes">${countDots(result.strikes, 3)}</span>
            </span>
          </div>`
        : "";

    // Outs display
    const outsHTML =
      result.outs != null
        ? `<div class="card-outs">
            <span class="outs-label">OUTS</span>
            <span class="outs-value">${result.outs}</span>
            <span class="outs-dots">${countDots(result.outs, 3)}</span>
          </div>`
        : "";

    // Tension display
    const tensionHTML =
      isLoaded && result.tension != null
        ? `<div class="card-tension tension-${result.tension}">
            <span class="tension-label">TENSION</span>
            <span class="tension-bar">${tensionBar(result.tension)}</span>
            <span class="tension-text ${result.tension >= 4 ? "extreme" : ""}">${escape(result.tensionLabel)}</span>
          </div>`
        : "";

    // Batter/pitcher display
    const matchupHTML =
      (result.batter || result.pitcher) && (isLoaded || result.watching)
        ? `<div class="card-matchup">
            ${result.batter ? `<span class="matchup-batter" title="Current batter">⚾ ${escape(result.batter.name)}</span>` : ""}
            ${result.pitcher ? `<span class="matchup-pitcher" title="Current pitcher">🎯 ${escape(result.pitcher.name)}</span>` : ""}
            ${result.onDeck ? `<span class="matchup-ondeck" title="On deck">↗ ${escape(result.onDeck.name)}</span>` : ""}
          </div>`
        : "";

    // Last event description (context for how we got here)
    const eventHTML =
      result.lastEvent && (isLoaded || result.watching)
        ? `<div class="card-event"><span class="event-label">LAST PLAY:</span> ${escape(result.lastEvent)}</div>`
        : "";

    // Watch context: how many runners on
    const watchContext =
      !isLoaded && !historical && result.watching && !result.entering
        ? `<div class="card-watch-context">
            <span>${result.runnersOn} runner${result.runnersOn === 1 ? "" : "s"} on · ${3 - result.runnersOn} base${3 - result.runnersOn === 1 ? "" : "s"} to fill</span>
          </div>`
        : "";

    // Build badge text
    let badgeText;
    if (historical) badgeText = "OBSERVED BASES LOADED";
    else if (error) badgeText = "DATA UNCONFIRMED";
    else if (isLoaded) badgeText = `● BASES LOADED · ALERT${result.tension >= 5 ? " · MAX TENSION" : ""}`;
    else badgeText = "◉ ON WATCH";

    // History card: show saved runners with batter/pitcher if available
    const historyDetailHTML = historical
      ? `<div class="history-details">
          ${result.bases.map((r, i) => `${i + 1}B: ${escape(r?.name || "Runner")}`).join(" · ")}
          ${result.batter ? `<br>Batter: ${escape(result.batter.name)}` : ""}
          ${result.pitcher ? ` · Pitcher: ${escape(result.pitcher.name)}` : ""}
          ${result.balls != null && result.strikes != null ? `<br>Count: ${escape(countDisplay(result.balls, result.strikes))}` : ""}
          ${result.tension != null ? ` · Tension: ${escape(result.tensionLabel)}` : ""}
        </div>`
      : "";

    return `<article class="alert-card ${historical ? "history-card" : isLoaded ? "loaded" : ""} ${isLoaded && result.tension >= 5 ? "max-tension" : ""}${highlight ? " card-highlight" : ""}">
      <div class="card-top">
        <span class="card-badge">${badgeText}</span>
        <span class="card-time">${historical ? escape(new Date(stamp).toLocaleDateString([], { month: "short", day: "numeric" })) + " · " : ""}${escape(time(stamp))}</span>
      </div>
      <h3>${escape(away)} <span style="color:#85958a">at</span> ${escape(home)}</h3>
      <div class="card-score">${escape(result.away)} – ${escape(result.home)}<span>${result.tied ? "TIED" : ""} · ${result.entering ? "ENTERING BOT" : "BOT"} ${escape(result.inning)}</span></div>
      ${tensionHTML}
      <div class="card-situation">
        ${outsHTML}
        ${countHTML}
      </div>
      ${matchupHTML}
      ${eventHTML}
      ${watchContext}
      ${error ? `<p class="stale-note">${escape(error)}. Last observed state, not a current alert.</p>` : ""}
      <div class="card-footer">
        <div class="mini-bases" aria-label="Base occupancy">${bases}</div>
        ${demo ? '<span class="card-time">Synthetic game</span>' : `<a href="game.html?gamePk=${encodeURIComponent(game.gamePk)}">Open game ↗</a>`}
      </div>
      ${historyDetailHTML}
    </article>`;
  }

  function render() {
    const entries = [...snapshots.values()];
    const current = entries.filter((s) => s.result.loaded && !s.error);
    const watching = entries.filter(
      (s) => s.result.watching && !s.result.loaded && !s.error,
    );
    const unconfirmed = entries.filter((s) => s.error);
    // A delay or suspension pauses play; it never proves the bases cleared.
    // The watch is held (see rules.observe), so the pause is shown, not hidden.
    const pausedLate = entries.filter(
      (s) =>
        !s.error &&
        isPausedStatus(s.game.status) &&
        s.result.known &&
        s.result.tied &&
        Number.isInteger(s.result.inning) &&
        s.result.inning >= 9,
    );
    const now = Date.now();
    if (highlightPk && now > highlightUntil) highlightPk = null;

    $("games-count").textContent = discoveryAt || demo ? games.size : "—";
    $("watch-count").textContent =
      discoveryAt || demo ? current.length + watching.length : "—";
    $("active-count").textContent = discoveryAt || demo ? current.length : "—";
    $("tied-count").textContent =
      discoveryAt || demo
        ? current.length + watching.length + pausedLate.length
        : "—";
    $("history-count").textContent = history.length;

    // Tension summary: count max-tension alerts
    const maxTensionCount = current.filter((s) => s.result.tension >= 5).length;
    if ($("tension-count")) {
      $("tension-count").textContent =
        discoveryAt || demo ? maxTensionCount : "—";
    }

    $("current").innerHTML = current.length
      ? current
          .map((s) =>
            card(s.game, s.result, {
              stamp: s.at,
              highlight: s.game.gamePk === highlightPk,
            }),
          )
          .join("")
      : empty(
          unconfirmed.length || scheduleError
            ? "Live status is not fully confirmed"
            : "No matching situation right now",
          unconfirmed.length || scheduleError
            ? "Some MLB data is unavailable. We will retry automatically; no all-clear is implied."
            : "When the exact situation appears, it will be highlighted here.",
        );

    $("watch").innerHTML =
      watching
        .map((s) =>
          card(s.game, s.result, {
            stamp: s.at,
            highlight: s.game.gamePk === highlightPk,
          }),
        )
        .join("") +
        pausedLate
          .map(
            (s) => `<div class="alert-empty paused-note">
              <strong>PAUSED · ${escape(s.game.teams?.away?.team?.name || "Away")} at ${escape(s.game.teams?.home?.team?.name || "Home")}</strong>
              Tied ${escape(s.result.away)}–${escape(s.result.home)} in the ${s.result.inning}th, ${escape(String(s.game.status?.detailedState || "delayed"))}.
              The watch window is held, so resuming play cannot create a duplicate alert and the situation cannot be lost while play is stopped.
            </div>`,
          )
          .join("") +
        unconfirmed
          .map(
            (s) =>
              `<div class="alert-empty stale-note">${escape(s.game.teams?.away?.team?.name || "Away")} at ${escape(s.game.teams?.home?.team?.name || "Home")}<br>${escape(s.error)}. Not counted as live.</div>`,
          )
          .join("") ||
      empty(
        current.length
          ? "No additional games waiting to load"
          : "Waiting for a tied late-inning game",
        current.length
          ? "Matching games are shown in Live alerts above."
          : "The watch begins when a tied game enters the bottom of the 9th or any later inning.",
      );

    renderBoard();

    $("history").innerHTML = history.length
      ? history
          .map((e) =>
            card(
              {
                gamePk: e.gamePk,
                teams: {
                  away: { team: { name: e.away } },
                  home: { team: { name: e.home } },
                },
              },
              {
                bases: e.runners,
                inning: e.inning,
                away: e.awayScore,
                home: e.homeScore,
                outs: e.outs,
                balls: e.balls,
                strikes: e.strikes,
                batter: e.batter,
                pitcher: e.pitcher,
                onDeck: e.onDeck,
                tension: e.tension,
                tensionLabel: e.tensionLabel,
                lastEvent: e.lastEvent,
                loaded: true,
                tied: true,
                entering: false,
              },
              { historical: true, stamp: e.observedAt },
            ),
          )
          .join("")
      : empty(
          "No alerts observed yet",
          "Only exact matches are saved. Repeated polls do not create duplicate alerts.",
          "↳",
        );

    const connecting = !demo && !discoveryAt && !scheduleError;
    if (connecting)
      $("current").innerHTML = empty(
        "Checking the official MLB schedule…",
        "Live status has not been confirmed yet.",
      );

    const paused = document.hidden;
    $("status").textContent = demo
      ? "Demo mode · live polling off"
      : paused
        ? "Paused · return to this tab to monitor"
        : connecting
          ? "Connecting to MLB…"
          : scheduleError || unconfirmed.length
            ? "Connection degraded · retrying"
            : "Monitoring MLB · exact matches only";
    $("connection-dot").classList.toggle(
      "warning-dot",
      paused || !!scheduleError || unconfirmed.length > 0,
    );
    $("updated").textContent = demo
      ? "Step through the scenarios below"
      : `${lastUpdate ? `Last live scan ${time(lastUpdate)}` : "Waiting for official data"} · ${scheduleError || "Schedule 15s / late innings 2s"}`;

    // Dynamic title with tension info
    if (current.length) {
      const maxT = current.filter((s) => s.result.tension >= 5).length;
      document.title = `(${current.length}) BASES LOADED${maxT ? " · " + maxT + " MAX TENSION" : ""} — Loaded Late`;
    } else {
      document.title = "Loaded Late — MLB situation alerts";
    }
  }

  async function discover() {
    const dates = rules.scheduleDates();
    if (
      dateKey === dates.join() &&
      Date.now() - discoveryAttempt < DISCOVERY_MS
    )
      return;
    discoveryAttempt = Date.now();
    dateKey = dates.join();
    try {
      const slates = await Promise.all(
        dates.map((date) => MLB.getSchedule(date, { retries: 0 })),
      );
      const next = new Map();
      slates.forEach((slate, index) =>
        slate.forEach((game) => {
          // Today's entire slate, plus only live games carried over from yesterday.
          if (index === 0 || game.status?.abstractGameState === "Live")
            next.set(game.gamePk, game);
        }),
      );
      games = next;
      dateKey = dates.join();
      discoveryAt = Date.now();
      scheduleError = "";
      for (const pk of snapshots.keys())
        if (!games.has(pk)) snapshots.delete(pk);
    } catch (_) {
      scheduleError = "Schedule unavailable — discovery will retry";
    }
  }

  async function poll(force = false) {
    if (demo || busy || document.hidden) return;
    clearTimeout(timer);
    busy = true;
    $("refresh").disabled = true;
    if (force) discoveryAttempt = 0;
    try {
      await discover();
      let newAlert = false;
      // Same target rule as the site-wide strip (assets/js/bases-loaded-core.js):
      // live games in inning 9+, plus any game already carrying an active watch.
      const targets = [...games.values()].filter((game) =>
        rules.scanTarget(game, states[game.gamePk]),
      );
      const targetIds = new Set(targets.map((g) => g.gamePk));
      for (const [pk, game] of games) {
        if (!targetIds.has(pk)) {
          snapshots.delete(pk);
          if (game.status?.abstractGameState === "Final" && states[pk])
            states[pk].active = false;
        }
      }
      let cursor = 0;
      async function worker() {
        while (cursor < targets.length && !document.hidden) {
          const game = targets[cursor++];
          try {
            const feed = await MLB.getAlertSnapshot(game.gamePk);
            if (document.hidden) return;
            newAlert =
              accept(rules.snapshotGame(game, feed), Date.now()) || newAlert;
          } catch (_) {
            if (document.hidden) return;
            const prior = snapshots.get(game.gamePk);
            snapshots.set(game.gamePk, {
              game,
              result: prior?.result || rules.evaluate(game),
              at: prior?.at || Date.now(),
              error: "Live snapshot unavailable — retrying",
            });
          }
        }
      }
      await Promise.all(
        Array.from({ length: Math.min(4, targets.length) }, worker),
      );
      if (newAlert) chime();
      if (!document.hidden) lastUpdate = Date.now();
      save();
      render();
    } catch (_) {
      scheduleError = "Monitor update failed — retrying";
      render();
    } finally {
      busy = false;
      $("refresh").disabled = false;
      if (!document.hidden) timer = setTimeout(() => poll(), SCAN_MS);
    }
  }

  $("sound").addEventListener("click", async () => {
    try {
      if (!soundEnabled) {
        audio ||= new (window.AudioContext || window.webkitAudioContext)();
        await audio.resume();
      }
      soundEnabled = !soundEnabled;
      $("sound").textContent = soundEnabled ? "Sound on" : "Sound off";
      $("sound").setAttribute("aria-pressed", String(soundEnabled));
      if (soundEnabled) {
        chime();
        feedback(
          "Sound enabled. This preview is the same chime used for a matching situation.",
        );
      }
    } catch (_) {
      feedback("Sound is not supported or was blocked by your browser.");
    }
  });

  $("notify").addEventListener("click", async () => {
    if (!("Notification" in window)) {
      feedback(
        "Desktop notifications are unavailable here. Use on-page alerts and sound.",
      );
      return;
    }
    try {
      if (notificationsEnabled) notificationsEnabled = false;
      else
        notificationsEnabled =
          (await Notification.requestPermission()) === "granted";
      updateNotificationButton();
      feedback(
        notificationsEnabled
          ? "Notifications enabled for this monitor while it is running."
          : Notification.permission === "denied"
            ? "Notifications are blocked. Change this site's permission in browser settings to enable them."
            : "Desktop notifications are off. On-page alerts still work.",
      );
      if (!demo) {
        try {
          localStorage.setItem(
            PREFS,
            JSON.stringify({ notifications: notificationsEnabled }),
          );
        } catch (_) {}
      }
    } catch (_) {
      feedback(
        "Notification permission could not be requested in this browser.",
      );
    }
  });

  $("refresh").addEventListener("click", () => (demo ? render() : poll(true)));
  document.addEventListener("visibilitychange", () => {
    clearTimeout(timer);
    if (document.hidden) {
      for (const entry of snapshots.values()) entry.error = "Monitoring paused";
      render();
    } else if (!demo) poll(true);
    else showDemo(false);
  });

  // Representative synthetic paths; detection never depends on play descriptions.
  const demoSteps = [
    {
      inning: 9,
      state: "Top",
      outs: 2,
      balls: 1,
      strikes: 2,
      bases: [true, true, true],
      text: "Top 9, tied, bases loaded: deliberately NO alert. Only the home half qualifies.",
    },
    {
      inning: 9,
      state: "Middle",
      outs: 3,
      balls: 0,
      strikes: 0,
      bases: [],
      text: "Top 9 ends tied. The game enters the watch window; stale top-half runners cannot trigger an alert.",
    },
    {
      inning: 9,
      state: "Bottom",
      outs: 0,
      balls: 0,
      strikes: 0,
      bases: [false, false, false],
      text: "Bottom 9 begins, tied. No runners. On watch, watching for any path to loaded bases.",
    },
    {
      inning: 9,
      state: "Bottom",
      outs: 0,
      balls: 0,
      strikes: 0,
      bases: [true, false, false],
      batter: "J. Ramirez",
      pitcher: "C. Sale",
      text: "Leadoff walk — runner on first. One base filled via a four-pitch walk.",
    },
    {
      inning: 9,
      state: "Bottom",
      outs: 0,
      balls: 0,
      strikes: 0,
      bases: [true, true, false],
      batter: "A. Judge",
      pitcher: "C. Sale",
      text: "Single advances the runner. Runners on first and second. Hit is one path.",
    },
    {
      inning: 9,
      state: "Bottom",
      outs: 1,
      balls: 2,
      strikes: 2,
      bases: [false, true, true],
      batter: "S. Ohtani",
      pitcher: "C. Sale",
      text: "Groundout advances runners to 2nd and 3rd, but first is now open. One out, not yet loaded.",
    },
    {
      inning: 9,
      state: "Bottom",
      outs: 1,
      balls: 0,
      strikes: 0,
      bases: [true, true, true],
      batter: "M. Trout",
      pitcher: "C. Sale",
      onDeck: "B. Harper",
      lastEvent: "Intentional Walk",
      text: "Intentional walk loads the bases! Exact match: alert fires. IBB is one of many paths to loaded bases.",
    },
    {
      inning: 9,
      state: "Bottom",
      outs: 1,
      balls: 0,
      strikes: 0,
      bases: [true, true, true],
      batter: "M. Trout",
      pitcher: "C. Sale",
      text: "Same situation on the next poll: no duplicate alert. The system tracks continuity.",
    },
    {
      inning: 9,
      state: "Bottom",
      outs: 2,
      balls: 3,
      strikes: 2,
      bases: [false, true, true],
      batter: "M. Trout",
      pitcher: "C. Sale",
      text: "Runner picked off first! Alert clears. Still tied, 3-2 count, 2 outs. Re-armed for a new load.",
    },
    {
      inning: 9,
      state: "Bottom",
      outs: 2,
      balls: 0,
      strikes: 0,
      bases: [true, true, true],
      batter: "B. Harper",
      pitcher: "C. Sale",
      text: "Hit-by-pitch fills the open first base! New alert at 2 outs. The next batter starts with a fresh 0-0 count; no particular count is required.",
    },
    {
      inning: 9,
      state: "Bottom",
      outs: 2,
      balls: 0,
      strikes: 0,
      bases: [false, false, false],
      home: 5,
      final: true,
      text: "Walk-off hit! The home team leads and the game is final. Leftover runner data never triggers an alert.",
    },
    {
      inning: 10,
      state: "Bottom",
      outs: 0,
      balls: 0,
      strikes: 0,
      bases: [false, true, false],
      batter: "M. Betts",
      pitcher: "J. Hader",
      text: "Extra innings: bottom 10, tied. The automatic runner starts on second. Only one base is occupied — no alert yet.",
    },
    {
      inning: 10,
      state: "Bottom",
      outs: 0,
      balls: 0,
      strikes: 0,
      bases: [true, true, false],
      batter: "F. Freeman",
      pitcher: "J. Hader",
      lastEvent: "Walk",
      text: "A walk puts the batter on first; the automatic runner remains on second. Two occupied bases, still on watch.",
    },
    {
      inning: 10,
      state: "Bottom",
      outs: 0,
      balls: 0,
      strikes: 0,
      bases: [true, true, true],
      batter: "W. Smith",
      pitcher: "J. Hader",
      lastEvent: "Error",
      text: "Fielding error loads the bases in bottom 10! Alert fires. Errors count — official occupancy decides.",
    },
    {
      inning: 14,
      state: "Bottom",
      outs: 1,
      balls: 3,
      strikes: 2,
      bases: [true, true, true],
      batter: "C. Correa",
      pitcher: "E. Diaz",
      text: "Bottom 14, 2 walks + placed runner = loaded. Full count, one out. No upper inning limit exists.",
    },
    {
      inning: 15,
      state: "Bottom",
      outs: 1,
      balls: 3,
      strikes: 1,
      bases: [true, true, true],
      home: 3,
      text: "Bottom 15, loaded, but the home team trails 4–3. We scan this game, but it is not a tied-game alert.",
    },
    {
      inning: 15,
      state: "Bottom",
      outs: 1,
      balls: 0,
      strikes: 0,
      bases: [true, true, true],
      lastEvent: "Walk",
      text: "A bases-loaded walk forces in the tying run: 4–4, still loaded! Alert immediately, even though the home half began with an unequal score.",
    },
  ];

  // A few fixed slate rows so the demo also shows how non-qualifying games are
  // labelled. They never change state and never produce an alert.
  const demoSlate = [
    {
      gamePk: 999002,
      status: { abstractGameState: "Live", detailedState: "In Progress" },
      teams: {
        away: { team: { name: "Demo Early Visitors" }, score: 1 },
        home: { team: { name: "Demo Early Home" }, score: 0 },
      },
      linescore: { currentInning: 4, inningState: "Top", outs: 1 },
    },
    {
      gamePk: 999003,
      status: { abstractGameState: "Live", detailedState: "Delayed" },
      teams: {
        away: { team: { name: "Demo Rain Visitors" }, score: 2 },
        home: { team: { name: "Demo Rain Home" }, score: 2 },
      },
      linescore: { currentInning: 10, inningState: "Bottom", outs: 1 },
    },
    {
      gamePk: 999004,
      status: { abstractGameState: "Final", detailedState: "Final" },
      teams: {
        away: { team: { name: "Demo Final Visitors" }, score: 3 },
        home: { team: { name: "Demo Final Home" }, score: 6 },
      },
      linescore: { currentInning: 9, inningState: "End", outs: 3, innings: [] },
    },
  ];

  function showDemo(advance = true) {
    const step = demoSteps[demoStep];
    const game = {
      gamePk: 999001,
      status: {
        abstractGameState: step.final ? "Final" : "Live",
        detailedState: step.final ? "Final" : "In Progress",
      },
      teams: {
        away: { team: { name: "Demo Visitors" } },
        home: { team: { name: "Demo Home" } },
      },
      linescore: {
        currentInning: step.inning,
        inningState: step.state,
        isTopInning: step.state === "Top",
        outs: step.outs,
        balls: step.balls ?? 0,
        strikes: step.strikes ?? 0,
        teams: { away: { runs: 4 }, home: { runs: step.home || 4 } },
        offense: Object.fromEntries(
          [
            ["first", step.bases[0]],
            ["second", step.bases[1]],
            ["third", step.bases[2]],
          ].flatMap(([base, occupied]) =>
            occupied
              ? [
                  [
                    base,
                    {
                      id: { first: 11, second: 22, third: 33 }[base],
                      fullName:
                        {
                          first: "Alex Runner",
                          second: "Jordan Runner",
                          third: "Sam Runner",
                        }[base],
                    },
                  ],
                ]
              : [],
          ),
        ),
      },
    };

    // Add batter/pitcher/onDeck if specified
    if (step.batter) {
      game.linescore.offense.batter = {
        id: 100,
        fullName: step.batter,
      };
    }
    if (step.pitcher) {
      game.linescore.defense = {
        pitcher: { id: 200, fullName: step.pitcher },
      };
    }
    if (step.onDeck) {
      game.linescore.offense.onDeck = {
        id: 150,
        fullName: step.onDeck,
      };
    }
    if (step.lastEvent) {
      game.linescore.currentPlay = {
        result: { event: step.lastEvent, description: step.lastEvent },
      };
    }

    games.set(game.gamePk, game);
    if (accept(game, Date.now()) && advance) chime();
    $("demo-description").textContent =
      `${demoStep + 1}/${demoSteps.length} · ${step.text}`;
    $("demo-next").textContent =
      demoStep === demoSteps.length - 1 ? "Restart demo ↺" : "Next scenario →";
    render();
  }

  $("demo-next").addEventListener("click", () => {
    demoStep = (demoStep + 1) % demoSteps.length;
    if (demoStep === 0) {
      history = [];
      states = {};
      snapshots.clear();
    }
    showDemo();
  });

  // Stale-snapshot watcher
  if (!demo)
    setInterval(() => {
      let changed = false;
      for (const entry of snapshots.values()) {
        if (!entry.error && Date.now() - entry.at > STALE_MS) {
          entry.error = "Snapshot is stale — awaiting fresh MLB data";
          changed = true;
        }
      }
      if (changed) render();
    }, 2000);

  restore();
  updateNotificationButton();
  if (demo) {
    $("demo-banner").hidden = false;
    for (const game of demoSlate) games.set(game.gamePk, game);
    showDemo();
  } else {
    render();
    poll();
  }
})();
