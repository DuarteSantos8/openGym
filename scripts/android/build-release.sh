#!/usr/bin/env bash
# Builds and signs both Android releases on the release machine, from one phone build:
#   openGym-<version>.apk   the sideloaded APK (GitHub, opengym.ch): updates itself
#   openGym-<version>.aab   the Google Play bundle: Play updates it
# The full-quality animations go into both packages and nowhere else (Gym visual licence,
# Part B), which is why this runs here and not in CI. Same key for both: a phone can move from
# the APK to Google Play and keep its data, as long as Play App Signing uses this key too
# (docs/APP_STORES.md).
#
# Usage: scripts/android/build-release.sh <keystore> <password-file> <alias-file> [out-dir]
#   APP_MEDIA_DIR defaults to /mnt/backup-hdd/opengym-media/build-appwebp.
set -euo pipefail

KS=${1:?keystore}; PASS=${2:?file with the keystore password}; ALIAS=$(cat "${3:?file with the key alias}")
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
OUT=${4:-$PWD}
export APP_MEDIA_DIR=${APP_MEDIA_DIR:-/mnt/backup-hdd/opengym-media/build-appwebp}
export VITE_CLIP_EXT=webp
: "${ANDROID_HOME:?set ANDROID_HOME}"
BT=$(ls -d "$ANDROID_HOME"/build-tools/* | sort -V | tail -1)

cd "$ROOT/frontend"
VER=$(node -p "require('./package.json').version")
GRADLE_VER=$(sed -n 's/.*versionName "\(.*\)"/\1/p' android/app/build.gradle)
[ "$VER" = "$GRADLE_VER" ] || { echo "package.json says $VER, build.gradle says $GRADLE_VER" >&2; exit 1; }

npm run build:mobile
(cd android && ./gradlew --no-daemon clean assembleSideloadRelease bundlePlayRelease)

APK_IN=android/app/build/outputs/apk/sideload/release/app-sideload-release-unsigned.apk
AAB_IN=android/app/build/outputs/bundle/playRelease/app-play-release.aab

"$BT/zipalign" -f -p 4 "$APK_IN" "$OUT/aligned.apk"
"$BT/apksigner" sign --ks "$KS" --ks-pass "file:$PASS" --ks-key-alias "$ALIAS" \
  --out "$OUT/openGym-$VER.apk" "$OUT/aligned.apk"
rm -f "$OUT/aligned.apk" "$OUT/openGym-$VER.apk.idsig"
"$BT/apksigner" verify --print-certs "$OUT/openGym-$VER.apk" | grep -i "SHA-256"
(cd "$OUT" && sha256sum "openGym-$VER.apk" > "openGym-$VER.apk.sha256")

# An app bundle is signed like a jar; Play checks it with the upload key and re-signs the APKs
# it builds from it with the app signing key.
cp "$AAB_IN" "$OUT/openGym-$VER.aab"
jarsigner -keystore "$KS" -storepass:file "$PASS" -keypass:file "$PASS" \
  -sigalg SHA256withRSA -digestalg SHA-256 "$OUT/openGym-$VER.aab" "$ALIAS" >/dev/null
jarsigner -verify "$OUT/openGym-$VER.aab" | grep -q "jar verified" || { echo "the bundle did not verify" >&2; exit 1; }

ls -la "$OUT/openGym-$VER.apk" "$OUT/openGym-$VER.aab"
