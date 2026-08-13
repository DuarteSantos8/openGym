FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force
COPY server.js device-link.js passkeys-store.js ./
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server.js"]
