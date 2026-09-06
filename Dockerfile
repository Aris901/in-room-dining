# syntax=docker/dockerfile:1
#
# In-Room Dining — production image.
#
# Every host worth using for this (Northflank, Koyeb, Fly, Railway, Render)
# accepts a Dockerfile, so this is the portable unit rather than tying the
# project to one platform's buildpack.
#
# The one real complication is better-sqlite3: it is a native module. It ships
# prebuilt binaries for common platforms, but when the prebuild misses it
# compiles from source, which needs a toolchain. The build stage carries that
# toolchain; the runtime stage does not, so the shipped image stays small and
# has no compiler in it.

# ---- build ---------------------------------------------------------------
FROM node:22-bookworm-slim AS build

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 \
      make \
      g++ \
      ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Copy manifests first so `npm ci` is cached until dependencies change.
COPY package.json package-lock.json ./

# --omit=dev: the test runner is Node's built-in, nothing dev-only ships.
RUN npm ci --omit=dev

COPY . .

# Fail the build rather than the deploy if the native module did not link.
RUN node -e "require('better-sqlite3'); console.log('better-sqlite3 loads OK')"

# ---- runtime -------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/data/dining.db

WORKDIR /app

# tini reaps zombies and forwards SIGTERM, so container stops are clean.
RUN apt-get update && apt-get install -y --no-install-recommends \
      tini \
      ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /data \
 && chown -R node:node /data

COPY --from=build --chown=node:node /app /app

# The mount point for the persistent volume. SQLite is a file: without a real
# disk here the database is wiped on every redeploy.
VOLUME ["/data"]

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>{if(!r.ok)throw 0}).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "scripts/start-production.js"]
