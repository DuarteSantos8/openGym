#!/usr/bin/env bash
# The web part of the F-Droid build (flavour "fdroid", docs/APP_STORES.md), run by F-Droid's
# recipe before Gradle (fdroiddata: metadata/ch.duartesantos.opengym.yml, "prebuild"):
#   1. installs the frontend's packages exactly as locked and builds the phone bundle, with the
#      repository's 180 px animations only (no APP_MEDIA_DIR);
#   2. takes the ML Kit barcode scanner plugin out of the Gradle build. The fdroid flavour never
#      links it anyway (app/build.gradle, "The F-Droid build: no ML Kit"), but `cap sync` still
#      registers its Android module, and that module's build file names ML Kit and Play services,
#      which F-Droid's scanner rightly refuses. Its JavaScript stays: the page asks the native
#      side whether the plugin is there and scans with jsQR when it is not (lib/scan.js).
# The Wear OS module (android/wear) is deleted by the recipe itself (its "rm" list) before this
# runs; settings.gradle only includes it when the folder is there.
#
# Run it from anywhere; it works on the checkout it lives in. On a developer machine it leaves
# the generated Capacitor files changed (git checkout frontend/android to undo).
set -euo pipefail
cd "$(dirname "$0")/../../frontend"

npm ci --ignore-scripts --no-audit --no-fund
npm run build:mobile

sed -i '/capacitor-mlkit-barcode-scanning/d' android/capacitor.settings.gradle android/app/capacitor.build.gradle
rm -rf node_modules/@capacitor-mlkit/barcode-scanning/android
if grep -q mlkit android/capacitor.settings.gradle android/app/capacitor.build.gradle; then
  echo "the ML Kit plugin is still in the Gradle build"; exit 1
fi
echo "fdroid prebuild: phone bundle built, ML Kit plugin out of the Gradle build"
