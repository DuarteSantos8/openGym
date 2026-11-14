#!/usr/bin/env bash
# Proves the gym reminder (#614) on the Android emulator: a gym is saved through the app's own
# plugin, the phone's position is moved far away and then into the gym, and the notification has
# to show up in the shade. Then the no-nag rules: a second arrival the same day stays quiet, and a
# day with a workout logged stays quiet. Nothing here touches a real device or the network.
#
#   ANDROID_SERIAL=emulator-5580 scripts/android/gym-reminder-emulator.sh <debug apk>
#
# Needs a running emulator, Node 22 and the CDP driver (CDP=/root/homelab/scripts/android-repro/
# cdp.mjs by default). Exits 0 when every step behaved, 1 otherwise.
#
# Why not `adb emu geo fix` alone: that feeds the emulator's GPS provider, while the platform's
# proximity alerts are fed by the fused provider (Google's on this image), which does not turn the
# GPS on for them. So the fused provider is replaced by a shell test provider and moved as well
# (geo fix is still sent, for whatever listens to GPS). Android also polls proximity alerts at most
# every 30 min by default (location_background_throttle_proximity_alert_interval_ms) unless other
# apps' fixes come in; the test lowers that to 15 s. On a real phone, arrival is noticed whenever
# the system gets a fix: usually within minutes, at worst half an hour.
set -uo pipefail
APK=${1:?debug apk}
ADB=${ADB:-/opt/android-sdk/platform-tools/adb}
CDP=${CDP:-/root/homelab/scripts/android-repro/cdp.mjs}
PKG=${PKG:-ch.duartesantos.opengym.test}
PREFS=shared_prefs/opengym_gym_reminder.xml
LAT=47.3769; LNG=8.5417          # the gym (Zurich)
FAR_LAT=47.4200; FAR_LNG=8.5900  # 5 km away
TODAY=$(date +%F)
TMP=$(mktemp)
FAIL=0

cdp() { PKG=$PKG timeout 90 node --experimental-websocket "$CDP" eval "$1" 2>&1 | grep '^=>'; }
at() { $ADB shell cmd location providers set-test-provider-location fused --location "$1,$2" --accuracy 10; $ADB emu geo fix "$2" "$1" >/dev/null; }
count() { $ADB shell dumpsys notification --noredact | grep -c "Gym spotted"; }
foreground() {
  $ADB shell am start -n "$PKG/ch.duartesantos.opengym.MainActivity" >/dev/null 2>&1
  for i in $(seq 1 60); do
    $ADB shell cat /proc/net/unix | grep -q "webview_devtools_remote_$($ADB shell pidof $PKG | tr -d '\r')" && break
    sleep 3
  done
  sleep 8
}
status() {  # status <trainedOn>: what the page tells the phone about today
  cdp "window.Capacitor.Plugins.GymReminder.status({ trainedOn: '$1', quietOn: '', activeSince: 0, title: 'Gym spotted', body: 'Ready for your workout? 💪', channel: 'Gym reminder' }).then(() => 'status ok')"
}
new_day() {  # forget that it went off today (as if it were tomorrow); the app is killed first
  $ADB shell input keyevent KEYCODE_HOME; sleep 2; $ADB shell am kill "$PKG"; sleep 2
  $ADB exec-out run-as "$PKG" cat "$PREFS" | sed "s#<string name=\"lastFired\">[^<]*</string>#<string name=\"lastFired\">2000-01-01</string>#" > "$TMP"
  $ADB exec-in run-as "$PKG" sh -c "cat > $PREFS" < "$TMP"
}
walk_in() {  # out, wait out the 90 s arming grace, in; returns after up to 75 s inside
  at $FAR_LAT $FAR_LNG; sleep 95
  for i in $(seq 1 15); do at $LAT $LNG; [ "$(count)" -gt 0 ] && { echo "   fired after ~$((i*5)) s inside"; return; }; sleep 5; done
}

$ADB install -r -g "$APK" >/dev/null
# A fresh start: an earlier run today would have left "went off today" behind.
$ADB shell pm clear "$PKG" >/dev/null
for p in ACCESS_FINE_LOCATION ACCESS_COARSE_LOCATION ACCESS_BACKGROUND_LOCATION POST_NOTIFICATIONS; do
  $ADB shell pm grant "$PKG" "android.permission.$p" 2>/dev/null || true
done
$ADB shell cmd location set-location-enabled true
$ADB shell settings put global location_background_throttle_proximity_alert_interval_ms 15000
$ADB shell appops set com.android.shell android:mock_location allow
$ADB shell cmd location providers add-test-provider fused --supportsAltitude --supportsSpeed --supportsBearing 2>/dev/null
$ADB shell cmd location providers set-test-provider-enabled fused true
at $FAR_LAT $FAR_LNG

echo "== 1. save a gym through the plugin (as Settings does), app to the background, walk in"
foreground
status 2000-01-01
cdp "window.Capacitor.Plugins.GymReminder.configure({ config: { on: true, window: null, gyms: [{ id: 'emu', name: 'Emulator gym', lat: $LAT, lng: $LNG, radius: 100, text: '' }] } }).then(r => JSON.stringify(r))"
$ADB shell input keyevent KEYCODE_HOME
walk_in
n=$(count); echo "   notifications: $n"; [ "$n" -ge 1 ] || FAIL=1
$ADB shell dumpsys notification --noredact | grep -E "android.title=String \(Gym|android.text=String \(Ready|channel=gym-reminder" | head -3

echo "== 2. tap it: the app opens on the Start screen (#/workout)"
foreground; cdp "location.hash = '#/settings'; location.hash"
$ADB shell input keyevent KEYCODE_HOME; sleep 2
$ADB shell cmd statusbar expand-notifications; sleep 3
$ADB shell uiautomator dump /sdcard/ui.xml >/dev/null
set -- 0 0 0 0 $($ADB shell cat /sdcard/ui.xml | grep -o 'text="Gym spotted"[^>]*bounds="[^"]*"' | head -1 | grep -o 'bounds="[^"]*"' | grep -o '[0-9]*' | tr '\n' ' ')
shift 4; [ $# -eq 4 ] && $ADB shell input tap $(( ($1+$3)/2 )) $(( ($2+$4)/2 )); sleep 8
h=$(cdp "location.hash"); echo "   route after the tap: $h"; [ "$h" = '=> "#/workout"' ] || FAIL=1
echo "   left in the shade: $(count)"

echo "== 3. walk out and in again the same day: quiet (once a day)"
$ADB shell input keyevent KEYCODE_HOME
walk_in
n=$(count); echo "   notifications: $n"; [ "$n" -eq 0 ] || FAIL=1

echo "== 4. a new day, but a workout is logged today: quiet"
foreground; status "$TODAY"
new_day; echo "   app process after kill: '$($ADB shell pidof $PKG | tr -d '\r')'"
walk_in
n=$(count); echo "   notifications: $n"; [ "$n" -eq 0 ] || FAIL=1

echo "== 5. a new day, nothing logged, app not running: goes off"
foreground; status 2000-01-01
new_day; echo "   app process after kill: '$($ADB shell pidof $PKG | tr -d '\r')'"
walk_in
n=$(count); echo "   notifications: $n"; [ "$n" -ge 1 ] || FAIL=1

rm -f "$TMP"
[ $FAIL -eq 0 ] && echo "== ALL GOOD" || echo "== SOMETHING DID NOT BEHAVE"
exit $FAIL
