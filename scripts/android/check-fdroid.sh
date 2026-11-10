#!/usr/bin/env bash
# Checks the F-Droid build (flavour "fdroid", docs/APP_STORES.md) carries nothing non-free:
#   1. its runtime classpath has nothing from Google Play services, Firebase, ML Kit or Play Core;
#   2. the APK, if built, lists no ML Kit plugin and asks for no install permission, and its
#      manifest names nothing from Google Play services.
# Run from the repository root after `npm run build:mobile` (in frontend/) and, for part 2,
# `./gradlew :app:assembleFdroidRelease` (in frontend/android). CI runs it in the android job.
#
#   scripts/android/check-fdroid.sh [path/to/fdroid.apk]
set -euo pipefail
given=${1:+$(realpath -m "$1")}
cd "$(dirname "$0")/../../frontend/android"
if [ -n "$given" ] && [ ! -f "$given" ]; then echo "no such APK: $1"; exit 2; fi

fail=0
deps=$(./gradlew -q --console=plain :app:dependencies --configuration fdroidReleaseRuntimeClasspath)
# Every coordinate line of the tree; the legend underneath has the word "display" in it.
bad=$(printf '%s\n' "$deps" | grep -E -- '--- ' | grep -iE 'gms|firebase|mlkit|datatransport|com\.google\.android\.play|play-services|odml' || true)
if [ -n "$bad" ]; then
  echo "fdroid runtime classpath has non-free dependencies:"; printf '%s\n' "$bad"; fail=1
else
  echo "fdroid runtime classpath: nothing from Google Play services, Firebase or ML Kit"
fi

apk=${given:-$(ls app/build/outputs/apk/fdroid/release/*.apk 2>/dev/null | head -1 || true)}
if [ -n "$apk" ] && [ -f "$apk" ]; then
  if unzip -p "$apk" assets/capacitor.plugins.json | grep -q mlkit; then
    echo "$apk: capacitor.plugins.json still lists the ML Kit plugin"; fail=1
  fi
  aapt2=$(ls "${ANDROID_HOME:-/opt/android-sdk}"/build-tools/*/aapt2 2>/dev/null | sort -V | tail -1 || true)
  if [ -n "$aapt2" ]; then
    manifest=$("$aapt2" dump xmltree --file AndroidManifest.xml "$apk")
    if printf '%s\n' "$manifest" | grep -qE 'com\.google\.(android\.gms|mlkit|firebase)'; then
      echo "$apk: the manifest names Google Play services"; fail=1
    fi
    if "$aapt2" dump permissions "$apk" | grep -q REQUEST_INSTALL_PACKAGES; then
      echo "$apk: asks for REQUEST_INSTALL_PACKAGES (F-Droid updates the app, not the app itself)"; fail=1
    fi
  fi
  [ "$fail" = 0 ] && echo "$apk: no ML Kit, no Play services in the manifest, no updater"
fi
exit "$fail"
