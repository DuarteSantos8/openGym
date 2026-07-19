#!/usr/bin/env bash
# Manually download the exercise images (JPG) and animations (GIF).
# You normally DON'T need this — `docker compose up` fetches them automatically.
# Use it only if you run the app without Docker. Source: hasaneyldrm/exercises-dataset (CC).
set -euo pipefail
cd "$(dirname "$0")/.."
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
git clone --depth 1 https://github.com/hasaneyldrm/exercises-dataset "$tmp"
mkdir -p app/img app/gif
cp "$tmp"/images/*.jpg app/img/
cp "$tmp"/videos/*.gif app/gif/
echo "✓ $(ls app/img | wc -l) images, $(ls app/gif | wc -l) GIFs"
