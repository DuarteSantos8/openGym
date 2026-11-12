# The routines service (server.mjs): submissions, Telegram moderation, copy counts. Build context
# is a folder holding scripts/routines/lib.mjs, scripts/routines/service/server.mjs and the
# catalogue-lite.json that `node scripts/routines/build.mjs --lite` writes (see README.md here).
FROM node:22-alpine
# cwebp re-encodes cover photos; it writes no metadata unless asked to.
RUN apk add --no-cache libwebp-tools
WORKDIR /app
COPY scripts/routines/lib.mjs scripts/routines/lib.mjs
COPY scripts/routines/service/server.mjs scripts/routines/service/server.mjs
COPY catalogue-lite.json catalogue-lite.json
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data CATALOGUE=/app/catalogue-lite.json
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8080
HEALTHCHECK --interval=60s --timeout=5s CMD wget -qO- "http://127.0.0.1:8080${SITE_BASE:-/routines/}api/health" >/dev/null || exit 1
CMD ["node", "scripts/routines/service/server.mjs"]
