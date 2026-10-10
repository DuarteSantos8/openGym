#!/usr/bin/env bash
# Finishes the App Store build of the iPhone app on the release machine.
#
# The Mac runner (.github/workflows/ios.yml, job device-archive) compiles the app and leaves an
# unsigned IPA without its web assets. The full-quality exercise animations may only ever be
# inside the app package itself (Gym visual licence, Part B), never in a repo, a CI run or a file
# anyone can download, so they are put in here, on this machine, from the phone build in
# frontend/ios/App/App/public, and the result is signed with the App Store distribution
# certificate. No Mac needed: rcodesign signs on Linux.
#
# Usage:
#   scripts/ios/finish-ipa.sh <App-unsigned.ipa> <dist.p12> <p12-password-file> <profile.mobileprovision> [out.ipa]
#
# Before: the phone build with the app's animations, from the same commit as the IPA:
#   cd frontend && VITE_CLIP_EXT=webp APP_MEDIA_DIR=/mnt/backup-hdd/opengym-media/build-appwebp npm run build:mobile
# After: upload the IPA (docs/APP_STORES.md, "Upload").
set -euo pipefail

IPA=${1:?unsigned IPA}; P12=${2:?distribution .p12}; P12PASS=${3:?file with the .p12 password}
PROFILE=${4:?App Store provisioning profile}
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
FRONT="$ROOT/frontend"
VERSION=$(node -p "require('$FRONT/package.json').version")
OUT=${5:-"$PWD/openGym-$VERSION.ipa"}
RCODESIGN=${RCODESIGN:-rcodesign}
WORK=$(mktemp -d "${TMPDIR:-/tmp}/finish-ipa.XXXXXX")
trap 'rm -rf "$WORK"' EXIT

PUBLIC="$FRONT/ios/App/App/public"
[ -f "$PUBLIC/index.html" ] || { echo "no phone build in $PUBLIC: run npm run build:mobile first" >&2; exit 1; }
grep -q 'name="opengym-flavor" content="mobile"' "$PUBLIC/index.html" || { echo "$PUBLIC is not the phone build" >&2; exit 1; }
CLIPS=$(find "$PUBLIC/exercise-media" -name '*.webp' 2>/dev/null | wc -l)
[ "$CLIPS" -gt 6000 ] || { echo "$PUBLIC has $CLIPS WebP animations: build with VITE_CLIP_EXT=webp and APP_MEDIA_DIR" >&2; exit 1; }

unzip -q "$IPA" -d "$WORK/ipa"
APP="$WORK/ipa/Payload/App.app"
[ -d "$APP" ] || { echo "$IPA has no Payload/App.app" >&2; exit 1; }

# The IPA and the web build must come from the same commit: the native side and the page talk
# through plugins that change together.
if [ -f "$WORK/ipa/ci-commit.txt" ]; then
  CI_SHA=$(cat "$WORK/ipa/ci-commit.txt"); HERE=$(git -C "$ROOT" rev-parse HEAD)
  [ "$CI_SHA" = "$HERE" ] || { echo "the IPA is from $CI_SHA, this checkout is $HERE" >&2; exit 1; }
  rm "$WORK/ipa/ci-commit.txt"
fi
PLIST_VERSION=$(python3 -c "import plistlib,sys;print(plistlib.load(open(sys.argv[1],'rb'))['CFBundleShortVersionString'])" "$APP/Info.plist")
[ "$PLIST_VERSION" = "$VERSION" ] || { echo "the IPA says $PLIST_VERSION, package.json says $VERSION" >&2; exit 1; }

rm -rf "$APP/public"
cp -R "$PUBLIC" "$APP/public"
cp "$FRONT/ios/App/App/capacitor.config.json" "$APP/capacitor.config.json"
cp "$PROFILE" "$APP/embedded.mobileprovision"

# The entitlements are the profile's own (application identifier, team), never a debug build's.
openssl smime -inform der -verify -noverify -in "$PROFILE" -out "$WORK/profile.plist" 2>/dev/null
python3 - "$WORK/profile.plist" "$WORK/entitlements.plist" <<'PY'
import plistlib, sys
p = plistlib.load(open(sys.argv[1], 'rb'))
e = dict(p['Entitlements'])
e['get-task-allow'] = False
assert e['application-identifier'].endswith('.ch.duartesantos.opengym'), e['application-identifier']
plistlib.dump(e, open(sys.argv[2], 'wb'))
print('profile:', p['Name'], '| team', p['TeamIdentifier'][0], '| expires', p['ExpirationDate'])
PY

"$RCODESIGN" sign --p12-file "$P12" --p12-password-file "$P12PASS" \
  --entitlements-xml-file "App:$WORK/entitlements.plist" "$APP"

(cd "$WORK/ipa" && rm -f "$OUT" && python3 -m zipfile -c "$OUT" Payload)
echo "signed: $OUT ($(du -h "$OUT" | cut -f1), $CLIPS animations)"
