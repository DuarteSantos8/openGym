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
#   EXT_PROFILE=<extension.mobileprovision> ...   once the IPA carries the asset pack downloader
#   WIDGETS_PROFILE=<widgets.mobileprovision> ...  once it carries the widget extension
#   WATCH_PROFILE=<watch.mobileprovision> ...     once the IPA carries the Apple Watch app
#   WATCH_WIDGET_PROFILE=<widget.mobileprovision>  once the watch app carries its widget
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
python3 - "$WORK/profile.plist" "$WORK/entitlements.plist" "$APP/Info.plist" <<'PY'
import plistlib, sys
p = plistlib.load(open(sys.argv[1], 'rb'))
e = dict(p['Entitlements'])
e['get-task-allow'] = False
assert e['application-identifier'].endswith('.ch.opengym.app'), e['application-identifier']
# The profile carries every capability the App ID has (HealthKit for the watch and the Health
# step); a build whose app doesn't ask for Health yet must not claim it.
info = plistlib.load(open(sys.argv[3], 'rb'))
if 'NSHealthShareUsageDescription' not in info:
    for k in [k for k in e if k.startswith('com.apple.developer.healthkit')]: del e[k]
# Apple Health (AppleHealthPlugin.swift) needs HealthKit on the app id and in the profile; without
# it the app still works, and Settings → Apple Health reports that it could not write.
if not e.get('com.apple.developer.healthkit'):
    print('WARNING: the app profile has no HealthKit: Apple Health will not work in this build')
plistlib.dump(e, open(sys.argv[2], 'wb'))
print('profile:', p['Name'], '| team', p['TeamIdentifier'][0], '| expires', p['ExpirationDate'])
PY

# The asset pack downloader extension (Background Assets, ios/App/AnimationPacksDownloader) is
# signed with its own App Store profile, given as EXT_PROFILE: its bundle id and its entitlements
# (the App Group it shares with the app) are its own.
EXT="$APP/Extensions/AnimationPacksDownloader.appex"
EXT_SIGN=()
if [ -d "$EXT" ]; then
  [ -n "${EXT_PROFILE:-}" ] || { echo "the IPA carries AnimationPacksDownloader.appex: set EXT_PROFILE to its App Store profile" >&2; exit 1; }
  cp "$EXT_PROFILE" "$EXT/embedded.mobileprovision"
  openssl smime -inform der -verify -noverify -in "$EXT_PROFILE" -out "$WORK/ext-profile.plist" 2>/dev/null
  python3 - "$WORK/ext-profile.plist" "$WORK/ext-entitlements.plist" <<'PY'
import plistlib, sys
p = plistlib.load(open(sys.argv[1], 'rb'))
e = dict(p['Entitlements'])
e['get-task-allow'] = False
assert e['application-identifier'].endswith('.ch.opengym.app.AnimationPacksDownloader'), e['application-identifier']
assert 'group.ch.opengym.app' in e.get('com.apple.security.application-groups', []), 'the extension profile has no App Group'
plistlib.dump(e, open(sys.argv[2], 'wb'))
print('extension profile:', p['Name'], '| expires', p['ExpirationDate'])
PY
  EXT_SIGN=(--entitlements-xml-file "Extensions/AnimationPacksDownloader.appex/AnimationPacksDownloader:$WORK/ext-entitlements.plist")
fi

# The widget extension (the widgets and the workout's Live Activity, ios/App/OpenGymWidgets): its
# own App Store profile, given as WIDGETS_PROFILE, for ch.opengym.app.widgets with the App Group.
WIDGETS="$APP/PlugIns/OpenGymWidgets.appex"
WIDGETS_SIGN=()
if [ -d "$WIDGETS" ]; then
  [ -n "${WIDGETS_PROFILE:-}" ] || { echo "the IPA carries OpenGymWidgets.appex: set WIDGETS_PROFILE to its App Store profile" >&2; exit 1; }
  cp "$WIDGETS_PROFILE" "$WIDGETS/embedded.mobileprovision"
  openssl smime -inform der -verify -noverify -in "$WIDGETS_PROFILE" -out "$WORK/widgets-profile.plist" 2>/dev/null
  python3 - "$WORK/widgets-profile.plist" "$WORK/widgets-entitlements.plist" <<'PY'
import plistlib, sys
p = plistlib.load(open(sys.argv[1], 'rb'))
e = dict(p['Entitlements'])
e['get-task-allow'] = False
assert e['application-identifier'].endswith('.ch.opengym.app.widgets'), e['application-identifier']
assert 'group.ch.opengym.app' in e.get('com.apple.security.application-groups', []), 'the widgets profile has no App Group'
plistlib.dump(e, open(sys.argv[2], 'wb'))
print('widgets profile:', p['Name'], '| expires', p['ExpirationDate'])
PY
  WIDGETS_SIGN=(--entitlements-xml-file "PlugIns/OpenGymWidgets.appex/OpenGymWidgets:$WORK/widgets-entitlements.plist")
fi

# The Apple Watch app (App.app/Watch/OpenGymWatch.app) is signed with its own App Store profile,
# given as WATCH_PROFILE: its bundle id and its entitlements (HealthKit) come from that profile.
WATCH_SIGN=()
WATCH="$APP/Watch/OpenGymWatch.app"
if [ -d "$WATCH" ]; then
  [ -n "${WATCH_PROFILE:-}" ] || { echo "the IPA carries the watch app: set WATCH_PROFILE to its App Store profile" >&2; exit 1; }
  cp "$WATCH_PROFILE" "$WATCH/embedded.mobileprovision"
  openssl smime -inform der -verify -noverify -in "$WATCH_PROFILE" -out "$WORK/watch-profile.plist" 2>/dev/null
  python3 - "$WORK/watch-profile.plist" "$WORK/watch-entitlements.plist" <<'PY'
import plistlib, sys
p = plistlib.load(open(sys.argv[1], 'rb'))
e = dict(p['Entitlements'])
e['get-task-allow'] = False
assert e['application-identifier'].endswith('.ch.opengym.app.watchkitapp'), e['application-identifier']
plistlib.dump(e, open(sys.argv[2], 'wb'))
print('watch profile:', p['Name'], '| expires', p['ExpirationDate'])
PY
  WATCH_SIGN=(--entitlements-xml-file "Watch/OpenGymWatch.app/OpenGymWatch:$WORK/watch-entitlements.plist")
  # Its complications / Smart Stack widget (OpenGymWatch.app/PlugIns), with its own profile.
  WIDGET="$WATCH/PlugIns/OpenGymWatchWidgets.appex"
  if [ -d "$WIDGET" ]; then
    [ -n "${WATCH_WIDGET_PROFILE:-}" ] || { echo "the watch app carries its widget: set WATCH_WIDGET_PROFILE to its App Store profile" >&2; exit 1; }
    cp "$WATCH_WIDGET_PROFILE" "$WIDGET/embedded.mobileprovision"
    openssl smime -inform der -verify -noverify -in "$WATCH_WIDGET_PROFILE" -out "$WORK/widget-profile.plist" 2>/dev/null
    python3 - "$WORK/widget-profile.plist" "$WORK/widget-entitlements.plist" <<'PY'
import plistlib, sys
p = plistlib.load(open(sys.argv[1], 'rb'))
e = dict(p['Entitlements'])
e['get-task-allow'] = False
assert e['application-identifier'].endswith('.ch.opengym.app.watchkitapp.widgets'), e['application-identifier']
assert 'group.ch.opengym.app' in e.get('com.apple.security.application-groups', []), 'the widget profile has no App Group'
plistlib.dump(e, open(sys.argv[2], 'wb'))
print('watch widget profile:', p['Name'], '| expires', p['ExpirationDate'])
PY
    WATCH_SIGN+=(--entitlements-xml-file "Watch/OpenGymWatch.app/PlugIns/OpenGymWatchWidgets.appex/OpenGymWatchWidgets:$WORK/widget-entitlements.plist")
  fi
fi

"$RCODESIGN" sign --p12-file "$P12" --p12-password-file "$P12PASS" \
  --entitlements-xml-file "App:$WORK/entitlements.plist" "${EXT_SIGN[@]}" "${WIDGETS_SIGN[@]}" "${WATCH_SIGN[@]}" "$APP"

(cd "$WORK/ipa" && rm -f "$OUT" && python3 -m zipfile -c "$OUT" Payload)
echo "signed: $OUT ($(du -h "$OUT" | cut -f1), $CLIPS animations)"
