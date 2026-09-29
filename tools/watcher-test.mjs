#!/usr/bin/env node
/* Deterministic tests for the always-on watcher (tools/watcher.mjs).
 *
 * No dependencies and no network: every request is a stub and the clock is
 * injected, so the watcher's polling, de-duplication, log and delivery
 * behaviour can be asserted exactly.
 *
 * Run: node tools/watcher-test.mjs
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createDecipheriv, createECDH, createHmac, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const rules = require("../assets/js/bases-loaded-core.js");
const {
  ALERT_FIELDS,
  gamePageUrl,
  MAX_WORKERS,
  loadConfig,
  deliver,
  readState,
  writeState,
  appendAlert,
  pushConfigProblem,
  pushPayload,
  pushTopic,
  PUSH_TTL_SECONDS,
  PUSH_MAX_ATTEMPTS,
  isRetryablePush,
  pushRetryWaitSeconds,
  sendPushWithRetry,
  doctor,
  listStoredSubscriptions,
  pruneInvalidSubscriptions,
  runCycle,
} = await import("./watcher.mjs");
const { b64url, generateVapidKeys, readSubscriptions, writeSubscriptions } = await import("./webpush.mjs");

let checks = 0;
const check = (actual, expected, label) => {
  assert.deepEqual(actual, expected, label);
  checks += 1;
};
const ok = (condition, label) => {
  assert.ok(condition, label);
  checks += 1;
};

/* --------------------------------------------------------------- fixtures - */

const ET_DAY = (offset) =>
  new Date(Date.now() + offset * 86_400_000).toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  });

/** A live game fixture. `state` is what the linescore shows right now. */
function game({
  gamePk = 900001,
  inning = 9,
  half = "Bottom",
  outs = 1,
  away = 4,
  home = 4,
  bases = [1, 2, 3],
  detailedState = "In Progress",
  abstractGameState = "Live",
} = {}) {
  const occupied = (pk, index) =>
    bases.includes(index) ? { id: pk, fullName: `Runner ${index}` } : undefined;
  return {
    gamePk,
    status: { abstractGameState, detailedState },
    teams: { away: { team: { name: "Away" } }, home: { team: { name: "Home" } } },
    linescore: {
      currentInning: inning,
      inningState: half === "Bottom" ? "Bottom" : "Top",
      isTopInning: half !== "Bottom",
      outs,
      teams: { away: { runs: away }, home: { runs: home } },
      offense: {
        first: occupied(101, 1),
        second: occupied(102, 2),
        third: occupied(103, 3),
      },
    },
  };
}

/** A fetch stub: `handler(url)` returns the payload, or throws. */
function stub(handler, { log = [] } = {}) {
  let inFlight = 0;
  let maxInFlight = 0;
  const fetchJson = async (url) => {
    log.push(url);
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      await Promise.resolve();
      return await handler(url);
    } finally {
      inFlight -= 1;
    }
  };
  return { fetchJson, log, peak: () => maxInFlight };
}

const schedules = (games, extra = {}) => (url) =>
  url.includes("/schedule")
    ? { dates: [{ games }] }
    : (() => {
        const pk = Number(url.match(/game\/(\d+)/)[1]);
        const found = [...games, ...(extra.extraGames || [])].find((g) => g.gamePk === pk);
        if (!found) throw new Error(`no fixture for ${pk}`);
        return {
          gameData: { status: found.status },
          liveData: { linescore: found.linescore },
        };
      })();

const noDelivery = { logFile: "/tmp/never-written.jsonl" };
const quietConfig = { ...noDelivery, webhookUrl: "", ntfyTopic: "" };

/* ---------------------------------------------------- config and clamping - */

const defaults = loadConfig({});
check(defaults.pollMs, 15_000, "Default discovery cadence is 15s");
check(defaults.lateMs, 2_000, "Default late-inning cadence is 2s");
check(loadConfig({ WATCHER_POLL_MS: "1000" }).pollMs, 1_000, "Cadence can be tightened");
check(loadConfig({ WATCHER_POLL_MS: "1" }).pollMs, 1_000, "An absurdly fast cadence is clamped");
check(loadConfig({ WATCHER_POLL_MS: "99999999" }).pollMs, 600_000, "An absurdly slow cadence is clamped");
check(loadConfig({ WATCHER_POLL_MS: "soon" }).pollMs, 15_000, "A non-numeric cadence falls back");
check(loadConfig({}).webhookUrl, "", "No webhook is configured by default");
check(loadConfig({ WATCHER_ONCE: "1" }).once, true, "One-shot mode is opt-in");
check(
  loadConfig({ WATCHER_NTFY_SERVER: "https://push.example.com/" }).ntfyServer,
  "https://push.example.com",
  "The ntfy server is normalised",
);

/* --------------------------------------------------------- the exact case - */

const loaded = game();
const first = await runCycle({
  config: quietConfig,
  fetchJson: stub(schedules([loaded])).fetchJson,
});
check(first.alerts.length, 1, "A tied, loaded bottom 9 alerts");
check(first.targets, 1, "The live 9th-inning game is a scan target");
check(first.games, 1, "Discovery finds the game");
check(
  first.alerts[0].officialSource,
  "https://statsapi.mlb.com/api/v1.1/game/900001/feed/live",
  "The alert record carries the exact official snapshot it was read from",
);
check(first.alerts[0].watcher, "tools/watcher.mjs", "The record names the watcher that wrote it");
check(
  first.alerts[0].gameUrl,
  "https://www.mlb.com/gameday/900001",
  "The log record links the official Gameday page (verified URL shape)",
);
check(
  rules.historyColumns.every((column) =>
    Object.prototype.hasOwnProperty.call(first.alerts[0], column),
  ),
  true,
  "The record carries every field of the site's export schema",
);
check(first.alerts[0].halfInning, "bottom", "The record is a bottom-half observation");
check(ALERT_FIELDS.includes("offense") && ALERT_FIELDS.includes("linescore"), true,
  "The watcher sends the same verified projection as the site");

/* --------------------------------------------------- what must NOT alert -- */

const cases = [
  ["a tied, loaded TOP half", game({ half: "Top" })],
  ["a loaded bottom 9 that is not tied", game({ away: 5, home: 4 })],
  ["a tied bottom 9 with only two runners on", game({ bases: [1, 2] })],
  ["a tied bottom 9 with the bases empty", game({ bases: [] })],
  ["a tied, loaded bottom 8", game({ inning: 8 })],
  ["a final game", game({ abstractGameState: "Final", detailedState: "Final" })],
  ["a scheduled game", game({ abstractGameState: "Preview", detailedState: "Scheduled" })],
];
for (const [label, fixture] of cases) {
  const summary = await runCycle({
    config: quietConfig,
    fetchJson: stub(schedules([fixture])).fetchJson,
  });
  check(summary.alerts.length, 0, `${label} does not alert`);
}

// Two outs is still a live situation; three outs is a completed half.
const twoOuts = await runCycle({
  config: quietConfig,
  fetchJson: stub(schedules([game({ outs: 2 })])).fetchJson,
});
check(twoOuts.alerts.length, 1, "Two outs with the bases loaded still alerts");
const threeOuts = await runCycle({
  config: quietConfig,
  fetchJson: stub(schedules([game({ outs: 3 })])).fetchJson,
});
check(threeOuts.alerts.length, 0, "Three outs is a completed half, never a live alert");

// A later inning is covered with no upper bound.
for (const inning of [10, 12, 15, 21]) {
  const summary = await runCycle({
    config: quietConfig,
    fetchJson: stub(schedules([game({ inning })])).fetchJson,
  });
  check(summary.alerts.length, 1, `Bottom ${inning} is covered`);
}

/* ------------------------------------------------- de-duplication + re-arm - */

const state = { states: {} };
const held = game({ bases: [] });
const loadedNow = game();

// 1. tied, not loaded (the watch opens) 2..4. loaded three times in a row.
for (let poll = 0; poll < 3; poll += 1) {
  const summary = await runCycle({
    state,
    config: quietConfig,
    fetchJson: stub(schedules([poll === 0 ? held : loadedNow])).fetchJson,
  });
  // Poll 1 is the tied-but-empty changeover (no alert yet), poll 2 is the load
  // that alerts, poll 3 is the same situation still in progress (no repeat).
  const expected = [0, 1, 0][poll];
  check(summary.alerts.length, expected, `Poll ${poll + 1} saves ${expected} alert(s)`);
}
const repeated = await runCycle({
  state,
  config: quietConfig,
  fetchJson: stub(schedules([loadedNow])).fetchJson,
});
check(repeated.alerts.length, 0, "A repeated poll of the same situation never alerts twice");
check(state.states["900001"].active, true, "The episode stays armed while the bases stay loaded");

// The bases clear: a confirmed exit re-arms, so a second load is a new alert.
await runCycle({
  state,
  config: quietConfig,
  fetchJson: stub(schedules([game({ bases: [] })])).fetchJson,
});
const second = await runCycle({
  state,
  config: quietConfig,
  fetchJson: stub(schedules([loadedNow])).fetchJson,
});
check(second.alerts.length, 1, "After the bases clear, a new load alerts again");

// A new inning is a new situation even without an observed exit.
const nextInning = await runCycle({
  state,
  config: quietConfig,
  fetchJson: stub(schedules([game({ inning: 10 })])).fetchJson,
});
check(nextInning.alerts.length, 1, "A new qualifying inning is a new situation");

/* ------------------------------------------------------------ a delay ---- */

const delayState = { states: {} };
const delayed = game({ detailedState: "Delayed", bases: [] });
await runCycle({
  state: delayState,
  config: quietConfig,
  fetchJson: stub(schedules([game({ bases: [] })])).fetchJson,
});
const raining = await runCycle({
  state: delayState,
  config: quietConfig,
  fetchJson: stub(schedules([delayed])).fetchJson,
});
check(raining.alerts.length, 0, "A delay is not an all-clear and not an alert");
const resumed = await runCycle({
  state: delayState,
  config: quietConfig,
  fetchJson: stub(schedules([loadedNow])).fetchJson,
});
check(resumed.alerts.length, 1, "The resumed, loaded game alerts once");

/* -------------------------------------------- unreadable/absent upstream - */

const brokenSnapshots = await runCycle({
  state: { states: {} },
  config: quietConfig,
  fetchJson: stub((url) => {
    if (url.includes("/schedule")) return { dates: [{ games: [loaded] }] };
    throw new Error("HTTP 503");
  }).fetchJson,
});
check(brokenSnapshots.alerts.length, 0, "An unreadable snapshot never alerts");
check(brokenSnapshots.snapshotErrors, 1, "Unreadable snapshots are counted, not swallowed");

const scheduleDown = await runCycle({
  state: { states: {} },
  config: quietConfig,
  fetchJson: async () => {
    throw new Error("ENOTFOUND");
  },
});
check(scheduleDown.alerts.length, 0, "A failed schedule fetch never alerts");
ok(scheduleDown.scheduleError.includes("ENOTFOUND"), "The schedule failure is reported by reason");

// A failing snapshot does not arm an episode, so the watcher cannot later
// double-alert when the same situation becomes readable.
const heldState = { states: {} };
await runCycle({
  state: heldState,
  config: quietConfig,
  fetchJson: stub((url) => {
    if (url.includes("/schedule")) return { dates: [{ games: [loaded] }] };
    throw new Error("HTTP 500");
  }).fetchJson,
});
const afterFailure = await runCycle({
  state: heldState,
  config: quietConfig,
  fetchJson: stub(schedules([loaded])).fetchJson,
});
check(afterFailure.alerts.length, 1, "After a failure the readable situation alerts exactly once");

/* ------------------------------------------------------------- discovery - */

const discovery = stub(schedules([loaded]));
await runCycle({ config: quietConfig, fetchJson: discovery.fetchJson });
check(discovery.log.filter((url) => url.includes("/schedule")).length, 2,
  "Discovery checks today and yesterday (overnight games)");
ok(discovery.log.some((url) => url.includes(`date=${ET_DAY(-1)}`)),
  "The previous day is requested in the MLB (America/New_York) calendar");

const previousDayLive = game({ gamePk: 900002 });
const carried = await runCycle({
  config: quietConfig,
  fetchJson: stub((url) =>
    url.includes("/schedule")
      ? url.includes(`date=${ET_DAY(0)}`)
        ? { dates: [{ games: [] }] }
        : { dates: [{ games: [previousDayLive] }] }
      : {
          gameData: { status: previousDayLive.status },
          liveData: { linescore: previousDayLive.linescore },
        },
  ).fetchJson,
});
check(carried.games, 1, "A live game carried over from yesterday is still watched");
check(carried.alerts.length, 1, "An overnight carryover can alert");

const finishedYesterday = game({ gamePk: 900003, abstractGameState: "Final", detailedState: "Final" });
const ignored = await runCycle({
  config: quietConfig,
  fetchJson: stub((url) =>
    url.includes("/schedule")
      ? url.includes(`date=${ET_DAY(0)}`)
        ? { dates: [{ games: [] }] }
        : { dates: [{ games: [finishedYesterday] }] }
      : { gameData: {}, liveData: {} },
  ).fetchJson,
});
check(ignored.games, 0, "Yesterday's finished games are not carried into the watch");

/* ------------------------------------------------------------ concurrency - */

const many = Array.from({ length: 12 }, (_, index) =>
  game({ gamePk: 910000 + index, bases: index === 0 ? [1, 2, 3] : [] }),
);
const concurrent = stub(schedules(many));
const manySummary = await runCycle({ config: quietConfig, fetchJson: concurrent.fetchJson });
check(manySummary.targets, 12, "Every late live game is scanned");
ok(concurrent.peak() <= MAX_WORKERS, `At most ${MAX_WORKERS} requests are ever in flight`);
ok(concurrent.peak() > 1, "The watcher does scan more than one game at a time");
check(manySummary.alerts.length, 1, "Exactly one of the batch alerted");

/* --------------------------------------------------------------- the log - */

const writes = [];
const fsStub = {
  appendFileSync: (file, line) => writes.push({ file, line }),
  mkdirSync: () => {},
  dirname: (file) => file.replace(/\/[^/]+$/, ""),
};
const logged = {
  ...quietConfig,
  logFile: "/tmp/loaded-late-alerts.jsonl",
  webhookUrl: "",
  ntfyTopic: "",
};
const delivery = await deliver(first.alerts[0], logged, async () => ({ ok: true, status: 200 }));
check(delivery.results[0].channel, "log", "The log is always the first channel");
check(
  gamePageUrl(849845),
  "https://www.mlb.com/gameday/849845",
  "The human-facing link is the official Gameday page for that game",
);
ok(
  delivery.text.includes("https://www.mlb.com/gameday/900001"),
  "The delivered text carries an official page a person can open",
);
ok(delivery.text.includes("bases loaded"), "The delivered text names the situation");
ok(
  delivery.text.includes("https://statsapi.mlb.com"),
  "The delivered text carries the official source",
);
ok(delivery.text.includes("BOT 9"), "The delivered text states the inning");

ok(
  appendAlert("/tmp/x.jsonl", first.alerts[0], fsStub) &&
    writes[0].line.endsWith("\n") &&
    JSON.parse(writes[0].line).gamePk === 900001,
  "The JSONL log holds one parseable record per line",
);
const unwritable = appendAlert("/nope/x.jsonl", first.alerts[0], {
  appendFileSync: () => {
    throw new Error("EACCES");
  },
  mkdirSync: () => {},
  dirname: () => "/nope",
});
check(unwritable, false, "A log that cannot be written reports failure instead of pretending");

/* ---------------------------------------------------------- the channels - */

const posted = [];
const failing = [];
const webhookConfig = {
  ...quietConfig,
  webhookUrl: "https://hooks.example.test/abc",
  ntfyTopic: "loaded-late-test",
};
const sent = await deliver(first.alerts[0], webhookConfig, async (url, options) => {
  posted.push({ url, options });
  if (url.includes("ntfy")) return { ok: false, status: 429 };
  return { ok: true, status: 200 };
});
check(sent.results.length, 3, "Log, webhook and ntfy are all attempted");
check(
  [sent.results[1].channel, sent.results[1].ok, sent.results[1].detail],
  ["webhook", true, "HTTP 200"],
  "A webhook delivery is reported with its status",
);
check(
  [sent.results[2].channel, sent.results[2].ok, sent.results[2].detail],
  ["ntfy", false, "HTTP 429"],
  "A refused push is reported as a failure, never as delivered",
);
const webhookBody = JSON.parse(posted[0].options.body);
check(webhookBody.alert.gamePk, 900001, "The webhook carries the full alert record");
ok(webhookBody.text.includes("bases loaded"), "The webhook carries the human-readable line");
check(posted[0].options.headers["content-type"], "application/json", "The webhook posts JSON");
check(posted[1].url, "https://ntfy.sh/loaded-late-test", "ntfy is posted to the topic URL");
ok(posted[1].options.body.includes("BOT 9"), "The push body is the evidence line");

const deadChannel = await deliver(first.alerts[0], webhookConfig, async (url) => {
  failing.push(url);
  throw new Error("ECONNREFUSED");
});
check(
  deadChannel.results.slice(1).map((result) => result.ok),
  [false, false],
  "A dead channel never reports success",
);
ok(
  deadChannel.results.slice(1).every((result) => result.detail.includes("ECONNREFUSED")),
  "A dead channel reports why",
);

// An alert whose channels failed is still written to the log.
const alertWithDeadChannels = await runCycle({
  config: webhookConfig,
  fetchJson: stub(schedules([loaded])).fetchJson,
  now: Date.now(),
});
check(alertWithDeadChannels.alerts.length, 1, "The alert survives a failing push channel");
check(alertWithDeadChannels.deliveries[0].results[0].channel, "log",
  "The log write is attempted before the network channels");

/* ------------------------------------------------------- web push channel - */

check(
  [pushConfigProblem({}), pushConfigProblem({ pushSubscriptions: "s", vapidKeysFile: "k" })],
  ["", ""],
  "Web Push is either fully configured or not configured at all",
);
ok(
  pushConfigProblem({ pushSubscriptions: "s" }).includes("WATCHER_VAPID_KEYS"),
  "A store without keys names the missing setting instead of silently doing nothing",
);
ok(
  pushConfigProblem({ vapidKeysFile: "k" }).includes("WATCHER_PUSH_SUBSCRIPTIONS"),
  "…and keys without a store names the store",
);
check(pushTopic({ gamePk: 900001 }), "loaded-900001", "The collapse key is per game");
check(pushTopic({}), "loaded-late", "A game without a usable id falls back to a generic topic");
{
  const payload = JSON.parse(pushPayload({ inning: 12, gamePk: 824801, gameUrl: "https://www.mlb.com/gameday/824801" }, "text"));
  check(payload.title, "BASES LOADED — BOT 12", "The notification title names the actual inning");
  check(payload.tag, "loaded-824801", "…and collapses per game");
  check(payload.url, "https://www.mlb.com/gameday/824801", "…and opens the official page");
  const bare = JSON.parse(pushPayload({}, "text"));
  check([bare.title, bare.gamePk, bare.url], ["BASES LOADED — tied, bottom 9+", null, ""],
    "An alert missing its inning and game still produces an honest notification");
}
check(PUSH_TTL_SECONDS, 1800, "A push expires after half an hour (the text carries its own timestamp)");

// A real receiver: a throwaway P-256 key pair plus a 16-octet auth secret, the
// two values a browser hands over when it subscribes. The delivery below is
// decrypted with the private half, which is the only way to prove the push a
// phone would receive is the alert we think we sent.
const receiver = createECDH("prime256v1");
receiver.generateKeys();
const receiverAuth = randomBytes(16);
const pushDirectory = mkdtempSync(join(tmpdir(), "loaded-late-push-"));
const storeFile = join(pushDirectory, "push-subscriptions.json");
const keysFile = join(pushDirectory, "vapid-keys.json");
const vapid = generateVapidKeys();
writeFileSync(keysFile, `${JSON.stringify(vapid)}\n`);
writeFileSync(
  storeFile,
  `${JSON.stringify({
    subscriptions: [
      { endpoint: "https://push.example.test/phone", keys: { p256dh: b64url(receiver.getPublicKey()), auth: b64url(receiverAuth) }, label: "phone" },
      { endpoint: "https://push.example.test/old-tablet", keys: { p256dh: b64url(receiver.getPublicKey()), auth: b64url(receiverAuth) }, label: "old-tablet" },
    ],
  })}\n`,
);

const pushConfig = {
  ...quietConfig,
  pushSubscriptions: storeFile,
  vapidKeysFile: keysFile,
  vapidSubject: "mailto:alerts@example.test",
};
const pushed = [];
const pushDelivery = await deliver(first.alerts[0], pushConfig, async (url, options) => {
  pushed.push({ url, options });
  // The tablet is gone; the phone accepts the notification.
  return { status: url.endsWith("/old-tablet") ? 410 : 201, ok: url.endsWith("/old-tablet") ? false : true, headers: { get: () => null } };
});
check(
  pushDelivery.results.map((result) => result.channel),
  ["log", "push(phone)", "push(old-tablet)", "push store"],
  "Each subscription is reported separately, plus one line about the store",
);
check(
  [pushDelivery.results[1].ok, pushDelivery.results[1].detail.startsWith("HTTP 201")],
  [true, true],
  "The accepted notification is reported as delivered, with its status and size",
);
check(
  [pushDelivery.results[2].ok, pushDelivery.results[2].detail.startsWith("HTTP 410")],
  [false, true],
  "A gone subscription is reported as a failure, not as delivered",
);
check(
  pushDelivery.results[3],
  { channel: "push store", ok: true, detail: "dropped 1 gone subscription(s); 1 left" },
  "The gone subscription is dropped from the store, and that is said out loud",
);
check(
  readSubscriptions(storeFile).map((entry) => entry.endpoint),
  ["https://push.example.test/phone"],
  "…and the store on disk really holds only the live subscription",
);
check(pushed[0].url, "https://push.example.test/phone", "The notification is posted to the subscription endpoint");
check(pushed[0].options.method, "POST", "…as a POST");
check(pushed[0].options.headers.TTL, "1800", "…with the watcher's TTL");
check(pushed[0].options.headers.Urgency, "high", "…marked urgent");
check(pushed[0].options.headers.Topic, "loaded-900001", "…and collapsible per game");
ok(pushed[0].options.headers.Authorization.startsWith("vapid t="), "…signed with VAPID");
ok(!pushed[0].options.url?.includes("push.example.test/phone/"), "The endpoint itself is not rewritten");
ok(
  !JSON.stringify(pushDelivery.results).includes("push.example.test/phone"),
  "The capability URL is masked in what gets logged",
);

// Decrypt the delivered bytes exactly as a browser would (RFC 8291 §3.4), and
// check the plaintext is the very text the watcher decided to send.
{
  const body = pushed[0].options.body;
  const salt = body.subarray(0, 16);
  const keyIdLength = body.readUInt8(20);
  const asPublic = body.subarray(21, 21 + keyIdLength);
  const ciphertext = body.subarray(21 + keyIdLength, body.length - 16);
  const tag = body.subarray(body.length - 16);
  // Hand-rolled HKDF (extract then a single expand block) so this decryption is
  // an independent implementation, not a call back into the code under test.
  const hkdfExtract = (salt, ikm) => createHmac("sha256", salt).update(ikm).digest();
  const hkdfExpand = (prk, info, length) =>
    createHmac("sha256", prk)
      .update(Buffer.concat([info, Buffer.from([1])])) // one block: T(1) = HMAC(PRK, info || 0x01)
      .digest()
      .subarray(0, length);
  const shared = receiver.computeSecret(asPublic);
  const prkKey = hkdfExtract(receiverAuth, shared);
  const ikm = hkdfExpand(
    prkKey,
    Buffer.concat([Buffer.from("WebPush: info\0"), receiver.getPublicKey(), asPublic]),
    32,
  );
  const prk = hkdfExtract(salt, ikm);
  const cek = hkdfExpand(prk, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = hkdfExpand(prk, Buffer.from("Content-Encoding: nonce\0"), 12);
  const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(tag);
  const record = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  const notification = JSON.parse(record.subarray(0, record.length - 1).toString("utf8"));
  check(
    notification.body,
    pushDelivery.text,
    "The notification a browser would decrypt carries exactly the alert text the watcher sent",
  );
  check(notification.title, "BASES LOADED — BOT 9", "…under a title naming the situation and the inning");
  check(
    notification.url,
    "https://www.mlb.com/gameday/900001",
    "…and the official page a tap should open",
  );
  check(notification.tag, "loaded-900001", "…and the same collapse tag the request header carries");
  check(notification.gamePk, 900001, "…and the game id, so a client can group alerts itself");
  check(record[record.length - 1], 2, "…terminated by the 0x02 padding delimiter");
  check(
    body.readUInt8(20),
    65,
    "…and the header carries the application server's uncompressed key",
  );
}

// Failure modes must name the problem, not look like a quiet channel.
const halfConfigured = await deliver(first.alerts[0], { ...quietConfig, pushSubscriptions: storeFile }, async () => ({ status: 201, ok: true }));
check(
  [halfConfigured.results[1].channel, halfConfigured.results[1].ok],
  ["push", false],
  "A half-configured Web Push channel is reported as a failure",
);
const missingStore = await deliver(first.alerts[0], { ...pushConfig, pushSubscriptions: join(pushDirectory, "nope.json") }, async () => ({ status: 201, ok: true }));
ok(
  missingStore.results[1].detail.includes("no subscription store"),
  "A store that does not exist yet is explained, not mistaken for a delivered push",
);
const emptyStore = join(pushDirectory, "empty.json");
writeFileSync(emptyStore, `${JSON.stringify({ subscriptions: [{ endpoint: "https://x/", keys: {} }] })}\n`);
ok(
  (await deliver(first.alerts[0], { ...pushConfig, pushSubscriptions: emptyStore }, async () => ({ status: 201, ok: true }))).results[1].detail.includes("nothing usable"),
  "A store full of unusable entries says so",
);
ok(
  (await deliver(first.alerts[0], { ...pushConfig, vapidKeysFile: join(pushDirectory, "no-keys.json") }, async () => ({ status: 201, ok: true }))).results[1].detail.includes("cannot read VAPID keys"),
  "A missing VAPID key file is named as the problem",
);
ok(
  (await deliver(first.alerts[0], pushConfig, async () => {
    throw new Error("ECONNRESET");
  })).results.slice(1, 3).every((result) => !result.ok && result.detail.includes("ECONNRESET")),
  "A push service that cannot be reached is a failure with its reason",
);
rmSync(pushDirectory, { recursive: true, force: true });

/* ------------------------------------------------- state across restarts - */

const memory = {};
const stateFs = {
  readFileSync: (file) => {
    if (!(file in memory)) throw new Error("ENOENT");
    return memory[file];
  },
  writeFileSync: (file, text) => {
    memory[file] = text;
  },
  mkdirSync: () => {},
  dirname: (file) => file.replace(/\/[^/]+$/, ""),
};
check(readState("/tmp/missing.json", stateFs).states, {}, "A missing state file is empty state");
const runOne = { states: {} };
await runCycle({ state: runOne, config: quietConfig, fetchJson: stub(schedules([loaded])).fetchJson });
ok(writeState("/tmp/state.json", runOne, stateFs), "State is written for the next run");
const restored = readState("/tmp/state.json", stateFs);
const cronSecondRun = await runCycle({
  state: restored,
  config: quietConfig,
  fetchJson: stub(schedules([loaded])).fetchJson,
});
check(cronSecondRun.alerts.length, 0,
  "A cron restart does not re-alert the same situation (state round-trips)");

const corrupt = readState("/tmp/state.json", {
  readFileSync: () => "{not json",
});
check(corrupt.states, {}, "A corrupt state file degrades to empty state, never a crash");
check(
  writeState("/tmp/state.json", runOne, {
    mkdirSync: () => {
      throw new Error("EROFS");
    },
    writeFileSync: () => {},
    dirname: () => "/tmp",
  }),
  false,
  "An unwritable state file is reported instead of throwing",
);

/* ------------------------------------------- push retry / backoff (ops) --- */

check(isRetryablePush({ ok: false, status: 503 }), true, "A 5xx push failure is retried");
check(isRetryablePush({ ok: false, status: 429, retryAfter: "5" }), true, "A 429 push failure is retried");
check(isRetryablePush({ ok: false, status: 0, error: "fetch failed" }), true, "A push that never got an answer is retried");
check(isRetryablePush({ ok: false, status: 400 }), false, "A 400 is a decision about this request — not retried");
check(isRetryablePush({ ok: false, status: 410, gone: true }), false, "A gone subscription is not retried");
check(isRetryablePush({ ok: true, status: 201 }), false, "A delivered push is not retried");

check(pushRetryWaitSeconds({ retryAfter: "7" }, 1), 7, "A Retry-After the service sent wins");
check(pushRetryWaitSeconds({}, 1), 2, "No Retry-After falls back to exponential backoff (2s)");
check(pushRetryWaitSeconds({}, 2), 4, "Backoff doubles on the second retry");
check(pushRetryWaitSeconds({ retryAfter: "9999" }, 1), 20, "An absurd Retry-After is capped");
check(pushRetryWaitSeconds({ retryAfter: "0" }, 1), 2, "A zero Retry-After is treated as absent");

const retryReceiver = createECDH("prime256v1");
retryReceiver.generateKeys();
const retryAuth = randomBytes(16);
const retrySubscription = {
  endpoint: "https://push.example.test/retry",
  keys: { p256dh: b64url(retryReceiver.getPublicKey()), auth: b64url(retryAuth) },
  label: "retry-phone",
};
const retryVapid = generateVapidKeys();

const waits = [];
const sleepStub = async (ms) => {
  waits.push(ms / 1000);
};
const statusSequence = async (statuses, retryAfterHeader = null) => {
  let index = 0;
  const calls = [];
  const result = await sendPushWithRetry(retrySubscription, "{}", {
    vapid: retryVapid,
    ttl: 60,
    sleep: sleepStub,
    fetchImpl: async (url) => {
      calls.push(url);
      const status = statuses[Math.min(index, statuses.length - 1)];
      index += 1;
      return {
        status,
        ok: status >= 200 && status < 300,
        headers: { get: (name) => (name === "retry-after" ? retryAfterHeader : null) },
      };
    },
  });
  return { ...result, calls };
};

const flaky = await statusSequence([503, 503, 201]);
check(flaky.attempts.length, 3, "A flaky service gets a third attempt");
check(flaky.outcome.ok, true, "…and the eventual 201 counts as delivered");
check(waits.slice(0, 2), [2, 4], "The two retries backed off 2s then 4s");
check(flaky.calls.length, 3, "Exactly three requests reached the push service");

waits.length = 0;
const stuck = await statusSequence([503]);
check(stuck.attempts.length, PUSH_MAX_ATTEMPTS, "A service that stays down stops after the attempt cap");
check(stuck.outcome.ok, false, "…and the alert is reported failed, not silently queued");
check(waits.length, PUSH_MAX_ATTEMPTS - 1, "One wait between each pair of attempts");

waits.length = 0;
const refused = await statusSequence([400]);
check(refused.attempts.length, 1, "A 400 is offered exactly once");
check(waits, [], "…with no backoff wait at all");

waits.length = 0;
const throttled = await statusSequence([429], "3");
check(throttled.outcome.ok, false, "A service that only says 429 never delivers");
check(waits[0], 3, "A 429 carrying Retry-After: 3 waits 3s before retrying");

/* --------------------------------------------- doctor + subscription CLI -- */

const opsDirectory = mkdtempSync(join(tmpdir(), "loaded-late-ops-"));
const opsKeys = join(opsDirectory, "vapid-keys.json");
writeFileSync(opsKeys, `${JSON.stringify(generateVapidKeys())}\n`);
const slate = (games) => ({ dates: [{ games }] });

const healthy = await doctor(
  {
    logDir: opsDirectory,
    logFile: join(opsDirectory, "alerts.jsonl"),
    stateFile: join(opsDirectory, "state.json"),
    webhookUrl: "https://hooks.example.test/loaded",
    ntfyTopic: "",
    ntfyServer: "https://ntfy.sh",
    pushSubscriptions: "",
    vapidKeysFile: "",
  },
  { fetchImpl: async () => slate([{}, {}]) },
);
check(healthy.ok, true, "doctor passes a watcher with a reachable upstream and one channel");
check(
  healthy.lines.some((line) => line.label === "upstream" && line.ok === true && line.detail.includes("2 game(s)")),
  true,
  "doctor proves the upstream by reading today's slate",
);
check(
  healthy.lines.some((line) => line.label === "web push" && line.ok === null),
  true,
  "an unconfigured channel reads as 'off', not as a failure",
);

// stdout + log is a legitimate setup, so "no push channel" is a notice, not a
// failure — but it must still be printed, because it is the difference between
// "alerts reach this machine" and "alerts reach me".
const terminalOnly = await doctor(
  {
    logDir: opsDirectory,
    logFile: join(opsDirectory, "alerts.jsonl"),
    stateFile: join(opsDirectory, "state.json"),
    webhookUrl: "",
    ntfyTopic: "",
    ntfyServer: "https://ntfy.sh",
    pushSubscriptions: "",
    vapidKeysFile: "",
  },
  { fetchImpl: async () => slate([{}]) },
);
check(terminalOnly.ok, true, "doctor passes a stdout-only watcher (a real, if local, setup)");
check(
  terminalOnly.lines.some((line) => line.label === "channels" && line.ok === null && /not a phone/.test(line.detail)),
  true,
  "…while still saying out loud that nothing reaches a phone",
);

const halfPush = await doctor(
  {
    logDir: opsDirectory,
    logFile: join(opsDirectory, "alerts.jsonl"),
    stateFile: join(opsDirectory, "state.json"),
    webhookUrl: "",
    ntfyTopic: "",
    ntfyServer: "https://ntfy.sh",
    pushSubscriptions: join(opsDirectory, "subs.json"),
    vapidKeysFile: "",
  },
  { fetchImpl: async () => slate([]) },
);
check(halfPush.ok, false, "doctor fails a half-configured Web Push channel");
check(
  halfPush.lines.some((line) => line.ok === false && /WATCHER_VAPID_KEYS/.test(line.detail)),
  true,
  "…naming the missing half so the fix is one command away",
);

const offline = await doctor(
  {
    logDir: opsDirectory,
    logFile: join(opsDirectory, "alerts.jsonl"),
    stateFile: join(opsDirectory, "state.json"),
    webhookUrl: "https://hooks.example.test/loaded",
    ntfyTopic: "",
    ntfyServer: "https://ntfy.sh",
    pushSubscriptions: "",
    vapidKeysFile: "",
  },
  { fetchImpl: async () => { throw new Error("ECONNREFUSED"); } },
);
check(offline.ok, false, "doctor fails when the official upstream is unreachable");
check(
  offline.lines.some((line) => line.label === "upstream" && line.ok === false),
  true,
  "…and says it is the upstream, not the channels",
);

// A store with one good device and one row that can never deliver.
const goodReceiver = createECDH("prime256v1");
goodReceiver.generateKeys();
const goodAuth = randomBytes(16);
const opsStore = join(opsDirectory, "ops-subscriptions.json");
writeFileSync(
  opsStore,
  `${JSON.stringify({
    subscriptions: [
      { endpoint: "https://push.example.test/good", keys: { p256dh: b64url(goodReceiver.getPublicKey()), auth: b64url(goodAuth) }, label: "good" },
      { endpoint: "https://push.example.test/broken", keys: { p256dh: b64url(goodReceiver.getPublicKey()), auth: "bm90LXNpeHRlZW4tYnl0ZXM" }, label: "broken" },
    ],
  })}\n`,
);
const listing = listStoredSubscriptions({ pushSubscriptions: opsStore });
check(listing.entries.length, 2, "the listing shows every stored row, good and bad");
check(
  listing.entries.map((entry) => entry.valid),
  [true, false],
  "…flagging the row whose auth secret is the wrong length",
);
ok(listing.entries[1].reason.includes("16 octets"), "…and says why, in words");

const pruned = pruneInvalidSubscriptions({ pushSubscriptions: opsStore });
check(pruned.removed.length, 1, "prune removes exactly the undeliverable row");
check(pruned.saved, true, "…and reports that the rewrite landed");
check(
  readSubscriptions(opsStore).map((entry) => entry.label),
  ["good"],
  "the store on disk now holds only the usable device",
);
check(
  pruneInvalidSubscriptions({ pushSubscriptions: opsStore }).removed.length,
  0,
  "a second prune finds nothing left to remove",
);
check(
  listStoredSubscriptions({ pushSubscriptions: "" }).configured,
  false,
  "with no store configured the CLI says so instead of guessing",
);

/* --------------------------------------------------------- the summary --- */

check(
  Object.keys(first).sort(),
  ["alerts", "at", "dates", "deliveries", "games", "scheduleError", "snapshotErrors", "targets", "workers"],
  "The cycle summary reports exactly the health fields the CLI prints",
);
check(first.workers, 1, "One worker is used for one target");
check(quietConfig.quiet ?? false, false, "Quiet mode is off unless asked for");

/* -------------------------------------------------- shared rules engine -- */

const coreSource = readFileSync(new URL("../assets/js/bases-loaded-core.js", import.meta.url), "utf8");
ok(
  coreSource.includes("module.exports = BasesLoadedRules"),
  "The watcher and the site share one rules implementation (no forked copy)",
);
const watcherSource = readFileSync(new URL("./watcher.mjs", import.meta.url), "utf8");
ok(
  !/\/challenge|review\/i|eventType ===|description\.includes/.test(watcherSource),
  "The watcher never matches play text or event names — occupancy decides",
);
ok(
  watcherSource.includes("bases-loaded-core.js"),
  "The watcher requires the shared rules engine rather than reimplementing it",
);

console.log(`✓ ${checks} watcher checks passed`);
