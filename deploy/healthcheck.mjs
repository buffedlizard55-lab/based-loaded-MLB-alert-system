#!/usr/bin/env node
/**
 * Container healthcheck for the Loaded Late watcher.
 *
 * What it can honestly prove: the watcher process is alive and *completing
 * cycles* — every cycle rewrites the dedup/state file, so a missing or stale
 * state file means the process is hung, was killed, or never started.
 *
 * What it cannot prove: that MLB's API is reachable. An upstream outage still
 * lets the watcher finish cycles (it prints `schedule unavailable … will retry`
 * and keeps going), and that text — not this exit code — is where you see it.
 * A healthcheck that claimed otherwise would be lying.
 *
 * Exit 0 = healthy, 1 = unhealthy (Docker then reports the container unhealthy;
 * `restart: unless-stopped` is what acts on it).
 *
 * Usage: node deploy/healthcheck.mjs
 *   WATCHER_LOG_DIR / WATCHER_STATE_FILE  same variables the watcher reads
 *   HEALTH_MAX_AGE_MS  how stale the state file may be (default 300000 = 5 min)
 */

import { statSync } from "node:fs";
import { join } from "node:path";

const stateFile =
  process.env.WATCHER_STATE_FILE ||
  join(process.env.WATCHER_LOG_DIR || "/data", "watcher-state.json");
const maxAge = Number(process.env.HEALTH_MAX_AGE_MS || 300_000);

let reason = "";
let healthy = false;
try {
  const { mtimeMs } = statSync(stateFile);
  const age = Date.now() - mtimeMs;
  healthy = Number.isFinite(age) && age <= maxAge;
  if (!healthy)
    reason = `state file is ${Math.round(age / 1000)}s old (limit ${Math.round(maxAge / 1000)}s)`;
} catch (error) {
  reason = `${stateFile} is unreadable: ${error?.code || error?.message || error}`;
}

console.log(
  healthy
    ? `healthy: ${stateFile} updated within ${Math.round(maxAge / 1000)}s`
    : `unhealthy: ${reason}`,
);
process.exit(healthy ? 0 : 1);
