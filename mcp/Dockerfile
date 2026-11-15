# The optional MCP-over-HTTPS container (docs/MCP_REMOTE.md): mcp/src/http.js on port 3100,
# proxied at /mcp by the web container. Built from the repository root, because the tools run
# the app's own training helpers (frontend/src/lib) the way the stdio server does:
#
#   docker build -f mcp/Dockerfile .
#   or through compose:  COMPOSE_PROFILES=mcp docker compose up -d --build
#
# It holds no data and no secret: no ./data mount, no SECRET. Every request carries a scoped
# token, and every read and write goes through the api with it.
FROM node:22.23.4-alpine

ARG VERSION=dev
ARG VCS_REF=dev
ARG BUILD_DATE=unknown
LABEL maintainer="Duarte Santos https://github.com/DuarteSantos8" \
    org.opencontainers.image.title="opengym-mcp" \
    org.opencontainers.image.description="Optional MCP server for openGym over HTTPS: lets an AI assistant read and, if you allow it, change your training plan and log, with a scoped token you make in Settings." \
    org.opencontainers.image.source="https://github.com/DuarteSantos8/openGym" \
    org.opencontainers.image.url="https://opengym.ch" \
    org.opencontainers.image.documentation="https://github.com/DuarteSantos8/openGym/blob/main/docs/MCP_REMOTE.md" \
    org.opencontainers.image.licenses="AGPL-3.0-or-later" \
    org.opencontainers.image.version=$VERSION \
    org.opencontainers.image.revision=$VCS_REF \
    org.opencontainers.image.created=$BUILD_DATE

RUN apk upgrade --no-cache
WORKDIR /app/mcp
COPY mcp/package.json mcp/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

# The helpers the tools import, and the one api module they reach (the streak rules), each
# beside its package.json so node reads them as the ES modules they are.
COPY frontend/package.json /app/frontend/package.json
COPY frontend/src/lib/ /app/frontend/src/lib/
COPY api/package.json /app/api/package.json
COPY api/coach/core/ /app/api/coach/core/
COPY mcp/src/ ./src/

ENV NODE_ENV=production
ENV MCP_PORT=3100
ENV OPENGYM_API_URL=http://api:3000
EXPOSE 3100
USER node
CMD ["node", "src/http.js"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --spider -q "http://127.0.0.1:${MCP_PORT}/mcp/health" || exit 1
