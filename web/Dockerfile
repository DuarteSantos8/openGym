# Multi-stage: build the React app, then serve it with nginx.
# Self-hosters never need Node locally — `docker compose up` builds everything.
#
# --platform=$BUILDPLATFORM pins the build stage to the host's native arch even when
# cross-building for other targets (e.g. amd64 host building an arm64 image). The build
# output (static JS/CSS/HTML) is arch-independent, so there's no reason to run it under
# QEMU — and QEMU-emulated npm installs are known to corrupt esbuild/rollup's platform-
# specific native binaries, which is what breaks `vite build` with unrelated-looking
# module-resolution errors.
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci 2>/dev/null || npm install
COPY frontend/ ./
RUN npm run build

FROM nginx:alpine
ARG VERSION=dev
ARG VCS_REF=dev
ARG BUILD_DATE=unknown

LABEL maintainer="Duarte Santos https://gitea.com/DuarteSantos" \
    org.opencontainers.image.title="opengym-web" \
    org.opencontainers.image.description="Frontend for Self-hosted gym & body-weight tracker — plan routines, log workouts (supersets & cardio too), track your weight and progress, passkey login. Your data, your server." \
    org.opencontainers.image.source="https://gitea.com/DuarteSantos/openGym" \
    org.opencontainers.image.url="https://gitea.com/DuarteSantos/-/packages/container/opengym-web" \
    org.opencontainers.image.documentation="https://gitea.com/DuarteSantos/openGym#readme" \
    org.opencontainers.image.licenses="AGPL-3.0-or-later" \
    org.opencontainers.image.version=$VERSION \
    org.opencontainers.image.revision=$VCS_REF \
    org.opencontainers.image.created=$BUILD_DATE

COPY web/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --chmod=555 web/35-assets-download.sh /docker-entrypoint.d/35-assets-download.sh
COPY --from=build /app/dist /usr/share/nginx/html
# exercise media (img/gif) is mounted at runtime from the media volume. But needs to be created prior
RUN mkdir /usr/share/nginx/html/img /usr/share/nginx/html/gif

# Set Default ENVs for nginx
ENV NGINX_PORT=80
ENV BACKEND=api
ENV PORT=3000

# Probe the port nginx was actually told to listen on (NGINX_PORT is configurable, so a
# hardcoded http://localhost/ breaks on any instance that changed it), and address it as
# 127.0.0.1: envsubst rewrites the conf after the image's IPv6 script, so nginx ends up
# listening on IPv4 only while "localhost" resolves to ::1 first.
HEALTHCHECK --interval=5m \
            --timeout=5s \
            --retries=3 \
            CMD wget --spider -q "http://127.0.0.1:${NGINX_PORT}/" || exit 1

