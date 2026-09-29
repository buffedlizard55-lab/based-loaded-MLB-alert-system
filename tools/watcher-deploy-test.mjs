#!/usr/bin/env node
/* Deployment-recipe checks for the always-on watcher.
 *
 * The recipes in deploy/ are the difference between "there is a watcher" and
 * "the watcher is actually running somewhere". They are text files that nothing
 * else would notice going stale, so they are checked against the watcher itself:
 * every variable the watcher reads must appear in the template, the unit files
 * must be able to find tools/watcher.mjs, state must survive a restart, and no
 * real secret may be committed in a template.
 *
 * These are structural checks, not a container build (Docker is not available
 * here); where a claim can be executed — the healthcheck exit codes — it is
 * executed rather than pattern-matched.
 *
 * Run: node tools/watcher-deploy-test.mjs
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (file) => readFileSync(join(root, file), "utf8");
const exists = (file) => existsSync(join(root, file));

let checks = 0;
const check = (actual, expected, label) => {
  assert.deepEqual(actual, expected, label);
  checks += 1;
};
const ok = (condition, label) => {
  assert.ok(condition, label);
  checks += 1;
};

const watcher = read("tools/watcher.mjs");

/* --------------------------------------- every setting the watcher reads --- */

// The source is the specification: any WATCHER_* the watcher reads must be
// documented, or someone will deploy a watcher that silently ignores a setting
// they thought they configured.
const watcherVars = [...new Set([...watcher.matchAll(/env\.(WATCHER_[A-Z_]+)/g)].map((m) => m[1]))];
ok(watcherVars.length >= 8, `The watcher reads ${watcherVars.length} environment variables`);

const envTemplate = read("deploy/loaded-late-watcher.env.example");
for (const name of watcherVars) {
  ok(envTemplate.includes(name), `deploy/loaded-late-watcher.env.example documents ${name}`);
}

// …and nothing is invented: a variable in the template that the watcher never
// reads is a footgun (it does nothing, and looks like it should).
const templateVars = [...new Set([...envTemplate.matchAll(/^(WATCHER_[A-Z_]+)=/gm)].map((m) => m[1]))];
for (const name of templateVars) {
  ok(watcherVars.includes(name), `${name} in the template is a variable the watcher actually reads`);
}

/* ------------------------------------------------- nothing secret, ever --- */

// A template that ships a real topic or webhook URL would leak delivery to
// whoever reads the repository. Empty or obvious placeholder only.
for (const [name, pattern] of [
  ["WATCHER_WEBHOOK_URL", /^WATCHER_WEBHOOK_URL=(.*)$/m],
  ["WATCHER_NTFY_TOPIC", /^WATCHER_NTFY_TOPIC=(.*)$/m],
]) {
  const value = (envTemplate.match(pattern) || [, ""])[1].trim();
  check(value, "", `${name} ships empty in the template (never a live secret)`);
}
const commentedValues = (envTemplate.match(/=\S+/g) || []).length;
const realValues = (envTemplate.match(/^[A-Z_]+=\S+/gm) || []).length;
ok(
  realValues <= templateVars.filter((name) => !/WEBHOOK|NTFY_TOPIC/.test(name)).length,
  `Only non-secret settings carry values (${commentedValues} assignments, ${realValues} with a value)`,
);
ok(
  !/(sk-|xox[baprs]-|ghp_|AKIA[0-9A-Z]{16})/.test(envTemplate),
  "No credential-shaped string appears anywhere in the template",
);

/* ------------------------------------------------------ systemd unit ------- */

const unit = read("deploy/loaded-late-watcher.service");
for (const [directive, pattern] of [
  ["a description", /^Description=\S.+$/m],
  ["a Documentation URL", /^Documentation=https:\/\//m],
  ["network-online ordering", /^After=network-online\.target$/m],
  ["a WorkingDirectory", /^WorkingDirectory=\/\S+$/m],
  ["ExecStart", /^ExecStart=\/usr\/bin\/env node tools\/watcher\.mjs$/m],
  ["an EnvironmentFile", /^EnvironmentFile=-?\/etc\/loaded-late\/watcher\.env$/m],
  ["a restart policy", /^Restart=always$/m],
  ["a restart delay", /^RestartSec=\d+$/m],
  ["journal logging", /^StandardOutput=journal$/m],
  ["a non-root user", /^User=\S+$/m],
  ["install target", /^WantedBy=multi-user\.target$/m],
]) {
  ok(pattern.test(unit), `The systemd unit declares ${directive}`);
}
ok(
  !/^User=root$/m.test(unit),
  "The unit does not run the watcher as root",
);
ok(
  !/WATCHER_ONCE/.test(unit) && !/^Type=oneshot$/m.test(unit),
  "The unit runs continuously (WATCHER_ONCE belongs to cron, not to a service)",
);
for (const section of ["[Unit]", "[Service]", "[Install]"]) {
  ok(unit.includes(section), `The unit has its ${section} section`);
}
// The unit points at the same env file the template tells people to create.
ok(
  unit.includes("/etc/loaded-late/watcher.env") &&
    envTemplate.includes("/etc/loaded-late/watcher.env"),
  "The unit and the template agree on where the environment file lives",
);
// WorkingDirectory is what makes the relative ExecStart work.
ok(
  exists("tools/watcher.mjs") && exists("assets/js/bases-loaded-core.js"),
  "The paths the unit relies on exist in this repository",
);
ok(
  /^WorkingDirectory=/m.test(unit) && !/^WorkingDirectory=\/$/m.test(unit),
  "WorkingDirectory is a real directory, not /",
);

/* ------------------------------------------------------------ Docker ------- */

const dockerfile = read("deploy/Dockerfile");
ok(/^FROM node:(\d+)/m.test(dockerfile), "The image builds on an official Node image");
const nodeMajor = Number((dockerfile.match(/^FROM node:(\d+)/m) || [, "0"])[1]);
ok(nodeMajor >= 18, `The image uses Node ${nodeMajor} (the watcher needs global fetch, Node 18+)`);
ok(/^USER node$/m.test(dockerfile), "The container runs as the unprivileged node user");
ok(!/^USER root$/m.test(dockerfile), "The container never runs as root");
ok(
  dockerfile.includes("COPY tools/watcher.mjs") &&
    dockerfile.includes("COPY assets/js/bases-loaded-core.js"),
  "The image carries the watcher AND the site's rules engine it requires",
);
ok(
  !/COPY \.\s/.test(dockerfile),
  "The image copies an explicit file list, not the whole repository",
);
ok(/^VOLUME \["\/data"\]$/m.test(dockerfile), "The data directory is a volume");
ok(
  /WATCHER_LOG_DIR=\/data/.test(dockerfile),
  "The container's log/state directory matches the volume (state survives restarts)",
);
ok(/HEALTHCHECK/.test(dockerfile) && dockerfile.includes("deploy/healthcheck.mjs"),
  "The healthcheck runs the real check, not a script that always passes");
ok(/^CMD \["node", "tools\/watcher\.mjs"\]$/m.test(dockerfile),
  "The container's default command is the watcher");
ok(dockerfile.includes("docker build -f deploy/Dockerfile"), "The image documents its build command");

/* ---------------------------------------------- compose (persistence) ------ */

const compose = read("deploy/docker-compose.yml");
ok(/^services:/m.test(compose), "The compose file declares services");
ok(/^ {2}watcher:$/m.test(compose), "…including the watcher service");
ok(/restart: unless-stopped/.test(compose), "Compose restarts the watcher if it dies or the host reboots");
ok(/env_file:/.test(compose) && /required: false/.test(compose),
  "The environment file is optional, so the watcher still runs without one");
ok(/^ {6}context: \.\.$/m.test(compose), "The build context is the repository root (…/assets/js is required)");
ok(/watcher-data:\/data/.test(compose), "A named volume holds the state and alert log");
ok(/^volumes:/m.test(compose) && /^ {2}watcher-data:$/m.test(compose),
  "…and that volume is declared, not just referenced");
ok(!/^\s+WATCHER_(WEBHOOK_URL|NTFY_TOPIC):\s*\S/m.test(compose),
  "No delivery secret is committed in the compose file");
ok(/read_only: true/.test(compose), "The container filesystem is read-only");
ok(/no-new-privileges/.test(compose), "Privilege escalation is disabled");

/* ------------------------------------------------------------ launchd ------ */

const plist = read("deploy/com.loadedlate.watcher.plist");
ok(plist.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), "The plist starts with an XML declaration");
ok(plist.includes('<!DOCTYPE plist PUBLIC'), "The plist declares the Apple DTD");
ok(plist.includes('<plist version="1.0">') && plist.trimEnd().endsWith("</plist>"),
  "The plist has one plist root element");

// Tag balance, ignoring comments and the self-contained declarations.
const xmlBody = plist
  .replace(/<\?xml[^>]*\?>/g, "")
  .replace(/<!DOCTYPE[^>]*>/g, "")
  .replace(/<!--[\s\S]*?-->/g, "");
const opened = (xmlBody.match(/<(?!\/)([a-zA-Z]+)(?=[\s>])/g) || []).map((tag) => tag.slice(1));
const closed = (xmlBody.match(/<\/([a-zA-Z]+)>/g) || []).map((tag) => tag.slice(2, -1));
check(opened.length, closed.length, "Every plist element is closed");
check(
  [...opened].sort().join(","),
  [...closed].sort().join(","),
  "The plist tags balance (no half-written recipe)",
);
for (const [key, pattern] of [
  ["Label", /<key>Label<\/key>\s*<string>com\.loadedlate\.watcher<\/string>/],
  ["ProgramArguments", /<key>ProgramArguments<\/key>\s*<array>[\s\S]*?node[\s\S]*?tools\/watcher\.mjs[\s\S]*?<\/array>/],
  ["WorkingDirectory", /<key>WorkingDirectory<\/key>\s*<string>\/\S+<\/string>/],
  ["RunAtLoad", /<key>RunAtLoad<\/key>\s*<true\/>/],
  ["KeepAlive", /<key>KeepAlive<\/key>\s*<true\/>/],
  ["StandardOutPath", /<key>StandardOutPath<\/key>\s*<string>\/\S+\.log<\/string>/],
]) {
  ok(pattern.test(plist), `The launchd recipe declares ${key}`);
}
// Checked against the comment-stripped body: the plist documents how to add a
// channel inside an XML comment, and documentation is not configuration.
ok(
  !/<key>WATCHER_(WEBHOOK_URL|NTFY_TOPIC)<\/key>\s*<string>\S+<\/string>/.test(xmlBody),
  "The launchd recipe ships no live delivery secret (comments excluded)",
);
ok(/launchctl load/.test(plist), "The launchd recipe says how to install it");

/* ------------------------------------------------------ docker context ----- */

const dockerignore = read(".dockerignore");
for (const entry of [".git", "node_modules", "data"]) {
  ok(
    dockerignore.split("\n").some((line) => line.trim().replace(/\/$/, "") === entry),
    `.dockerignore excludes ${entry} from the build context`,
  );
}

/* --------------------------------------------- the healthcheck, executed --- */

const healthDir = mkdtempSync(join(tmpdir(), "loaded-late-health-"));
const stateFile = join(healthDir, "watcher-state.json");
const runHealth = (env) => {
  try {
    const output = execFileSync("node", [join(root, "deploy/healthcheck.mjs")], {
      env: { ...process.env, WATCHER_STATE_FILE: stateFile, ...env },
      encoding: "utf8",
    });
    return { code: 0, output };
  } catch (error) {
    return { code: error.status ?? 1, output: `${error.stdout || ""}${error.stderr || ""}` };
  }
};

// 1. No state file at all: the watcher has never completed a cycle.
const missing = runHealth({});
check(missing.code, 1, "A missing state file is unhealthy (the watcher never ran)");
ok(/unreadable|ENOENT/.test(missing.output), "…and the reason names the missing file");

// 2. A fresh state file: a cycle completed recently.
writeFileSync(stateFile, JSON.stringify({ states: {} }));
const fresh = runHealth({});
check(fresh.code, 0, "A freshly written state file is healthy");
ok(/healthy/.test(fresh.output), "…and says so");

// 3. A stale state file: the process is hung or gone.
const longAgo = Date.now() / 1000 - 600;
utimesSync(stateFile, longAgo, longAgo);
const stale = runHealth({ HEALTH_MAX_AGE_MS: "60000" });
check(stale.code, 1, "A state file older than the limit is unhealthy");
ok(stale.output.includes("600s old"), "…and the reason states the measured age");

// 4. The limit is configurable, and its default is generous enough not to flap.
const tolerated = runHealth({ HEALTH_MAX_AGE_MS: "900000" });
check(tolerated.code, 0, "A larger age limit tolerates the same file");
ok(
  /300_000|300000/.test(read("deploy/healthcheck.mjs")),
  "The default limit is five minutes (long enough to survive a slow cycle)",
);

/* -------------------------------------------------------------- docs ------- */

const docs = read("docs/watcher-deployment.md");
for (const file of [
  "deploy/loaded-late-watcher.service",
  "deploy/loaded-late-watcher.env.example",
  "deploy/Dockerfile",
  "deploy/docker-compose.yml",
  "deploy/com.loadedlate.watcher.plist",
  "deploy/healthcheck.mjs",
]) {
  ok(docs.includes(file), `docs/watcher-deployment.md walks through ${file}`);
  ok(exists(file), `${file} exists`);
}
ok(/systemctl (enable|start)/.test(docs), "The doc shows the systemctl steps, not just the file");
ok(/docker compose/.test(docs), "The doc shows the compose steps");
ok(/launchctl/.test(docs), "The doc shows the launchctl steps");
ok(
  /WATCHER_ONCE=1/.test(docs) && /cron|systemd timer|Timer/.test(docs),
  "The doc covers the one-shot scheduler route as well",
);
ok(
  /survive|persist|restart/i.test(docs) && /state/i.test(docs),
  "The doc explains why state must persist (or a restart re-alerts)",
);
ok(
  /not claimed|cannot prove|does not prove|honest/i.test(docs),
  "The doc states what the healthcheck and recipes do not prove",
);
ok(
  /journalctl|docker compose logs|logs/.test(docs),
  "The doc says where alerts show up after deploying",
);
// The README and the sources page must point at the deployment doc, or nobody
// deploying this will find it.
ok(read("README.md").includes("docs/watcher-deployment.md"),
  "The README links the deployment guide");
ok(read("verification.html").includes("watcher-deployment.md"),
  "The sources page links the deployment guide");

console.log(`✓ ${checks} watcher deployment checks passed`);
