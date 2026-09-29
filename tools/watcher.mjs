#!/usr/bin/env node
/**
 * Loaded Late — always-on watcher.
 *
 * The monitor page only watches while a browser tab is open and visible. This
 * runs the *same rules engine* (`assets/js/bases-loaded-core.js`, required
 * verbatim) outside the browser, so the tied / bases-loaded / bottom-9+
 * situation can be caught with every tab closed.
 *
 * It is deliberately tiny and dependency-free: Node 18+ (global fetch) and one
 * file. It polls the official MLB StatsAPI the same way the pages do — the
 * dated schedule for discovery, one coherent `feed/live` snapshot per target —
 * and, when the exact situation appears, it
 *
 *   1. prints it (which is already useful under `journalctl`, `tmux`, or a
 *      terminal someone is watching),
 *   2. appends it to a JSONL log, each record carrying the exact official
 *      snapshot URL it was read from (same schema as the site's export), and
 *   3. delivers it if a push channel is configured (`WATCHER_WEBHOOK_URL`,
 *      `WATCHER_NTFY_TOPIC`, or Web Push) — that is the part that reaches a
 *      phone.
 *
 * Run
 *   node tools/watcher.mjs                 # watch until stopped (Ctrl-C)
 *   WATCHER_ONCE=1 node tools/watcher.mjs   # one cycle, then exit (cron)
 *   node tools/watcher.mjs --doctor         # "will this reach me?" report, then exit
 *   node tools/watcher.mjs --list-subscriptions   # show stored devices, masked
 *   node tools/watcher.mjs --prune-subscriptions  # drop rows that can never deliver
 *
 * A push that fails transiently (429, 5xx, or no answer at all) is retried up to
 * PUSH_MAX_ATTEMPTS times with a capped backoff that honours `Retry-After`;
 * failures that are a decision about this request (400/401/403/404/410/413) are
 * reported once and not retried, because retrying them only wastes the moment.
 *
 * Configuration (all optional)
 *   WATCHER_POLL_MS=15000     schedule discovery cadence
 *   WATCHER_LATE_MS=2000      snapshot cadence for a live game in inning 9+
 *   WATCHER_WEBHOOK_URL=…     POST {text, alert} JSON to this URL on an alert
 *   WATCHER_NTFY_TOPIC=…      push to https://ntfy.sh/<topic> (phone app)
 *   WATCHER_NTFY_SERVER=…     override the ntfy server (default ntfy.sh)
 *   WATCHER_PUSH_SUBSCRIPTIONS=…  JSON file of Web Push subscriptions (see below)
 *   WATCHER_VAPID_KEYS=…      JSON file with this watcher's VAPID key pair
 *   WATCHER_VAPID_SUBJECT=…   optional mailto:/https: contact for the VAPID token
 *   WATCHER_LOG_DIR=data      where the JSONL log and dedup state live
 *   WATCHER_STATE_FILE=…      override the dedup state path
 *   WATCHER_ONCE=1            run one cycle and exit
 *   WATCHER_QUIET=1           no per-cycle heartbeat lines
 *
 * Web Push is the channel that reaches a phone without a third party reading the
 * alert: the message is encrypted (RFC 8291) to a key only the subscribed
 * browser holds, and authenticated with a VAPID key (RFC 8292) — both
 * implemented in `tools/webpush.mjs`, checked against the RFC test vectors.
 * Enable it by setting BOTH `WATCHER_PUSH_SUBSCRIPTIONS` and
 * `WATCHER_VAPID_KEYS`; setting only one is reported at startup rather than
 * silently doing nothing. A subscription the push service reports as gone
 * (404/410) is dropped from the store, and the log says so.
 *
 *   node tools/webpush.mjs --generate --write   # create the VAPID key pair
 *
 * Delivery is never claimed when it did not happen: a failed webhook, ntfy or
 * Web Push delivery is reported on the alert line and in the health summary, and
 * the alert is in the log regardless.
 */

import { createRequire } from "node:module";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  maskEndpoint,
  normalizeSubscription,
  readSubscriptions,
  readVapidKeys,
  removeSubscription,
  sendPush,
  writeSubscriptions,
} from "./webpush.mjs";

const require = createRequire(import.meta.url);
const rules = require("../assets/js/bases-loaded-core.js");

const V1 = "https://statsapi.mlb.com/api/v1";
const V11 = "https://statsapi.mlb.com/api/v1.1";
const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** The projection the site's `getAlertSnapshot` sends — verified, not widened. */
export const ALERT_FIELDS =
  "gamePk,gameData,status,abstractGameState,detailedState,statusCode," +
  "liveData,plays,currentPlay,result,description,event,eventType,rbi,awayScore,homeScore," +
  "linescore,currentInning,inningState,isTopInning,outs,teams,away,home,runs," +
  "offense,defense,first,second,third,id,fullName," +
  "balls,strikes,batter,pitcher,onDeck,inHole";

export const MAX_WORKERS = 4;

/**
 * The human-facing official page for a game. `https://www.mlb.com/gameday/<pk>`
 * was verified on 2026-09-29 to resolve to that game's Gameday page (checked
 * against a completed game: the redirect lands on the canonical
 * `/gameday/<slug>/<date>/<pk>` URL with the final score in the title), so a
 * push that reaches a phone carries a link a person can actually open — next to
 * the machine-readable snapshot URL the alert was read from.
 */
export const gamePageUrl = (gamePk) => `https://www.mlb.com/gameday/${gamePk}`;

export function loadConfig(env = process.env) {
  const number = (value, fallback, min, max) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
  };
  const logDir = env.WATCHER_LOG_DIR || join(ROOT, "data");
  return {
    pollMs: number(env.WATCHER_POLL_MS, 15_000, 1_000, 600_000),
    lateMs: number(env.WATCHER_LATE_MS, 2_000, 250, 600_000),
    webhookUrl: env.WATCHER_WEBHOOK_URL || "",
    ntfyTopic: env.WATCHER_NTFY_TOPIC || "",
    ntfyServer: (env.WATCHER_NTFY_SERVER || "https://ntfy.sh").replace(/\/+$/, ""),
    pushSubscriptions: env.WATCHER_PUSH_SUBSCRIPTIONS || "",
    vapidKeysFile: env.WATCHER_VAPID_KEYS || "",
    vapidSubject: env.WATCHER_VAPID_SUBJECT || "",
    logDir,
    logFile: env.WATCHER_LOG_FILE || join(logDir, "watcher-alerts.jsonl"),
    stateFile: env.WATCHER_STATE_FILE || join(logDir, "watcher-state.json"),
    once: env.WATCHER_ONCE === "1",
    quiet: env.WATCHER_QUIET === "1",
  };
}

/* --------------------------------------------------------------- delivery - */

/**
 * How long a push service should keep trying to deliver an alert, in seconds.
 *
 * The text carries its own observation timestamp and a link to the live game, so
 * a slightly late alert is still honest and still useful; a very late one is
 * neither. Half an hour is the point where "tied, bases loaded, bottom 9" stops
 * being a description of a moment worth acting on.
 */
export const PUSH_TTL_SECONDS = 1_800;

/**
 * How many times one alert may be offered to one push service before the
 * watcher gives up and lets the *next* alert be the retry. Three tries with a
 * short backoff covers the common transient answers (a 503 from a busy service,
 * a dropped connection) without ever letting a retry loop outlive the moment
 * the alert describes.
 */
export const PUSH_MAX_ATTEMPTS = 3;

/**
 * Longest single retry wait, in seconds. A push service may answer 429 with a
 * `Retry-After` of minutes; honouring that in full would push the alert past
 * the point where "bases loaded, bottom 9" is still news, so the wait is capped
 * and, if the service is still saying no after the last attempt, the delivery is
 * reported as failed rather than silently queued.
 */
export const PUSH_MAX_RETRY_WAIT_SECONDS = 20;

/**
 * Which failed pushes are worth another attempt.
 *
 *   429        the service asked us to slow down — retrying later is the point
 *   5xx        the service's own problem, not ours
 *   status 0   the request never reached an answer (DNS/TLS/timeout)
 *
 * Everything else is a decision about *this* request (400 malformed, 401/403
 * bad VAPID, 404/410 subscription gone, 413 too big) and retrying it would only
 * waste the window.
 */
export function isRetryablePush(outcome) {
  if (!outcome || outcome.ok || outcome.gone) return false;
  const status = Number(outcome.status);
  if (!Number.isFinite(status)) return false;
  if (status === 0) return true;
  if (status === 429) return true;
  return status >= 500 && status <= 599;
}

/**
 * How long to wait before the next attempt, in seconds. A `Retry-After` the
 * service actually sent wins (it knows its own load), otherwise exponential
 * backoff; both are capped so a stalled service cannot stall the watch.
 */
export function pushRetryWaitSeconds(outcome, attempt) {
  const asked = Number(outcome?.retryAfter);
  const seconds = Number.isFinite(asked) && asked > 0 ? asked : 2 ** attempt;
  return Math.min(Math.max(1, Math.floor(seconds)), PUSH_MAX_RETRY_WAIT_SECONDS);
}

/**
 * Offer one payload to one subscription, retrying only the failures that can
 * plausibly clear. `sleep` is injected so tests run the backoff without waiting.
 * Returns the final outcome plus the list of attempts it took.
 */
export async function sendPushWithRetry(subscription, payload, options = {}) {
  const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const attempts = [];
  let outcome = await sendPush(subscription, payload, options);
  attempts.push(outcome);
  let attempt = 0;
  while (attempts.length < PUSH_MAX_ATTEMPTS && isRetryablePush(outcome)) {
    attempt += 1;
    await sleep(pushRetryWaitSeconds(outcome, attempt) * 1000);
    outcome = await sendPush(subscription, payload, options);
    attempts.push(outcome);
  }
  return { outcome, attempts };
}

/**
 * The notification a subscribed device will actually display, as JSON.
 *
 * `sw.js` (the service worker the panel registers) reads these fields: the title
 * says which situation and inning, the body is the same evidence line the log and
 * the other channels get, and `url` is what opens when the notification is tapped
 * — the official Gameday page for that game. A push that cannot say what happened
 * or open the record of it is barely better than no push.
 */
export function pushPayload(alert, text) {
  const inning = Number(alert?.inning);
  return JSON.stringify({
    title: Number.isInteger(inning) ? `BASES LOADED — BOT ${inning}` : "BASES LOADED — tied, bottom 9+",
    body: text,
    url: alert?.gameUrl || "",
    tag: pushTopic(alert),
    gamePk: Number.isInteger(Number(alert?.gamePk)) ? Number(alert.gamePk) : null,
    observedAtIso: alert?.observedAtIso || "",
  });
}

/**
 * Collapse key for a push notification (RFC 8030 §5.4): a newer alert about the
 * same game replaces an older one still waiting on the device instead of
 * stacking up behind it. Anything outside the permitted alphabet is dropped
 * rather than guessed at.
 */
export function pushTopic(alert) {
  const gamePk = Number(alert?.gamePk);
  // "loaded-NaN" would pass the alphabet check, so the id is validated as an id.
  if (!Number.isInteger(gamePk) || gamePk <= 0) return "loaded-late";
  const topic = `loaded-${gamePk}`;
  return /^[A-Za-z0-9_-]{1,32}$/.test(topic) ? topic : "loaded-late";
}

/**
 * A half-configured Web Push channel is a mistake worth naming: it would
 * otherwise look like a working channel that never fires.
 */
export function pushConfigProblem(config) {
  const hasStore = Boolean(config?.pushSubscriptions);
  const hasKeys = Boolean(config?.vapidKeysFile);
  if (!hasStore && !hasKeys) return "";
  if (hasStore && !hasKeys)
    return "WATCHER_PUSH_SUBSCRIPTIONS is set but WATCHER_VAPID_KEYS is not (run: node tools/webpush.mjs --generate --write)";
  if (!hasStore && hasKeys)
    return "WATCHER_VAPID_KEYS is set but WATCHER_PUSH_SUBSCRIPTIONS is not (the store holds the subscriptions to send to)";
  return "";
}

/**
 * One alert reached a channel, or it did not — never "probably". A channel that
 * throws is recorded as a failure with its reason, and the alert is still in
 * the log.
 */
export async function deliver(alert, config, fetchImpl = fetch, pushOptions = {}) {
  const text = rules.evidenceLine(alert, gamePageUrl);
  const results = [{ channel: "log", ok: true, detail: config.logFile || "(log)" }];

  if (config.webhookUrl) {
    try {
      const response = await fetchImpl(config.webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, alert }),
      });
      results.push({
        channel: "webhook",
        ok: response.ok,
        detail: `HTTP ${response.status}`,
      });
    } catch (error) {
      results.push({ channel: "webhook", ok: false, detail: String(error?.message || error) });
    }
  }

  if (config.ntfyTopic) {
    try {
      // Defaulted here as well as in loadConfig: a caller that builds a config
      // by hand must not end up posting to "undefined/<topic>".
      const server = (config.ntfyServer || "https://ntfy.sh").replace(/\/+$/, "");
      const response = await fetchImpl(`${server}/${config.ntfyTopic}`, {
        method: "POST",
        headers: { title: "BASES LOADED — tied, bottom 9+", tags: "baseball" },
        body: text,
      });
      results.push({ channel: "ntfy", ok: response.ok, detail: `HTTP ${response.status}` });
    } catch (error) {
      results.push({ channel: "ntfy", ok: false, detail: String(error?.message || error) });
    }
  }

  const pushProblem = pushConfigProblem(config);
  if (pushProblem) {
    results.push({ channel: "push", ok: false, detail: pushProblem });
  } else if (config.pushSubscriptions && config.vapidKeysFile) {
    results.push(...(await deliverPush(text, alert, config, fetchImpl, pushOptions)));
  }

  return { text, results };
}

/**
 * Send one alert to every stored Web Push subscription.
 *
 * Returns one result per subscription (plus one result explaining a store that
 * could not be used at all), so the watcher log says exactly which device
 * received an alert and which did not. Subscriptions the push service reports as
 * permanently gone are removed from the store — and that rewrite is reported,
 * because silently growing a store full of dead endpoints is how a channel rots.
 */
async function deliverPush(text, alert, config, fetchImpl, pushOptions = {}) {
  let vapid;
  try {
    vapid = readVapidKeys(config.vapidKeysFile);
  } catch (error) {
    return [{ channel: "push", ok: false, detail: String(error?.message || error) }];
  }

  if (!existsSync(config.pushSubscriptions))
    return [
      {
        channel: "push",
        ok: false,
        detail: `no subscription store at ${config.pushSubscriptions} — subscribe this device on the site first`,
      },
    ];

  const subscriptions = readSubscriptions(config.pushSubscriptions);
  if (!subscriptions.length)
    return [
      {
        channel: "push",
        ok: false,
        detail: `subscription store ${config.pushSubscriptions} holds nothing usable`,
      },
    ];

  const results = [];
  const gone = [];
  for (const subscription of subscriptions) {
    const label = subscription.label || "device";
    const { outcome, attempts } = await sendPushWithRetry(
      subscription,
      pushPayload(alert, text),
      {
        fetchImpl,
        vapid,
        ttl: PUSH_TTL_SECONDS,
        urgency: "high",
        topic: pushTopic(alert),
        subject: config.vapidSubject || undefined,
        ...pushOptions,
      },
    );
    const tried = attempts.length > 1 ? ` · ${attempts.length} attempts` : "";
    results.push({
      channel: `push(${label})`,
      ok: outcome.ok,
      detail: outcome.ok
        ? `HTTP ${outcome.status} · ${outcome.bytes} bytes · ${maskEndpoint(subscription.endpoint)}${tried}`
        : `${outcome.error || `HTTP ${outcome.status}`} · ${maskEndpoint(subscription.endpoint)}` +
          (outcome.retryAfter ? ` · retry after ${outcome.retryAfter}s` : "") +
          tried,
    });
    if (outcome.gone) gone.push(subscription.endpoint);
  }

  if (gone.length) {
    const kept = gone.reduce((list, endpoint) => removeSubscription(list, endpoint), subscriptions);
    const saved = writeSubscriptions(config.pushSubscriptions, kept);
    results.push({
      channel: "push store",
      ok: saved,
      detail: saved
        ? `dropped ${gone.length} gone subscription(s); ${kept.length} left`
        : `could not rewrite ${config.pushSubscriptions} after ${gone.length} gone subscription(s)`,
    });
  }

  return results;
}

/* ------------------------------------------------------------ persistence - */

export function readState(file, fs = { readFileSync }) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" && parsed.states ? parsed : { states: {} };
  } catch (_) {
    return { states: {} };
  }
}

export function writeState(file, state, fs = { mkdirSync, writeFileSync, dirname }) {
  try {
    fs.mkdirSync(fs.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(state, null, 2));
    return true;
  } catch (_) {
    return false;
  }
}

export function appendAlert(file, record, fs = { appendFileSync, mkdirSync, dirname }) {
  try {
    fs.mkdirSync(fs.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(record)}\n`);
    return true;
  } catch (_) {
    return false;
  }
}

/* ------------------------------------------------------- operations (doctor) */

/**
 * Every stored subscription with a verdict, without sending anything.
 *
 * `readSubscriptions` deliberately drops entries it cannot validate so one bad
 * row cannot disable the rest — which is right at delivery time but means the
 * operator cannot see *why* a device went quiet. This reads the raw file and
 * says, per row, whether it is usable and, if not, why.
 */
export function listStoredSubscriptions(config, fs = { readFileSync }) {
  if (!config?.pushSubscriptions) return { configured: false, entries: [] };
  if (!existsSync(config.pushSubscriptions))
    return { configured: true, missing: true, entries: [] };
  let raw = [];
  try {
    const parsed = JSON.parse(fs.readFileSync(config.pushSubscriptions, "utf8"));
    raw = Array.isArray(parsed) ? parsed : parsed?.subscriptions || [];
  } catch (error) {
    return { configured: true, unreadable: String(error?.message || error), entries: [] };
  }
  return {
    configured: true,
    entries: raw.map((entry, index) => {
      try {
        const normal = normalizeSubscription(entry);
        return {
          index,
          label: normal.label || `entry ${index}`,
          endpoint: maskEndpoint(normal.endpoint),
          valid: true,
          reason: "",
        };
      } catch (error) {
        return {
          index,
          label: `entry ${index}`,
          endpoint: maskEndpoint(entry?.endpoint),
          valid: false,
          reason: String(error?.message || error),
        };
      }
    }),
  };
}

/**
 * Remove rows that can never deliver (malformed endpoint or keys) from the
 * store. Endpoints that are merely *gone* (404/410) are pruned automatically at
 * delivery time, because only the push service knows that; this only clears
 * rows that are structurally invalid and would be skipped forever.
 */
export function pruneInvalidSubscriptions(config, fs = { readFileSync }) {
  const listing = listStoredSubscriptions(config, fs);
  if (listing.missing || listing.unreadable || !listing.configured)
    return { ...listing, removed: [], kept: 0, saved: false };
  const valid = listing.entries.filter((entry) => entry.valid);
  const removed = listing.entries.filter((entry) => !entry.valid);
  if (!removed.length)
    return { ...listing, removed: [], kept: valid.length, saved: false };
  const kept = readSubscriptions(config.pushSubscriptions, fs);
  const saved = writeSubscriptions(config.pushSubscriptions, kept);
  return { ...listing, removed, kept: kept.length, saved };
}

/**
 * One command that answers "will this watcher actually reach me?" before a game
 * starts, instead of discovering it mid-walk-off.
 *
 * Checks, in the order an operator cares about them: can it reach the official
 * API, can it write its log and state, and is every configured delivery channel
 * actually configured (keys readable, store present and non-empty). A channel
 * the operator did not configure is reported as *off*, not as a failure — but a
 * channel configured half-way is a failure, because it looks like one that works.
 */
export async function doctor(config, { fetchImpl = fetch } = {}) {
  const lines = [];
  const add = (ok, label, detail) => lines.push({ ok, label, detail });

  // 1. The official upstream, with today's (Eastern) slate as the proof.
  try {
    const slate = await fetchImpl(`${V1}/schedule?sportId=1&date=${isoDay(0)}`);
    const games = slate?.dates?.[0]?.games;
    if (!Array.isArray(games)) add(false, "upstream", "answered but not with a readable slate");
    else add(true, "upstream", `statsapi.mlb.com answered · ${games.length} game(s) on ${isoDay(0)}`);
  } catch (error) {
    add(false, "upstream", `unreachable: ${String(error?.message || error)}`);
  }

  // 2. The log and the dedup state must be writable, or alerts vanish silently.
  const probe = join(config.logDir, ".doctor-probe");
  const wrote = appendAlert(probe, { probe: true });
  let probeRemoved = false;
  if (wrote) {
    try {
      unlinkSync(probe);
      probeRemoved = true;
    } catch (_) {
      probeRemoved = false;
    }
  }
  add(wrote, "log dir", wrote ? `writable (${config.logDir})` : `cannot write to ${config.logDir}`);
  if (wrote) add(probeRemoved, "log dir", probeRemoved ? "probe file removed" : `left a probe at ${probe}`);
  add(
    writeState(config.stateFile, readState(config.stateFile)),
    "state file",
    `dedup state readable and writable (${config.stateFile})`,
  );

  // 3. Channels. stdout + the log is a legitimate setup for someone watching a
  //    terminal or journalctl, so "no push channel" is a notice, not a failure —
  //    but it is printed, because it is the difference between "alerts reach
  //    this machine" and "alerts reach me". A channel configured half-way, on
  //    the other hand, looks like one that works and never fires: that fails.
  const anyChannel = Boolean(config.webhookUrl || config.ntfyTopic || config.pushSubscriptions);
  add(
    anyChannel ? true : null,
    "channels",
    anyChannel
      ? "at least one push channel is configured"
      : "only stdout + the log — alerts reach this machine, not a phone",
  );
  add(config.webhookUrl ? true : null, "webhook", config.webhookUrl ? maskEndpoint(config.webhookUrl) : "off");
  add(config.ntfyTopic ? true : null, "ntfy", config.ntfyTopic ? `${config.ntfyServer}/${config.ntfyTopic}` : "off");

  const pushProblem = pushConfigProblem(config);
  if (pushProblem) {
    add(false, "web push", pushProblem);
  } else if (!config.pushSubscriptions && !config.vapidKeysFile) {
    add(null, "web push", "off");
  } else {
    let keysOk = true;
    try {
      readVapidKeys(config.vapidKeysFile);
    } catch (error) {
      keysOk = false;
      add(false, "web push", `VAPID keys unreadable: ${String(error?.message || error)}`);
    }
    if (keysOk) add(true, "web push", `VAPID keys readable (${config.vapidKeysFile})`);
    const store = listStoredSubscriptions(config);
    if (store.missing) add(false, "web push", `no subscription store at ${config.pushSubscriptions}`);
    else if (store.unreadable) add(false, "web push", `subscription store unreadable: ${store.unreadable}`);
    else if (!store.entries.length) add(false, "web push", "subscription store is empty — subscribe a device on the site");
    else {
      const bad = store.entries.filter((entry) => !entry.valid);
      add(!bad.length, "web push", `${store.entries.length - bad.length}/${store.entries.length} stored subscription(s) usable${bad.length ? ` · ${bad.length} invalid` : ""}`);
    }
  }

  // A `null` verdict means "off by choice": it prints, but never fails the run.
  const ok = lines.every((line) => line.ok !== false);
  return { ok, lines };
}

/* ----------------------------------------------------------------- cycle - */

const isoDay = (offset = 0) =>
  new Date(Date.now() + offset * 86_400_000).toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  });

/**
 * One discovery + snapshot pass. Everything external is injected, so the
 * behaviour is deterministic in `tools/watcher-test.mjs` and identical in
 * production. Returns a summary; never throws on upstream trouble (a watcher
 * that dies on a bad response stops watching).
 */
export async function runCycle({
  state = { states: {} },
  config,
  fetchJson,
  now = Date.now(),
  dates = [isoDay(0), isoDay(-1)],
  workerLimit = MAX_WORKERS,
}) {
  const summary = {
    at: now,
    dates,
    games: 0,
    targets: 0,
    alerts: [],
    deliveries: [],
    scheduleError: "",
    snapshotErrors: 0,
    workers: 0,
  };

  let slates;
  try {
    slates = await Promise.all(dates.map((date) => fetchJson(`${V1}/schedule?sportId=1&date=${date}`)));
  } catch (error) {
    summary.scheduleError = String(error?.message || error);
    return summary;
  }

  const games = new Map();
  slates.forEach((slate, index) => {
    for (const game of (slate?.dates?.[0]?.games) || []) {
      // Today's whole slate, plus live games carried over from yesterday —
      // the same rule the monitor page uses.
      if (index === 0 || game.status?.abstractGameState === "Live") games.set(game.gamePk, game);
    }
  });
  summary.games = games.size;

  const targets = [...games.values()].filter((game) =>
    rules.scanTarget(game, state.states[game.gamePk]),
  );
  summary.targets = targets.length;

  // Bounded concurrency, like the pages: at most four requests in flight.
  let cursor = 0;
  const snapshots = [];
  const workers = Array.from({ length: Math.min(workerLimit, targets.length) }, async () => {
    while (cursor < targets.length) {
      const game = targets[cursor++];
      try {
        const payload = await fetchJson(
          `${V11}/game/${game.gamePk}/feed/live?fields=${ALERT_FIELDS}`,
        );
        snapshots.push({ game, payload });
      } catch (_) {
        summary.snapshotErrors += 1;
        snapshots.push({ game, payload: null });
      }
    }
  });
  summary.workers = workers.length;
  await Promise.all(workers);

  for (const { game, payload } of snapshots) {
    if (!payload) {
      // An unreadable snapshot is not an all-clear: hold the episode, exactly
      // like the pages do, so a resumed game cannot alert twice.
      continue;
    }
    const coherent = {
      gamePk: game.gamePk,
      status: payload?.gameData?.status || game.status,
      linescore: payload?.liveData?.linescore,
      teams: game.teams,
    };
    const observation = rules.observe(state.states[game.gamePk], coherent, now);
    state.states[game.gamePk] = observation.state;
    if (!observation.event) continue;

    const record = {
      ...rules.historyRecord({ ...observation.event }, gamePageUrl),
      watcher: "tools/watcher.mjs",
    };
    summary.alerts.push(record);
    const written = appendAlert(config.logFile, record);
    summary.deliveries.push(await deliver(record, config));
    if (!written)
      summary.deliveries[summary.deliveries.length - 1].results.unshift({
        channel: "log",
        ok: false,
        detail: `could not write ${config.logFile}`,
      });
  }

  return summary;
}

/* ------------------------------------------------------------------ main - */

async function fetchJson(url, timeoutMs = 6_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function report(summary, config) {
  const clock = new Date(summary.at).toISOString().slice(11, 19);
  if (summary.scheduleError) {
    console.log(`[${clock}] schedule unavailable (${summary.scheduleError}) — will retry`);
    return;
  }
  for (let index = 0; index < summary.alerts.length; index += 1) {
    const alert = summary.alerts[index];
    const delivery = summary.deliveries[index];
    console.log(`[${clock}] ALERT · ${delivery.text}`);
    for (const result of delivery.results) {
      console.log(
        `[${clock}]   ${result.ok ? "delivered" : "FAILED"} → ${result.channel}: ${result.detail}`,
      );
    }
  }
  if (!config.quiet)
    console.log(
      `[${clock}] watched ${summary.targets}/${summary.games} games` +
        `${summary.snapshotErrors ? ` · ${summary.snapshotErrors} unreadable snapshot(s)` : ""}` +
        `${summary.alerts.length ? ` · ${summary.alerts.length} alert(s)` : ""}`,
    );
}

/**
 * The operations sub-commands. Each prints a report and exits without watching,
 * so they are safe to run next to a live watcher and from cron/CI. Returns a
 * process exit code.
 */
async function runOperations(config, flags) {
  if (flags.has("--list-subscriptions")) {
    const store = listStoredSubscriptions(config);
    if (!store.configured) {
      console.log("no subscription store configured (set WATCHER_PUSH_SUBSCRIPTIONS)");
      return 0;
    }
    if (store.missing) {
      console.log(`no subscription store at ${config.pushSubscriptions} yet`);
      return 0;
    }
    if (store.unreadable) {
      console.error(`subscription store unreadable: ${store.unreadable}`);
      return 1;
    }
    if (!store.entries.length) {
      console.log(`subscription store ${config.pushSubscriptions} is empty`);
      return 0;
    }
    for (const entry of store.entries)
      console.log(
        `${entry.valid ? "ok  " : "BAD "} ${entry.label} · ${entry.endpoint}${entry.valid ? "" : ` · ${entry.reason}`}`,
      );
    return store.entries.some((entry) => !entry.valid) ? 1 : 0;
  }

  if (flags.has("--prune-subscriptions")) {
    const result = pruneInvalidSubscriptions(config);
    if (!result.configured) {
      console.log("no subscription store configured (set WATCHER_PUSH_SUBSCRIPTIONS)");
      return 0;
    }
    if (!result.removed.length) {
      console.log(`nothing to prune · ${result.kept ?? 0} stored subscription(s) all usable`);
      return 0;
    }
    console.log(
      result.saved
        ? `removed ${result.removed.length} invalid subscription(s) · ${result.kept} left`
        : `found ${result.removed.length} invalid subscription(s) but could not rewrite ${config.pushSubscriptions}`,
    );
    for (const entry of result.removed) console.log(`  - ${entry.label} · ${entry.endpoint} · ${entry.reason}`);
    return result.saved ? 0 : 1;
  }

  if (flags.has("--doctor") || flags.has("--check")) {
    const report = await doctor(config);
    for (const line of report.lines)
      console.log(`${line.ok === false ? "FAIL" : line.ok === null ? "off " : "ok  "} ${line.label}: ${line.detail}`);
    console.log(report.ok ? "doctor: ready" : "doctor: NOT ready — fix the FAIL lines above");
    return report.ok ? 0 : 1;
  }

  return null; // no operations flag: run the watch loop
}

async function main() {
  const config = loadConfig();
  const flags = new Set(process.argv.slice(2));
  const code = await runOperations(config, flags);
  if (code !== null) {
    process.exitCode = code;
    return;
  }
  const state = readState(config.stateFile);
  const pushReady = Boolean(config.pushSubscriptions && config.vapidKeysFile && !pushConfigProblem(config));
  const stored = pushReady && existsSync(config.pushSubscriptions) ? readSubscriptions(config.pushSubscriptions) : [];
  const channels = [
    "stdout",
    `log ${config.logFile}`,
    config.webhookUrl ? "webhook" : null,
    config.ntfyTopic ? `ntfy ${config.ntfyServer}/${config.ntfyTopic}` : null,
    pushReady ? `Web Push (${stored.length} subscription${stored.length === 1 ? "" : "s"})` : null,
  ].filter(Boolean);
  console.log(
    `Loaded Late watcher · same rules engine as the site · every ${config.pollMs / 1000}s ` +
      `(late innings ${config.lateMs / 1000}s) · channels: ${channels.join(", ")}`,
  );
  // Say the quiet part at startup: a channel that is configured but cannot work
  // would otherwise look identical to a channel that simply had nothing to send.
  const configProblem = pushConfigProblem(config);
  if (configProblem) console.log(`WARNING: ${configProblem}`);
  else if (pushReady && !stored.length)
    console.log(
      `NOTE: no Web Push subscriptions in ${config.pushSubscriptions} yet — subscribe a device on the site.`,
    );

  let stopping = false;
  const stop = (signal) => {
    if (stopping) return;
    stopping = true;
    writeState(config.stateFile, state);
    console.log(`\n${signal} — state saved to ${config.stateFile}; stopping.`);
    process.exit(0);
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));

  do {
    const summary = await runCycle({ state, config, fetchJson });
    report(summary, config);
    writeState(config.stateFile, state);
    if (config.once) break;
    await new Promise((resolve) => setTimeout(resolve, config.pollMs));
  } while (!stopping);
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) await main();
