#!/usr/bin/env node
/* Re-verification of the captured official snapshots — network required.
 *
 *   node tools/verify-official-snapshots.mjs
 *   SNAPSHOT_ALLOW_OFFLINE=1 node tools/verify-official-snapshots.mjs   (sandbox / no egress)
 *
 * tools/official-snapshot-test.mjs replays the payloads in
 * tools/fixtures/official-snapshots-822933.json through the rules engine with
 * no network at all. That only means something if the payloads really are what
 * the official MLB StatsAPI returned — so this tool re-fetches every fixture
 * URL, field by field, and fails loudly if anything has drifted.
 *
 * A difference is never "fixed" here. It is an irregularity to be reviewed:
 * either the fixture capture was wrong (fix the fixture, in a signed-off
 * change) or the official payload changed (which is exactly the signal the
 * nightly CI job exists to surface).
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
require("../assets/js/bases-loaded-core.js");
const FIXTURE_URL = new URL(
  "./fixtures/official-snapshots-822933.json",
  import.meta.url,
);
const TIMEOUT_MS = 20000;

const fixture = JSON.parse(readFileSync(FIXTURE_URL, "utf8"));

/** Path-by-path differences between the stored payload and the live one. */
function diff(expected, actual, path = "", out = []) {
  if (expected === actual) return out;
  const bothObjects =
    expected && actual && typeof expected === "object" && typeof actual === "object";
  if (!bothObjects) {
    out.push(`${path || "(root)"}: stored ${JSON.stringify(expected)} / live ${JSON.stringify(actual)}`);
    return out;
  }
  const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
  for (const key of keys) {
    if (!(key in expected)) {
      out.push(`${path}.${key}: missing from the stored fixture (live ${JSON.stringify(actual[key])})`);
      continue;
    }
    if (!(key in actual)) {
      out.push(`${path}.${key}: absent from the live payload (stored ${JSON.stringify(expected[key])})`);
      continue;
    }
    diff(expected[key], actual[key], path ? `${path}.${key}` : key, out);
  }
  return out;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
  return response.json();
}

const offline = process.env.SNAPSHOT_ALLOW_OFFLINE === "1";
let failures = 0;
let checked = 0;

for (const snap of fixture.snapshots) {
  const timecode = snap.url.match(/timecode=(\d{8}_\d{6})/)[1];
  let live;
  try {
    live = await fetchJson(snap.url);
  } catch (error) {
    if (offline) {
      console.log(`• ${timecode} — not re-fetched (offline mode): ${error.message}`);
      continue;
    }
    failures++;
    console.error(`✗ ${timecode} — could not re-fetch the official payload: ${error.message}`);
    console.error(`  ${snap.url}`);
    continue;
  }
  const differences = diff(snap.payload, live);
  checked++;
  if (differences.length) {
    failures++;
    console.error(`✗ ${timecode} — the official payload no longer matches the fixture:`);
    for (const line of differences) console.error(`    ${line}`);
    console.error(`  re-fetch it yourself: ${snap.url}`);
  } else {
    console.log(`✓ ${timecode} — official payload matches the fixture byte for byte (${snap.label})`);
  }
}

if (failures) {
  console.error(
    `\n${failures} snapshot(s) drifted. Do not "fix" the fixture blindly: confirm the change against the API, then update tools/fixtures/official-snapshots-822933.json and tools/official-snapshot-test.mjs together.`,
  );
  process.exit(1);
}

console.log(
  checked === 0 && offline
    ? "\nSkipped: no egress in this environment (SNAPSHOT_ALLOW_OFFLINE=1). Re-run where statsapi.mlb.com is reachable — CI runs it nightly.\n"
    : `\n✓ ${checked} official snapshot(s) re-verified against statsapi.mlb.com — the real-data fixtures still match the live API.\n`,
);
