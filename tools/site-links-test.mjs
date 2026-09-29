#!/usr/bin/env node
/* Static-site integrity checks for the Loaded Late copy of the site.
 *
 * These are the checks that keep the published pages honest and self-contained:
 *
 *   1. every page exists and carries the metadata a clean page needs
 *   2. every internal href/src resolves to a file in this repository
 *   3. no root-absolute internal path (the site must work under a project
 *      Pages subpath such as /based-loaded-MLB-alert-system/)
 *   4. every outbound link is HTTPS, and no page loads a third-party script
 *   5. the project prompt and the verbatim Rule 5.08(b) sentence are still in
 *      the README, and every `node tools/...` command the README advertises
 *      points at a file that exists
 *   6. the alert surfaces still accept no manual input
 *
 * Run: node tools/site-links-test.mjs (no dependencies, no network)
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
let checks = 0;
const ok = (condition, label) => {
  assert.ok(condition, label);
  checks++;
};
const check = (actual, expected, label) => {
  assert.deepEqual(actual, expected, label);
  checks++;
};
const read = (file) => readFileSync(path.join(root, file), "utf8");
const exists = (file) => existsSync(path.join(root, file));

const pages = [
  "index.html",
  "bases-loaded.html",
  "verification.html",
  "scoreboard.html",
  "reviews.html",
  "game.html",
  "404.html",
];

/* ------------------------------------------------------- 1. pages exist */

for (const page of pages) {
  ok(exists(page), `${page} exists`);
  const html = read(page);
  ok(/<html lang="en"/.test(html), `${page} declares a language`);
  ok(/<meta name="viewport"/.test(html), `${page} is mobile-viewport ready`);
  const title = html.match(/<title>([^<]+)<\/title>/);
  ok(title && title[1].trim().length > 3, `${page} has a real title`);
  if (page !== "404.html")
    ok(
      /<meta\s+name="description"/.test(html) ||
        /name="description"/.test(html),
      `${page} has a description for search and previews`,
    );
}

/* --------------------------------------- 2. internal links all resolve */

const localTargets = (html) =>
  [...html.matchAll(/(?:href|src)="([^"]+)"/g)]
    .map((match) => match[1])
    .filter(
      (target) =>
        !/^(?:https?:|mailto:|data:|#|javascript:)/.test(target) &&
        target.trim() !== "",
    );

const missing = [];
for (const page of pages) {
  for (const target of localTargets(read(page))) {
    const clean = target.split("#")[0].split("?")[0];
    if (!clean) continue; // pure query/fragment link to the same page
    const resolved = path.join(root, clean);
    if (!existsSync(resolved)) missing.push(`${page} → ${target}`);
  }
}
check(missing, [], "Every internal href/src on every page resolves");

// CSS referenced by pages may itself reference local assets.
for (const sheet of ["assets/css/bases-loaded.css", "assets/css/bases-loaded-strip.css", "assets/css/style.css"]) {
  ok(exists(sheet), `${sheet} exists`);
}

/* ----------------------------------- 3. no root-absolute internal paths */

const absolute = [];
for (const page of pages)
  if (/(?:href|src)="\/(?!\/)/.test(read(page))) absolute.push(page);
check(
  absolute,
  [],
  "No page uses a root-absolute path (works under a project Pages subpath)",
);

/* ------------------------------- 4. outbound links are HTTPS, no 3p scripts */

const insecure = [];
for (const page of pages) {
  const html = read(page);
  for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const target = match[1];
    if (/^http:\/\//.test(target)) insecure.push(`${page} → ${target}`);
    if (/^<script/.test("") && false) continue;
  }
  for (const script of html.matchAll(/<script[^>]*src="([^"]+)"/g))
    ok(
      !/^(?:https?:)?\/\//.test(script[1]),
      `${page} loads only same-origin scripts (${script[1]})`,
    );
}
check(insecure, [], "Every outbound link uses HTTPS");

/* ------------------------------------------ 5. README contract and claims */

const readme = read("README.md");
const promptPhrases = [
  "Project prompt — read this first, every session",
  "Clone the repo and create a copy of the website",
  "TIED GAME BOTTOM OF THE INNING THAT COULD END THE GAME",
  "Maximize P(Win)",
  "Own the Outcome",
  "No hallucinations",
];
for (const phrase of promptPhrases)
  ok(readme.includes(phrase), `README still carries the prompt phrase: “${phrase}”`);

// The verbatim game-ending-bases-full sentence must be identical wherever it
// is quoted, so a paraphrase can never quietly replace the rule text.
const ruleSentence = (
  html,
) =>
  (html.match(
    /When the winning run is scored in the last half-inning of a[\s\S]{0,600}?batter-runner has touched first base\./,
  ) || [""])[0]
    .replace(/<[^>]*>/g, " ")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
const readmeRule = ruleSentence(readme);
const pageRule = ruleSentence(read("verification.html"));
ok(
  readmeRule.length > 250,
  "README quotes the full Rule 5.08(b) sentence (no paraphrase)",
);
check(
  pageRule,
  readmeRule,
  "The rule sentence on the site is identical to the README's quotation",
);
ok(
  readme.includes("Rule 5.08(b)"),
  "README attributes the quoted sentence to Rule 5.08(b)",
);
ok(
  read("verification.html").includes("Rule 7.01(b)"),
  "The extra-innings automatic runner is attributed to Rule 7.01(b)",
);

// Documented test commands must exist.
const documented = [
  ...readme.matchAll(/node (tools\/[\w.-]+\.mjs)/g),
].map((match) => match[1]);
ok(documented.length >= 4, "README documents its test suites");
for (const file of new Set(documented))
  ok(exists(file), `README's documented command exists: ${file}`);

/* --------------------------------- 6. the alert surfaces have no inputs */

// No page may take typed input into the alert pipeline: the whole point is that
// nothing has to be entered for a situation to be caught. The phone-alerts panel
// is the single exception, and it is fenced in by its own checks below: its device
// name is a note on a subscription, it cannot reach the rules engine, and its
// only other field is a read-only output.
for (const page of ["index.html", "bases-loaded.html", "verification.html"]) {
  const html = read(page);
  ok(!/<form|contenteditable/i.test(html), `${page} has no manual data entry form`);
  const editable = [...html.matchAll(/<input[^>]*>|<textarea[^>]*>/gi)]
    .map((match) => match[0])
    .filter((tag) => !/readonly/i.test(tag));
  const outsidePanel = editable.filter(
    (tag) => !/id="phone-alerts-label"/.test(tag) || !html.includes('id="phone-alerts"'),
  );
  check(
    outsidePanel,
    [],
    `${page}'s only editable control is the phone-alert device name`,
  );
}
// …and that one control really cannot influence a single rule: the monitor code
// does not look at it, and the push panel is the only thing that reads it.
for (const file of ["assets/js/bases-loaded.js", "assets/js/bases-loaded-core.js", "assets/js/bases-loaded-strip.js"]) {
  ok(
    !read(file).includes("phone-alerts"),
    `${file} never reads the phone-alerts panel (alerts stay input-free)`,
  );
}
check(
  read("assets/js/push-alerts.js").includes("phone-alerts-label") &&
    read("assets/js/push-alerts.js").includes("navigator.clipboard"),
  true,
  "The push panel is the only reader of the device name, and it is only copied out",
);

/* ------------------------------ 6b. phone alerts (Web Push) are wired up --- */

const indexHtml = read("index.html");
for (const script of ["assets/js/vapid-config.js", "assets/js/push-alerts.js"]) {
  ok(indexHtml.includes(`<script src="${script}"></script>`), `index.html loads ${script}`);
}
ok(read("sw.js").includes('addEventListener("push"'), "The service worker handles push events");
ok(read("sw.js").includes('addEventListener("notificationclick"'), "…and a tapped notification");
ok(read("sw.js").includes("showNotification"), "…by actually showing a notification");
ok(
  !read("sw.js").includes('addEventListener("fetch"') && !/\bcaches\./.test(read("sw.js")),
  "The service worker caches nothing (a stale page about a live game would be a lie)",
);
ok(
  !/\bfetch\(/.test(read("assets/js/push-alerts.js")),
  "The subscribe panel never calls the watcher: it hands the entry over by copy/paste",
);
ok(
  /window\.LOADED_LATE_VAPID_PUBLIC_KEY = "";/.test(read("assets/js/vapid-config.js")),
  "The repository ships with no VAPID public key configured (the panel says so until one is pasted)",
);
// Both monitor entrypoints are byte-identical (asserted by the rules suite), so
// both carry the panel; the standalone pages deliberately do not, so the alert
// surface stays in one place.
for (const page of ["verification.html", "scoreboard.html", "reviews.html", "game.html"]) {
  ok(!read(page).includes("push-alerts.js"), `${page} does not load the subscribe panel`);
}
for (const page of ["index.html", "bases-loaded.html"]) {
  ok(read(page).includes('id="phone-alerts"'), `${page} carries the phone-alerts panel`);
  ok(read(page).includes("window.LoadedLatePush.mount(document"), `${page} wires the panel up`);
  ok(/WATCHER_PUSH_SUBSCRIPTIONS/.test(read(page)), `${page} names the watcher setting the entry goes into`);
}
for (const envVar of ["WATCHER_PUSH_SUBSCRIPTIONS", "WATCHER_VAPID_KEYS"]) {
  ok(read("docs/watcher-deployment.md").includes(envVar), `The deployment guide documents ${envVar}`);
  ok(read("deploy/loaded-late-watcher.env.example").includes(envVar), `The env template documents ${envVar}`);
}
ok(
  read("tools/watcher.mjs").includes("./webpush.mjs"),
  "The watcher really uses the Web Push implementation the docs describe",
);
// The inherited scoreboard / replay feed date pickers select which day is
// displayed; they never feed the alert rules.
for (const page of ["scoreboard.html", "reviews.html"]) {
  const html = read(page);
  const inputs = [...html.matchAll(/<input[^>]*>/g)].map((match) => match[0]);
  check(
    inputs.every((tag) => /type="date"/.test(tag)),
    true,
    `${page}'s only input is the view-only date picker`,
  );
}


/* --------------------------- 7. well-formed structure (tags, table columns) */

const structuralTags = [
  "table",
  "thead",
  "tbody",
  "tr",
  "section",
  "details",
  "summary",
  "aside",
  "main",
  "header",
  "footer",
  "nav",
  "blockquote",
];
for (const page of pages) {
  const html = read(page);
  for (const tag of structuralTags) {
    const opening = (html.match(new RegExp(`<${tag}(\\s|>)`, "g")) || []).length;
    const closing = (html.match(new RegExp(`</${tag}>`, "g")) || []).length;
    check(closing, opening, `${page}: <${tag}> tags balance`);
  }
  // Every table must line up: colspan and rowspan counted, all rows equal width.
  const tables = html.match(/<table[\s\S]*?<\/table>/g) || [];
  tables.forEach((table, index) => {
    const carry = [];
    let width = null;
    (table.match(/<tr[\s\S]*?<\/tr>/g) || []).forEach((row, rowIndex) => {
      let cells = carry[rowIndex] || 0;
      for (const cell of row.match(/<t[hd][^>]*>/g) || []) {
        const colspan = cell.match(/colspan="(\d+)"/);
        cells += colspan ? Number(colspan[1]) : 1;
        const rowspan = cell.match(/rowspan="(\d+)"/);
        if (rowspan)
          for (let span = 1; span < Number(rowspan[1]); span++)
            carry[rowIndex + span] = (carry[rowIndex + span] || 0) + 1;
      }
      if (width === null) width = cells;
      else check(cells, width, `${page}: table ${index} row ${rowIndex} width`);
    });
  });
}

/* ------------------------------------------- 8. deployment entry points */

// The site is published by GitHub Pages' built-in "deploy from a branch"
// build: the repository root of `main` IS the site. That is deliberate — no
// build step, nothing to keep in sync, and one publisher only. A competing
// Actions deployment workflow would race the built-in build, so assert the
// repository does not ship one.
ok(
  exists(".github/workflows/smoke.yml"),
  "The checks workflow ships in .github/workflows",
);
ok(
  !exists(".github/workflows/pages.yml"),
  "No competing Pages workflow (the built-in branch build publishes the root)",
);
const smokeWorkflow = read(".github/workflows/smoke.yml");
for (const suite of [
  "tools/bases-loaded-test.mjs",
  "tools/bases-loaded-monitor-test.mjs",
  "tools/bases-loaded-strip-test.mjs",
  "tools/watcher-test.mjs",
  "tools/watcher-deploy-test.mjs",
  "tools/site-links-test.mjs",
])
  ok(smokeWorkflow.includes(suite), `CI runs ${suite}`);
ok(
  smokeWorkflow.includes("tools/deployed-site-test.mjs"),
  "CI checks the published site after a merge to main and nightly",
);
ok(
  /github\.ref == 'refs\/heads\/main'/.test(smokeWorkflow),
  "The published-site check is scoped to main (never runs against an unpublished PR)",
);

// The published-site check is a network test; the deterministic group must
// never depend on it, or a sandbox without internet becomes a red build.
const deterministicJob = smokeWorkflow.slice(
  smokeWorkflow.indexOf("deterministic:"),
  smokeWorkflow.indexOf("published-site:"),
);
ok(
  !deterministicJob.includes("deployed-site-test.mjs") &&
    !deterministicJob.includes("smoke-test.mjs"),
  "The deterministic CI job stays offline",
);

/* ------------------- 9. the documented projection matches the code --------- */

// The alert snapshot projection is the one request every watch/alert depends
// on. If someone widens the request in api.js, the documented links must move
// with it (a stale projection in the docs is a claim about the wrong request).
const apiSource = read("assets/js/api.js");
const projection = (
  apiSource.match(/const fields = ([\s\S]*?);/) || [null, ""]
)[1]
  .replace(/['"\n]/g, "")
  .split("+")
  .map((part) => part.trim())
  .join("");
ok(projection.length > 100, "api.js still declares the alert projection");
for (const [file, label] of [
  ["README.md", "README"],
  ["verification.html", "the sources page"],
]) {
  const html = read(file);
  const link = html.match(
    /feed\/live\?fields=([A-Za-z0-9,]+)/,
  );
  check(
    link ? link[1] : null,
    projection,
    `${label} documents exactly the projection api.js sends`,
  );
  ok(
    html.indexOf("statsapi.mlb.com") > -1,
    `${label} links the official endpoint`,
  );
}


/* ------------------------------------------------------------- assets */

ok(
  exists("tools/watcher.mjs") && exists("tools/watcher-test.mjs"),
  "The always-on watcher and its suite ship together",
);
// Deployment recipes are only useful if they ship, are documented, and stay in
// step with the watcher's settings — the deployment suite is what keeps them
// honest, so its presence and its CI wiring are part of site integrity.
for (const recipe of [
  "deploy/loaded-late-watcher.service",
  "deploy/loaded-late-watcher.env.example",
  "deploy/Dockerfile",
  "deploy/docker-compose.yml",
  "deploy/com.loadedlate.watcher.plist",
  "deploy/healthcheck.mjs",
  "tools/watcher-deploy-test.mjs",
])
  ok(exists(recipe), `${recipe} ships with the watcher it deploys`);
ok(
  exists("docs/watcher-deployment.md") &&
    read("docs/watcher-deployment.md").includes("deploy/Dockerfile"),
  "The deployment guide documents the recipes it ships",
);
// The sources page keeps a "recommended next work" list next to a shipped log.
// A list that still advertises something the log says shipped reads as if the
// work were outstanding — check the two against each other for the features
// this project has already delivered.
{
  const page = read("verification.html");
  const listStart = page.indexOf("Recommended next work:");
  const listEnd = page.indexOf("</li>", listStart);
  const nextWork = listStart > -1 ? page.slice(listStart, listEnd) : "";
  ok(nextWork.length > 0, "The sources page still lists recommended next work");
  for (const [pattern, label] of [
    [/host and schedule/i, "hosting the watcher"],
    [/history export \(CSV\/JSON\)/i, "the history export"],
    [/always-on server watcher\s+with Web Push/i, "the always-on watcher itself"],
  ])
    ok(!pattern.test(nextWork), `Next work no longer lists ${label}, which already shipped`);
  // A tracked feature must not be advertised as outstanding once it ships. The
  // list is allowed to mention it in its "done already" clause — that is the
  // point of the clause — so the check targets the words that promise future
  // work, not the words that name the feature.
  ok(
    !/still not implemented|not yet implemented|remains outstanding|is still open/i.test(nextWork),
    "Next work does not describe shipped work as outstanding",
  );
  ok(
    /prove it live/i.test(nextWork),
    "Next work leads with the live end-to-end proof, the only acceptance test left",
  );
}
ok(
  read(".dockerignore").split("\n").some((line) => line.trim() === ".git"),
  ".dockerignore keeps the repository history out of a published image context",
);
ok(
  read("tools/watcher.mjs").includes("bases-loaded-core.js"),
  "The watcher reuses the shared rules engine (no forked copy of the rules)",
);
ok(
  read(".gitignore").includes("watcher-state.json"),
  "Each deployment's watcher state stays out of version control",
);
for (const secret of ["data/vapid-keys.json", "data/push-subscriptions.json"]) {
  ok(
    read(".gitignore").split("\n").some((line) => line.trim() === secret),
    `${secret} is gitignored (a VAPID key and a subscription endpoint are secrets)`,
  );
}
ok(
  read("index.html").includes("if (window.LoadedLatePush) window.LoadedLatePush.mount(document"),
  "The panel is mounted behind a guard, so a blocked script cannot break the monitor",
);
// Every element the panel reaches for must exist in the markup: an id rename
// would otherwise leave a silently missing status line or a dead button.
for (const id of new Set([...read("assets/js/push-alerts.js").matchAll(/byId\("([^"]+)"\)/g)].map((m) => m[1]))) {
  ok(
    read("index.html").includes(`id="${id}"`) && read("bases-loaded.html").includes(`id="${id}"`),
    `Both entrypoints ship the ${id} element the panel wires`,
  );
}

for (const asset of [
  "assets/js/api.js",
  "assets/js/bases-loaded-core.js",
  "assets/js/bases-loaded.js",
  "assets/js/bases-loaded-strip.js",
  "assets/css/bases-loaded.css",
  "assets/css/bases-loaded-strip.css",
  "server.mjs",
])
  ok(exists(asset) && statSync(path.join(root, asset)).size > 0, `${asset} is present`);

/* --------------------- 10. documented suite counts stay in step ----------- */

// The README and the sources page both quote the size of this suite. The two
// figures may lag the real number slightly (the suite grows whenever a page
// grows), but they may never disagree with each other — that is how a reader
// ends up comparing two "official" numbers that cannot both be right.
function documentedSiteCount(file, pattern) {
  const match = read(file).match(pattern);
  return match ? Number(match[1].replace(/,/g, "")) : null;
}
const readmeCount = documentedSiteCount("README.md", /([\d,]+) site checks/);
const pageCount = documentedSiteCount(
  "verification.html",
  // Tolerant of prose reflow: the sentence may wrap between the words.
  /static site by\s+([\d,]+)\s+checks/,
);
ok(
  readmeCount !== null && pageCount !== null,
  "Both the README and the sources page state the size of this suite",
);

// The rule-suite number is quoted in several places (README, the requirement
// checklist, the verification log). They may lag a growing suite, but they may
// never contradict each other — two different "official" counts is worse than
// one stale count, and it is exactly what a reader would notice first.
const ruleCounts = [];
for (const [file, pattern] of [
  ["README.md", /([\d,]+) rule states/g],
  ["README.md", /rules ([\d,]+) ·/g],
  ["verification.html", /([\d,]+) deterministic checks/g],
  ["verification.html", /\\(([\d,]+) checks\\)/g],
  ["verification.html", /([\d,]+) checks, including an 11,520-case/g],
]) {
  const text = read(file);
  for (const match of text.matchAll(pattern))
    ruleCounts.push({ file, value: Number(match[1].replace(/,/g, "")) });
}
ok(ruleCounts.length >= 3, "The rule-suite size is stated in the expected places");
check(
  new Set(ruleCounts.map((entry) => entry.value)).size,
  1,
  `Every stated rule-suite size agrees (${ruleCounts
    .map((entry) => `${entry.file}:${entry.value}`)
    .join(", ")})`,
);
check(
  pageCount,
  readmeCount,
  "The README and the sources page quote the same suite size",
);

// The same rule applies to the other suites by name: a page that says "the
// watcher suite is 85 checks" in one place and 120 in another is quoting two
// "official" numbers, which is exactly how a reader stops trusting the page.
{
  // Every place the sources page sizes the watcher suite — "…— 120 checks" and
  // "…(120 checks)" — pooled, then compared to each other.
  const quoted = [...read("verification.html").matchAll(/watcher-test\.mjs<\/code>[^\d]{0,12}([\d,]+)/g)].map(
    (match) => Number(match[1].replace(/,/g, "")),
  );
  ok(quoted.length >= 2, `The sources page sizes the watcher suite where expected (${quoted.join(", ")})`);
  check(
    new Set(quoted).size,
    1,
    `The sources page quotes one watcher-suite size throughout (${quoted.join(", ")})`,
  );
}
if (readmeCount !== null && readmeCount !== checks)
  console.log(
    `  note: the docs quote ${readmeCount} site checks; this run performs ${checks}.`,
  );

/* --------------- 11. the history export controls stay on both pages ------- */

// The export toolbar is read-only, but it is wired by id: a rename in the
// markup would silently turn the buttons into dead controls. Assert the ids on
// both entrypoints and that the controller still reaches for the tested
// serializers instead of building its own strings.
for (const page of ["index.html", "bases-loaded.html"]) {
  const html = read(page);
  for (const id of ["export-json", "export-csv", "copy-evidence", "export-note"])
    ok(html.includes(`id="${id}"`), `${page} ships the ${id} control`);
}
const monitorSource = read("assets/js/bases-loaded.js");
for (const id of ["export-json", "export-csv", "copy-evidence"])
  ok(monitorSource.includes(`$("${id}")`), `the monitor wires the ${id} button`);
ok(
  /rules\.historyCSV|rules\.historyJSON/.test(monitorSource) &&
    /rules\.evidenceLine/.test(monitorSource),
  "The export uses the tested serializers, not ad-hoc string building",
);

console.log(`✓ ${checks} static site integrity checks passed`);
