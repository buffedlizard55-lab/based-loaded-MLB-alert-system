#!/usr/bin/env node
/* Chat-feed (alerts.html) controller tests — no dependencies, no network, no browser.
 *
 *   node tools/chat-feed-test.mjs
 *
 * Two layers:
 *   1. the wiring contract of alerts.html (scripts in order, the ids the
 *      controller reads, no editable inputs into the alert pipeline);
 *   2. the controller itself, driven through a deterministic DOM, clock and
 *      MLB StatsAPI stub, so every narrated state is reproducible offline:
 *      watch → runners → loaded → tension → cleared → reload → walk-off,
 *      extra innings, a failed-fetch episode, the cross-page quiet window,
 *      and a page reload that must not re-alert.
 *
 * The rules themselves (what counts as tied / bottom-9+ / loaded) are pinned
 * by tools/bases-loaded-test.mjs; this suite pins the FEED around them.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require("../assets/js/bases-loaded-core.js"); // parse-check the engine too
const coreSource = readFileSync(
  new URL("../assets/js/bases-loaded-core.js", import.meta.url),
  "utf8",
);
const feedSource = readFileSync(
  new URL("../assets/js/bases-loaded-feed.js", import.meta.url),
  "utf8",
);
const alertsHtml = readFileSync(new URL("../alerts.html", import.meta.url), "utf8");

let checks = 0;
const check = (actual, expected, label) => {
  assert.deepEqual(actual, expected, label);
  checks++;
};
const ok = (value, label) => check(Boolean(value), true, label);

/* ==========================================================================
 * 1. alerts.html wiring contract
 * ======================================================================== */

const FEED_IDS = [
  "feed-list",
  "status-line",
  "banner",
  "countdown",
  "live-dot",
  "sound-toggle-btn",
  "notify-toggle-btn",
  "refresh-btn",
  "stat-active",
  "stat-watch",
  "stat-today",
  "stat-walkoffs",
  "stat-events",
  "updated",
  "demo-banner",
  "demo-description",
  "demo-next",
];
for (const id of FEED_IDS)
  ok(alertsHtml.includes(`id="${id}"`), `alerts.html exposes #${id} to the controller`);

const scriptOrder = [
  "assets/js/api.js",
  "assets/js/ui.js",
  "assets/js/bases-loaded-core.js",
  "assets/js/bases-loaded-feed.js",
];
let last = -1;
for (const src of scriptOrder) {
  const at = alertsHtml.indexOf(`<script src="${src}"></script>`);
  ok(at >= 0, `alerts.html loads ${src}`);
  ok(at > last, `${src} loads after the scripts before it`);
  last = at;
}
ok(
  alertsHtml.includes('href="assets/css/bases-loaded-feed.css"'),
  "alerts.html loads the feed stylesheet",
);
ok(
  !/<form|<input|<textarea|contenteditable/i.test(alertsHtml),
  "alerts.html takes no typed input at all",
);
ok(
  !alertsHtml.includes("bases-loaded-strip.js"),
  "the chat feed page does not double-mount the site-wide strip",
);

/* ==========================================================================
 * 2. Deterministic harness (same shape as the strip suite)
 * ======================================================================== */

function makeElement(tag = "div") {
  const node = {
    tagName: String(tag).toUpperCase(),
    id: "",
    className: "",
    _text: "",
    _html: "",
    hidden: false,
    disabled: false,
    attributes: {},
    listeners: {},
    children: [],
    parentNode: null,
    classList: {
      toggle(name, force) {
        const set = new Set(node.className.split(/\s+/).filter(Boolean));
        const want = force === undefined ? !set.has(name) : !!force;
        if (want) set.add(name);
        else set.delete(name);
        node.className = [...set].join(" ");
      },
      add(name) {
        this.toggle(name, true);
      },
      remove(name) {
        this.toggle(name, false);
      },
      contains(name) {
        return node.className.split(/\s+/).includes(name);
      },
    },
    setAttribute(key, value) {
      this.attributes[key] = String(value);
    },
    getAttribute(key) {
      return Object.prototype.hasOwnProperty.call(this.attributes, key)
        ? this.attributes[key]
        : null;
    },
    addEventListener(key, fn) {
      (this.listeners[key] ||= []).push(fn);
    },
    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      return child;
    },
    fire(type, event = {}) {
      for (const fn of this.listeners[type] || []) fn({ target: this, ...event });
    },
    text() {
      const own = `${this.textContent || ""} ${String(this.innerHTML || "").replace(/<[^>]*>/g, " ")}`;
      return `${own} ${this.children.map((child) => child.text()).join(" ")}`
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&")
        .replace(/\s+/g, " ")
        .trim();
    },
  };
  Object.defineProperty(node, "textContent", {
    configurable: true,
    get() {
      return this._text;
    },
    set(value) {
      this._text = String(value);
      this._html = "";
      this.children = [];
    },
  });
  Object.defineProperty(node, "innerHTML", {
    configurable: true,
    get() {
      return this._html || this._text || "";
    },
    set(value) {
      this._html = String(value);
      this._text = "";
      this.children = [];
    },
  });
  return node;
}

const GAME_PK = 849901;

/** Schedule entry the way getSchedule(hydrate=linescore) reports it. */
function scheduleGame({ inning = 9, state = "Middle", away = 3, home = 3, detailed = "In Progress" } = {}) {
  return {
    gamePk: GAME_PK,
    status: { abstractGameState: "Live", detailedState: detailed },
    teams: {
      away: { team: { id: 111, name: "Away Nine" } },
      home: { team: { id: 222, name: "Home Nine" } },
    },
    linescore: {
      currentInning: inning,
      inningState: state,
      isTopInning: state === "Top",
      outs: 0,
      teams: { away: { runs: away }, home: { runs: home } },
    },
  };
}

const runner = (id, name) => ({ id, fullName: name });

/** Live snapshot linescore the way getAlertSnapshot projects it. */
function linescore({
  inning = 9,
  state = "Bottom",
  outs = 0,
  balls = 0,
  strikes = 0,
  away = 3,
  home = 3,
  first = null,
  second = null,
  third = null,
}) {
  return {
    currentInning: inning,
    inningState: state,
    isTopInning: state === "Top",
    outs,
    balls,
    strikes,
    teams: { away: { runs: away }, home: { runs: home } },
    offense: {
      first,
      second,
      third,
      batter: runner(900, "Batter Niner"),
      onDeck: runner(901, "Deck Niner"),
      inHole: runner(902, "Hole Niner"),
    },
    defense: { pitcher: runner(950, "Pitcher Niner") },
  };
}

const snapshot = (ls, status = { abstractGameState: "Live", detailedState: "In Progress" }) => ({
  gameData: { status },
  liveData: { linescore: ls },
});

const PREFS_KEY = "loaded-late:preferences";
const STORE_KEY = "loaded-late:feed:v1";
const SHARED_KEY = "loaded-late:shared:v1";
const armedPrefs = () => JSON.stringify({ sound: true, notify: true });

function boot({
  storage = new Map(),
  games = [scheduleGame()],
  demo = false,
  notificationPermission = "granted",
} = {}) {
  const body = makeElement("body");
  for (const id of FEED_IDS) {
    const el = makeElement("div");
    el.id = id;
    body.appendChild(el);
  }
  const listeners = {};
  const timeouts = new Map();
  const intervals = new Map();
  const notices = [];
  const state = {
    games,
    feeds: new Map(),
    snapshotFails: false,
    scheduleCalls: 0,
    snapshotCalls: [],
    clock: 1_760_000_000_000,
    oscillators: 0,
    permission: notificationPermission,
  };

  class Clock extends Date {
    constructor(...args) {
      super(...(args.length ? args : [state.clock]));
    }
    static now() {
      return state.clock;
    }
  }

  class Notice {
    static get permission() {
      return state.permission;
    }
    static async requestPermission() {
      return state.permission;
    }
    constructor(title, options) {
      notices.push({ title, ...options });
    }
    close() {}
  }

  class CountingAudio {
    constructor() {
      this.currentTime = 0;
      this.destination = {};
      this.state = "running";
    }
    async resume() {}
    createOscillator() {
      state.oscillators++;
      return {
        frequency: { value: 0 },
        connect() {
          return this;
        },
        start() {},
        stop() {},
      };
    }
    createGain() {
      return {
        gain: {
          setValueAtTime() {},
          linearRampToValueAtTime() {},
          exponentialRampToValueAtTime() {},
        },
        connect() {
          return this;
        },
      };
    }
  }

  const document = {
    readyState: "complete",
    hidden: false,
    title: "",
    body,
    createElement: (tag) => makeElement(tag),
    getElementById(id) {
      const walk = (node) => {
        if (node.id === id) return node;
        for (const child of node.children) {
          const found = walk(child);
          if (found) return found;
        }
        return null;
      };
      return walk(body);
    },
    addEventListener(type, fn) {
      (listeners[type] ||= []).push(fn);
    },
    dispatch(type, event = {}) {
      for (const fn of listeners[type] || []) fn(event);
    },
  };

  const context = vm.createContext({
    document,
    location: { search: demo ? "?demo=1" : "" },
    Date: Clock,
    Intl,
    URLSearchParams,
    console,
    Notification: Notice,
    AudioContext: CountingAudio,
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
    setTimeout: (fn, ms) => {
      const id = timeouts.size + 1;
      timeouts.set(id, { fn, ms });
      return id;
    },
    clearTimeout: (id) => timeouts.delete(id),
    setInterval: (fn, ms) => {
      const id = intervals.size + 1;
      intervals.set(id, { fn, ms });
      return id;
    },
    clearInterval: (id) => intervals.delete(id),
  });
  context.window = context;
  context.window.open = () => {};

  context.MLB = {
    async getSchedule() {
      state.scheduleCalls++;
      return structuredClone(state.games);
    },
    async getAlertSnapshot(pk) {
      state.snapshotCalls.push(pk);
      if (state.snapshotFails) throw Error("Offline");
      const feed = state.feeds.get(pk);
      if (!feed) throw Error("No feed");
      return structuredClone(feed);
    },
  };

  vm.runInContext(`${coreSource}\n${feedSource}`, context);

  const el = (id) => document.getElementById(id);

  // Count real card-list rebuilds: wrap the innerHTML setter on #feed-list so
  // a "the DOM did not churn" assertion can see identical-string rebuilds too.
  let feedWrites = 0;
  {
    const fl = el("feed-list");
    const desc = Object.getOwnPropertyDescriptor(fl, "innerHTML");
    Object.defineProperty(fl, "innerHTML", {
      get: desc.get,
      set(value) {
        feedWrites++;
        desc.set.call(this, value);
      },
    });
  }

  return {
    state,
    storage,
    notices,
    timeouts,
    el,
    feedList: () => el("feed-list"),
    feedText: () => el("feed-list").innerHTML,
    feedWrites: () => feedWrites,
    statusLine: () => el("status-line").textContent,
    savedFeed: () => JSON.parse(storage.get(STORE_KEY) || `{"feed":[]}`).feed,
    nextDelay: () => [...timeouts.values()].map((entry) => entry.ms),
    async start() {
      document.dispatch("DOMContentLoaded");
      await settle();
    },
    async tick() {
      const pending = [...timeouts.values()];
      timeouts.clear();
      for (const entry of pending) await entry.fn();
      await settle();
    },
    runInterval() {
      for (const { fn } of intervals.values()) fn();
    },
    advance(ms) {
      state.clock += ms;
    },
    setSnapshot(snap) {
      state.feeds.set(GAME_PK, snap);
    },
    async click(id) {
      el(id).fire("click");
      await settle();
    },
  };
}

const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
};

const kinds = (env) => env.savedFeed().map((event) => event.kind);

/* ==========================================================================
 * 3. The full story: watch → build → loaded → tension → cleared → reload →
 *    walk-off, with chime and desktop notification exactly where due
 * ======================================================================== */

{
  const storage = new Map([[PREFS_KEY, armedPrefs()]]);
  const env = boot({ storage });
  // Tied changeover into the bottom of the 9th → the watch begins on the
  // very first poll.
  env.setSnapshot(snapshot(linescore({ state: "Middle" })));
  await env.start();
  check(kinds(env), ["watch_begins"], "A tied changeover into the 9th opens the watch");
  ok(env.feedText().includes("WATCH ON"), "The watch card is narrated in the feed");
  check(env.state.oscillators, 0, "Opening the watch does not chime (only alerts do)");

  // Polling cadence is now fast (a live inning-9 game exists).
  ok(env.nextDelay().every((ms) => ms === 2000), "A late tied game tightens the loop to 2s");
  ok(/refreshing every 2s/.test(env.statusLine()), "The status line names the cadence the loop actually uses");
  ok(/^1 game · 1 feed event /.test(env.statusLine()), "The status line counts games and events");

  // DOM stability: the one-second heartbeat must not rebuild the card list.
  const frozen = env.feedText();
  const writesBefore = env.feedWrites();
  env.advance(1000);
  env.runInterval();
  env.advance(1000);
  env.runInterval();
  check(env.feedText(), frozen, "The heartbeat leaves the cards untouched when nothing changed");
  check(env.feedWrites(), writesBefore, "…and performs zero card-list rebuilds while idle");

  // Bottom 9: runners reach one by one — the feed counts them up.
  env.setSnapshot(snapshot(linescore({ first: runner(1, "Runner One") })));
  await env.advance(2000);
  await env.tick();
  check(kinds(env)[0], "runner_advanced", "A runner reaching is narrated");
  ok(env.feedText().includes("1 runner on"), "The feed says how many are on");

  env.setSnapshot(
    snapshot(linescore({ first: runner(1, "Runner One"), second: runner(2, "Runner Two") })),
  );
  await env.advance(2000);
  await env.tick();
  check(kinds(env)[0], "runner_advanced", "A second runner reaching is narrated");

  // BASES LOADED — the alert itself: chime + desktop notification.
  env.setSnapshot(
    snapshot(
      linescore({
        balls: 1,
        first: runner(1, "Runner One"),
        second: runner(2, "Runner Two"),
        third: runner(3, "Runner Three"),
      }),
    ),
  );
  await env.advance(2000);
  await env.tick();
  check(kinds(env)[0], "bases_loaded", "All three bases occupied raises the alert");
  check(env.state.oscillators, 3, "The alert chime played exactly once (three oscillators)");
  check(env.notices.length, 1, "One desktop notification for the alert");
  ok(/BASES LOADED/.test(env.notices[0].title), "The notification names the situation");
  ok(env.feedText().includes("⚾ BASES LOADED"), "The alert card carries the alert headline");
  ok(env.feedText().includes("Batter Niner"), "The alert card names the batter");
  ok(env.feedText().includes("Pitcher Niner"), "The alert card names the pitcher");

  // Repeated polls while still loaded must not re-alert.
  await env.advance(2000);
  await env.tick();
  check(kinds(env).filter((k) => k === "bases_loaded").length, 1, "A continuous situation alerts once");
  check(env.state.oscillators, 3, "…and chimes once");

  // Tension rises: two outs, full count.
  env.setSnapshot(
    snapshot(
      linescore({
        outs: 2,
        balls: 3,
        strikes: 2,
        first: runner(1, "Runner One"),
        second: runner(2, "Runner Two"),
        third: runner(3, "Runner Three"),
      }),
    ),
  );
  await env.advance(2000);
  await env.tick();
  check(kinds(env)[0], "tension_update", "Rising tension is narrated");
  ok(env.feedText().includes("MAXIMUM"), "The feed shows the tension level");

  // Bases clear without a walk-off (the ✗ outcome marker).
  env.setSnapshot(snapshot(linescore({ outs: 2 })));
  await env.advance(2000);
  await env.tick();
  check(kinds(env)[0], "bases_cleared", "The bases clearing is narrated");
  ok(env.feedText().includes("✗ No walk-off"), "A cleared situation carries the ✗ outcome badge");

  // Reloaded in the same inning → alerts AGAIN (confirmed exit and reload).
  env.setSnapshot(
    snapshot(
      linescore({
        outs: 2,
        balls: 3,
        strikes: 2,
        first: runner(4, "Pinch Runner A"),
        second: runner(5, "Pinch Runner B"),
        third: runner(6, "Pinch Runner C"),
      }),
    ),
  );
  await env.advance(2000);
  await env.tick();
  check(
    kinds(env).filter((k) => k === "bases_loaded").length,
    2,
    "A confirmed exit and reload alerts again in the same inning",
  );
  check(env.state.oscillators, 6, "…with its own chime");
  check(env.notices.length, 2, "…and its own desktop notification");

  // WALK-OFF: home scores to take the lead in the bottom half.
  env.setSnapshot(snapshot(linescore({ outs: 2, away: 3, home: 4 })));
  await env.advance(2000);
  await env.tick();
  check(kinds(env)[0], "walkoff_rbi", "Home taking the lead from a loaded bottom half is a walk-off");
  ok(env.feedText().includes("✓ Walk-off"), "The walk-off card carries the ✓ outcome badge");
  ok(env.notices.some((n) => /WALK-OFF/.test(n.title)), "The walk-off raised a notification too");
  check(env.statusLine().split("·")[1].trim(), "8 feed events", "The status line keeps count");
}

/* ==========================================================================
 * 4. Empty slate: the page says exactly what it is waiting for
 * ======================================================================== */

{
  const env = boot({ games: [] });
  await env.start();
  ok(
    env.feedText().includes("Waiting for the first qualifying situation"),
    "The empty feed explains itself",
  );
  ok(/^0 games · 0 feed events /.test(env.statusLine()), "The status line reports the empty slate honestly");
}

/* ==========================================================================
 * 5. Extra innings: the watch simply continues — bottom 10 alerts the same way
 * ======================================================================== */

{
  const env = boot();
  env.setSnapshot(snapshot(linescore({ state: "Middle" })));
  await env.start();
  check(kinds(env), ["watch_begins"], "Bot-9 watch opens");

  // Scoreless bottom 9 retires the side, then the game goes to extras tied.
  env.setSnapshot(snapshot(linescore({ state: "Bottom", outs: 3 })));
  await env.advance(2000);
  await env.tick();

  env.setSnapshot(snapshot(linescore({ inning: 10, state: "Top" })));
  await env.advance(2000);
  await env.tick();

  env.setSnapshot(snapshot(linescore({ inning: 10, state: "Middle" })));
  await env.advance(2000);
  await env.tick();

  env.setSnapshot(
    snapshot(
      linescore({
        inning: 10,
        state: "Bottom",
        first: runner(1, "R1"),
        second: runner(2, "R2"),
        third: runner(3, "Automatic Runner"),
      }),
    ),
  );
  await env.advance(2000);
  await env.tick();
  check(kinds(env).filter((k) => k === "bases_loaded").length, 1, "Bottom of the 10th alerts exactly like the 9th");
  const loadedEvent = env.savedFeed().find((e) => e.kind === "bases_loaded");
  check(loadedEvent.inning, 10, "The alert carries the extra inning it happened in");
  ok(env.feedText().includes("BOT 10"), "The card badge shows BOT 10");
}

/* ==========================================================================
 * 6. Failed fetches are narrated once and can never invent a verdict
 * ======================================================================== */

// First contact fails: the outage card appears, nothing else.
{
  const env = boot();
  env.state.snapshotFails = true;
  await env.start();
  check(kinds(env), ["data_unavailable"], "A failed first fetch is narrated");
  await env.advance(2000);
  await env.tick();
  check(
    kinds(env).filter((k) => k === "data_unavailable").length,
    1,
    "One outage card per error episode, not one per failed poll",
  );
  env.state.snapshotFails = false;
  env.setSnapshot(snapshot(linescore({ state: "Middle" })));
  await env.advance(2000);
  await env.tick();
  check(kinds(env)[0], "watch_begins", "Recovery narrates the situation, not a second outage");
}

// Mid-watch outage: the watch is held, no verdict is fabricated.
{
  const env = boot();
  env.setSnapshot(snapshot(linescore({ state: "Middle" })));
  await env.start();
  check(kinds(env), ["watch_begins"], "Watch established before the outage");

  env.state.snapshotFails = true;
  await env.advance(2000);
  await env.tick();
  check(kinds(env)[0], "data_unavailable", "A mid-watch outage is narrated");
  ok(env.feedText().includes("DATA UNAVAILABLE"), "The outage card is visible");
  ok(
    !env.feedText().includes("✓ Walk-off") && !env.feedText().includes("— Final"),
    "An outage never fabricates a walk-off or a final verdict",
  );

  await env.advance(2000);
  await env.tick();
  check(
    kinds(env).filter((k) => k === "data_unavailable").length,
    1,
    "Still one outage card while the fetch keeps failing",
  );

  env.state.snapshotFails = false;
  await env.advance(2000);
  await env.tick();
  check(
    kinds(env).filter((k) => k === "watch_begins").length,
    1,
    "Recovery does not re-open a watch that never closed",
  );
}

/* ==========================================================================
 * 7. Cross-page quiet window: another page's fresh alert silences the chime,
 *    never the card
 * ======================================================================== */

{
  const storage = new Map([
    [PREFS_KEY, armedPrefs()],
    [
      SHARED_KEY,
      JSON.stringify({
        history: [
          {
            id: "other-page-alert",
            gamePk: GAME_PK,
            inning: 9,
            observedAt: 1_760_000_000_000,
            observer: "another-tab",
            isAlert: true,
          },
        ],
      }),
    ],
  ]);
  const env = boot({ storage });
  env.setSnapshot(
    snapshot(
      linescore({
        state: "Bottom",
        first: runner(1, "R1"),
        second: runner(2, "R2"),
        third: runner(3, "R3"),
      }),
    ),
  );
  await env.start();
  check(kinds(env)[0], "bases_loaded", "The card still appears when another page just chimed");
  check(env.state.oscillators, 0, "…but the chime stays quiet inside the shared window");
  check(env.notices.length, 0, "…and no duplicate desktop notification");
  check(env.savedFeed()[0].crossPage, true, "The row records that it was silenced as cross-page");
}

/* ==========================================================================
 * 8. Reload the page mid-situation: history returns, the alert does not repeat
 * ======================================================================== */

{
  const storage = new Map([[PREFS_KEY, armedPrefs()]]);
  const env = boot({ storage });
  env.setSnapshot(
    snapshot(
      linescore({
        state: "Bottom",
        first: runner(1, "R1"),
        second: runner(2, "R2"),
        third: runner(3, "R3"),
      }),
    ),
  );
  await env.start();
  check(kinds(env)[0], "bases_loaded", "First tab raises the alert");
  check(env.state.oscillators, 3, "First tab chimes");

  // Same browser storage, a brand-new page instance, same official snapshot.
  const env2 = boot({ storage });
  env2.setSnapshot(
    snapshot(
      linescore({
        state: "Bottom",
        first: runner(1, "R1"),
        second: runner(2, "R2"),
        third: runner(3, "R3"),
      }),
    ),
  );
  await env2.start();
  ok(env2.savedFeed().length >= 2, "The reload restores the narrated history");
  ok(
    env2.feedText().includes("⚾ BASES LOADED"),
    "…and the restored cards render without a fresh poll",
  );

  await env2.advance(2000);
  await env2.tick();
  check(
    env2.savedFeed().filter((e) => e.kind === "bases_loaded").length,
    1,
    "The restored stream state suppresses a duplicate alert after reload",
  );
  check(env2.state.oscillators, 0, "…and the reloaded tab never chimes for it");
}

/* ==========================================================================
 * 9. Demo mode: guided walk-off, no network at all
 * ======================================================================== */

{
  const env = boot({ demo: true });
  await env.start();
  check(env.state.scheduleCalls, 0, "Demo mode never calls the schedule");
  check(env.state.snapshotCalls.length, 0, "Demo mode never calls the live feed");
  ok(!env.el("demo-banner").hidden, "The demo banner is visible in demo mode");
  ok(env.savedFeed().length >= 1, "The first demo step narrates immediately");
  await env.click("demo-next");
  ok(env.savedFeed().length >= 2, "Advancing the demo narrates the next step");
  for (let i = 0; i < 6; i++) await env.click("demo-next");
  ok(
    env.savedFeed().some((e) => e.kind === "walkoff_rbi"),
    "The guided demo ends in a walk-off",
  );
}

console.log(`✓ ${checks} chat-feed controller checks passed`);
