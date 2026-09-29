/* ============================================================================
 * bases-loaded-strip.js — site-wide "Loaded Late" watcher.
 *
 * The monitor page (index.html / bases-loaded.html) is the full dashboard for
 * the one situation this system tracks:
 *
 *     tied score + all three bases occupied + bottom of the 9th or later
 *
 * That dashboard only helps if it is the tab you are looking at. This script
 * runs on the *other* pages of this copy of the site — the scoreboard, the
 * replay feed and the game view — and mounts a slim bar that watches every
 * live MLB game for exactly that situation, in exactly the same way:
 *
 *   - it reuses the shared rules engine (assets/js/bases-loaded-core.js), so
 *     the strip and the dashboard can never disagree about what counts;
 *   - it reuses the shared alert log (localStorage 'loaded-late:v3'), so moving
 *     between pages does not alert twice for one continuous situation, and an
 *     alert observed here also appears in the dashboard's history;
 *   - it reuses the shared notification preference, so opting in once opts in
 *     for every page of the site in this browser.
 *
 * Zero dependencies, no build step. If the page has no MLB api client, the
 * strip says so instead of pretending to watch.
 * ==========================================================================*/
"use strict";
(() => {
  // `BasesLoadedRules` is a script-scope binding, so it is referenced directly
  // and never through `window`.
  const rules = typeof BasesLoadedRules === "undefined" ? null : BasesLoadedRules;
  if (!rules || typeof document === "undefined") return;

  const api = typeof MLB === "undefined" ? null : MLB;

  /* ------------------------------------------------------------- constants */
  const STORE = "loaded-late:v3"; // shared with the dashboard
  const PREFS = "loaded-late:preferences"; // shared with the dashboard
  const MOUNT_ID = "loaded-late-strip";
  const WEEK = 7 * 86400000;
  const MAX_HISTORY = 200;
  const SCAN_MS = 5000; // live snapshots while a game is in / entering inning 9+
  const DISCOVERY_FAST_MS = 15000; // schedule refresh while something is late
  const DISCOVERY_SLOW_MS = 30000; // schedule refresh while nothing is late
  const CROSS_PAGE_QUIET_MS = 90000; // shared-log quiet window (see core)
  const STALE_MS = 12000; // a snapshot older than this is not shown as live
  const CONCURRENCY = 4;
  // Identifies this page instance in the shared log: entries this page wrote
  // itself never trigger its own quiet window, so a confirmed exit and reload
  // still chimes here while another page's recent alert stays silent.
  const PAGE_ID =
    Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

  const demo =
    typeof location !== "undefined" &&
    /(^|[?&])ll-demo=1(&|$)/.test(location.search || "");

  /* ---------------------------------------------------------------- state */
  let history = [];
  let states = {};
  let games = new Map();
  const snapshots = new Map();
  let busy = false;
  let timer;
  let staleTimer;
  let dateKey = "";
  let discoveryAt = 0;
  let discoveryFailed = false;
  let lastScanAt = 0;
  let soundEnabled = false;
  let notificationsEnabled = false;
  let audio;
  let dismissed = false; // user hid the toast for the situation they saw

  /* ------------------------------------------------------------------ DOM */
  const strip = { node: null, state: null, detail: null, sound: null, notify: null, scan: null, toast: null };

  const escape = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
    );

  const clock = (stamp) =>
    new Date(stamp).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    });

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function mount() {
    if (strip.node || document.getElementById(MOUNT_ID)) {
      strip.node ||= document.getElementById(MOUNT_ID);
      return strip.node;
    }
    const root = el("section", "ll-strip ll-idle");
    root.id = MOUNT_ID;
    root.setAttribute("role", "region");
    root.setAttribute(
      "aria-label",
      "Loaded Late alert: tied game with the bases loaded in the bottom of the 9th inning or later",
    );

    const main = el("div", "ll-main");
    const brand = el("span", "ll-brand");
    brand.innerHTML =
      '<span class="ll-mark">◆</span>LOADED<span class="ll-accent">LATE</span><span class="ll-tag">tied · loaded · bot 9+</span>';
    main.appendChild(brand);

    const state = el("span", "ll-state", "Starting the load");
    state.setAttribute("role", "status");
    state.setAttribute("aria-live", "polite");
    main.appendChild(state);

    const actions = el("span", "ll-actions");
    const sound = el("button", "ll-btn", "Sound off");
    sound.setAttribute("type", "button");
    sound.setAttribute("aria-pressed", "false");
    sound.title =
      "Play a chime when a tied, bases-loaded situation appears in the bottom of the 9th or later";
    const notify = el("button", "ll-btn", "Alerts off");
    notify.setAttribute("type", "button");
    notify.setAttribute("aria-pressed", "false");
    notify.title =
      "Desktop notification when a tied, bases-loaded situation appears (one opt-in covers every page of this site)";
    const scan = el("button", "ll-btn", "↻");
    scan.setAttribute("type", "button");
    scan.title = "Check the official MLB feed now";
    const monitor = el("a", "ll-btn ll-monitor", "Monitor ↗");
    monitor.setAttribute("href", "bases-loaded.html");
    monitor.title = "Open the full situation monitor";
    actions.appendChild(sound);
    actions.appendChild(notify);
    actions.appendChild(scan);
    actions.appendChild(monitor);
    main.appendChild(actions);
    root.appendChild(main);

    const detail = el("div", "ll-detail");
    root.appendChild(detail);

    const toast = el("aside", "ll-toast");
    toast.setAttribute("role", "alert");
    toast.setAttribute("aria-live", "assertive");
    root.appendChild(toast);

    strip.node = root;
    strip.state = state;
    strip.detail = detail;
    strip.sound = sound;
    strip.notify = notify;
    strip.scan = scan;
    strip.toast = toast;

    sound.addEventListener("click", () => toggleSound());
    notify.addEventListener("click", () => toggleNotifications());
    scan.addEventListener("click", () => (demo ? demoNext() : cycle(true)));
    toast.addEventListener("click", (event) => {
      const target = event.target;
      if (target && target.getAttribute && target.getAttribute("data-dismiss")) {
        dismissed = true;
        render();
      }
    });

    const parent = document.body || document.documentElement;
    parent.insertBefore(root, parent.firstChild || null);
    return root;
  }

  /* ------------------------------------------------------------ storage */

  function restore() {
    if (demo) return;
    try {
      const saved = JSON.parse(localStorage.getItem(STORE) || "{}");
      // Same validation the dashboard applies: a malformed entry is dropped,
      // never guessed at.
      history = (Array.isArray(saved.history) ? saved.history : [])
        .filter(
          (entry) =>
            /^\d+$/.test(String(entry?.gamePk)) &&
            Number.isFinite(entry?.observedAt) &&
            entry.observedAt > Date.now() - WEEK &&
            Number.isInteger(entry?.inning) &&
            entry.inning >= 9 &&
            Array.isArray(entry?.runners),
        )
        .slice(0, MAX_HISTORY);
      states = Object.fromEntries(
        Object.entries(saved.states || {}).filter(
          ([pk, state]) =>
            /^\d+$/.test(pk) &&
            state &&
            Number.isFinite(state.observedAt) &&
            state.observedAt > Date.now() - WEEK,
        ),
      );
      const prefs = JSON.parse(localStorage.getItem(PREFS) || "{}");
      notificationsEnabled = prefs.notifications === true;
    } catch (_) {
      // Storage blocked: live watching still works, only memory is lost.
    }
  }

  /**
   * Merge the shared alert log before deciding anything.
   *
   * Two pages of this site (the dashboard and this strip) can poll the same
   * game in two tabs at the same moment. Neither can see the other's memory,
   * so each re-reads the shared log at the instant it has something to say:
   * the first observer wins the chime and the desktop notice, the second keeps
   * the record but stays quiet. The log is merged, not overwritten, so nothing
   * either page observed is lost.
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
        .slice(0, MAX_HISTORY);
    } catch (_) {
      // Unreadable log: fall back to this page's own memory.
    }
    return history;
  }

  function save() {
    if (demo) return;
    try {
      localStorage.setItem(
        STORE,
        JSON.stringify({
          history: history
            .filter((entry) => entry.observedAt > Date.now() - WEEK)
            .slice(0, MAX_HISTORY),
          states: Object.fromEntries(
            Object.entries(states).filter(
              ([, state]) => state?.observedAt > Date.now() - WEEK,
            ),
          ),
        }),
      );
    } catch (_) {
      // Never fatal: the alert itself does not depend on persistence.
    }
  }

  function savePrefs() {
    if (demo) return;
    try {
      localStorage.setItem(
        PREFS,
        JSON.stringify({ notifications: notificationsEnabled }),
      );
    } catch (_) {}
  }

  /* ------------------------------------------------- alerting (opt-in) */

  async function chime() {
    if (!soundEnabled || !audio) return;
    try {
      await audio.resume();
      [659.25, 880, 987.77].forEach((frequency, index) => {
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        const start = audio.currentTime + index * 0.15;
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
      // Audio blocked: the visual alert is unaffected.
    }
  }

  async function toggleSound() {
    try {
      if (!soundEnabled) {
        audio ||= new (window.AudioContext || window.webkitAudioContext)();
        await audio.resume();
      }
      soundEnabled = !soundEnabled;
      if (soundEnabled) chime();
    } catch (_) {
      soundEnabled = false;
    }
    render();
  }

  async function toggleNotifications() {
    if (!("Notification" in window)) {
      notificationsEnabled = false;
      render();
      return;
    }
    try {
      if (notificationsEnabled) notificationsEnabled = false;
      else
        notificationsEnabled =
          (await Notification.requestPermission()) === "granted";
    } catch (_) {
      notificationsEnabled = false;
    }
    savePrefs();
    render();
  }

  function notify(event) {
    if (
      !notificationsEnabled ||
      !("Notification" in window) ||
      Notification.permission !== "granted"
    )
      return;
    try {
      const context = [
        `${event.away} at ${event.home} · ${event.awayScore}–${event.homeScore}`,
        `${event.outs} out${event.outs === 1 ? "" : "s"}${
          event.balls != null && event.strikes != null
            ? ` · ${event.balls}-${event.strikes} count`
            : ""
        }`,
        event.batter?.name ? `Batter: ${event.batter.name}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      const notice = new Notification(
        `${demo ? "DEMO · " : ""}Tied. Bases loaded. Bottom ${event.inning}.${
          event.tension >= 4 ? ` 🔥 ${event.tensionLabel}` : ""
        }`,
        { body: context, tag: event.id },
      );
      notice.onclick = () => {
        notice.close();
        // Returning from the notification clears a previous dismissal so the
        // alert card is visible again; the page is not navigated away, so the
        // watcher keeps running.
        dismissed = false;
        render();
        window.focus();
      };
    } catch (_) {
      // Some browsers refuse the constructor; the on-page alert remains.
    }
  }

  /* ------------------------------------------------- observation plumbing */

  /**
   * One observed snapshot for one game. Mirrors the monitor's `accept`, with
   * one addition: a situation another page in this browser already alerted
   * inside the quiet window is logged but stays silent.
   */
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
    // Read the shared log first: if another page of this site already alerted
    // this exact game + inning moments ago, this observation stays silent.
    // Entries this strip wrote itself are never counted (see PAGE_ID).
    const repeated = rules.recentSharedAlert(
      mergeSharedHistory(),
      game.gamePk,
      observation.event.inning,
      now,
      CROSS_PAGE_QUIET_MS,
      PAGE_ID,
    );
    history.unshift({
      ...observation.event,
      observer: PAGE_ID,
      crossPage: repeated,
    });
    history = history.slice(0, MAX_HISTORY);
    dismissed = false;
    if (!repeated) notify(observation.event);
    save();
    return !repeated;
  }

  /* --------------------------------------------------------------- polling */

  async function discover(force = false) {
    if (!api) return;
    const dates = rules.scheduleDates();
    const late = [...games.values()].some((game) =>
      rules.scanTarget(game, states[game.gamePk]),
    );
    const gap = late ? DISCOVERY_FAST_MS : DISCOVERY_SLOW_MS;
    if (!force && dateKey === dates.join() && Date.now() - discoveryAt < gap)
      return;
    discoveryAt = Date.now();
    dateKey = dates.join();
    try {
      const slates = await Promise.all(
        dates.map((date) => api.getSchedule(date, { retries: 0 })),
      );
      const next = new Map();
      slates.forEach((slate, index) =>
        (slate || []).forEach((game) => {
          // Today's whole slate, plus only still-live games carried over from
          // yesterday (an extra-inning game that ran past Eastern midnight).
          if (index === 0 || game.status?.abstractGameState === "Live")
            next.set(game.gamePk, game);
        }),
      );
      games = next;
      discoveryFailed = false;
      for (const pk of [...snapshots.keys()])
        if (!games.has(pk)) snapshots.delete(pk);
      for (const [pk, game] of games)
        if (game.status?.abstractGameState === "Final" && states[pk])
          states[pk].active = false;
    } catch (_) {
      // Reported in the strip; never treated as "no games are close".
      discoveryFailed = true;
    }
  }

  async function scanLate() {
    const targets = [...games.values()].filter((game) =>
      rules.scanTarget(game, states[game.gamePk]),
    );
    let alerted = false;
    let cursor = 0;
    async function worker() {
      while (cursor < targets.length && !document.hidden) {
        const game = targets[cursor++];
        try {
          const feed = await api.getAlertSnapshot(game.gamePk);
          if (document.hidden) return;
          alerted = accept(rules.snapshotGame(game, feed), Date.now()) || alerted;
        } catch (_) {
          // Keep the last confirmed state, clearly marked, and never re-arm.
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
      Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker),
    );
    if (alerted) chime();
  }

  async function cycle(force = false) {
    if (demo || busy || document.hidden) return;
    clearTimeout(timer);
    busy = true;
    try {
      if (!api) {
        render();
        return;
      }
      await discover(force);
      await scanLate();
      lastScanAt = Date.now();
      render();
    } finally {
      busy = false;
      if (!demo && !document.hidden)
        timer = setTimeout(
          () => cycle(),
          rules.pollCadence(games, states, {
            fast: SCAN_MS,
            slow: DISCOVERY_SLOW_MS,
          }),
        );
    }
  }

  /* -------------------------------------------------------------- render */

  function scoreLine(game, result) {
    const away = game.teams?.away?.team?.name || "Away";
    const home = game.teams?.home?.team?.name || "Home";
    return `${away} ${result.away}–${result.home} ${home}`;
  }

  function situationLine(result) {
    const parts = [];
    parts.push(
      result.entering
        ? "changeover · home half pending"
        : `bot ${result.inning}`,
    );
    if (!result.entering && result.outs != null)
      parts.push(`${result.outs} out${result.outs === 1 ? "" : "s"}`);
    if (result.balls != null && result.strikes != null)
      parts.push(`${result.balls}-${result.strikes}`);
    if (!result.entering)
      parts.push(rules.occupancyLabel(result.bases.map(Boolean)));
    return parts.join(" · ");
  }

  function render() {
    if (!strip.node) return;
    const entries = [...snapshots.values()];
    const loaded = entries.filter((s) => s.result.loaded && !s.error);
    const watching = entries.filter(
      (s) => s.result.watching && !s.result.loaded && !s.error,
    );
    const stale = entries.filter((s) => s.error);
    // Delay / suspension: not an alert, not an all-clear. Shown, never dropped.
    const heldPaused = entries.filter(
      (s) =>
        !s.error &&
        rules.isPaused(s.game.status) &&
        s.result.known &&
        s.result.tied &&
        s.result.inning >= 9,
    );
    const paused = document.hidden;

    strip.node.className = `ll-strip ${
      loaded.length ? "ll-loaded" : watching.length ? "ll-watch" : "ll-idle"
    }${stale.length || discoveryFailed ? " ll-stale" : ""}`;

    // Demo mode is labelled on every render, so a screenshot of the strip can
    // never be mistaken for a live alert.
    const lead = demo
      ? '<span class="ll-warn">DEMO</span> synthetic, no live polling · '
      : "";
    if (!api) {
      strip.state.innerHTML = `${lead}MLB api client missing on this page — the strip cannot watch here`;
    } else if (paused) {
      // Hidden tabs stop polling, so nothing here is a live claim.
      const tracked = loaded.length + watching.length + stale.length;
      strip.state.innerHTML = `${lead}paused · hidden tab, no new checks — ${tracked} late-inning game${
        tracked === 1 ? "" : "s"
      } last seen · return to this tab to resume`;
    } else if (loaded.length) {
      const first = loaded[0];
      strip.state.innerHTML = `${lead}<strong>ALERT · TIED · BASES LOADED · ${escape(
        `BOT ${first.result.inning}`,
      )}</strong> · ${escape(scoreLine(first.game, first.result))}${
        loaded.length > 1 ? ` · +${loaded.length - 1} more` : ""
      }`;
    } else if (watching.length) {
      strip.state.innerHTML = `${lead}<strong>WATCHING ${watching.length}</strong> · ${watching
        .slice(0, 3)
        .map(
          (s) =>
            `${escape(scoreLine(s.game, s.result))} (${escape(
              situationLine(s.result),
            )})`,
        )
        .join(" · ")}${watching.length > 3 ? ` · +${watching.length - 3} more` : ""}`;
    } else if (heldPaused.length) {
      strip.state.innerHTML = `${lead}<strong>WATCH HELD · ${escape(
        `BOT ${heldPaused[0].result.inning}`,
      )}</strong> · ${escape(scoreLine(heldPaused[0].game, heldPaused[0].result))} · play paused (${escape(
        String(heldPaused[0].game.status?.detailedState || "delay"),
      )}) — the tied watch survives the stoppage`;
    } else if (!lastScanAt && !discoveryAt) {
      strip.state.innerHTML = `${lead}starting — reading the official MLB schedule`;
    } else if (discoveryFailed) {
      strip.state.innerHTML = `${lead}schedule unavailable — retrying (no all-clear is implied)`;
    } else {
      strip.state.innerHTML = `${lead}no tied bottom-9 situation right now · ${
        games.size
      } game${games.size === 1 ? "" : "s"} on radar${
        lastScanAt ? ` · checked ${clock(lastScanAt)}` : ""
      }`;
    }
    // An unconfirmed game is never silently dropped from the picture, and the
    // reason is shown: "no fresh data" must not read as "nothing is happening".
    if (stale.length)
      strip.state.innerHTML += ` <span class="ll-warn">· ${stale.length} unconfirmed (${escape(
        stale[0].error,
      )})</span>`;

    // Detail rows: every tracked game, so partial progress toward loaded bases
    // is visible (1st, 1st & 2nd, 2nd & 3rd, ...) instead of a binary state.
    const loadedRows = loaded
      .map(
        (s) => `<div class="ll-row ll-row-loaded">
          <span class="ll-row-badge">BASES LOADED</span>
          <span class="ll-row-text"><strong>${escape(scoreLine(s.game, s.result))}</strong> · ${escape(situationLine(s.result))}${
            s.result.batter
              ? ` · ${escape(s.result.batter.name)} vs ${escape(s.result.pitcher?.name || "TBD")}`
              : ""
          }</span>
          <span class="ll-row-tension ll-tension-${s.result.tension}">${escape(
            s.result.tensionLabel,
          )} ${s.result.tension}/5</span>
          ${
            s.result.lastEvent
              ? `<span class="ll-row-note">loaded on: ${escape(s.result.lastEvent)}</span>`
              : ""
          }
          <a class="ll-row-link" href="game.html?gamePk=${encodeURIComponent(
            s.game.gamePk,
          )}">open game ↗</a>
        </div>`,
      )
      .join("");
    const watchRows = watching
      .map(
        (s) => `<div class="ll-row">
          <span class="ll-row-badge">ON WATCH</span>
          <span class="ll-row-text"><strong>${escape(scoreLine(s.game, s.result))}</strong> · ${escape(situationLine(s.result))}</span>
          <span class="ll-row-note">${escape(
            s.result.runnersOn
              ? `${s.result.runnersOn} on · ${3 - s.result.runnersOn} base${
                  3 - s.result.runnersOn === 1 ? "" : "s"
                } to fill`
              : "no runners yet",
          )}</span>
          <a class="ll-row-link" href="game.html?gamePk=${encodeURIComponent(
            s.game.gamePk,
          )}">open game ↗</a>
        </div>`,
      )
      .join("");
    const pausedRows = heldPaused
      .map(
        (s) => `<div class="ll-row ll-row-paused">
          <span class="ll-row-badge">PAUSED</span>
          <span class="ll-row-text"><strong>${escape(scoreLine(s.game, s.result))}</strong> · ${escape(situationLine(s.result))} · play paused (${escape(
            String(s.game.status?.detailedState || "delay"),
          )})</span>
          <span class="ll-row-note">watch held — resuming cannot re-alert</span>
          <a class="ll-row-link" href="game.html?gamePk=${encodeURIComponent(
            s.game.gamePk,
          )}">open game ↗</a>
        </div>`,
      )
      .join("");
    strip.detail.innerHTML = loadedRows + watchRows + pausedRows;
    strip.detail.hidden = !strip.detail.innerHTML;

    // Toast: the loud, readable alert. It follows the live snapshots, so the
    // count / outs / score keep updating while the situation is in progress.
    const show = loaded.length > 0 && !dismissed;
    if (show) {
      strip.toast.className = "ll-toast ll-toast-loaded";
      strip.toast.innerHTML = loaded
        .map(
          (s) => `<div class="ll-toast-card">
            <div class="ll-toast-top">
              <span class="ll-toast-badge">TIED · BASES LOADED</span>
              <span class="ll-toast-inning">BOT ${escape(s.result.inning)}</span>
              <button class="ll-toast-close" data-dismiss="1" aria-label="Dismiss this alert">✕</button>
            </div>
            <div class="ll-toast-score">${escape(scoreLine(s.game, s.result))}</div>
            <div class="ll-toast-detail">${escape(
              `${s.result.outs} out${s.result.outs === 1 ? "" : "s"}${
                s.result.balls != null && s.result.strikes != null
                  ? ` · ${s.result.balls}-${s.result.strikes} count`
                  : ""
              }${s.result.batter ? ` · ${s.result.batter.name}` : ""}${
                s.result.pitcher ? ` vs ${s.result.pitcher.name}` : ""
              }`,
            )}</div>
            <div class="ll-toast-tension ll-tension-${s.result.tension}">TENSION ${escape(
              s.result.tensionLabel,
            )} ${s.result.tension}/5 · observed ${escape(clock(s.at))}</div>
          </div>`,
        )
        .join("");
      strip.toast.hidden = false;
    } else {
      strip.toast.innerHTML = "";
      strip.toast.hidden = true;
    }

    strip.sound.textContent = soundEnabled ? "Sound on" : "Sound off";
    strip.sound.setAttribute("aria-pressed", String(soundEnabled));
    strip.sound.disabled = !(window.AudioContext || window.webkitAudioContext);
    const notificationSupport = "Notification" in window;
    strip.notify.textContent = !notificationSupport
      ? "Alerts unavailable"
      : notificationsEnabled
        ? "Alerts on"
        : Notification.permission === "denied"
          ? "Alerts blocked"
          : "Alerts off";
    strip.notify.setAttribute("aria-pressed", String(notificationsEnabled));
    strip.notify.disabled = !notificationSupport;
    strip.scan.textContent = demo ? "Next scenario →" : "↻";

    // A background tab is where an alert matters most, so the situation also
    // goes in the title — guarded so we never clobber another page's title.
    try {
      const marker = "⚠ BASES LOADED — ";
      const base = document.title.startsWith(marker)
        ? document.title.slice(marker.length)
        : document.title;
      const next = loaded.length ? `${marker}${base}` : base;
      if (document.title !== next) document.title = next;
    } catch (_) {}
  }

  /* ---------------------------------------------------------------- boot */

  function start() {
    mount();
    restore();
    render();
    if (demo) {
      strip.detail.hidden = false;
      strip.state.textContent = "demo mode · synthetic games, no live polling";
      demoNext();
      return;
    }
    if (!api) {
      render();
      return;
    }
    cycle(true);
    clearInterval(staleTimer);
    staleTimer = setInterval(() => {
      // A snapshot that stopped refreshing must not keep claiming to be live.
      let changed = false;
      for (const entry of snapshots.values()) {
        if (!entry.error && Date.now() - entry.at > STALE_MS) {
          entry.error = "Snapshot is stale — awaiting fresh MLB data";
          changed = true;
        }
      }
      if (changed) render();
    }, 2000);
    document.addEventListener("visibilitychange", () => {
      clearTimeout(timer);
      if (document.hidden) {
        render();
      } else {
        cycle(true);
      }
    });
  }

  /* ----------------------------------------------------------- demo mode */
  /* Five scripted snapshots driven through the production rules engine, so the
   * strip can be shown working without a live game anywhere in the league.
   * Demo observations never touch the shared alert log and never enter the
   * dashboard's history. */

  const DEMO_STEPS = [
    {
      inning: 9,
      state: "Middle",
      outs: 3,
      bases: [],
      text: "Top 9 ends in a tie — the watch window opens (changeover).",
    },
    {
      inning: 9,
      state: "Bottom",
      outs: 1,
      bases: [true, false, false],
      text: "Bottom 9. A walk puts the leadoff runner on first.",
    },
    {
      inning: 9,
      state: "Bottom",
      outs: 1,
      balls: 3,
      strikes: 1,
      bases: [true, true, false],
      text: "Single — runners on 1st and 2nd. Two of three bases filled.",
    },
    {
      inning: 9,
      state: "Bottom",
      outs: 1,
      balls: 3,
      strikes: 2,
      bases: [true, true, true],
      batter: "M. Trout",
      pitcher: "C. Sale",
      lastEvent: "Intentional Walk",
      text: "Intentional walk loads the bases — ALERT, full count, 1 out.",
    },
    {
      inning: 12,
      state: "Bottom",
      outs: 2,
      balls: 3,
      strikes: 2,
      bases: [true, true, true],
      batter: "A. Judge",
      pitcher: "E. Clase",
      lastEvent: "Walk",
      text: "Bottom 12, still tied, loaded, 2 outs and a full count — maximum tension. No inning limit.",
    },
    {
      inning: 12,
      state: "Bottom",
      outs: 2,
      bases: [false, false, false],
      text: "Bases clear on a fielder's choice that ends the inning — re-armed for the next situation.",
    },
  ];

  let demoStep = -1;

  function demoNext() {
    demoStep += 1;
    if (demoStep >= DEMO_STEPS.length) {
      demoStep = 0;
      history = [];
      states = {};
      snapshots.clear();
    }
    const step = DEMO_STEPS[demoStep];
    // One synthetic game that evolves across the steps, exactly like a real
    // extra-inning game would, instead of a pile of unrelated fake games.
    const game = {
      gamePk: 900000,
      status: { abstractGameState: "Live", detailedState: "In Progress" },
      teams: {
        away: { team: { name: "Away Nine" } },
        home: { team: { name: "Home Nine" } },
      },
      linescore: {
        currentInning: step.inning,
        inningState: step.state,
        isTopInning: false,
        outs: step.outs,
        balls: step.balls ?? 0,
        strikes: step.strikes ?? 0,
        teams: { away: { runs: 4 }, home: { runs: 4 } },
        offense: {},
        defense: step.pitcher
          ? { pitcher: { id: 200, fullName: step.pitcher } }
          : undefined,
        currentPlay: step.lastEvent
          ? { result: { event: step.lastEvent, description: step.lastEvent } }
          : undefined,
      },
    };
    if (step.batter)
      game.linescore.offense.batter = { id: 100, fullName: step.batter };
    ["first", "second", "third"].forEach((base, index) => {
      if (step.bases[index])
        game.linescore.offense[base] = { id: 10 + index, fullName: `Runner ${index + 1}` };
    });
    games.set(game.gamePk, game);
    accept(game, Date.now());
    render();
    strip.detail.innerHTML = `<div class="ll-row ll-row-demo">
      <span class="ll-row-badge">DEMO ${demoStep + 1}/${DEMO_STEPS.length}</span>
      <span class="ll-row-text">${escape(step.text)}</span>
    </div>${strip.detail.innerHTML}`;
    strip.detail.hidden = false;
  }

  /* --------------------------------------------------------------- exports */

  window.LoadedLateStrip = {
    mount,
    start,
    cycle,
    render,
    accept,
    demoNext,
    snapshot: () => ({
      games,
      states,
      history,
      snapshots: new Map(snapshots),
      soundEnabled,
      notificationsEnabled,
      demo,
    }),
    __setGames: (list) => {
      games = new Map(list.map((game) => [game.gamePk, game]));
    },
  };

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", start);
  else start();
})();
