# Loaded Late watcher — container image.
#
# Build from the REPOSITORY ROOT (the watcher needs assets/js/bases-loaded-core.js,
# and the image deliberately carries the site's rules engine rather than a copy):
#
#   docker build -f deploy/Dockerfile -t loaded-late-watcher .
#   docker run --rm -v loaded-late-data:/data \
#     -e WATCHER_LOG_DIR=/data -e WATCHER_NTFY_TOPIC=my-loaded-late \
#     loaded-late-watcher
#
# There is no build step and no dependency install: the watcher is one file that
# requires Node's own `fetch`, `fs` and `module`.

FROM node:22-alpine

# The whole point of this image is watching games while nobody is looking, so
# keep it small, non-root and deterministic.
ENV NODE_ENV=production \
    WATCHER_LOG_DIR=/data \
    WATCHER_QUIET=1

WORKDIR /app

# Copy only what the watcher actually needs. The image does not need the pages,
# the stylesheets or the other test suites.
COPY tools/watcher.mjs /app/tools/watcher.mjs
COPY deploy/healthcheck.mjs /app/deploy/healthcheck.mjs
COPY assets/js/bases-loaded-core.js /app/assets/js/bases-loaded-core.js
COPY LICENSE /app/LICENSE

# Alert log + dedup state. Mount a volume here or every restart forgets what it
# has already reported (and would re-alert the same situation).
VOLUME ["/data"]
RUN mkdir -p /data && chown -R node:node /data

USER node

# A hung watcher is worse than a stopped one. This check reads the state file the
# watcher rewrites every cycle, so a hung or killed process is reported unhealthy
# instead of pretending everything is fine. It deliberately does not try to prove
# MLB is reachable — see the header of deploy/healthcheck.mjs.
HEALTHCHECK --interval=60s --timeout=10s --start-period=45s --retries=3 \
  CMD node deploy/healthcheck.mjs

CMD ["node", "tools/watcher.mjs"]
