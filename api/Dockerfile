FROM node:22-alpine

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
COPY api/package.json api/package-lock.json* ./api/
WORKDIR /app/api
RUN npm install --omit=dev && npm cache clean --force
WORKDIR /app
COPY api/server.js api/push-messages.js api/verify-error.js api/storage.js ./api/
# The API validates routine exercise ids and serves the same catalogue as the frontend. Keep the
# generated data file in the image but never mount profile data into any other service.
COPY frontend/src/lib/exercises-data.js ./frontend/src/lib/exercises-data.js

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000
CMD ["node", "api/server.js"]

HEALTHCHECK --interval=5m \
            --timeout=5s \
            --retries=3 \
            CMD wget --spider -q "http://127.0.0.1:${PORT}/api/health" || exit 1
