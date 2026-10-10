#!/bin/sh
# Builds the iPhone app as an .ipa to install with AltStore (or SideStore, Sideloadly), and the
# AltStore source that lists it. macOS only: Xcode, CocoaPods and Node. CI's build:ios job runs
# this too (.gitlab-ci.yml). See docs/MOBILE.md ("iPhone — AltStore").
#
#   scripts/build-ipa.sh [--no-watch] [--out DIR] [--url TEMPLATE] [--notes TEXT]
#
#   --no-watch   leave the Apple Watch app out (it takes a second App ID from a free Apple ID)
#   --out DIR    where the .ipa, its .sha256 and altstore.json go (default: the current folder);
#                an altstore.json already there keeps its versions behind the new one. Without
#                the watch app it is altstore-nowatch.json, a source of its own
#   --url T      where the .ipa will be downloaded from: %v is the version, %f the file name
#                (default: the upstream project's package registry, scripts/altstore-source.mjs)
#
# The archive is built without signing, then signed ad hoc — inside out, the watch app and the
# frameworks first — with the entitlements the app asks for (App.healthkit.entitlements). AltStore
# re-signs with the user's Apple ID and asks Apple for what that signature names; a free Apple ID
# does not get HealthKit, and the app then simply shows no Apple Health card.
set -eu

WATCH=1
OUT=.
URL=
NOTES=
while [ $# -gt 0 ]; do
  case "$1" in
    --no-watch) WATCH=0 ;;
    --out) OUT="$2"; shift ;;
    --url) URL="$2"; shift ;;
    --notes) NOTES="$2"; shift ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

FRONTEND="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
cd "$FRONTEND"

npm run build:mobile
VER="$(node -p "require('./package.json').version")"
# Build number = the Android versionCode, so both apps count the same way.
BUILD="$(sed -n 's/^ *versionCode \([0-9]*\).*/\1/p' android/app/build.gradle | sed -n 1p)"
[ -n "$BUILD" ] || { echo "could not read versionCode from android/app/build.gradle" >&2; exit 1; }

cd ios/App
rm -rf build/App.xcarchive Payload
xcodebuild -workspace App.xcworkspace -scheme App -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$PWD/build/App.xcarchive" \
  MARKETING_VERSION="$VER" CURRENT_PROJECT_VERSION="$BUILD" OPENGYM_HEALTHKIT=YES \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" \
  archive | tail -40

# An .ipa is a zip with the .app under Payload/.
mkdir Payload
cp -R build/App.xcarchive/Products/Applications/App.app Payload/
APP=Payload/App.app
if [ "$WATCH" = 0 ]; then rm -rf "$APP/Watch"; fi

if [ -d "$APP/Watch/OpenGymWatch.app" ]; then
  codesign --force --sign - --timestamp=none "$APP/Watch/OpenGymWatch.app"
fi
for fw in "$APP"/Frameworks/*; do
  [ -e "$fw" ] && codesign --force --sign - --timestamp=none "$fw"
done
codesign --force --sign - --timestamp=none --entitlements App/App.healthkit.entitlements "$APP"
codesign -d --entitlements - "$APP" >/dev/null 2>&1 || { echo "the app carries no signature" >&2; exit 1; }

if [ "$WATCH" = 0 ]; then NAME="openGym-$VER-nowatch.ipa"; SOURCE=altstore-nowatch.json; else NAME="openGym-$VER.ipa"; SOURCE=altstore.json; fi
rm -f "$OUT/$NAME"
zip -qr "$OUT/$NAME" Payload
rm -rf Payload
cd "$OUT"
shasum -a 256 "$NAME" > "$NAME.sha256"
cat "$NAME.sha256"

set -- --ipa "$OUT/$NAME" --version "$VER" --build "$BUILD" --previous "$OUT/$SOURCE" --out "$OUT/$SOURCE"
[ -n "$URL" ] && set -- "$@" --url "$URL"
[ -n "$NOTES" ] && set -- "$@" --notes "$NOTES"
node "$FRONTEND/scripts/altstore-source.mjs" "$@"
