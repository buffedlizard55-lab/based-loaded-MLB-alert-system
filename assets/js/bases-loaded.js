/* Alert-only monitor. Schedule discovery is separate from coherent live snapshots. */
"use strict";
(() => {
  const $ = (id) => document.getElementById(id);
  const rules = BasesLoadedRules;
  const demo = new URLSearchParams(location.search).get("demo") === "1";
  const STORE = "loaded-late:v2",
    PREFS = "loaded-late:preferences";
  const WEEK = 7 * 86400000,
    DISCOVERY_MS = 15000,
    SCAN_MS = 2000;
  let history = [],
    states = {},
    games = new Map(),
    snapshots = new Map();
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
      // Sound needs a fresh user gesture to unlock AudioContext each session.
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
    try {
      localStorage.setItem(STORE, JSON.stringify({ history, states }));
    } catch (_) {
      feedback(
        "Could not save history. Live monitoring still works, but history may not survive a refresh.",
      );
    }
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
  function announce(event) {
    if (
      notificationsEnabled &&
      "Notification" in window &&
      Notification.permission === "granted"
    ) {
      try {
        const notice = new Notification(
          `${demo ? "DEMO · " : ""}Tied. Bases loaded. Bottom ${event.inning}.`,
          {
            body: `${event.away} at ${event.home} · ${event.awayScore}–${event.homeScore} · ${event.outs} out${event.outs === 1 ? "" : "s"}`,
            tag: event.id,
          },
        );
        notice.onclick = () => {
          window.focus();
          notice.close();
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
    history.unshift(observation.event);
    announce(observation.event);
    return true;
  }
  function card(game, result, options = {}) {
    const { historical, stamp, error } = options;
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
    return `<article class="alert-card ${historical ? "history-card" : isLoaded ? "loaded" : ""}">
      <div class="card-top"><span class="card-badge">${historical ? "OBSERVED BASES LOADED" : error ? "DATA UNCONFIRMED" : isLoaded ? "● BASES LOADED · ALERT" : "◉ ON WATCH"}</span><span class="card-time">${historical ? escape(new Date(stamp).toLocaleDateString([], { month: "short", day: "numeric" })) + " · " : ""}${escape(time(stamp))}</span></div>
      <h3>${escape(away)} <span style="color:#85958a">at</span> ${escape(home)}</h3>
      <div class="card-score">${escape(result.away)} – ${escape(result.home)}<span>${result.tied ? "TIED" : ""} · ${result.entering ? "ENTERING BOT" : "BOT"} ${escape(result.inning)}</span></div>
      <p>${result.entering ? "Changeover — waiting for the home half. No alert yet." : `${escape(result.outs)} out${result.outs === 1 ? "" : "s"} · ${isLoaded || historical ? "Runners on first, second and third" : "Watching for all three bases to fill"}`}</p>
      ${error ? `<p class="stale-note">${escape(error)}. Last observed state, not a current alert.</p>` : ""}
      <div class="card-footer"><div class="mini-bases" aria-label="Base occupancy">${bases}</div>${demo ? '<span class="card-time">Synthetic game</span>' : `<a href="game.html?gamePk=${encodeURIComponent(game.gamePk)}">Open game ↗</a>`}</div>
      ${historical ? `<p>${result.bases.map((r, i) => `${i + 1}B: ${escape(r?.name || "Runner")}`).join(" · ")}</p>` : ""}
    </article>`;
  }
  function render() {
    const entries = [...snapshots.values()];
    const current = entries.filter((s) => s.result.loaded && !s.error);
    const watching = entries.filter(
      (s) => s.result.watching && !s.result.loaded && !s.error,
    );
    const unconfirmed = entries.filter((s) => s.error);
    $("games-count").textContent = discoveryAt || demo ? games.size : "—";
    $("watch-count").textContent =
      discoveryAt || demo ? current.length + watching.length : "—";
    $("active-count").textContent = discoveryAt || demo ? current.length : "—";
    $("history-count").textContent = history.length;
    $("current").innerHTML = current.length
      ? current.map((s) => card(s.game, s.result, { stamp: s.at })).join("")
      : empty(
          unconfirmed.length || scheduleError
            ? "Live status is not fully confirmed"
            : "No matching situation right now",
          unconfirmed.length || scheduleError
            ? "Some MLB data is unavailable. We will retry automatically; no all-clear is implied."
            : "When the exact situation appears, it will be highlighted here.",
        );
    $("watch").innerHTML =
      watching.map((s) => card(s.game, s.result, { stamp: s.at })).join("") +
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
          : "The watch starts at the changeover into bottom 9, 10, 11 and beyond.",
      );
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
    document.title = current.length
      ? `(${current.length}) BASES LOADED — Loaded Late`
      : "Loaded Late — MLB situation alerts";
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
      const targets = [...games.values()].filter(
        (game) =>
          game.status?.abstractGameState === "Live" &&
          (Number(game.linescore?.currentInning) >= 9 ||
            states[game.gamePk]?.active),
      );
      const targetIds = new Set(targets.map((g) => g.gamePk));
      for (const [pk, game] of games) {
        if (!targetIds.has(pk)) {
          snapshots.delete(pk);
          // Schedule can confirm a final game, but never assert live base occupancy.
          if (game.status?.abstractGameState === "Final" && states[pk])
            states[pk].active = false;
        }
      }
      // Limit concurrent requests, including on a full MLB slate.
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
      if (newAlert) chime(); // One chime per scan even if several games qualify.
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
            ? "Notifications are blocked. Change this site’s permission in browser settings to enable them."
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
      // Do not leave stale green live alerts displayed when monitoring stops.
      for (const entry of snapshots.values()) entry.error = "Monitoring paused";
      render();
    } else if (!demo) poll(true);
    else showDemo(false);
  });
  // Guided offline demo exercises the same rule engine, never touches live storage.
  const demoSteps = [
    {
      inning: 9,
      state: "Top",
      outs: 2,
      bases: [true, true, true],
      text: "Top 9, tied, bases loaded: deliberately NO alert. Only the home half qualifies.",
    },
    {
      inning: 9,
      state: "Middle",
      outs: 3,
      bases: [],
      text: "Top 9 ends tied. The game enters the watch window; stale top-half runners cannot trigger an alert.",
    },
    {
      inning: 9,
      state: "Bottom",
      outs: 1,
      bases: [true, true, false],
      text: "Bottom 9, tied, two runners. On watch, but no alert yet.",
    },
    {
      inning: 9,
      state: "Bottom",
      outs: 1,
      bases: [true, true, true],
      text: "A walk fills the bases. Exact match: alert, with an immutable score and runner snapshot.",
    },
    {
      inning: 9,
      state: "Bottom",
      outs: 1,
      bases: [true, true, true],
      text: "Same situation on the next poll: no duplicate alert.",
    },
    {
      inning: 9,
      state: "Bottom",
      outs: 2,
      bases: [false, true, true],
      text: "A runner is picked off first. Still tied; the alert clears and re-arms.",
    },
    {
      inning: 9,
      state: "Bottom",
      outs: 2,
      bases: [true, true, true],
      text: "An intentional walk reloads the bases: a new alert in the same inning.",
    },
    {
      inning: 9,
      state: "Bottom",
      outs: 2,
      bases: [true, true, true],
      home: 5,
      final: true,
      text: "Walk-off. The home team leads and the game is final. Leftover runner data never triggers an alert.",
    },
    {
      inning: 14,
      state: "Bottom",
      outs: 0,
      bases: [true, true, true],
      text: "Separate extra-inning scenario: a placed runner plus two walks in bottom 14. No upper inning limit.",
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
        teams: { away: { runs: 4 }, home: { runs: step.home || 4 } },
        offense: Object.fromEntries(
          ["first", "second", "third"].flatMap((base, i) =>
            step.bases[i]
              ? [
                  [
                    base,
                    {
                      id: i + 1,
                      fullName: ["Alex Runner", "Jordan Runner", "Sam Runner"][
                        i
                      ],
                    },
                  ],
                ]
              : [],
          ),
        ),
      },
    };
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
  // A slow request or rate-limit quiet period must not leave an old green alert live.
  if (!demo)
    setInterval(() => {
      let changed = false;
      for (const entry of snapshots.values()) {
        if (!entry.error && Date.now() - entry.at > 12000) {
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
    showDemo();
  } else {
    render();
    poll();
  }
})();
