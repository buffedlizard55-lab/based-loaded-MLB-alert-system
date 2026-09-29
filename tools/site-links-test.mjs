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

for (const page of ["index.html", "bases-loaded.html", "verification.html"]) {
  const html = read(page);
  ok(
    !/<input|<textarea|<form|contenteditable/i.test(html),
    `${page} has no manual data entry`,
  );
}
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
  /static site by ([\d,]+) checks/,
);
ok(
  readmeCount !== null && pageCount !== null,
  "Both the README and the sources page state the size of this suite",
);
check(
  pageCount,
  readmeCount,
  "The README and the sources page quote the same suite size",
);
if (readmeCount !== null && readmeCount !== checks)
  console.log(
    `  note: the docs quote ${readmeCount} site checks; this run performs ${checks}.`,
  );

console.log(`✓ ${checks} static site integrity checks passed`);
