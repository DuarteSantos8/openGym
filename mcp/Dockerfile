FROM node:22-alpine
WORKDIR /app/mcp
COPY mcp/package.json mcp/package-lock.json ./
RUN npm ci --omit=dev
COPY mcp/src ./src
WORKDIR /app
COPY frontend/src/lib ./frontend/src/lib
ENV MCP_PORT=8787
EXPOSE 8787
USER node
CMD ["node", "mcp/src/http.js"]
