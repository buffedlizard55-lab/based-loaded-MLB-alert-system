#!/usr/bin/env node
/* Browser-controller integration tests with a deterministic DOM, clock and MLB API.
 * Run: node tools/bases-loaded-monitor-test.mjs (no dependencies/network).
 */
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
const core = readFileSync(
  new URL("../assets/js/bases-loaded-core.js", import.meta.url),
  "utf8",
);
const controller = readFileSync(
  new URL("../assets/js/bases-loaded.js", import.meta.url),
  "utf8",
);
const page = readFileSync(
  new URL("../bases-loaded.html", import.meta.url),
  "utf8",
);
const ids = [...page.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
const fixture = () => ({
  gamePk: 123,
  status: { abstractGameState: "Live", detailedState: "In Progress" },
  teams: {
    away: { team: { name: "Away <team>" } },
    home: { team: { name: "Home & team" } },
  },
  linescore: {
    currentInning: 9,
    inningState: "Middle",
    isTopInning: false,
    outs: 3,
    teams: { away: { runs: 4 }, home: { runs: 4 } },
    offense: {},
  },
});
let checks = 0;
const check = (actual, expected, label) => {
  assert.deepEqual(actual, expected, label);
  checks++;
};
const settle = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r));
};
function boot({
  storage = new Map(),
  demo = false,
  scheduleFails = false,
  storageFails = false,
  multiple = null,
} = {}) {
  const nodes = Object.fromEntries(
    ids.map((id) => [
      id,
      {
        id,
        textContent: "",
        innerHTML: "",
        disabled: false,
        hidden: false,
        attributes: {},
        listeners: {},
        classList: { toggle() {} },
        setAttribute(key, value) {
          this.attributes[key] = value;
        },
        addEventListener(key, fn) {
          this.listeners[key] = fn;
        },
      },
    ]),
  );
  const listeners = {},
    timeouts = new Map(),
    intervals = [],
    notices = [];
  const state = {
    game: fixture(),
    multiple,
    inFlight: 0,
    maxInFlight: 0,
    snapshotFails: false,
    scheduleFails,
    scheduleCalls: 0,
    snapshotCalls: 0,
    clock: Date.now(),
    hold: null,
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
    static permission = "granted";
    static async requestPermission() {
      return this.permission;
    }
    constructor(title, options) {
      notices.push({ title, ...options });
    }
    close() {}
  }
  const document = {
    hidden: false,
    title: "",
    getElementById: (id) => nodes[id],
    addEventListener: (key, fn) => (listeners[key] = fn),
  };
  const context = vm.createContext({
    document,
    location: { search: demo ? "?demo=1" : "" },
    Date: Clock,
    Intl,
    URLSearchParams,
    console,
    Notification: Notice,
    localStorage: {
      getItem: (key) => {
        if (storageFails) throw Error("blocked");
        return storage.get(key) || null;
      },
      setItem: (key, value) => {
        if (storageFails) throw Error("blocked");
        storage.set(key, value);
      },
    },
    setTimeout: (fn) => {
      const id = timeouts.size + 1;
      timeouts.set(id, fn);
      return id;
    },
    clearTimeout: (id) => timeouts.delete(id),
    setInterval: (fn) => intervals.push(fn),
    MLB: {
      async getSchedule() {
        state.scheduleCalls++;
        if (state.scheduleFails) throw Error("Offline");
        return structuredClone(state.multiple || [state.game]);
      },
      async getAlertSnapshot(pk) {
        state.snapshotCalls++;
        state.inFlight++;
        state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
        try {
          await Promise.resolve();
          if (state.hold) await state.hold;
          if (state.snapshotFails) throw Error("Offline");
          const game =
            state.multiple?.find((g) => g.gamePk === pk) || state.game;
          return {
            gameData: { status: structuredClone(game.status) },
            liveData: { linescore: structuredClone(game.linescore) },
          };
        } finally {
          state.inFlight--;
        }
      },
    },
  });
  context.window = context;
  context.focus = () => {};
  vm.runInContext(core + "\n" + controller, context);
  return {
    nodes,
    state,
    document,
    listeners,
    notices,
    storage,
    intervals,
    click: async (id) => {
      await nodes[id].listeners.click({ currentTarget: nodes[id] });
      await settle();
    },
    tick: async () => {
      const entries = [...timeouts.values()];
      timeouts.clear();
      for (const fn of entries) await fn();
      await settle();
    },
  };
}
const app = boot();
await settle();
check(app.state.scheduleCalls, 2, "Fetch current and prior MLB dates");
check(app.state.snapshotCalls, 1, "Deduplicate same game across schedules");
check(app.nodes["watch-count"].textContent, 1, "Tied changeover starts watch");
check(app.nodes["active-count"].textContent, 0, "No alert at changeover");
check(
  app.nodes.watch.innerHTML.includes("Away &lt;team&gt;"),
  true,
  "Names HTML escaped",
);
await app.click("notify");
app.state.game.linescore = {
  ...app.state.game.linescore,
  inningState: "Bottom",
  outs: 1,
  offense: {
    first: { id: 1, fullName: "A" },
    second: { id: 2, fullName: "B" },
    third: { id: 3, fullName: "C" },
  },
};
await app.click("refresh");
check(
  app.nodes["active-count"].textContent,
  1,
  "Exact live condition displays",
);
check(app.notices.length, 1, "One desktop notification after explicit opt-in");
check(app.nodes["history-count"].textContent, 1, "Store first alert");
await app.click("refresh");
check(app.notices.length, 1, "Repeated scan not announced");
check(
  app.nodes["history-count"].textContent,
  1,
  "Repeated scan not saved twice",
);
app.state.snapshotFails = true;
await app.click("refresh");
check(
  app.nodes["active-count"].textContent,
  0,
  "Failed snapshot cannot appear as live",
);
check(
  app.nodes.current.innerHTML.includes("not fully confirmed"),
  true,
  "Failure not falsely reported as all clear",
);
app.state.snapshotFails = false;
await app.click("refresh");
check(app.notices.length, 1, "Error recovery preserves dedup");
app.state.clock += 13000;
app.intervals.forEach((fn) => fn());
check(
  app.nodes["active-count"].textContent,
  0,
  "Stale snapshot expires even while awaiting poll",
);
await app.click("refresh");
check(app.notices.length, 1, "Stale recovery does not retrigger");
app.document.hidden = true;
app.listeners.visibilitychange();
const callsBefore = app.state.snapshotCalls;
await app.click("refresh");
check(app.state.snapshotCalls, callsBefore, "No polling in hidden tab");
check(
  app.nodes["active-count"].textContent,
  0,
  "Hidden tab clears green live indicator",
);
check(
  app.nodes.status.textContent.includes("Paused"),
  true,
  "Paused monitoring disclosed",
);
app.document.hidden = false;
app.listeners.visibilitychange();
await settle();
check(
  app.nodes["active-count"].textContent,
  1,
  "Visibility resumes immediately",
);
check(app.notices.length, 1, "Visibility resume does not duplicate");
let release;
app.state.hold = new Promise((resolve) => (release = resolve));
app.nodes.refresh.listeners.click();
await settle();
const inFlight = app.state.snapshotCalls;
app.nodes.refresh.listeners.click();
await settle();
check(app.state.snapshotCalls, inFlight, "Refresh cannot overlap scan");
release();
app.state.hold = null;
await settle();
delete app.state.game.linescore.offense.first;
await app.click("refresh");
check(
  app.nodes["active-count"].textContent,
  0,
  "Base clearing removes active alert",
);
app.state.game.linescore.offense.first = { id: 4, fullName: "D" };
await app.click("refresh");
check(
  app.notices.length,
  2,
  "Reloading bases in same inning sends second alert",
);
check(app.nodes["history-count"].textContent, 2, "Reload saved separately");
const persisted = JSON.parse(app.storage.get("loaded-late:v3"));
check(
  persisted.history[1].runners[0].name,
  "A",
  "First runner snapshot stays immutable",
);
const reloaded = boot({ storage: app.storage });
reloaded.state.game = structuredClone(app.state.game);
await settle();
check(
  reloaded.nodes["history-count"].textContent,
  2,
  "History restored after refresh",
);
check(
  reloaded.notices.length,
  0,
  "Restored active situation not announced again",
);

/* -------------------- shared log: no cross-page double alerts ------------
 * The other page of this site (the strip on reviews.html, or another tab)
 * recorded this exact game + inning moments ago. This dashboard has its own
 * in-memory dedup state (not yet active), so it observes a fresh event —
 * it must record it, mark it, and stay SILENT. Its save must also keep the
 * other page's entry instead of clobbering it. */
const crossStorage = new Map();
const cross = boot({ storage: crossStorage });
await settle();
await cross.click("notify");
check(cross.notices.length, 0, "Opt-in alone never notifies");
crossStorage.set(
  "loaded-late:v3",
  JSON.stringify({
    history: [
      {
        id: "123:9:other-page",
        gamePk: 123,
        inning: 9,
        awayScore: 4,
        homeScore: 4,
        outs: 1,
        runners: [{ id: 1 }, { id: 2 }, { id: 3 }],
        away: "Away",
        home: "Home",
        observedAt: Date.now() - 5000,
        observer: "other-page",
      },
    ],
    states: {},
  }),
);
cross.state.game.linescore = {
  ...cross.state.game.linescore,
  inningState: "Bottom",
  outs: 1,
  offense: {
    first: { id: 1, fullName: "A" },
    second: { id: 2, fullName: "B" },
    third: { id: 3, fullName: "C" },
  },
};
await cross.click("refresh");
check(
  cross.nodes["active-count"].textContent,
  1,
  "Cross-page alert still shown live on this page",
);
check(
  cross.notices.length,
  0,
  "No second desktop notice when the other page already alerted",
);
const crossLog = JSON.parse(crossStorage.get("loaded-late:v3"));
check(
  crossLog.history.some((entry) => entry.crossPage === true),
  true,
  "This page's observation is recorded with the crossPage marker",
);
check(
  crossLog.history.some((entry) => entry.id === "123:9:other-page"),
  true,
  "Saving never clobbers the other page's entry",
);

app.state.game.linescore.teams.home.runs = 5;
app.state.game.status = { abstractGameState: "Final", detailedState: "Final" };
await app.click("refresh");
check(
  app.nodes["active-count"].textContent,
  0,
  "Final game removed despite leftover bases",
);
check(
  JSON.parse(app.storage.get("loaded-late:v3")).history[0].homeScore,
  4,
  "Final score never overwrites historical tie",
);
const failed = boot({ scheduleFails: true });
await settle();
check(
  failed.nodes.status.textContent.includes("degraded"),
  true,
  "Initial schedule failure is visible",
);
check(
  failed.nodes.current.innerHTML.includes("not fully confirmed"),
  true,
  "Empty unavailable schedule is not all clear",
);
await failed.tick();
check(
  failed.state.scheduleCalls,
  2,
  "Failed schedule retries at discovery cadence, not each 2s tick",
);
const blocked = boot({ storageFails: true });
await settle();
check(
  blocked.nodes["watch-count"].textContent,
  1,
  "Storage failure does not break monitor",
);
check(
  blocked.nodes.feedback.textContent.includes("history"),
  true,
  "Persistence failure disclosed",
);
const demoStore = new Map([["loaded-late:v3", "leave untouched"]]);
const demo = boot({ demo: true, storage: demoStore });
await settle();
check(demo.state.scheduleCalls, 0, "Demo never calls live schedule");
for (let i = 0; i < 14; i++) await demo.click("demo-next");
check(
  demo.nodes["history-count"].textContent,
  4,
  "Demo exercises first load, reload, error-load, bottom 14",
);
check(
  demo.nodes.current.innerHTML.includes("BOT 14"),
  true,
  "Demo shows extra innings",
);
check(
  demoStore.get("loaded-late:v3"),
  "leave untouched",
  "Demo isolated from live history",
);
check(demo.notices.length, 0, "No demo notifications without explicit opt-in");
await demo.click("demo-next");
check(demo.nodes["active-count"].textContent, 0, "Demo loaded but trailing is excluded");
await demo.click("demo-next");
check(demo.nodes["active-count"].textContent, 1, "Demo tying walk alerts with bases still loaded");
check(demo.nodes["history-count"].textContent, 5, "Demo saves the newly tied bottom-15 situation");
await demo.click("demo-next");
check(demo.nodes["history-count"].textContent, 0, "Demo restart clears synthetic history");
check(demoStore.get("loaded-late:v3"), "leave untouched", "Restart still never writes live history");
const slate = Array.from({ length: 7 }, (_, i) => {
  const game = fixture();
  game.gamePk = i + 1000;
  Object.assign(game.linescore, {
    inningState: "Bottom",
    outs: 1,
    offense: { first: { id: 1 }, second: { id: 2 }, third: { id: 3 } },
  });
  if (i === 5) {
    game.linescore.inningState = "Top";
    game.linescore.isTopInning = true;
  }
  if (i === 6) game.linescore.currentInning = 8;
  return game;
});
const multi = boot({ multiple: slate });
await settle();
check(
  multi.nodes["games-count"].textContent,
  7,
  "All games included once across dates",
);
check(
  multi.state.snapshotCalls,
  6,
  "Scan every ninth-inning game, not the eighth inning",
);
check(
  multi.state.maxInFlight,
  4,
  "Maximum four parallel live snapshot requests",
);
check(
  multi.nodes["active-count"].textContent,
  5,
  "Concurrent matching games tracked separately",
);
check(
  multi.nodes["history-count"].textContent,
  5,
  "One historical record per matching game",
);
console.log(`✓ ${checks} bases-loaded monitor integration checks passed`);
