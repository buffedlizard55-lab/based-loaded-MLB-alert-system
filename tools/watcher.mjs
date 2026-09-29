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
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  maskEndpoint,
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
export async function deliver(alert, config, fetchImpl = fetch) {
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
    results.push(...(await deliverPush(text, alert, config, fetchImpl)));
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
async function deliverPush(text, alert, config, fetchImpl) {
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
    const outcome = await sendPush(subscription, pushPayload(alert, text), {
      fetchImpl,
      vapid,
      ttl: PUSH_TTL_SECONDS,
      urgency: "high",
      topic: pushTopic(alert),
      subject: config.vapidSubject || undefined,
    });
    results.push({
      channel: `push(${label})`,
      ok: outcome.ok,
      detail: outcome.ok
        ? `HTTP ${outcome.status} · ${outcome.bytes} bytes · ${maskEndpoint(subscription.endpoint)}`
        : `${outcome.error || `HTTP ${outcome.status}`} · ${maskEndpoint(subscription.endpoint)}` +
          (outcome.retryAfter ? ` · retry after ${outcome.retryAfter}s` : ""),
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

async function main() {
  const config = loadConfig();
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
