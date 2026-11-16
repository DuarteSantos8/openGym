#!/usr/bin/env bash
# Puts the Android files of a release on its GitHub release and checks that nothing is missing.
#   scripts/android/upload-release.sh v1.4.6 /path/to/out
# Uploads every APK in the folder, the checksum file next to each one and SHA256SUMS, then runs
# scripts/ci/release-assets-check.mjs on the release (a draft too). The list is not typed by
# hand on purpose: v1.4.5 went out without the per-APK .sha256 files because the upload command
# named the APKs and SHA256SUMS only, and no sideloaded phone could update for a day.
# Publish the release only after this ends with "ok". Needs gh, logged in.
set -euo pipefail
TAG=${1:?tag, e.g. v1.4.6}; OUT=${2:?folder with the built files}
VER=${TAG#v}
cd "$(dirname "$0")/../.."
shopt -s nullglob
apks=("$OUT"/openGym-*"$VER".apk)
[ ${#apks[@]} -gt 0 ] || { echo "no openGym-*$VER.apk in $OUT"; exit 1; }
files=("$OUT/SHA256SUMS")
for apk in "${apks[@]}"; do
  [ -f "$apk.sha256" ] || { echo "$(basename "$apk").sha256 is missing in $OUT (build-release.sh and build-wear.sh write it)"; exit 1; }
  (cd "$OUT" && sha256sum -c --quiet "$(basename "$apk").sha256")
  grep -q "  $(basename "$apk")\$" "$OUT/SHA256SUMS" || sha256sum "$apk" | sed "s#$OUT/##" >> "$OUT/SHA256SUMS"
  files+=("$apk" "$apk.sha256")
done
gh release upload "$TAG" "${files[@]}" --clobber
GH_TOKEN=${GH_TOKEN:-$(gh auth token)} node scripts/ci/release-assets-check.mjs "$TAG" --draft
echo "ok: $TAG has ${#apks[@]} APKs, each with its checksum"
