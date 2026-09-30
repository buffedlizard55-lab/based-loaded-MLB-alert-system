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
  "feed-tabs",
  "active-strip",
  "status-line",
  "banner",
  "countdown",
  "live-dot",
  "sound-toggle-btn",
  "notify-toggle-btn",
  "refresh-btn",
  "stat-active",
  "stat-watch",
  "stat-held",
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
  let stripWrites = 0;
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
    const strip = el("active-strip");
    const stripDesc = Object.getOwnPropertyDescriptor(strip, "innerHTML");
    Object.defineProperty(strip, "innerHTML", {
      get: stripDesc.get,
      set(value) {
        stripWrites++;
        stripDesc.set.call(this, value);
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
    stripText: () => el("active-strip").innerHTML,
    stripWrites: () => stripWrites,
    tabButtons: () => el("feed-tabs").children,
    tabLabels: () => el("feed-tabs").children.map((b) => b.textContent),
    async clickTab(index) {
      el("feed-tabs").children[index].fire("click");
      await settle();
    },
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

/* ==========================================================================
 * 10. Held watch: a tied game whose home team is not batting is TRACKED, not
 *     "over" — and the hold is narrated once, then never repeated
 * ======================================================================== */

{
  const env = boot();
  // The page opens in the TOP of the 9th of a tied game: the home team has not
  // batted yet, so the situation is being tracked but is not live.
  env.setSnapshot(snapshot(linescore({ state: "Top" })));
  await env.start();
  check(kinds(env), ["watch_held"], "Opening in the top half of a tied 9th narrates a held watch");
  ok(env.feedText().includes("WATCH HELD"), "The held card is visible");
  ok(
    env.feedText().includes("Still tied in the top of the 9th"),
    "The held card says exactly why: the home team still has to bat",
  );
  ok(
    !env.feedText().includes("WATCH OVER"),
    "A held watch is never narrated as over while the game is still tied",
  );
  check(env.el("stat-held").textContent, "1", "The held counter shows the tracked game");
  check(env.el("stat-watch").textContent, "0", "…and it is not counted as batting right now");

  // Still in the top half: one card per hold, not one per poll.
  env.setSnapshot(snapshot(linescore({ state: "Top", outs: 1 })));
  await env.advance(2000);
  await env.tick();
  check(
    kinds(env).filter((k) => k === "watch_held").length,
    1,
    "A hold is narrated once, not once per poll",
  );

  // Home half starts: the watch opens.
  env.setSnapshot(snapshot(linescore({ state: "Middle", outs: 3 })));
  await env.advance(2000);
  await env.tick();
  check(kinds(env)[0], "watch_begins", "The home half opens the watch");
  check(env.el("stat-held").textContent, "0", "The held counter clears when the home team bats");

  // Third out with the game still tied: held again, never "over".
  env.setSnapshot(snapshot(linescore({ state: "Bottom", outs: 3 })));
  await env.advance(2000);
  await env.tick();
  check(kinds(env)[0], "watch_held", "A tied, scoreless home half holds the watch");
  ok(
    env.feedText().includes("Still tied after the home half of the 9th"),
    "The hold after a completed home half says so",
  );
  check(env.el("stat-held").textContent, "1", "…and the hold counter picks it up");

  // Top 10, still tied: no new card (the hold is already narrated).
  env.setSnapshot(snapshot(linescore({ inning: 10, state: "Top" })));
  await env.advance(2000);
  await env.tick();
  check(kinds(env)[0], "watch_held", "Moving into the top of the 10th still tied emits nothing new");

  // The away team scores in the top 10: the tie is gone, so the watch really is over.
  env.setSnapshot(
    snapshot(linescore({ inning: 10, state: "Top", outs: 1, away: 4, home: 3 })),
  );
  await env.advance(2000);
  await env.tick();
  check(kinds(env)[0], "watch_ends", "Breaking the tie ends the watch");
  ok(
    env.feedText().includes("no longer tied"),
    "The end of the watch names the real reason instead of a vague message",
  );

  // A reload mid-hold must not repeat the held card (the state is persisted).
  const storage = new Map();
  const env3 = boot({ storage });
  env3.setSnapshot(snapshot(linescore({ state: "Top" })));
  await env3.start();
  check(
    env3.savedFeed().filter((e) => e.kind === "watch_held").length,
    1,
    "The first page narrates the hold once",
  );
  const env4 = boot({ storage });
  env4.setSnapshot(snapshot(linescore({ state: "Top", outs: 2 })));
  await env4.start();
  check(
    env4.savedFeed().filter((e) => e.kind === "watch_held").length,
    1,
    "A page reload during a hold does not repeat the held card",
  );
}

/* ==========================================================================
 * 11. Category tabs — the replay feed's pills, counting and filtering THIS
 *     feed, without ever touching the alert pipeline
 * ======================================================================== */

{
  const env = boot();
  env.setSnapshot(snapshot(linescore({ state: "Middle" })));
  await env.start();
  env.setSnapshot(snapshot(linescore({ first: runner(1, "R1"), second: runner(2, "R2"), third: runner(3, "R3") })));
  await env.advance(2000);
  await env.tick();
  env.setSnapshot(snapshot(linescore({ first: runner(1, "R1"), second: runner(2, "R2"), third: runner(3, "R3") })));
  await env.advance(2000);
  await env.tick();

  check(env.tabButtons().length, 5, "Five category tabs, exactly like the replay feed's pattern");
  check(
    env.tabLabels().map((label) => label.replace(/\s\(\d+\)$/, "")),
    ["All", "⚾ Bases Loaded", "👀 On Watch", "🎉 Walk-offs", "⚠️ Warnings"],
    "The tabs name this feed's categories",
  );
  const counts = env.tabLabels().map((label) => Number(label.match(/\((\d+)\)$/)[1]));
  check(counts[0], env.savedFeed().length, "The All tab counts every event");
  check(
    counts[1] + counts[2] + counts[3] + counts[4],
    counts[0],
    "Every event belongs to exactly one category tab (no orphans, no double counting)",
  );
  check(
    counts[1],
    1,
    "The Bases Loaded tab counts the alert",
  );
  check(
    env.tabButtons()[0].className,
    "tab tab-on",
    "The All tab starts active with the replay feed's tab-on class",
  );

  // Filter to the walk-off tab: the cards change, the alerts do not.
  const savedBefore = env.savedFeed().length;
  await env.clickTab(3);
  check(
    env.tabButtons()[3].className,
    "tab tab-on",
    "Clicking a tab moves the active pill",
  );
  check(env.tabButtons()[0].className, "tab", "…and clears it from the others");
  ok(
    !env.feedText().includes("⚾ BASES LOADED"),
    "The Walk-offs tab hides the bases-loaded cards",
  );
  check(env.savedFeed().length, savedBefore, "Filtering the view never drops a recorded event");

  // Back to All: everything returns.
  await env.clickTab(0);
  ok(env.feedText().includes("⚾ BASES LOADED"), "The All tab shows the alert again");

  // A new alert while a category is selected is still recorded and still chimes.
  await env.clickTab(4);
  env.setSnapshot(snapshot(linescore({ outs: 1 })));
  await env.advance(2000);
  await env.tick();
  env.setSnapshot(snapshot(linescore({ outs: 2, first: runner(4, "R4"), second: runner(5, "R5"), third: runner(6, "R6") })));
  await env.advance(2000);
  await env.tick();
  check(
    env.savedFeed().filter((e) => e.kind === "bases_loaded").length,
    2,
    "A new alert lands in the history even while another tab is selected",
  );
  check(
    counts.length && env.tabLabels()[1].includes("(2)"),
    true,
    "The Bases Loaded tab count updates live",
  );
  ok(
    !env.feedText().includes("⚾ BASES LOADED"),
    "…while the selected Warnings tab stays filtered",
  );

  // Idle ticks rebuild nothing: not the cards, not the strip, not the tabs.
  await env.clickTab(0);
  const frozenFeed = env.feedText();
  const frozenStrip = env.stripText();
  const frozenTabs = env.tabButtons().length;
  const writes = [env.feedWrites(), env.stripWrites()];
  env.advance(1000);
  env.runInterval();
  env.advance(1000);
  env.runInterval();
  check(env.feedText(), frozenFeed, "The heartbeat leaves the cards untouched");
  check(env.stripText(), frozenStrip, "The heartbeat leaves the live strip untouched");
  check(env.tabButtons().length, frozenTabs, "The heartbeat leaves the tabs untouched");
  check([env.feedWrites(), env.stripWrites()], writes, "…with zero rebuilds while idle");
}

/* ==========================================================================
 * 12. The live-now strip: loaded, on watch, held — the replay feed's strip
 *     component carrying this feed's situations
 * ======================================================================== */

{
  const env = boot();
  // A late game that is not tied is polled and listed in the slate, but it is
  // not a situation: the strip must stay empty rather than invent a row.
  env.setSnapshot(snapshot(linescore({ state: "Top", away: 5, home: 3 })));
  await env.start();
  check(env.stripText(), "", "Nothing qualifies: the strip renders nothing at all");
  check(env.el("stat-held").textContent, "0", "…and nothing is counted as held");

  env.setSnapshot(snapshot(linescore({ first: runner(1, "R1") })));
  await env.advance(2000);
  await env.tick();
  ok(env.stripText().includes("👀 ON WATCH"), "A tied game in the bottom half shows on the strip");
  ok(env.stripText().includes("2 to fill"), "…with how many runners are still needed");
  ok(
    env.stripText().includes("game.html?gamePk=" + GAME_PK),
    "Each strip row links to the same game page the cards use",
  );
  ok(
    env.stripText().includes("feed-active-link") && env.stripText().includes("feed-active-badge"),
    "The strip reuses the replay feed's own strip classes",
  );

  env.setSnapshot(
    snapshot(linescore({ outs: 1, first: runner(1, "R1"), second: runner(2, "R2"), third: runner(3, "R3") })),
  );
  await env.advance(2000);
  await env.tick();
  ok(env.stripText().includes("🚨 BASES LOADED"), "A loaded situation takes over the strip");
  ok(env.stripText().includes("WALK-OFF POSSIBLE"), "…and is labelled as the walk-off situation");
  ok(env.stripText().includes("1 out"), "…with the official outs");

  env.setSnapshot(snapshot(linescore({ inning: 10, state: "Top" })));
  await env.advance(2000);
  await env.tick();
  ok(env.stripText().includes("⏳ WATCH HELD"), "A tied game between home halves shows as held");
  ok(env.stripText().includes("home team still to bat"), "…with the honest reason");
  ok(!env.stripText().includes("🚨 BASES LOADED"), "The loaded row is gone once the situation is");
}

/* ==========================================================================
 * 13. A stopped game: a late tie in a delay is held and counted as such — an
 *     early or untied delay is never allowed to inflate a counter
 * ======================================================================== */

{
  const env = boot();
  const delayed = { abstractGameState: "Live", detailedState: "Delayed" };
  env.setSnapshot(snapshot(linescore({ inning: 10, state: "Bottom" }), delayed));
  await env.start();
  check(env.state.oscillators, 0, "A paused game never chimes");
  check(env.el("stat-watch").textContent, "0", "A paused game is not counted as batting now");
  check(env.el("stat-held").textContent, "1", "…it is counted as a held watch");
  ok(
    env.stripText().includes("⏸ PAUSED · WATCH HELD"),
    "The strip shows the stopped game as a held watch",
  );
  ok(
    !env.stripText().includes("🚨 BASES LOADED"),
    "A stopped game is never presented as a loaded situation",
  );
  ok(
    env.savedFeed().every((e) => e.kind !== "bases_loaded"),
    "…and never produces an alert card from a snapshot that did not arrive",
  );
  check(
    env.savedFeed().filter((e) => e.kind === "watch_held").length,
    0,
    "A stopped game is never narrated as a held watch card (the hold is already labelled)",
  );

  // A delayed game that is NOT tied is still polled (it is a late inning), and
  // must not be counted anywhere.
  const env2 = boot();
  env2.setSnapshot(snapshot(linescore({ inning: 9, state: "Top", away: 5, home: 3 }), delayed));
  await env2.start();
  check(env2.el("stat-held").textContent, "0", "A late delay that is not tied is not a held watch");
  check(env2.el("stat-watch").textContent, "0", "…and it is not on watch");
  check(env2.stripText(), "", "…and the strip stays empty");

  // A tie that is delayed in an EARLY inning is not this page's business.
  const env3 = boot({ games: [scheduleGame({ inning: 3, state: "Bottom" })] });
  env3.setSnapshot(snapshot(linescore({ inning: 3, state: "Bottom" }), delayed));
  await env3.start();
  check(env3.el("stat-held").textContent, "0", "A delayed early-inning tie is not a held watch");
  check(env3.state.snapshotCalls.length, 0, "…and it is not even polled individually");
}

console.log(`✓ ${checks} chat-feed controller checks passed`);
