#!/usr/bin/env bash
# Builds the static copy of opengym.ch that Cloudflare serves while the homelab is down.
# Same layout as the nginx site (see website/README.md): website/ + img/ + icons + demo/.
# Output: dist/ (uploaded as the Worker's static assets, cloudflare/wrangler.jsonc)
set -euo pipefail
cd "$(dirname "$0")/.."

rm -rf dist && mkdir -p dist
cp -r website/. dist/
rm -f dist/README.md dist/build-images.sh
cp frontend/public/icon-180.png frontend/public/icon-512.png dist/

# Cloudflare's build image has no ffmpeg: fall back to the static binary from npm
if ! command -v ffmpeg >/dev/null; then
  npm install --no-save --no-package-lock ffmpeg-static
  export PATH="$(dirname "$(node -p "require('ffmpeg-static')")"):$PATH"
fi
bash website/build-images.sh dist/img

# Browser-only demo under /demo/ (same build as the pages job in .gitlab-ci.yml)
(cd frontend && npm ci --ignore-scripts && VITE_DEMO=1 npm run build)
node scripts/catalogue/stage-media.mjs frontend/dist
mv frontend/dist dist/demo

echo "fallback site in dist/: $(find dist -type f | wc -l) files"
