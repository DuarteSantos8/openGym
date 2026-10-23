# openGym Claude connector: remote MCP over HTTP with OAuth. Local build only; nothing publishes it.
FROM node:22-alpine

LABEL org.opencontainers.image.title="opengym-connector" \
    org.opencontainers.image.description="Remote MCP connector for openGym (Claude). Talks to the openGym API; holds no user data on disk." \
    org.opencontainers.image.licenses="AGPL-3.0-or-later"

WORKDIR /app

# connector/package.json declares no dependencies, so there is no install step and no node_modules.
# If one is ever added: COPY its lockfile here and install with the lockfile before copying src.
COPY package.json ./
COPY src ./src

ENV NODE_ENV=production \
    CONNECTOR_HOST=0.0.0.0 \
    CONNECTOR_PORT=8787
# 0.0.0.0 is the container's own interface, so the port mapping can reach it. Exposure to the
# host is decided only by compose.yaml, which binds 127.0.0.1. Never `docker run -p 8787:8787`.
EXPOSE 8787

# Non-root, and no volume: grants and connections live in memory, the encryption key in the env.
USER node
CMD ["node", "src/main.js"]

HEALTHCHECK --interval=1m --timeout=5s --retries=3 \
    CMD wget -q -O /dev/null "http://127.0.0.1:${CONNECTOR_PORT}/connector/.well-known/oauth-protected-resource" || exit 1
