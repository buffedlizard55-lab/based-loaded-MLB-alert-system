#!/usr/bin/env node
/**
 * Published-site check — the last link in the chain.
 *
 * Every other suite in this repository runs against the working tree. This one
 * asks the only question that cannot be answered locally: *is the site the
 * public actually gets the site we built?* It fetches the published GitHub
 * Pages URL and asserts the pages, the alert wording and the assets are the
 * ones in this repository.
 *
 * Where it runs
 *   `.github/workflows/smoke.yml` runs it after a merge to `main` and on the
 *   nightly schedule — never on a pull request, because a pull request is not
 *   published yet and the check would be meaningless (or worse, it would pass
 *   against the previous deployment and hide a regression).
 *
 * Network required
 *   Yes. It is deliberately not part of the deterministic suite group
 *   (`bases-loaded-test`, `bases-loaded-monitor-test`,
 *   `bases-loaded-strip-test`, `site-links-test`), all of which run offline.
 *
 * Usage
 *   node tools/deployed-site-test.mjs
 *   SITE_URL=…                     override the site root
 *   SITE_CHECK_ATTEMPTS=6          fetch attempts per page (default 6)
 *   SITE_CHECK_DELAY_MS=10000      delay between attempts (default 10s)
 *   SITE_CHECK_ALLOW_OFFLINE=1     treat "no network" as a skip (exit 0)
 */

const DEFAULT_SITE = "https://buffedlizard55-lab.github.io/based-loaded-MLB-alert-system/";

const siteRoot = (process.env.SITE_URL || DEFAULT_SITE).replace(/\/?$/, "/");
const attempts = Math.max(1, Number(process.env.SITE_CHECK_ATTEMPTS || 6));
const delayMs = Math.max(0, Number(process.env.SITE_CHECK_DELAY_MS || 10_000));
const allowOffline = process.env.SITE_CHECK_ALLOW_OFFLINE === "1";

let passed = 0;
const failures = [];
let offline = false;

function ok(condition, message) {
  if (condition) {
    passed += 1;
    return true;
  }
  failures.push(message);
  return false;
}

function equal(actual, expected, message) {
  return ok(
    actual === expected,
    `${message} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`,
  );
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fetch a URL, retrying the failures that mean "not deployed yet" rather than
 * "wrong content": GitHub Pages can trail a merge by up to a minute, and an
 * unattended nightly run has no reason to be impatient.
 */
async function get(path, { expectType = "html" } = {}) {
  const url = new URL(path.replace(/^\//, ""), siteRoot).href;
  let last = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        redirect: "follow",
        headers: { "user-agent": "based-loaded-mlb-alert-system/site-check" },
      });
      const body = response.status === 200 ? await response.text() : "";
      last = { url, status: response.status, body, type: expectType };
      if (response.status === 200 && body.length > 0) return last;
    } catch (error) {
      last = { url, status: 0, body: "", error: String(error?.message || error) };
    }
    if (attempt < attempts) await sleep(delayMs);
  }
  return last;
}

function unreachable(result) {
  return result && (result.status === 0 || result.status === 404);
}

/**
 * Collapse whitespace before asserting on page text. The published HTML is
 * indented, so a sentence written across two source lines arrives with a
 * newline inside it; matching the raw body would fail on the page's formatting
 * rather than on its content.
 */
function flat(text) {
  return String(text || "").replace(/\s+/g, " ");
}

const started = Date.now();

/* --------------------------------------------------------------- the pages */

const index = await get("");
const indexOk = ok(
  index?.status === 200 && /Loaded Late/i.test(index.body || ""),
  `the site root answers 200 and identifies itself (${index?.url} → ${index?.status})`,
);
if (!indexOk && unreachable(index)) offline = true;

if (indexOk) {
  ok(
    /Tie game/i.test(index.body) && /Bottom 9/i.test(index.body),
    "the published monitor still states the one situation it watches",
  );
  ok(
    flat(index.body).includes('id="board"') &&
      flat(index.body).includes('id="board-summary"'),
    "the published monitor ships the live slate (the newest feature reaches the public)",
  );
  ok(
    flat(index.body).includes("assets/css/bases-loaded.css") &&
      flat(index.body).includes("assets/js/bases-loaded.js"),
    "the published monitor loads its stylesheet and controller with relative paths",
  );
  equal(
    (flat(index.body).match(/verification\.html/g) || []).length > 0,
    true,
    "the published monitor links the sources page",
  );
  ok(
    flat(index.body).includes('id="tied-count"'),
    "the published monitor ships the tied-in-a-final-half metric",
  );
}

const basesLoaded = await get("bases-loaded.html");
if (indexOk) {
  ok(
    basesLoaded?.status === 200 &&
      flat(basesLoaded.body).includes('id="board"') &&
      flat(basesLoaded.body).includes('id="tied-count"'),
    `bases-loaded.html is published and identical in structure (${basesLoaded?.status})`,
  );
}

const verification = await get("verification.html");
if (indexOk) {
  ok(
    verification?.status === 200,
    `the sources page is published (${verification?.status})`,
  );
  const page = flat(verification?.body);
  ok(
    /Every route to loaded bases/i.test(page),
    "the sources page still documents every route to loaded bases",
  );
  ok(
    /When the winning run is scored in the last half-inning/.test(page) &&
      /the umpire shall not declare the game ended until the runner forced to advance from third has touched home base/.test(
        page,
      ),
    "the sources page still carries the verbatim Rule 5.08(b) sentence",
  );
  ok(
    page.includes("statsapi.mlb.com"),
    "the sources page still links the official MLB data endpoint",
  );
  ok(
    page.includes("assets/js/bases-loaded-strip.js"),
    "the sources page still loads the site-wide watch strip",
  );
}

for (const page of ["scoreboard.html", "reviews.html", "game.html"]) {
  const result = await get(page);
  if (!indexOk) break;
  ok(result?.status === 200, `${page} is published (${result?.status})`);
}

for (const asset of [
  "assets/css/bases-loaded.css",
  "assets/js/bases-loaded.js",
  "assets/js/bases-loaded-core.js",
]) {
  const result = await get(asset, { expectType: "text" });
  if (!indexOk) break;
  ok(
    result?.status === 200 && (result.body || "").length > 500,
    `${asset} is served from the published site (${result?.status})`,
  );
}

/* ------------------------------------------------------------- the verdict */

if (failures.length === 0) {
  console.log(
    `✓ ${passed} published-site checks passed against ${siteRoot} (${Math.round(
      (Date.now() - started) / 1000,
    )}s)`,
  );
  process.exit(0);
}

if (offline && allowOffline) {
  console.log(
    `⚠ published-site check skipped: ${siteRoot} unreachable from this environment`,
  );
  process.exit(0);
}

console.error(`✗ ${failures.length} published-site checks failed against ${siteRoot}`);
for (const failure of failures) console.error(`  · ${failure}`);
// Annotations make the failure readable in the checks UI (and through the
// check-run API) instead of only "Process completed with exit code 1".
console.log(
  `::error title=Published site check::${failures.length} check(s) failed against ${siteRoot}`,
);
for (const failure of failures.slice(0, 8))
  console.log(`::warning title=Published site check::${failure}`);
if (offline) {
  console.error(
    "\nThe site could not be reached at all. If this is a sandbox without\n" +
      "internet access, re-run with SITE_CHECK_ALLOW_OFFLINE=1; in CI this is a\n" +
      "real failure (Pages disabled, deployment broken, or the URL moved).",
  );
}
process.exit(1);
