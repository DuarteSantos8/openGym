#!/usr/bin/env bash
# Checks openGym Offline (flavour "offline", app/build.gradle) really cannot reach the network:
#   1. its runtime classpath has no network SDK (OkHttp, Retrofit, Cronet, Volley, Ktor) and
#      nothing from Google Play services, Firebase, ML Kit, Play Core or Garmin's Connect IQ SDK;
#   2. the APK, if built, asks for neither INTERNET nor ACCESS_NETWORK_STATE nor the installer
#      permission, names nothing from Play services or Garmin in its manifest, and does not list
#      the ML Kit plugin.
# Run from anywhere after `npm run build:mobile` (in frontend/) and, for part 2,
# `./gradlew :app:assembleOfflineDebug` (or Release) in frontend/android. CI runs it in the
# android job, next to check-fdroid.sh.
#
#   scripts/android/check-offline.sh [path/to/offline.apk]
#   CHECK_OFFLINE_SKIP_GRADLE=1 scripts/android/check-offline.sh app.apk   only part 2 (the tests)
set -euo pipefail
given=${1:+$(realpath -m "$1")}
cd "$(dirname "$0")/../../frontend/android"
if [ -n "$given" ] && [ ! -f "$given" ]; then echo "no such APK: $1"; exit 2; fi

fail=0
# What may never be on the classpath. The F-Droid list plus every common HTTP client: the app's
# own code has none, so one showing up means a dependency pulled it in.
NET='gms|firebase|mlkit|datatransport|com\.google\.android\.play|play-services|odml|connectiq|com\.garmin|okhttp|retrofit|cronet|volley|ktor|grpc'
if [ -z "${CHECK_OFFLINE_SKIP_GRADLE:-}" ]; then
  for conf in offlineDebugRuntimeClasspath offlineReleaseRuntimeClasspath; do
    deps=$(./gradlew -q --console=plain :app:dependencies --configuration "$conf")
    bad=$(printf '%s\n' "$deps" | grep -E -- '--- ' | grep -iE "$NET" || true)
    if [ -n "$bad" ]; then
      echo "$conf has a network or non-free dependency:"; printf '%s\n' "$bad"; fail=1
    else
      echo "$conf: no network SDK, nothing from Google Play services, Firebase, ML Kit or Garmin"
    fi
  done
fi

apk=${given:-$(ls app/build/outputs/apk/offline/*/*.apk 2>/dev/null | head -1 || true)}
if [ -n "$apk" ] && [ -f "$apk" ]; then
  if unzip -p "$apk" assets/capacitor.plugins.json | grep -c mlkit >/dev/null; then
    echo "$apk: capacitor.plugins.json still lists the ML Kit plugin"; fail=1
  fi
  aapt2=${AAPT2:-$(ls "${ANDROID_HOME:-/opt/android-sdk}"/build-tools/*/aapt2 2>/dev/null | sort -V | tail -1 || true)}
  if [ -z "$aapt2" ]; then
    echo "no aapt2 found (set ANDROID_HOME or AAPT2): cannot read the APK's permissions"; exit 2
  fi
  perms=$("$aapt2" dump permissions "$apk")
  for p in android.permission.INTERNET android.permission.ACCESS_NETWORK_STATE android.permission.ACCESS_WIFI_STATE android.permission.REQUEST_INSTALL_PACKAGES; do
    if grep -qF "'$p'" <<<"$perms"; then
      echo "$apk: asks for $p"; fail=1
    fi
  done
  manifest=$("$aapt2" dump xmltree --file AndroidManifest.xml "$apk")
  if grep -qE 'com\.google\.(android\.gms|mlkit|firebase)' <<<"$manifest"; then
    echo "$apk: the manifest names Google Play services"; fail=1
  fi
  if grep -qE 'com\.garmin\.android\.connectiq' <<<"$manifest"; then
    echo "$apk: the manifest names Garmin's Connect IQ SDK"; fail=1
  fi
  if ! grep -q 'ch.duartesantos.opengym.offline' <<<"$manifest"; then
    echo "$apk: not the openGym Offline package (ch.duartesantos.opengym.offline)"; fail=1
  fi
  [ "$fail" = 0 ] && echo "$apk: no INTERNET, no network state, no installer, no Play services, no Garmin"
elif [ -n "${CHECK_OFFLINE_SKIP_GRADLE:-}" ]; then
  echo "no APK to check"; exit 2
fi
exit "$fail"
