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
# The frontend sits at /app/frontend, not /app: the Coach's runtime-neutral core lives in
# api/coach/core and is imported from frontend/src as ../../../api/coach/core/*, so the two
# have to keep the same relative position they have in the repository. Copying frontend/ alone
# is exactly what made the v1.2.15 web image fail to build.
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* ./
# --ignore-scripts: the web image only needs `vite build`; the one heavy postinstall in this tree
# (@capacitor/assets -> sharp, a libvips download from GitHub) is for drawing app icons and has
# timed out on the shared runners — a lockfile-ignoring `npm install` fallback is no answer to that.
RUN npm ci --ignore-scripts
COPY api/coach/core/ /app/api/coach/core/
COPY frontend/ ./
RUN npm run build

FROM nginx:alpine
# Same reason as in api/Dockerfile: alpine fixes land faster than the nginx image is rebuilt.
RUN apk upgrade --no-cache
ARG VERSION=dev
ARG VCS_REF=dev
ARG BUILD_DATE=unknown

LABEL maintainer="Duarte Santos https://gitlab.com/DuarteSantos8" \
    org.opencontainers.image.title="opengym-web" \
    org.opencontainers.image.description="Frontend for Self-hosted gym & body-weight tracker — plan routines, log workouts (supersets & cardio too), track your weight and progress, passkey login. Your data, your server." \
    org.opencontainers.image.source="https://gitlab.com/DuarteSantos8/opengym" \
    org.opencontainers.image.url="https://gitlab.com/DuarteSantos8/opengym/container_registry" \
    org.opencontainers.image.documentation="https://gitlab.com/DuarteSantos8/opengym#readme" \
    org.opencontainers.image.licenses="AGPL-3.0-or-later" \
    org.opencontainers.image.version=$VERSION \
    org.opencontainers.image.revision=$VCS_REF \
    org.opencontainers.image.created=$BUILD_DATE

COPY web/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/frontend/dist /usr/share/nginx/html
# exercise media (img/gif) is mounted at runtime from the media volume

# Set Default ENVs for nginx
ENV NGINX_PORT=80
ENV BACKEND=api
ENV PORT=3000
# Empty = the CF-Connecting-IP header is dropped before it reaches the API, so it cannot be
# forged by a direct client. Set to $http_cf_connecting_ip only when Cloudflare is really in
# front. Defined here too, not just in compose, so the template always renders for anyone
# running the prebuilt image from their own compose file.
ENV CF_CONNECTING_IP=""

# Probe the port nginx was actually told to listen on (NGINX_PORT is configurable, so a
# hardcoded http://localhost/ breaks on any instance that changed it), and address it as
# 127.0.0.1: envsubst rewrites the conf after the image's IPv6 script, so nginx ends up
# listening on IPv4 only while "localhost" resolves to ::1 first.
HEALTHCHECK --interval=5m \
            --timeout=5s \
            --retries=3 \
            CMD wget --spider -q "http://127.0.0.1:${NGINX_PORT}/" || exit 1

