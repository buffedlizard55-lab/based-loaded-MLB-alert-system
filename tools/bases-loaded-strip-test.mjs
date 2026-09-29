#!/usr/bin/env node
/* Site-wide "Loaded Late" strip tests — no dependencies, no network, no browser.
 *
 *   node tools/bases-loaded-strip-test.mjs
 *
 * Three layers:
 *   1. the pure helpers the monitor page and the strip now share
 *      (scanTarget / pollCadence / recentSharedAlert / occupancyLabel);
 *   2. the wiring contract: which pages mount the strip, which intentionally
 *      do not, and in what order the scripts load;
 *   3. the strip controller itself, driven through a deterministic DOM, clock
 *      and MLB StatsAPI stub, so every alert state is reproducible offline.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const rules = require("../assets/js/bases-loaded-core.js");
const coreSource = readFileSync(
  new URL("../assets/js/bases-loaded-core.js", import.meta.url),
  "utf8",
);
const stripSource = readFileSync(
  new URL("../assets/js/bases-loaded-strip.js", import.meta.url),
  "utf8",
);
const page = (name) =>
  readFileSync(new URL(`../${name}`, import.meta.url), "utf8");

let checks = 0;
const check = (actual, expected, label) => {
  assert.deepEqual(actual, expected, label);
  checks++;
};
const ok = (value, label) => check(Boolean(value), true, label);

/* ==========================================================================
 * 1. Shared rule helpers
 * ======================================================================== */

const live = (inning, extra = {}) => ({
  gamePk: 1,
  status: { abstractGameState: "Live", detailedState: "In Progress" },
  linescore: { currentInning: inning, ...extra },
});

check(rules.scanTarget(live(8), undefined), false, "Inning 8 is not scanned");
check(rules.scanTarget(live(9), undefined), true, "Inning 9 is scanned");
check(rules.scanTarget(live(10), undefined), true, "Inning 10 is scanned");
check(rules.scanTarget(live(18), undefined), true, "Inning 18 is scanned");
check(
  rules.scanTarget(live(7), { active: true }),
  true,
  "A game already on watch stays a scan target even if the inning regresses",
);
check(
  rules.scanTarget(
    { ...live(12), status: { abstractGameState: "Final", detailedState: "Final" } },
    { active: true },
  ),
  false,
  "A final game is never scanned",
);
check(
  rules.scanTarget({ gamePk: 1, status: { abstractGameState: "Preview" } }, undefined),
  false,
  "A not-yet-started game is never scanned",
);

check(
  rules.pollCadence([live(3), live(5)], {}, { fast: 5000, slow: 30000 }),
  30000,
  "No late game: discovery-only pacing",
);
check(
  rules.pollCadence([live(3), live(9)], {}, { fast: 5000, slow: 30000 }),
  5000,
  "A game in inning 9 tightens the loop",
);
check(
  rules.pollCadence([live(2)], { 1: { active: true } }, { fast: 4000, slow: 25000 }),
  4000,
  "An active watch keeps the loop tight (array input)",
);
check(
  rules.pollCadence(new Map([[1, live(3)]]), {}, { fast: 5000, slow: 30000 }),
  30000,
  "Accepts a Map of games",
);
check(
  rules.pollCadence(null, {}, { fast: 5000, slow: 30000 }),
  30000,
  "Malformed input falls back to the slow cadence, never to busy polling",
);

const logEntry = (over = {}) => ({
  id: "100:9:1",
  gamePk: 100,
  inning: 9,
  observedAt: 1_000_000,
  runners: [{ id: 1 }, { id: 2 }, { id: 3 }],
  ...over,
});
check(
  rules.recentSharedAlert([logEntry()], 100, 9, 1_000_000 + 89_000),
  true,
  "Same game and inning inside the quiet window",
);
check(
  rules.recentSharedAlert([logEntry()], 100, 9, 1_000_000 + 90_001),
  false,
  "Outside the quiet window the situation may alert again",
);
check(
  rules.recentSharedAlert([logEntry()], 100, 10, 1_000_000),
  false,
  "A later inning is a new situation",
);
check(
  rules.recentSharedAlert([logEntry()], 101, 9, 1_000_000),
  false,
  "A different game is never suppressed",
);
check(
  rules.recentSharedAlert([logEntry()], 100, 9, 900_000),
  false,
  "A future-dated log entry cannot suppress an alert",
);
check(rules.recentSharedAlert(null, 100, 9, 1), false, "No log, no suppression");
check(rules.recentSharedAlert([logEntry()], 100, null, 1), false, "Unknown inning");

check(rules.occupancyLabel([]), "Bases empty", "Empty bases label");
check(rules.occupancyLabel([true, false, false]), "1st", "First only");
check(rules.occupancyLabel([true, true, false]), "1st & 2nd", "First and second");
check(rules.occupancyLabel([false, true, false]), "2nd", "Second only");
check(rules.occupancyLabel([false, true, true]), "2nd & 3rd", "Second and third");
check(rules.occupancyLabel([true, false, true]), "1st & 3rd", "Corners");
check(rules.occupancyLabel([true, true, true]), "Loaded", "All three");

/* ==========================================================================
 * 2. Page wiring contract
 * ======================================================================== */

for (const name of ["reviews.html", "scoreboard.html", "game.html"]) {
  const html = page(name);
  ok(
    html.includes('href="assets/css/bases-loaded-strip.css"'),
    `${name} loads the strip stylesheet`,
  );
  ok(
    html.includes('<script src="assets/js/bases-loaded-core.js"></script>'),
    `${name} loads the shared rules engine`,
  );
  ok(
    html.includes('<script src="assets/js/bases-loaded-strip.js"></script>'),
    `${name} loads the strip controller`,
  );
  ok(
    html.indexOf("assets/js/api.js") <
      html.indexOf("assets/js/bases-loaded-strip.js"),
    `${name} defines the api client before the strip starts`,
  );
}

for (const name of ["index.html", "bases-loaded.html"]) {
  const html = page(name);
  ok(
    !html.includes("bases-loaded-strip.js"),
    `${name} (the dashboard) does not double-mount the strip`,
  );
}

const reviewsHtml = page("reviews.html");
const scoreboardHtml = page("scoreboard.html");
ok(reviewsHtml.includes("bases-loaded.html"), "Replay feed still links to the monitor");
check(
  reviewsHtml.split("bases-loaded-strip.js").length - 1,
  1,
  "The strip is mounted exactly once per page",
);

/* ==========================================================================
 * 3. Strip controller: deterministic DOM + clock + API
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
    get firstChild() {
      return this.children[0] || null;
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
    insertBefore(child, reference) {
      child.parentNode = this;
      if (!reference) return this.appendChild(child);
      const index = this.children.indexOf(reference);
      if (index < 0) this.children.push(child);
      else this.children.splice(index, 0, child);
      return child;
    },
    fire(type, event = {}) {
      for (const fn of this.listeners[type] || []) fn({ target: this, ...event });
    },
    /**
     * Flattened text of the node and its children: tags stripped and the
     * escape() entities the controller emits decoded again, so assertions read
     * the same strings a browser would render.
     */
    text() {
      const own = `${this.textContent || ""} ${String(this.innerHTML || "").replace(
        /<[^>]*>/g,
        " ",
      )}`;
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
  // Browsers keep these in one backing store: setting either one replaces the
  // node's contents, so the shim must not let both exist at once.
  Object.defineProperty(node, "textContent", {
    get() {
      return this._text || (this.children.length ? "" : String(this._html || "").replace(/<[^>]*>/g, "")) ;
    },
    set(value) {
      this._text = String(value);
      this._html = "";
      this.children = [];
    },
  });
  Object.defineProperty(node, "innerHTML", {
    get() {
      // Reading innerHTML after a textContent write returns that text, which is
      // what makes `innerHTML += ...` behave the way it does in a browser.
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

function findAll(node) {
  return [node, ...node.children.flatMap((child) => findAll(child))];
}

function findByClass(node, className) {
  if ((node.className || "").split(/\s+/).includes(className)) return node;
  for (const child of node.children) {
    const found = findByClass(child, className);
    if (found) return found;
  }
  return null;
}

/** A live game as the schedule endpoint reports it. */
function scheduleGame(pk, { inning, state, outs = 0, away = 4, home = 4, bases = [] }) {
  return {
    gamePk: pk,
    status: { abstractGameState: "Live", detailedState: "In Progress" },
    teams: {
      away: { team: { name: `Away${pk}` } },
      home: { team: { name: `Home${pk}` } },
    },
    linescore: {
      currentInning: inning,
      inningState: state,
      isTopInning: state === "Top",
      outs,
      teams: { away: { runs: away }, home: { runs: home } },
      offense: Object.fromEntries(
        ["first", "second", "third"].flatMap((base, index) =>
          bases[index] ? [[base, { id: index + 1, fullName: `Runner ${index + 1}` }]] : [],
        ),
      ),
    },
  };
}

function boot({
  storage = new Map(),
  storageFails = false,
  demo = false,
  games = [],
  feeds = new Map(),
  scheduleFails = false,
  snapshotFails = false,
  audio = true,
  notificationPermission = "default",
  title = "MLB Live PBP — Replay Feed",
  withApi = true,
} = {}) {
  const body = makeElement("body");
  const listeners = {};
  const timeouts = new Map();
  const intervals = new Map();
  const notices = [];
  const state = {
    games,
    feeds,
    scheduleFails,
    snapshotFails,
    scheduleCalls: 0,
    snapshotCalls: [],
    clock: Date.now(),
    oscillators: 0,
    permission: notificationPermission,
    requestCalls: 0,
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
      state.requestCalls++;
      return state.permission;
    }
    constructor(title, options) {
      notices.push({ title, ...options });
    }
    close() {}
  }

  class FakeAudioContext {
    constructor() {
      this.currentTime = 0;
      this.destination = {};
    }
    async resume() {}
    createOscillator() {
      return {
        frequency: { value: 0 },
        connect() {},
        start() {},
        stop() {},
        disconnect() {},
        onended: null,
      };
    }
    createGain() {
      return {
        gain: {
          setValueAtTime() {},
          linearRampToValueAtTime() {},
          exponentialRampToValueAtTime() {},
        },
        connect() {},
        disconnect() {},
      };
    }
  }
  // Count oscillators through a proxy: each chime starts three of them.
  const CountingAudio = audio
    ? class extends FakeAudioContext {
        createOscillator() {
          state.oscillators++;
          return super.createOscillator();
        }
      }
    : undefined;

  const document = {
    readyState: "complete",
    hidden: false,
    title,
    body,
    documentElement: body,
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
    location: { search: demo ? "?ll-demo=1" : "" },
    Date: Clock,
    Intl,
    URLSearchParams,
    console,
    Notification: Notice,
    AudioContext: CountingAudio,
    localStorage: {
      getItem: (key) => {
        if (storageFails) throw Error("blocked");
        return storage.get(key) ?? null;
      },
      setItem: (key, value) => {
        if (storageFails) throw Error("blocked");
        storage.set(key, value);
      },
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
  context.focus = () => {};

  if (withApi) {
    context.MLB = {
      async getSchedule() {
        state.scheduleCalls++;
        if (state.scheduleFails) throw Error("Offline");
        return structuredClone(state.games);
      },
      async getAlertSnapshot(pk) {
        state.snapshotCalls.push(pk);
        if (state.snapshotFails) throw Error("Offline");
        const feed = state.feeds.get(pk);
        if (!feed) throw Error("No feed");
        return structuredClone({
          gameData: { status: feed.status },
          liveData: { linescore: feed.linescore },
        });
      },
    };
  }

  vm.runInContext(`${coreSource}\n${stripSource}`, context);

  const strip = () => document.getElementById("loaded-late-strip");
  return {
    context,
    document,
    state,
    body,
    notices,
    storage,
    timeouts,
    intervals,
    strip,
    text: () => strip()?.text() || "",
    toast: () => findByClass(strip(), "ll-toast"),
    detail: () => findByClass(strip(), "ll-detail"),
    actions: () => findByClass(strip(), "ll-actions"),
    /** Any control inside the strip, found by its visible label. */
    button: (label) => findAll(strip()).find((node) => node.textContent === label) || null,
    soundButton: (label = "Sound off") =>
      findAll(strip()).find((node) => node.textContent === label) || null,
    /** Next scheduled cycle delay (ms) — the strip's cadence. */
    nextDelay: () => [...timeouts.values()].map((entry) => entry.ms),
    async tick() {
      const pending = [...timeouts.values()];
      timeouts.clear();
      for (const entry of pending) await entry.fn();
      await settle();
    },
    runIntervals() {
      for (const { fn } of intervals.values()) fn();
    },
    advance(ms) {
      state.clock += ms;
    },
    setFeed(pk, feed) {
      state.feeds.set(pk, feed);
    },
    dispatchVisibility(hidden) {
      document.hidden = hidden;
      document.dispatch("visibilitychange");
    },
    async click(node) {
      node.fire("click");
      await settle();
    },
  };
}

const settle = async () => {
  for (let i = 0; i < 12; i++) await new Promise((resolve) => setImmediate(resolve));
};

const feedFor = (game) => ({
  status: game.status,
  linescore: {
    ...game.linescore,
    balls: game.linescore.balls ?? 0,
    strikes: game.linescore.strikes ?? 0,
  },
});

/* ------------------------------------------------------- the happy path */

{
  const tied9 = scheduleGame(11, { inning: 9, state: "Top", outs: 2, bases: [true, true, true] });
  const feed = { ...feedFor(tied9), linescore: { ...tied9.linescore, offence: undefined } };
  void feed;
  const app = boot({ games: [tied9], feeds: new Map([[11, feedFor(tied9)]]) });
  await settle();

  check(
    app.strip() !== null,
    true,
    "Strip mounts itself into the page it is loaded on",
  );
  check(app.body.children[0], app.strip(), "Strip is the first element in <body>");
  check(
    app.text().includes("LOADED LATE") || app.text().includes("LOADEDLATE"),
    true,
    "Strip carries the Loaded Late brand",
  );

  // Top 9, tied, loaded: deliberately NOT an alert — the home half has not begun.
  check(app.toast().hidden, true, "No toast for a loaded top half");
  check(app.notices.length, 0, "No desktop notice for a loaded top half");
  ok(
    app.text().includes("no tied bottom-9 situation"),
    "Loaded top half stays out of the watch list",
  );

  // The changeover into the home half opens the watch window.
  const middle = scheduleGame(11, { inning: 9, state: "Middle", outs: 3, bases: [true, true, true] });
  app.state.games = [middle];
  app.setFeed(11, feedFor(middle));
  await app.tick();
  ok(app.text().includes("WATCHING 1"), "Tied changeover puts the game on watch");
  ok(
    app.text().includes("changeover") || app.text().includes("home half pending"),
    "Changeover is labelled, not guessed",
  );
  check(app.toast().hidden, true, "Changeover is not an alert");
  check(app.notices.length, 0, "Changeover sends no notice");

  // Walk + single: two bases occupied, still no alert.
  const twoOn = scheduleGame(11, { inning: 9, state: "Bottom", outs: 1, bases: [true, true, false] });
  app.state.games = [twoOn];
  app.setFeed(11, feedFor(twoOn));
  await app.tick();
  ok(app.text().includes("1st & 2nd"), "Partial occupancy is tracked, not just 'loaded or not'");
  ok(app.text().includes("1 base to fill"), "Remaining base is named");
  check(app.toast().hidden, true, "Two runners are never an alert");

  // The intentional walk loads them: ALERT.
  const loaded = scheduleGame(11, { inning: 9, state: "Bottom", outs: 2, bases: [true, true, true] });
  loaded.linescore.balls = 3;
  loaded.linescore.strikes = 2;
  loaded.linescore.offense.batter = { id: 77, fullName: "M. Trout" };
  loaded.linescore.defense = { pitcher: { id: 78, fullName: "C. Sale" } };
  loaded.linescore.currentPlay = { result: { event: "Intentional Walk" } };
  app.state.games = [loaded];
  app.setFeed(11, feedFor(loaded));
  await app.tick();

  ok(app.text().includes("ALERT · TIED · BASES LOADED · BOT 9"), "Alert banner names the situation");
  check(app.toast().hidden, false, "Toast appears on the exact situation");
  ok(app.text().includes("MAXIMUM"), "Top tension (2 outs, full count) is surfaced");
  ok(app.text().includes("loaded on: Intentional Walk"), "The observed route to loaded bases is shown");
  ok(app.text().includes("M. Trout"), "Batter is carried into the alert");
  ok(app.text().includes("C. Sale"), "Pitcher is carried into the alert");
  check(app.notices.length, 0, "No notice without an explicit opt-in");
  check(app.state.oscillators, 0, "No chime while sound is off");
  ok(app.document.title.startsWith("⚠ BASES LOADED — "), "Background-tab title is marked");
  ok(
    app.document.title.includes("MLB Live PBP — Replay Feed"),
    "The host page's own title text is preserved",
  );

  const log = JSON.parse(app.storage.get("loaded-late:v3"));
  check(log.history.length, 1, "One alert appended to the shared log");
  check(log.states[11].active, true, "Shared dedup state marks the situation active");

  // Repeat polls never duplicate the alert.
  const before = app.state.snapshotCalls.length;
  await app.tick();
  await app.tick();
  ok(app.state.snapshotCalls.length > before, "Late games keep being polled");
  check(
    JSON.parse(app.storage.get("loaded-late:v3")).history.length,
    1,
    "Repeated polls do not create duplicate alerts",
  );

  // The situation ends: bases empty, game still tied.
  const cleared = scheduleGame(11, { inning: 9, state: "Bottom", outs: 2, bases: [false, false, false] });
  app.state.games = [cleared];
  app.setFeed(11, feedFor(cleared));
  await app.tick();
  check(app.toast().hidden, true, "Cleared situation removes the toast");
  check(
    app.document.title.startsWith("⚠"),
    false,
    "Title marker is removed once the situation clears",
  );
  check(app.document.title, "MLB Live PBP — Replay Feed", "Original title restored exactly");

  // Sound armed before the reload: a confirmed exit + reload is a genuine new
  // situation and must chime again. The quiet window only ever counts entries
  // written by ANOTHER page (observer-scoped), never this strip's own alert.
  await app.click(app.button("Sound off"));
  const armed = app.state.oscillators;
  check(app.button("Sound on").textContent, "Sound on", "Sound armed for the reload");

  // Same inning, loaded again: a genuine new situation (documented re-arm).
  app.state.games = [twoOn];
  app.setFeed(11, feedFor(twoOn));
  await app.tick();
  await app.tick();
  check(
    app.state.oscillators,
    armed,
    "Partial occupancy on the way back never chimes",
  );
  app.state.games = [loaded];
  app.setFeed(11, feedFor(loaded));
  await app.tick();
  check(
    JSON.parse(app.storage.get("loaded-late:v3")).history.length,
    2,
    "A confirmed exit and reload can alert again in the same inning",
  );
  check(
    app.state.oscillators,
    armed + 3,
    "The reload chimes again — the strip's own earlier alert never suppresses it",
  );
}

/* ------------------------------------------------- extra innings, no cap */

{
  for (const inning of [10, 11, 12, 13, 14, 17]) {
    const game = scheduleGame(20 + inning, {
      inning,
      state: "Bottom",
      outs: 1,
      bases: [true, true, true],
    });
    const app = boot({ games: [game], feeds: new Map([[game.gamePk, feedFor(game)]]) });
    await settle();
    ok(
      app.text().includes(`BOT ${inning}`) && app.text().includes("BASES LOADED"),
      `Bottom ${inning} alerts with no inning limit`,
    );
    check(app.toast().hidden, false, `Bottom ${inning} shows the toast`);
  }
}

/* ------------------------------------------- opt-in sound and notifications */

{
  const game = scheduleGame(31, { inning: 11, state: "Middle", outs: 3 });
  const app = boot({
    games: [game],
    feeds: new Map([[31, feedFor(game)]]),
    notificationPermission: "granted",
  });
  await settle();

  const sound = app.button("Sound off");
  check(sound.textContent, "Sound off", "Sound starts off every session");
  await app.click(sound);
  check(app.button("Sound on").textContent, "Sound on", "Sound toggles on");
  check(app.state.oscillators, 3, "Enabling sound plays the preview chime");

  const notify = app.button("Alerts off");
  await app.click(notify);
  check(app.button("Alerts on").textContent, "Alerts on", "Notification opt-in is reflected in the button");
  check(app.state.requestCalls, 1, "Permission is requested on the user's click");
  check(
    JSON.parse(app.storage.get("loaded-late:preferences")).notifications,
    true,
    "Notification preference is shared with the dashboard",
  );

  const loaded = scheduleGame(31, { inning: 11, state: "Bottom", outs: 1, bases: [true, true, true] });
  app.state.games = [loaded];
  app.setFeed(31, feedFor(loaded));
  await app.tick();
  check(app.state.oscillators, 6, "An alert chimes once sound is on");
  check(app.notices.length, 1, "An alert raises one desktop notice after opt-in");
  ok(app.notices[0].title.includes("Bottom 11"), "Notice names the inning");
  ok(app.notices[0].body.includes("Away31"), "Notice carries the matchup");
  check(
    app.notices[0].tag,
    JSON.parse(app.storage.get("loaded-late:v3")).history[0].id,
    "Notice is tagged with the alert id so repeated notices collapse",
  );

  // A repeated poll must not re-notify.
  await app.tick();
  check(app.notices.length, 1, "Repeat polls do not re-notify");
}

/* -------------------------------------------- blocked / unsupported notices */

{
  const game = scheduleGame(41, { inning: 9, state: "Bottom", outs: 0, bases: [true, true, true] });
  const app = boot({
    games: [game],
    feeds: new Map([[41, feedFor(game)]]),
    notificationPermission: "denied",
    audio: false,
  });
  await settle();
  check(
    app.button("Sound off").disabled,
    true,
    "Sound is disabled when the browser has no AudioContext",
  );
  check(
    app.button("Alerts blocked").textContent,
    "Alerts blocked",
    "Denied permission is stated plainly",
  );
  check(app.toast().hidden, false, "On-page alert still works with no notification support");
  check(app.notices.length, 0, "No notice is attempted when permission is denied");
}

/* --------------------------------- shared log: no cross-page double alerts */

{
  const game = scheduleGame(51, { inning: 10, state: "Bottom", outs: 2, bases: [true, true, true] });
  const observedAt = Date.now();
  const storage = new Map([
    [
      "loaded-late:v3",
      JSON.stringify({
        history: [
          {
            id: "51:10:999",
            gamePk: 51,
            inning: 10,
            awayScore: 4,
            homeScore: 4,
            outs: 2,
            runners: [{ id: 1 }, { id: 2 }, { id: 3 }],
            away: "Away51",
            home: "Home51",
            observedAt: observedAt - 8000,
          },
        ],
        states: {},
      }),
    ],
  ]);
  const app = boot({
    games: [game],
    feeds: new Map([[51, feedFor(game)]]),
    storage,
    notificationPermission: "granted",
  });
  await settle();
  await app.click(app.button("Sound off")); // sound on -> preview chime
  await app.click(app.button("Alerts off")); // notifications on
  check(app.state.oscillators, 3, "Opt-in preview chime only");
  check(app.notices.length, 0, "Opt-in alone does not notify");

  await app.tick();
  const log = JSON.parse(storage.get("loaded-late:v3"));
  check(log.history.length, 2, "The second page still records what it observed");
  check(log.history[0].crossPage, true, "It is marked as already alerted elsewhere");
  check(app.notices.length, 0, "No second desktop notice for the same game + inning");
  check(app.state.oscillators, 3, "Only the opt-in preview chime is heard, not an alert chime");
  ok(app.text().includes("BASES LOADED"), "The situation is still shown live on this page");
}

/* ------------------------------- fresh page load mid-situation (dedup state) */

{
  const game = scheduleGame(61, { inning: 9, state: "Bottom", outs: 1, bases: [true, true, true] });
  const storage = new Map([
    [
      "loaded-late:v3",
      JSON.stringify({
        history: [
          {
            id: "61:9:5",
            gamePk: 61,
            inning: 9,
            awayScore: 4,
            homeScore: 4,
            outs: 1,
            runners: [{ id: 1 }, { id: 2 }, { id: 3 }],
            away: "Away61",
            home: "Home61",
            observedAt: Date.now() - 4000,
          },
        ],
        states: { 61: { inningKey: "61:9", active: true, serial: 1, observedAt: Date.now() - 4000 } },
      }),
    ],
  ]);
  const app = boot({
    games: [game],
    feeds: new Map([[61, feedFor(game)]]),
    storage,
    notificationPermission: "granted",
  });
  await settle();
  await app.click(app.button("Alerts off"));
  const noticesAfterOptIn = app.notices.length;
  await app.tick();
  check(
    JSON.parse(storage.get("loaded-late:v3")).history.length,
    1,
    "A continuous situation is not logged twice across pages",
  );
  check(app.notices.length, noticesAfterOptIn, "No re-notification on a page switch");
  check(app.toast().hidden, false, "The live situation is still displayed");
}

/* --------------------------------------------------- hidden tab behaviour */

{
  const game = scheduleGame(71, { inning: 9, state: "Bottom", outs: 0, bases: [false, false, false] });
  const app = boot({ games: [game], feeds: new Map([[71, feedFor(game)]]) });
  await settle();
  const afterBoot = app.state.snapshotCalls.length;

  app.dispatchVisibility(true);
  await settle();
  check(app.document.hidden, true, "Test harness hides the tab");
  ok(app.text().includes("paused"), "Hidden tab is reported as paused, never as an all-clear");
  await app.tick();
  check(app.state.snapshotCalls.length, afterBoot, "No requests are made in a hidden tab");

  app.dispatchVisibility(false);
  await settle();
  check(
    app.state.snapshotCalls.length,
    afterBoot + 1,
    "Returning to the tab scans immediately",
  );
}

/* --------------------------------------------------------- loop pacing */

{
  const early = scheduleGame(81, { inning: 3, state: "Top", outs: 1 });
  const slow = boot({ games: [early], feeds: new Map([[81, feedFor(early)]]) });
  await settle();
  check(slow.nextDelay(), [30000], "Nothing late: one schedule refresh per 30s");

  const late = scheduleGame(82, { inning: 9, state: "Top", outs: 1 });
  const fast = boot({ games: [late], feeds: new Map([[82, feedFor(late)]]) });
  await settle();
  check(fast.nextDelay(), [5000], "Inning 9+: live snapshots every 5s");
}

/* -------------------------------------------- stale snapshots + failures */

{
  const game = scheduleGame(91, { inning: 9, state: "Bottom", outs: 1, bases: [true, true, true] });
  const app = boot({ games: [game], feeds: new Map([[91, feedFor(game)]]) });
  await settle();
  check(app.toast().hidden, false, "Alert observed before the feed fails");

  // Polling stops in a hidden tab, so the last good snapshot ages out.
  app.dispatchVisibility(true);
  await settle();
  app.advance(15000);
  app.runIntervals();
  ok(app.text().includes("Snapshot is stale"), "An unrefreshed snapshot is marked stale");
  ok(app.text().includes("paused"), "A paused tab is reported as paused, never all-clear");
  ok(
    app.text().includes("BASES LOADED") === false,
    "A stale snapshot is not displayed as a live alert",
  );

  app.dispatchVisibility(false);
  await settle();
  check(app.toast().hidden, false, "Resuming finds the live situation again");
  ok(!app.text().includes("stale"), "A fresh snapshot clears the stale flag");
  check(
    JSON.parse(app.storage.get("loaded-late:v3")).history.length,
    1,
    "Recovery from a gap does not re-alert or re-arm",
  );

  // A failing feed keeps the last confirmed state, clearly marked.
  app.state.snapshotFails = true;
  await app.tick();
  ok(app.text().includes("unconfirmed"), "A failed snapshot is flagged, not hidden");
  ok(
    app.text().includes("Live snapshot unavailable"),
    "The failure reason is shown instead of an all-clear",
  );
  app.state.snapshotFails = false;
  await app.tick();
  check(
    JSON.parse(app.storage.get("loaded-late:v3")).history.length,
    1,
    "Recovery after a failed snapshot does not re-alert",
  );

  const failedSchedule = boot({ games: [game], feeds: new Map([[91, feedFor(game)]]), scheduleFails: true });
  await settle();
  ok(
    failedSchedule.text().includes("schedule unavailable"),
    "A schedule failure is stated, never shown as 'nothing is happening'",
  );
}

/* ------------------------------------------------------ storage is optional */

{
  const game = scheduleGame(101, { inning: 9, state: "Bottom", outs: 2, bases: [true, true, true] });
  const app = boot({
    games: [game],
    feeds: new Map([[101, feedFor(game)]]),
    storageFails: true,
  });
  await settle();
  check(app.toast().hidden, false, "Live alerting survives blocked storage");
  await app.tick();
  check(app.toast().hidden, false, "Polling continues with blocked storage");
}

/* ------------------------------------------- missing api client degrades well */

{
  const app = boot({ withApi: false });
  await settle();
  ok(app.strip() !== null, "Strip still mounts when the page has no api client");
  ok(
    app.text().includes("api client missing"),
    "The strip says it cannot watch instead of pretending to",
  );
  check(app.state.scheduleCalls ?? 0, 0, "No api client means no requests");
}

/* ------------------------------------------------------------- demo mode */

{
  const app = boot({ demo: true });
  await settle();
  ok(app.text().includes("no live polling"), "Demo mode is labelled on every render");
  check(app.state.scheduleCalls ?? 0, 0, "Demo mode makes no MLB requests");
  check(app.storage.size, 0, "Demo mode never writes the shared alert log");

  check(
    app.toast().hidden,
    true,
    "Demo opens on the changeover, which is a watch and not an alert",
  );
  ok(app.text().includes("WATCHING 1"), "Demo evolves one synthetic game, not a pile of games");

  const next = app.button("Next scenario →");
  check(next.textContent, "Next scenario →", "Demo advances with the same button");
  const seen = [];
  for (let i = 0; i < 6; i++) {
    seen.push(app.text());
    await app.click(next);
  }
  ok(
    seen.some((text) => text.includes("BASES LOADED")),
    "Demo reaches a bases-loaded alert",
  );
  ok(seen.some((text) => text.includes("BOT 12")), "Demo includes a bottom-12 case");
  check(app.storage.size, 0, "Stepping the demo still never writes storage");
  check(app.notices.length, 0, "Demo sends no desktop notices without opt-in");
}

/* ----------------------------------------------------------- dismissal */

{
  const game = scheduleGame(111, { inning: 9, state: "Bottom", outs: 0, bases: [true, true, true] });
  const app = boot({ games: [game], feeds: new Map([[111, feedFor(game)]]) });
  await settle();
  check(app.toast().hidden, false, "Toast is up before dismissal");
  // The toast's close control is part of the rendered markup.
  ok(
    app.toast().innerHTML.includes("data-dismiss"),
    "Toast offers a dismiss control",
  );
  app.toast().fire("click", {
    target: { getAttribute: (key) => (key === "data-dismiss" ? "1" : null) },
  });
  await settle();
  check(app.toast().hidden, true, "Dismiss hides the toast");
  ok(app.text().includes("BASES LOADED"), "The bar keeps reporting the live situation");
  await app.tick();
  check(app.toast().hidden, true, "Dismissal sticks while the same situation continues");
}

console.log(`✓ ${checks} site-wide Loaded Late strip checks passed`);
