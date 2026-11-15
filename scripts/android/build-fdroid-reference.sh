#!/usr/bin/env bash
# Builds and signs openGym-FDroid-<version>.apk, the reference APK for F-Droid's reproducible
# build (fdroiddata: metadata/ch.duartesantos.opengym.yml, "Binaries" + AllowedAPKSigningKeys).
# F-Droid builds the fdroid flavour from the tag, copies our signature onto its own unsigned APK
# and ships it only if that verifies, so the APK it ships is signed with our key and installs
# over the GitHub APK and back (same applicationId, same key).
#
# The build has to be byte for byte the one F-Droid makes, so it runs in a fresh clone of the
# tag with the recipe's steps and nothing from this machine: the Wear OS module deleted,
# scripts/android/fdroid-prebuild.sh, `assembleFdroidRelease`, and no APP_MEDIA_DIR or other
# VITE_* settings (a clean environment). Use the same JDK major version as F-Droid (21).
# Signing keeps the zip exactly as built: no zipalign, `--alignment-preserved`, and no v1
# signature (minSdk 24 does not need one). zipalign or apksigner's own re-alignment move the
# entries, and F-Droid's copied signature then no longer verifies.
#
#   scripts/android/build-fdroid-reference.sh <keystore> <keystore.pass> <key.alias> <out dir> [tag]
#
# Attach the result to the GitHub release of that tag. Optional: FDROID_UNSIGNED=<apk> compares
# a build F-Droid made (or the CI artifact) with ours before signing.
set -euo pipefail
KS=$1; PASS=$2; ALIAS=$(cat "$3"); OUT=$(realpath -m "$4")
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
TAG=${5:-$(git -C "$ROOT" describe --tags --exact-match HEAD)}
: "${ANDROID_HOME:?set ANDROID_HOME}"
java -version 2>&1 | grep -q 'version "21' || { echo "F-Droid builds with JDK 21; this java is not 21" >&2; exit 1; }

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
git clone -q --no-checkout "$ROOT" "$WORK/src"
git -C "$WORK/src" checkout -q "$TAG"
rm -rf "$WORK/src/frontend/android/wear"
clean_env=(env -i "PATH=$PATH" "HOME=$HOME" "ANDROID_HOME=$ANDROID_HOME" ${JAVA_HOME:+"JAVA_HOME=$JAVA_HOME"} "LANG=C.UTF-8")
"${clean_env[@]}" "$WORK/src/scripts/android/fdroid-prebuild.sh"
(cd "$WORK/src/frontend/android" && "${clean_env[@]}" ./gradlew --no-daemon ${GRADLE_ARGS:-} :app:assembleFdroidRelease)

VER=$(sed -n 's/.*versionName "\(.*\)"/\1/p' "$WORK/src/frontend/android/app/build.gradle")
UNSIGNED="$WORK/src/frontend/android/app/build/outputs/apk/fdroid/release/app-fdroid-release-unsigned.apk"
if [ -n "${FDROID_UNSIGNED:-}" ]; then
  cmp -s "$UNSIGNED" "$FDROID_UNSIGNED" && echo "same bytes as $FDROID_UNSIGNED" || { echo "differs from $FDROID_UNSIGNED" >&2; exit 1; }
fi
BT=$(ls -d "$ANDROID_HOME"/build-tools/* | sort -V | tail -1)
mkdir -p "$OUT"
NAME="openGym-FDroid-$VER.apk"
"$BT/apksigner" sign --alignment-preserved --v1-signing-enabled false \
  --ks "$KS" --ks-pass "file:$PASS" --ks-key-alias "$ALIAS" --out "$OUT/$NAME" "$UNSIGNED"
rm -f "$OUT/$NAME.idsig"
"$BT/apksigner" verify --print-certs "$OUT/$NAME" | grep -i "SHA-256"
(cd "$OUT" && sha256sum "$NAME" > "$NAME.sha256")
echo "$OUT/$NAME (unsigned build: $(sha256sum "$UNSIGNED" | cut -c1-16))"
