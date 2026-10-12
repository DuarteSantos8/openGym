# The optional video-import worker: reads exercise names and timers off a follow-along video.
#
#   default — ffmpeg, Tesseract and yt-dlp on Alpine, about 500 MB. What compose builds.
#   paddle  — the same worker reading with PaddleOCR instead (much better on stylised fonts),
#             on Debian because Paddle has no musl wheels; about 2 GB.
#   test    — default plus a font and the test suite, for CI:  docker build --target test .
#
# No dependencies from npm: the worker is plain node:http plus three command-line tools.
# Built only when the `video-import` compose profile is on; the api and web images never
# carry any of it.
#
# yt-dlp has to keep up with YouTube, so rebuild this image now and then:
#   docker compose --profile video-import build --pull --no-cache video-import

FROM node:22-alpine AS base
ARG VERSION=dev
ARG VCS_REF=dev
LABEL org.opencontainers.image.title="opengym-video-import" \
    org.opencontainers.image.description="Optional worker for openGym: turns a follow-along workout video into a draft routine (OCR of on-screen names and timers)." \
    org.opencontainers.image.licenses="AGPL-3.0-or-later" \
    org.opencontainers.image.version=$VERSION \
    org.opencontainers.image.revision=$VCS_REF
RUN apk upgrade --no-cache \
 && apk add --no-cache ffmpeg tesseract-ocr tesseract-ocr-data-eng yt-dlp
WORKDIR /app
COPY package.json ./
COPY src ./src
ENV NODE_ENV=production PORT=3100 OCR_ENGINE=tesseract
EXPOSE 3100
USER node
CMD ["node", "src/server.js"]
HEALTHCHECK --interval=5m --timeout=10s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/health" || exit 1

# ---------------------------------------------------------------------------------------------
FROM base AS test
USER root
RUN apk add --no-cache font-dejavu
COPY test ./test
ENV REQUIRE_E2E=1
USER node
CMD ["sh", "-c", "node --test test/*.test.js"]

# ---------------------------------------------------------------------------------------------
FROM node:22-bookworm-slim AS paddle
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg tesseract-ocr tesseract-ocr-eng python3 python3-venv ca-certificates wget libgomp1 libgl1 libglib2.0-0 \
 && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /opt/venv \
 && /opt/venv/bin/pip install --no-cache-dir yt-dlp paddlepaddle==2.6.2 paddleocr==2.8.1 \
 && /opt/venv/bin/python -c "from paddleocr import PaddleOCR; PaddleOCR(use_angle_cls=False, lang='en', show_log=False)"
ENV PATH="/opt/venv/bin:$PATH"
WORKDIR /app
COPY package.json ./
COPY src ./src
ENV NODE_ENV=production PORT=3100 OCR_ENGINE=paddle PADDLEOCR_HOME=/root/.paddleocr
EXPOSE 3100
CMD ["node", "src/server.js"]

# ---------------------------------------------------------------------------------------------
# Last, so a plain `docker build ./video-import` is the slim Tesseract image.
FROM base AS default
