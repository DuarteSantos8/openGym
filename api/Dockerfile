# Two targets from one file.
#
#   default (built when no --target is given) — what every instance has always got. No AI
#           runtime, no AI dependency: `npm ci --omit=optional` skips the Agent SDK and its
#           platform runtime entirely, so an owner who never wanted the Coach carries none of it.
#   coach                                     — the same image plus the Claude Agent SDK.
#
# Build the opt-in one with:  docker build --target coach ./api
# or through compose with:    API_TARGET=coach docker compose up --build
#
# The stage order matters: Docker builds the *last* stage when none is named, so `default` is
# deliberately last and `coach` sits above it.

FROM node:22-alpine AS base

# Declared on the base stage so both targets inherit the labels and the healthcheck.
ARG VERSION=dev
ARG VCS_REF=dev
ARG BUILD_DATE=unknown

LABEL maintainer="Duarte Santos https://gitlab.com/DuarteSantos8" \
    org.opencontainers.image.title="opengym-api" \
    org.opencontainers.image.description="Backend for Self-hosted gym & body-weight tracker — plan routines, log workouts (supersets & cardio too), track your weight and progress, passkey login. Your data, your server." \
    org.opencontainers.image.source="https://gitlab.com/DuarteSantos8/opengym" \
    org.opencontainers.image.url="https://gitlab.com/DuarteSantos8/opengym/container_registry" \
    org.opencontainers.image.documentation="https://gitlab.com/DuarteSantos8/opengym#readme" \
    org.opencontainers.image.licenses="AGPL-3.0-or-later" \
    org.opencontainers.image.version=$VERSION \
    org.opencontainers.image.revision=$VCS_REF \
    org.opencontainers.image.created=$BUILD_DATE

WORKDIR /app

# The base image is rebuilt on node's schedule, not alpine's: between two node releases the
# alpine packages it ships (openssl above all) fall behind their fixes. Taking the upgrades at
# build time keeps the published image at alpine's current state without waiting for node.
RUN apk upgrade --no-cache

# The unprivileged user Coach jobs drop to. Its uid cannot read /data, which is the control that
# keeps a provider runtime away from users, passkeys and the session secret.
#
# Not optional, and not only for the real providers: canDropPrivileges() fails closed on Linux,
# so in an image without this user *every* job is refused with "no `coach` user exists in this
# image" — including the fixture provider that exists precisely so the loop can be walked before
# an account is connected. It costs one line and no bytes worth measuring.
RUN adduser -D -H -s /sbin/nologin coach

COPY package.json package-lock.json* ./
# `npm ci` rather than `npm install`: the lockfile is the point of committing one, and the SDK's
# per-platform runtime is resolved from it (musl on this base) rather than from whatever the
# build host happened to be.
RUN npm ci --omit=dev --omit=optional && npm cache clean --force

COPY server.js push-messages.js verify-error.js ./
COPY coach ./coach
COPY social ./social
COPY training ./training
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
CMD ["node", "server.js"]

HEALTHCHECK --interval=5m \
            --timeout=5s \
            --retries=3 \
            CMD wget --spider -q "http://127.0.0.1:${PORT}/api/health" || exit 1

# ---------------------------------------------------------------------------------------------
# The opt-in target. Dropping --omit=optional is the whole difference: it pulls in
# @anthropic-ai/claude-agent-sdk together with the one platform runtime this base needs
# (linux-*-musl), both pinned by the lockfile.
FROM base AS coach
RUN npm ci --omit=dev && npm cache clean --force

# Codex ships as a CLI rather than a library, so it is installed rather than resolved, and
# bubblewrap is its sandbox — a Codex requirement, which is why neither appears in the default
# target or anywhere in this tree until now.
RUN apk add --no-cache bubblewrap \
 && npm install -g @openai/codex \
 && npm cache clean --force

# Where Codex keeps its refreshable login cache. Deliberately a sibling of /data rather than a
# path inside it: docs/SELF_HOSTING tells owners to back up with `tar czf … data/`, and a live
# refresh token has no business riding along in every archive that instruction produces. Owned
# by `coach` because the job that writes it has already dropped to that user.
RUN mkdir -p /coach-auth && chown coach:coach /coach-auth && chmod 700 /coach-auth
VOLUME ["/coach-auth"]

# ---------------------------------------------------------------------------------------------
# Last, so that a plain `docker build ./api` keeps producing the runtime-free image.
FROM base AS default
# npm itself is only a build-time tool here: the server is started with `node server.js` and
# nothing in it spawns npm. Its bundled dependency tree (tar, brace-expansion, ...) is where
# every vulnerability the image scan ever reported lived — none of them was in a package the
# app uses. Gone from the published image; the coach target keeps npm for the Codex CLI.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
