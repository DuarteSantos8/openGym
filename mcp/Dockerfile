# MCP server (HTTP mode). Serves the same read-only tools over Streamable HTTP so an LLM
# client on a different host can reach the data without sharing the filesystem.
#
# Build:  docker build -t opengym-mcp ./mcp
# Run:    docker run -p 3100:3100 -v ./data:/data -e OPENGYM_UID=<uid> opengym-mcp

FROM node:22-alpine

RUN apk upgrade --no-cache

LABEL maintainer="Duarte Santos https://gitlab.com/DuarteSantos8" \
    org.opencontainers.image.title="opengym-mcp" \
    org.opencontainers.image.description="MCP (Model Context Protocol) server for openGym — read-only access to workout data over HTTP." \
    org.opencontainers.image.source="https://gitlab.com/DuarteSantos8/opengym" \
    org.opencontainers.image.licenses="AGPL-3.0-or-later"

WORKDIR /app

COPY mcp/package.json mcp/package-lock.json* ./
RUN npm ci --omit=dev --omit=optional && npm cache clean --force

# tools.js imports from ../../frontend/src/lib/ — recreate that path in the image so the
# relative imports resolve without modification. Only lib/ is needed; the rest of frontend/
# is React/Vite-specific and not used by the MCP server.
COPY frontend/src/lib/ /frontend/src/lib/
RUN ln -s /frontend /app/frontend

COPY mcp/src/ ./src/

ENV NODE_ENV=production
ENV OPENGYM_HTTP_PORT=3100
EXPOSE 3100

CMD ["node", "src/http.js"]

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD wget --spider -q "http://127.0.0.1:${OPENGYM_HTTP_PORT}/health" || exit 1
