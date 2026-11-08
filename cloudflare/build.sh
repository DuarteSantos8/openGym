#!/bin/sh
# Builds what wrangler.toml deploys: run from the repo root or from cloudflare/.
set -e
cd "$(dirname "$0")/.."
(cd api && npm ci --ignore-scripts --omit=optional)
(cd frontend && npm ci --ignore-scripts && npm run build)
rm -rf cloudflare/dist
cp -R frontend/dist cloudflare/dist
cp -R catalogue/media cloudflare/dist/exercise-media
cp cloudflare/_headers cloudflare/dist/_headers
