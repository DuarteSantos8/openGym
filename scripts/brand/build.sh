#!/usr/bin/env bash
# Rebuilds opengym.ch/brand: logo SVGs, PNGs, banners, brand guide PDF, previews and the ZIP.
#   CHROME=/path/to/chrome ROBOTO=/path/to/Roboto.ttf PUPPETEER_FROM=/dir/with/puppeteer-core/package.json \
#     bash scripts/brand/build.sh
# Logo geometry and colours: assets/logo (official). Never edit the generated files by hand.
set -euo pipefail
cd "$(dirname "$0")/../.."
K=website/brand/kit
python3 scripts/brand/make-kit.py $K
node scripts/brand/render-kit.mjs $K
node scripts/brand/render-guide.mjs $K
python3 - <<'PY'
import glob, os, zipfile
from PIL import Image
K = 'website/brand/kit'
os.makedirs('website/brand/preview', exist_ok=True)
for f in glob.glob(K + '/banners/*.png'):
    im = Image.open(f).convert('RGB'); w = 880 if im.width > im.height else 400
    im.resize((w, round(im.height * w / im.width)), Image.LANCZOS).save('website/brand/preview/' + os.path.basename(f)[:-4] + '.webp', 'WEBP', quality=80, method=6)
with zipfile.ZipFile(K + '/opengym-brand-kit.zip', 'w', zipfile.ZIP_DEFLATED) as z:
    for d, _, fs in os.walk(K):
        for f in sorted(fs):
            p = os.path.relpath(os.path.join(d, f), K)
            if not p.endswith('.zip') and not p.startswith('.'):
                z.write(os.path.join(K, p), 'opengym-brand-kit/' + p)
PY
echo "brand kit rebuilt in $K"
