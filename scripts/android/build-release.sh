#!/usr/bin/env bash
# Builds and signs the Android releases on the release machine:
#   openGym-<version>.apk      the Standard sideloaded APK (GitHub, opengym.ch): 180 px built in
#   openGym-Plus-<version>.apk the Plus sideloaded APK: 240 px built in (PLUS_PX)
#   openGym-HD-<version>.apk   the HD sideloaded APK: sharper animations built in (HD_PX, 360)
#   openGym-<version>.aab      the Google Play bundle: Play updates it
# Each from its own phone build (owner, v1.4.2). The APKs have no packs and update themselves,
# each to its own kind (lib/update.js pickApk, told by VITE_APK_VARIANT); both are the same app
# with the same key, so installing one over another keeps the data. The Play bundle carries
# 180 px built in, like the App Store app, and every sharper quality whose folder exists as an on-demand Play asset pack
# (scripts/android/make-asset-packs.mjs), which Google Play delivers when someone picks it. These
# animations go into the packages and nowhere else (Gym visual licence, Part B), which is why this
# runs here and not in CI; the pack modules are taken out of the project again at the end. Same
# key for both: a phone can move from the APK to Google Play and keep its data, as long as Play App
# Signing uses this key too (docs/APP_STORES.md).
#
# Usage: scripts/android/build-release.sh <keystore> <password-file> <alias-file> [out-dir]
#   QUALITY_ROOT  the private quality folders, default /mnt/backup-hdd/opengym-media/quality
#   APK_PX        the Standard APK's built-in size, default 180;  PLAY_PX  the bundle's, default 180
#   PLUS_PX       the Plus APK's built-in size, default 240; PLUS_PX=0 builds no Plus APK
#   HD_PX         the HD APK's built-in size, default 360; HD_PX=0 builds no HD APK
#   APK_ONLY=1    only the APKs, no Play bundle
#   NO_PACKS=1    a Play bundle without asset packs
set -euo pipefail

KS=${1:?keystore}; PASS=${2:?file with the keystore password}; ALIAS=$(cat "${3:?file with the key alias}")
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
OUT=${4:-$PWD}
QUALITY_ROOT=${QUALITY_ROOT:-/mnt/backup-hdd/opengym-media/quality}
APK_PX=${APK_PX:-180}
PLUS_PX=${PLUS_PX:-240}
HD_PX=${HD_PX:-360}
PLAY_PX=${PLAY_PX:-180}
export VITE_CLIP_EXT=webp
: "${ANDROID_HOME:?set ANDROID_HOME}"
BT=$(ls -d "$ANDROID_HOME"/build-tools/* | sort -V | tail -1)
for px in "$APK_PX" "$PLAY_PX" $([ "$PLUS_PX" != 0 ] && echo "$PLUS_PX") $([ "$HD_PX" != 0 ] && echo "$HD_PX"); do
  [ -d "$QUALITY_ROOT/$px" ] || { echo "no $QUALITY_ROOT/$px" >&2; exit 1; }
done

cd "$ROOT/frontend"
VER=$(node -p "require('./package.json').version")
GRADLE_VER=$(sed -n 's/.*versionName "\(.*\)"/\1/p' android/app/build.gradle)
[ "$VER" = "$GRADLE_VER" ] || { echo "package.json says $VER, build.gradle says $GRADLE_VER" >&2; exit 1; }

# The phone build with one size of animations built in: the files and the size the page assumes,
# and for an APK which kind it is, so its updater stays with that kind ($2: standard / hd).
phone_build() {
  APP_MEDIA_DIR="$QUALITY_ROOT/$1" VITE_BUILTIN_CLIP_PX="$1" VITE_APK_VARIANT="${2:-standard}" npm run build:mobile
  local n
  n=$(find android/app/src/main/assets/public/exercise-media/clip -name '*.webp' | wc -l)
  [ "$n" -gt 6000 ] || { echo "the $1 px phone build has only $n animations" >&2; exit 1; }
}

# 1. The APKs: Standard (180 px built in), Plus (PLUS_PX) and HD (HD_PX), no packs.
node "$ROOT/scripts/android/make-asset-packs.mjs" --clean
phone_build "$APK_PX" standard
(cd android && ./gradlew --no-daemon clean assembleSideloadRelease)
APK_BUILT="$OUT/.openGym-$VER-sideload-unsigned.apk"   # beside the outputs: the root disk has no room
cp android/app/build/outputs/apk/sideload/release/app-sideload-release-unsigned.apk "$APK_BUILT"
PLUS_BUILT="$OUT/.openGym-Plus-$VER-sideload-unsigned.apk"
if [ "$PLUS_PX" != 0 ]; then
  phone_build "$PLUS_PX" plus
  (cd android && ./gradlew --no-daemon assembleSideloadRelease)
  cp android/app/build/outputs/apk/sideload/release/app-sideload-release-unsigned.apk "$PLUS_BUILT"
fi
HD_BUILT="$OUT/.openGym-HD-$VER-sideload-unsigned.apk"
if [ "$HD_PX" != 0 ]; then
  phone_build "$HD_PX" hd
  (cd android && ./gradlew --no-daemon assembleSideloadRelease)
  cp android/app/build/outputs/apk/sideload/release/app-sideload-release-unsigned.apk "$HD_BUILT"
fi

sign_apk() {  # <unsigned> <name>
  "$BT/zipalign" -f -p 4 "$1" "$OUT/aligned.apk"
  "$BT/apksigner" sign --ks "$KS" --ks-pass "file:$PASS" --ks-key-alias "$ALIAS" \
    --out "$OUT/$2" "$OUT/aligned.apk"
  rm -f "$OUT/aligned.apk" "$OUT/$2.idsig"
  "$BT/apksigner" verify --print-certs "$OUT/$2" | grep -i "SHA-256"
  (cd "$OUT" && sha256sum "$2" > "$2.sha256")
}
sign_apk "$APK_BUILT" "openGym-$VER.apk"
[ "$PLUS_PX" = 0 ] || sign_apk "$PLUS_BUILT" "openGym-Plus-$VER.apk"
[ "$HD_PX" = 0 ] || sign_apk "$HD_BUILT" "openGym-HD-$VER.apk"
(cd "$OUT" && cat openGym-*"$VER".apk.sha256 > SHA256SUMS)


if [ -n "${APK_ONLY:-}" ]; then
  rm -f "$APK_BUILT" "$PLUS_BUILT" "$HD_BUILT"
  ls -la "$OUT"/openGym-*"$VER".apk
  exit 0
fi

# 2. The Play bundle: 180 px built in, the sharper ones as asset packs.
phone_build "$PLAY_PX"
if [ -z "${NO_PACKS:-}" ]; then
  trap 'node "$ROOT/scripts/android/make-asset-packs.mjs" --clean; rm -f "$APK_BUILT" "$PLUS_BUILT" "$HD_BUILT"' EXIT
  node "$ROOT/scripts/android/make-asset-packs.mjs" --builtin "$PLAY_PX" --src-root "$QUALITY_ROOT"
else
  trap 'rm -f "$APK_BUILT" "$PLUS_BUILT" "$HD_BUILT"' EXIT
fi
(cd android && ./gradlew --no-daemon bundlePlayRelease)

AAB_IN=android/app/build/outputs/bundle/playRelease/app-play-release.aab

# An app bundle is signed like a jar; Play checks it with the upload key and re-signs the APKs
# it builds from it with the app signing key.
cp "$AAB_IN" "$OUT/openGym-$VER.aab"
jarsigner -keystore "$KS" -storepass:file "$PASS" -keypass:file "$PASS" \
  -sigalg SHA256withRSA -digestalg SHA-256 "$OUT/openGym-$VER.aab" "$ALIAS" >/dev/null
jarsigner -verify "$OUT/openGym-$VER.aab" | grep -q "jar verified" || { echo "the bundle did not verify" >&2; exit 1; }

ls -la "$OUT"/openGym-*"$VER".apk "$OUT/openGym-$VER.aab"
# Google Play's limits: 500 MB for the base module, 1.5 GB per asset pack (the packs are split
# below that by make-asset-packs.mjs). The base is what the bundle holds outside the packs.
BASE=$(unzip -l "$OUT/openGym-$VER.aab" | awk '$4 != "" && $4 !~ /^anim_/ {s+=$1} END {print s}')
echo "base module: $((BASE / 1024 / 1024)) MB (Play allows 500 MB)"
[ "$BASE" -lt $((500 * 1024 * 1024)) ] || { echo "the base module is over Play's 500 MB" >&2; exit 1; }
