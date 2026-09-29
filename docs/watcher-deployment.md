# Running the watcher — deployment guide

`tools/watcher.mjs` is the always-on half of Loaded Late: the same rules engine the page uses,
running without a browser so the tied / bases-loaded / bottom-9+ situation is caught while every
tab is closed. **It still needs somewhere to run.** This guide is the "somewhere": pick one
recipe, deploy it, and know how to tell whether it is working.

Everything here is a plain text file in [`deploy/`](../deploy/) — nothing is hosted for you, and
no step requires editing the code.

| Recipe | File | Best for |
| --- | --- | --- |
| systemd service | [`deploy/loaded-late-watcher.service`](../deploy/loaded-late-watcher.service) | a Linux box, VPS or Raspberry Pi that stays on |
| Docker / compose | [`deploy/Dockerfile`](../deploy/Dockerfile), [`deploy/docker-compose.yml`](../deploy/docker-compose.yml) | any host with Docker, or a home server |
| launchd agent | [`deploy/com.loadedlate.watcher.plist`](../deploy/com.loadedlate.watcher.plist) | a Mac you keep awake |
| one-shot scheduler | `WATCHER_ONCE=1` + cron / a systemd timer | a machine that should not hold a process open |

All four read the same settings; the template is
[`deploy/loaded-late-watcher.env.example`](../deploy/loaded-late-watcher.env.example), and
`tools/watcher-deploy-test.mjs` fails if it ever stops documenting a variable the watcher reads.

---

## 1. systemd (Linux, recommended)

```bash
sudo useradd --system --home /opt/loaded-late --shell /usr/sbin/nologin loaded-late
sudo git clone https://github.com/buffedlizard55-lab/based-loaded-MLB-alert-system.git /opt/loaded-late
sudo mkdir -p /etc/loaded-late /var/lib/loaded-late
sudo cp /opt/loaded-late/deploy/loaded-late-watcher.env.example /etc/loaded-late/watcher.env
sudo nano /etc/loaded-late/watcher.env        # set the log dir + a push channel
sudo chown -R loaded-late:loaded-late /var/lib/loaded-late

sudo cp /opt/loaded-late/deploy/loaded-late-watcher.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now loaded-late-watcher
```

Read the alerts — they go to the journal:

```bash
journalctl -u loaded-late-watcher -f
```

The unit sets `EnvironmentFile=-/etc/loaded-late/watcher.env` (the `-` makes it optional, so the
service still runs with no configuration at all), `Restart=always`, and a `WorkingDirectory` of
`/opt/loaded-late` — the watcher loads `assets/js/bases-loaded-core.js` **by relative path**, so
that working directory is what lets it find the site's rules engine. It runs as the unprivileged
`loaded-late` account, never as root.

## 2. Docker / compose

```bash
git clone https://github.com/buffedlizard55-lab/based-loaded-MLB-alert-system.git
cd based-loaded-MLB-alert-system
cp deploy/loaded-late-watcher.env.example deploy/.env    # optional; edit to add a push channel
docker compose -f deploy/docker-compose.yml up -d
docker compose -f deploy/docker-compose.yml logs -f
```

The build context is the **repository root** on purpose: the image copies
`tools/watcher.mjs` *and* `assets/js/bases-loaded-core.js`, because the watcher requires the site's
own rules engine rather than a copy of it. The image runs as the unprivileged `node` user, mounts a
named volume at `/data`, and sets `WATCHER_LOG_DIR=/data` so the alert log and dedup state live on
that volume.

`.dockerignore` keeps `.git`, `node_modules` and the local `data/` out of the build context.

## 3. launchd (macOS)

```bash
cp deploy/com.loadedlate.watcher.plist ~/Library/LaunchAgents/
# edit WorkingDirectory and WATCHER_LOG_DIR inside the copy to real absolute paths
launchctl load ~/Library/LaunchAgents/com.loadedlate.watcher.plist
launchctl list | grep loadedlate
```

A laptop that sleeps stops watching while it sleeps. For a genuinely always-on watch, use
systemd or Docker on a machine that stays up.

## 4. One-shot runs (cron, systemd timer, Task Scheduler)

`WATCHER_ONCE=1` runs exactly one discovery + snapshot cycle and exits:

```cron
* * * * * cd /opt/loaded-late && WATCHER_ONCE=1 WATCHER_LOG_DIR=/var/lib/loaded-late \
  /usr/bin/node tools/watcher.mjs >> /var/log/loaded-late.log 2>&1
```

A minute-by-minute cron is **coarser than the service** (the watcher polls every 2 s in a late
inning), so it can miss a situation that appears and clears between runs. It is the right choice
when you cannot hold a process open, not the best choice overall. The state file makes it safe:
a restart — or the next cron run — never re-alerts a situation you have already seen.

---

## Where the alerts appear

| Channel | How to read it |
| --- | --- |
| stdout | `journalctl -u loaded-late-watcher -f` · `docker compose logs -f` · the cron log |
| JSONL log | `data/watcher-alerts.jsonl` (`WATCHER_LOG_DIR`), one JSON record per line |
| phone push | `WATCHER_NTFY_TOPIC` (ntfy app) or `WATCHER_WEBHOOK_URL` (any HTTPS endpoint accepting `{"text", "alert"}`) |

Each record and each push carries the exact official snapshot URL the alert was read from, plus
the official `mlb.com/gameday/<gamePk>` page. Nothing is ever reported as delivered when it was
not: a failed channel is logged with its reason.

## Knowing it is working — and what that does not prove

[`deploy/healthcheck.mjs`](../deploy/healthcheck.mjs) is the container healthcheck (Docker runs it
automatically; you can run it by hand any time):

```bash
WATCHER_LOG_DIR=/var/lib/loaded-late node deploy/healthcheck.mjs
# healthy: /var/lib/loaded-late/watcher-state.json updated within 300s
```

- **What it proves:** the process is alive and *completing cycles* — every cycle rewrites the state
  file, so a missing or stale file means the watcher is hung, was killed, or never started.
- **What it does not prove:** that MLB's API is reachable. An upstream outage still lets cycles
  finish (the watcher prints `schedule unavailable … will retry` and keeps going) — that line, not
  the exit code, is where an outage is visible. This guide will not claim otherwise.

For a service deployment, "no alerts" is not the same as "no situation": confirm the watcher is
running *and* completing cycles (`journalctl` shows a `watched N/M games` line each cycle unless
`WATCHER_QUIET=1` is set) before trusting the silence.

## Resource use

One process, no dependencies, no inbound ports, and the same self-imposed limits as the pages:
schedule discovery every 15 s, a coherent official snapshot every 2 s per live 9th-inning-or-later
game, at most four requests in flight, and a documented HTTP-429 backoff. A small VPS, a Raspberry
Pi or a sleeping-laptop-that-runs-while-awake all cope; the nightly CI job checks that the upstream
payload still matches these parsers.
