# The MCP server over HTTP, for the opt-in `mcp` service in docker-compose.yml. Built from the
# repository root (`docker build -f mcp/Dockerfile .`): the tools import the training helpers
# under frontend/src/lib, and those have to keep the relative position they have in the repo.
FROM node:22-alpine

ARG VERSION=dev
ARG VCS_REF=dev
ARG BUILD_DATE=unknown

LABEL maintainer="Duarte Santos https://gitlab.com/DuarteSantos8" \
    org.opencontainers.image.title="opengym-mcp" \
    org.opencontainers.image.description="Read-only MCP endpoint for a self-hosted openGym: lets an LLM client read your routines, workouts, body weight, 1RMs and muscle balance." \
    org.opencontainers.image.source="https://gitlab.com/DuarteSantos8/opengym" \
    org.opencontainers.image.url="https://gitlab.com/DuarteSantos8/opengym/container_registry" \
    org.opencontainers.image.documentation="https://gitlab.com/DuarteSantos8/opengym/-/blob/main/mcp/README.md" \
    org.opencontainers.image.licenses="AGPL-3.0-or-later" \
    org.opencontainers.image.version=$VERSION \
    org.opencontainers.image.revision=$VCS_REF \
    org.opencontainers.image.created=$BUILD_DATE

# Same reason as in api/Dockerfile: alpine fixes land faster than the node image is rebuilt.
RUN apk upgrade --no-cache

WORKDIR /app/mcp
COPY mcp/package.json mcp/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
COPY mcp/src ./src
# package.json for its "type": "module", which is what makes node read lib/*.js as ESM.
COPY frontend/package.json /app/frontend/
COPY frontend/src/lib /app/frontend/src/lib

# Runs as root on purpose: the api writes db.json and the state files 0600 as root, so no other
# uid can read them. compose mounts ./data read-only, which is the control that matters here.
ENV NODE_ENV=production
ENV OPENGYM_DATA=/data
ENV MCP_PORT=3001
EXPOSE 3001
CMD ["node", "src/http.js"]
