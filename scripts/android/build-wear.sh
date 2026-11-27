#!/usr/bin/env bash
# Builds and signs the Wear OS watch app (frontend/android/wear, docs/WEAR_OS.md) on the release
# machine, separately from the phone packages (build-release.sh), which it never touches:
#   openGym-Wear-<version>.aab   for Google Play: uploaded to the same app, Wear OS form factor
#   openGym-WearOS-watch-only-<version>.apk   for a watch next to the sideloaded phone APK (adb install)
# The APK's name says watch only (#1359): it has the phone app's applicationId and a higher
# versionCode, so installed on a phone by mistake it replaced the phone app, and the phone APK was
# then refused as a downgrade. On a phone it now only shows a "this is the watch app" screen.
# Same applicationId and the same key as the phone app: the Wearable Data Layer only links a
# watch app to a phone app with both, and Play wants it in the phone app's listing. The watch has
# no exercise media at all (text and numbers only), so nothing here is licensed material.
# Version: the phone's versionName, and the phone's versionCode + 10000 (wear/build.gradle).
#
# Usage: scripts/android/build-wear.sh <keystore> <password-file> <alias-file> [out-dir]
set -euo pipefail
KS=${1:?keystore}; PASS=${2:?file with the keystore password}; ALIAS=$(cat "${3:?file with the key alias}")
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
OUT=${4:-$PWD}
: "${ANDROID_HOME:?set ANDROID_HOME}"
BT=$(ls -d "$ANDROID_HOME"/build-tools/* | sort -V | tail -1)
cd "$ROOT/frontend/android"
VER=$(sed -n 's/.*versionName "\(.*\)"/\1/p' app/build.gradle)
APK="openGym-WearOS-watch-only-$VER.apk"
GRADLE=(./gradlew --no-daemon ${GRADLE_ARGS:-})
"${GRADLE[@]}" :wear:bundleRelease
"${GRADLE[@]}" :wear:assembleRelease
# The bundle is signed like a jar with the upload key; Play re-signs what it delivers.
cp wear/build/outputs/bundle/release/wear-release.aab "$OUT/openGym-Wear-$VER.aab"
# Only the store password from the file (-keypass:file on the same file fails, see build-release.sh).
jarsigner -keystore "$KS" -storepass:file "$PASS" \
  -sigalg SHA256withRSA -digestalg SHA-256 "$OUT/openGym-Wear-$VER.aab" "$ALIAS" >/dev/null
jarsigner -verify "$OUT/openGym-Wear-$VER.aab" | grep -q "jar verified" || { echo "the bundle did not verify" >&2; exit 1; }
"$BT/zipalign" -f -p 4 wear/build/outputs/apk/release/wear-release-unsigned.apk "$OUT/wear-aligned.apk"
"$BT/apksigner" sign --ks "$KS" --ks-pass "file:$PASS" --ks-key-alias "$ALIAS" \
  --out "$OUT/$APK" "$OUT/wear-aligned.apk"
rm -f "$OUT/wear-aligned.apk" "$OUT/$APK.idsig"
"$BT/apksigner" verify --print-certs "$OUT/$APK" | grep -i "SHA-256"
(cd "$OUT" && sha256sum "openGym-Wear-$VER.aab" "$APK" > "openGym-Wear-$VER.sha256")
# The GitHub release wants one checksum file per APK (scripts/ci/release-assets-check.mjs).
(cd "$OUT" && sha256sum "$APK" > "$APK.sha256")
"$BT/aapt2" dump badging "$OUT/$APK" | sed -n 1p   # not head: under pipefail its early exit failed the script (141)
ls -la "$OUT"/openGym-Wear-"$VER".* "$OUT/$APK"*
