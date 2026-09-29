#!/usr/bin/env node
/**
 * Published-site check — the last link in the chain.
 *
 * Every other suite in this repository runs against the working tree. This one
 * asks the only question that cannot be answered locally: *is the site the
 * public actually gets the site we built?* It fetches the published GitHub
 * Pages URL, compares every published page and alert asset **byte for byte**
 * with this repository, and asserts the wording and markup the site promises.
 *
 * Why it waits
 *   GitHub Pages builds *after* the merge commit, so for a minute or two after
 *   a merge the published site is legitimately still the previous commit. The
 *   whole assessment is therefore retried — one that reports "differs from this
 *   repository" for a file that was just changed is almost always a deployment
 *   that has not finished, not a defect. Only when the budget is exhausted is
 *   the run a failure, and it says how long it waited. Files already confirmed
 *   identical are not re-fetched.
 *
 * Where it runs
 *   `.github/workflows/smoke.yml` runs it after a merge to `main` and on the
 *   nightly schedule — never on a pull request, because a pull request is not
 *   published yet and the check would be worthless (or worse, it would pass
 *   against the previous deployment and hide a regression).
 *
 * Network required
 *   Yes. It is deliberately not part of the deterministic suite group
 *   (`bases-loaded-test`, `bases-loaded-monitor-test`,
 *   `bases-loaded-strip-test`, `site-links-test`), all of which run offline.
 *
 * Usage
 *   node tools/deployed-site-test.mjs
 *   SITE_URL=…                     override the site root (a local server works)
 *   SITE_CHECK_ATTEMPTS=20         assessment rounds (default 20)
 *   SITE_CHECK_DELAY_MS=15000      wait between rounds (default 15s → 5 minutes)
 *   SITE_CHECK_ALLOW_OFFLINE=1     treat "no network" as a documented skip (exit 0)
 */

const { readFileSync } = await import("node:fs");

const DEFAULT_SITE = "https://buffedlizard55-lab.github.io/based-loaded-MLB-alert-system/";

const siteRoot = (process.env.SITE_URL || DEFAULT_SITE).replace(/\/?$/, "/");
const rounds = Math.max(1, Number(process.env.SITE_CHECK_ATTEMPTS || 20));
const delayMs = Math.max(0, Number(process.env.SITE_CHECK_DELAY_MS || 15_000));
const allowOffline = process.env.SITE_CHECK_ALLOW_OFFLINE === "1";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Describe where two strings first differ, for a diagnosable CI annotation. */
function firstDifference(local, remote) {
  const limit = Math.min(local.length, remote.length);
  for (let i = 0; i < limit; i += 1)
    if (local[i] !== remote[i])
      return `byte ${i}: local ${JSON.stringify(local.slice(i, i + 40))} vs published ${JSON.stringify(remote.slice(i, i + 40))}`;
  if (local.length !== remote.length)
    return `length ${local.length} local vs ${remote.length} published`;
  return "identical";
}

/** Collapse whitespace: a sentence written across two source lines arrives
 *  with a newline inside it, and matching the raw body would fail on the page's
 *  formatting rather than on its content. */
const flat = (text) => String(text || "").replace(/\s+/g, " ");

const get = async (path) => {
  const url = new URL(path.replace(/^\//, ""), siteRoot).href;
  try {
    const response = await fetch(url, {
      redirect: "follow",
      headers: { "user-agent": "based-loaded-mlb-alert-system/site-check" },
    });
    const body = response.status === 200 ? await response.text() : "";
    return { url, status: response.status, body };
  } catch (error) {
    return { url, status: 0, body: "", error: String(error?.message || error) };
  }
};

const unreachable = (result) => result && (result.status === 0 || result.status === 404);

const PAGES = ["scoreboard.html", "reviews.html", "game.html"];
const ASSETS = [
  "assets/css/bases-loaded.css",
  "assets/js/bases-loaded.js",
  "assets/js/bases-loaded-core.js",
];
const PUBLISHED_FILES = [
  "index.html",
  "bases-loaded.html",
  "verification.html",
  ...PAGES,
  "assets/js/bases-loaded.js",
  "assets/js/bases-loaded-core.js",
  "assets/js/bases-loaded-strip.js",
  "assets/css/bases-loaded.css",
  "assets/css/bases-loaded-strip.css",
];

/**
 * One full assessment. Returns `{ passed, failures, offline }` for this round;
 * `state.confirmed` carries the files already proven identical so a retry only
 * re-fetches what is still in question.
 */
async function assess(state) {
  let passed = 0;
  const failures = [];
  let offline = false;

  const ok = (condition, message) => {
    if (condition) {
      passed += 1;
      return true;
    }
    failures.push(message);
    return false;
  };

  const index = await get("");
  const indexOk = ok(
    index.status === 200 && /Loaded Late/i.test(index.body),
    `the site root answers 200 and identifies itself (${index.url} → ${index.status})`,
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
    ok(
      flat(index.body).includes("verification.html"),
      "the published monitor links the sources page",
    );
    ok(
      flat(index.body).includes('id="tied-count"'),
      "the published monitor ships the tied-in-a-final-half metric",
    );
    ok(
      flat(index.body).includes('id="export-json"') &&
        flat(index.body).includes('id="copy-evidence"'),
      "the published monitor ships the history export and evidence controls",
    );
  } else if (index.status === 0) {
    return { passed, failures, offline };
  }

  const basesLoaded = await get("bases-loaded.html");
  ok(
    basesLoaded.status === 200 &&
      flat(basesLoaded.body).includes('id="board"') &&
      flat(basesLoaded.body).includes('id="tied-count"'),
    `bases-loaded.html is published with the slate and the tied metric (${basesLoaded.status})`,
  );

  const verification = await get("verification.html");
  ok(verification.status === 200, `the sources page is published (${verification.status})`);
  const page = flat(verification.body);
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

  for (const name of PAGES) {
    const result = await get(name);
    ok(result.status === 200, `${name} is published (${result.status})`);
  }

  for (const asset of ASSETS) {
    const result = await get(asset);
    ok(
      result.status === 200 && (result.body || "").length > 500,
      `${asset} is served from the published site (${result.status})`,
    );
  }

  /* ----------------- the published bytes are this repository's bytes ------- */

  // The strongest form of "the site is deployed": the file the public receives
  // is the file in this repository, byte for byte. Markup checks can pass on a
  // stale deployment that happens to carry the same ids; this cannot.
  for (const file of PUBLISHED_FILES) {
    if (state.confirmed.has(file)) {
      passed += 1;
      continue;
    }
    const result = await get(file);
    const local = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    const remote = result.body ?? "";
    if (remote === local) {
      state.confirmed.add(file);
      passed += 1;
      continue;
    }
    failures.push(`${file} differs — ${firstDifference(local, remote)}`);
  }

  return { passed, failures, offline };
}

/* --------------------------------------------------------------- the loop */

const started = Date.now();
const state = { confirmed: new Set() };
let result = { passed: 0, failures: [], offline: false };
const waitBudgetMs = delayMs * (rounds - 1);

for (let round = 1; round <= rounds; round += 1) {
  result = await assess(state);
  if (!result.failures.length || result.offline || round === rounds) break;
  const waited = Math.round((Date.now() - started) / 1000);
  console.log(
    `  round ${round}: ${result.failures.length} check(s) still failing after ${waited}s — ` +
      `waiting ${Math.round(delayMs / 1000)}s for the deployment to catch up`,
  );
  await sleep(delayMs);
}

const elapsed = Math.round((Date.now() - started) / 1000);

/* ------------------------------------------------------------- the verdict */

if (!result.failures.length) {
  console.log(
    `✓ ${result.passed} published-site checks passed against ${siteRoot} (${elapsed}s, ${state.confirmed.size} files byte-identical)`,
  );
  process.exit(0);
}

if (result.offline && allowOffline) {
  console.log(
    `⚠ published-site check skipped: ${siteRoot} unreachable from this environment`,
  );
  process.exit(0);
}

console.error(
  `✗ ${result.failures.length} published-site checks failed against ${siteRoot} after ${elapsed}s`,
);
for (const failure of result.failures) console.error(`  · ${failure}`);
// Annotations make the failure readable in the checks UI (and through the
// check-run API) instead of only "Process completed with exit code 1".
console.log(
  `::error title=Published site check::${result.failures.length} check(s) failed against ${siteRoot} after ${elapsed}s`,
);
for (const failure of result.failures.slice(0, 8))
  console.log(`::warning title=Published site check::${failure}`);
if (result.failures.some((failure) => failure.includes("differs")))
  console.log(
    `::warning title=Published site check::a file that differs may mean the Pages build is still running — the check waited ${Math.round(
      waitBudgetMs / 1000,
    )}s in ${rounds} rounds; inspect the latest pages-build-deployment run before assuming a defect`,
  );
if (result.offline) {
  console.error(
    "\nThe site could not be reached at all. If this is a sandbox without\n" +
      "internet access, re-run with SITE_CHECK_ALLOW_OFFLINE=1; in CI this is a\n" +
      "real failure (Pages disabled, deployment broken, or the URL moved).",
  );
}
process.exit(1);
