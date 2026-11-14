#!/usr/bin/env bash
# Proves the gym reminder's approach check and server check (#614) on the Android emulator.
#
#   ANDROID_SERIAL=emulator-5590 [EXEMPT=battery|alarm|none] scripts/android/gym-reminder-approach-emulator.sh <debug apk>
#
# EXEMPT: how the app may start the check from the background on Android 12+ (battery =
# "Unrestricted" battery, the default here; alarm = "Alarms & reminders" allowed; none = neither,
# then the check is refused and only the gym's own alert is left).
#
# 1. Latency with Android's REAL schedule: the proximity-alert throttle is left at its default
#    (a look every 30 minutes for a background app). The phone waits in a gym's approach zone
#    (650 m out) until Android notices it, which starts the short check with live location; then
#    it walks in at 1.4 m/s. Measured: how long after crossing the gym's radius the notification
#    shows up, and that the check (and its silent notification) ends right after.
# 2.-4. The server check before posting, with the throttle lowered to 15 s only to save the wait
#    (the latency is not what these measure): a fake paired server on the host says "trained
#    today" -> quiet; a server that never answers -> posts after the 3 s bound; no server -> posts.
#
# Needs a running emulator (one, -cores 2 is plenty), Node 22 and the CDP driver
# (CDP=/root/homelab/scripts/android-repro/cdp.mjs). Exits 0 when every step behaved.
set -uo pipefail
APK=${1:?debug apk}
ADB=${ADB:-/opt/android-sdk/platform-tools/adb}
CDP=${CDP:-/root/homelab/scripts/android-repro/cdp.mjs}
PKG=${PKG:-ch.duartesantos.opengym.test}
PREFS=shared_prefs/opengym_gym_reminder.xml
PORT=${PORT:-47731}
EXEMPT=${EXEMPT:-battery}
LAT=47.3769; LNG=8.5417          # the gym (Zurich), radius 100 m, approach zone 800 m
RING_LAT=47.382739               # 650 m north: inside the approach zone, outside the gym
FAR_LAT=47.4200; FAR_LNG=8.5900  # 5 km away
TODAY=$(date +%F)
TMP=$(mktemp -d)
FAIL=0

cdp() { PKG=$PKG timeout 90 node --experimental-websocket "$CDP" eval "$1" 2>&1 | grep '^=>'; }
at() { $ADB shell cmd location providers set-test-provider-location fused --location "$1,$2" --accuracy 8; }
count() { $ADB shell dumpsys notification --noredact | grep -c "android.title=String (Gym spotted"; }
checking() { $ADB shell dumpsys notification --noredact | grep -c "android.title=String (Checking if you made it"; }
note() { $ADB exec-out run-as "$PKG" cat "$PREFS" 2>/dev/null | grep -o '<string name="lastNote">[^<]*' | sed 's/.*>//'; }
foreground() {
  $ADB shell am start -n "$PKG/ch.duartesantos.opengym.MainActivity" >/dev/null 2>&1
  for i in $(seq 1 60); do
    $ADB shell cat /proc/net/unix | grep -q "webview_devtools_remote_$($ADB shell pidof $PKG | tr -d '\r')" && break
    sleep 3
  done
  sleep 8
}
background() { $ADB shell input keyevent KEYCODE_HOME; sleep 2; $ADB shell am kill "$PKG"; sleep 2; }
server() {  # server <url or ''>: what the page hands over on a paired phone
  if [ -z "$1" ]; then cdp "window.Capacitor.Plugins.GymReminder.server({ server: '' }).then(() => 'server cleared')"
  else cdp "window.Capacitor.Plugins.GymReminder.server({ server: '$1', headers: { Authorization: 'Bearer emu' } }).then(() => 'server set')"; fi
}
configure() {
  cdp "window.Capacitor.Plugins.GymReminder.configure({ config: { on: true, window: null, gyms: [{ id: 'emu', name: 'Emulator gym', lat: $LAT, lng: $LNG, radius: 100, text: '' }] } }).then(r => JSON.stringify(r))"
}
new_day() {  # new_day <server or ''>: as if it were tomorrow (force-stop also clears the shade)
  $ADB shell am force-stop "$PKG"; sleep 2
  $ADB exec-out run-as "$PKG" cat "$PREFS" \
    | sed -e "s#<string name=\"lastFired\">[^<]*</string>#<string name=\"lastFired\">2000-01-01</string>#" \
          -e "s#<string name=\"scanDay\">[^<]*</string>#<string name=\"scanDay\">2000-01-01</string>#" > "$TMP/prefs.xml"
  $ADB exec-in run-as "$PKG" sh -c "cat > $PREFS" < "$TMP/prefs.xml"
  foreground; status; server "$1"; configure; background
}
status() {  # nothing logged today, as the page would report it
  cdp "window.Capacitor.Plugins.GymReminder.status({ trainedOn: '2000-01-01', quietOn: '', activeSince: 0, title: 'Gym spotted', body: 'Ready for your workout? 💪', channel: 'Gym reminder', scan: 'Checking if you made it to the gym' }).then(() => 'status ok')"
}
walk_in_fast() {  # far, out the 90 s arming grace, then in; up to 90 s inside
  at $FAR_LAT $FAR_LNG; sleep 95
  for i in $(seq 1 18); do at $LAT $LNG; sleep 5; done
}

# The fake paired server: /api/nudge-check answers with "done" from a file.
echo false > "$TMP/done"
node -e "
  const fs = require('fs'), http = require('http')
  http.createServer((q, r) => {
    const u = new URL(q.url, 'http://x')
    console.log(new Date().toISOString(), q.method, q.url, q.headers.authorization || '')
    if (u.pathname !== '/api/nudge-check') { r.writeHead(404); return r.end() }
    const done = fs.readFileSync('$TMP/done', 'utf8').trim() === 'true'
    r.writeHead(200, { 'Content-Type': 'application/json' })
    r.end(JSON.stringify({ date: u.searchParams.get('date'), done, nudge: !done, rev: 1 }))
  }).listen($PORT, '0.0.0.0')
" > "$TMP/server.log" 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null; rm -rf "$TMP"' EXIT

$ADB install -r -g "$APK" >/dev/null
$ADB shell pm clear "$PKG" >/dev/null
$ADB logcat -c
for p in ACCESS_FINE_LOCATION ACCESS_COARSE_LOCATION ACCESS_BACKGROUND_LOCATION POST_NOTIFICATIONS; do
  $ADB shell pm grant "$PKG" "android.permission.$p" 2>/dev/null || true
done
$ADB shell cmd location set-location-enabled true
$ADB shell dumpsys deviceidle whitelist -"$PKG" >/dev/null 2>&1; $ADB shell appops set "$PKG" SCHEDULE_EXACT_ALARM default
case "$EXEMPT" in
  battery) $ADB shell dumpsys deviceidle whitelist +"$PKG" >/dev/null ;;
  alarm) $ADB shell appops set "$PKG" SCHEDULE_EXACT_ALARM allow ;;
esac
echo "   exemption: $EXEMPT"
# Android's own schedule for phase 1: whatever an earlier run lowered goes back to the default.
$ADB shell settings delete global location_background_throttle_proximity_alert_interval_ms >/dev/null
echo "   proximity-alert throttle: '$($ADB shell settings get global location_background_throttle_proximity_alert_interval_ms | tr -d '\r')' (null = default, 30 min)"
$ADB shell appops set com.android.shell android:mock_location allow
$ADB shell cmd location providers add-test-provider fused --supportsAltitude --supportsSpeed --supportsBearing 2>/dev/null
$ADB shell cmd location providers set-test-provider-enabled fused true
at $FAR_LAT $FAR_LNG

echo "== 1. Android's real schedule: wait in the approach zone, then walk in"
foreground
status
server "http://10.0.2.2:$PORT"
configure
background
sleep 95                                   # the arming grace, far away
t0=$(date +%s)
started=0
while [ $(( $(date +%s) - t0 )) -lt 2100 ]; do   # up to 35 min: one full Android look and a bit
  at $RING_LAT $LNG                         # a phone in the zone: fixes keep coming (5 s)
  sleep 5
  case "$(note)" in *"check started"*|*"check: watching"*) started=1; break ;; *refused*) break ;; esac
done
waited=$(( $(date +%s) - t0 ))
[ $started -eq 1 ] && echo "   Android noticed the approach zone after ${waited} s in it: $(note)" || { echo "   approach zone never noticed in ${waited} s"; FAIL=1; }
echo "   silent check notification showing: $(checking)"
$ADB shell dumpsys location | grep -A1 -i "$PKG" | grep -i "interval\|Request\|@" | head -3 | sed 's/^ */   location request: /'
[ "$EXEMPT" = none ] && { echo "   (no exemption: refused as expected)"; [ $started -eq 0 ] && FAIL=0; $ADB logcat -d -s OpenGymGym | tail -3 | sed 's/^/   log: /'; exit $FAIL; }
if [ $started -eq 1 ]; then
  lat=$RING_LAT; tin=0; t1=$(date +%s); posted=0
  for i in $(seq 1 200); do                 # 7 m every 5 s = 1.4 m/s, 650 m in ~7.7 min
    lat=$(awk "BEGIN{v = $lat - 0.0000629; if (v < $LAT) v = $LAT; printf \"%.7f\", v}")
    at "$lat" $LNG
    d=$(awk "BEGIN{printf \"%d\", ($lat - $LAT) * 111320}")
    [ $tin -eq 0 ] && [ "$d" -le 100 ] && tin=$(date +%s) && echo "   crossed the gym's 100 m after $(( tin - t1 )) s of walking"
    sleep 5
    [ "$(count)" -gt 0 ] && { posted=1; break; }
  done
  if [ $posted -eq 1 ]; then echo "   NOTIFIED $(( $(date +%s) - tin )) s after crossing into the gym"; else echo "   no notification"; FAIL=1; fi
  sleep 3
  echo "   last note: $(note)"
  np=$($ADB logcat -d -s OpenGymGym | grep -c ': posted'); echo "   posted: $np time(s) (the gym's own alert and the check can both see the arrival)"; [ "$np" -eq 1 ] || FAIL=1
  echo "   silent check notification still showing: $(checking)"; [ "$(checking)" -eq 0 ] || FAIL=1
fi
$ADB logcat -d -s OpenGymGym | tail -8 | sed 's/^/   log: /'

echo "== 2.-4. server check (throttle lowered to 15 s for these only)"
$ADB shell settings put global location_background_throttle_proximity_alert_interval_ms 15000

echo "-- 2. the server says today was trained on another device: quiet"
echo true > "$TMP/done"; new_day "http://10.0.2.2:$PORT"; walk_in_fast
n=$(count); echo "   notifications: $n, note: $(note)"; [ "$n" -eq 0 ] || FAIL=1
grep -q "Bearer emu" "$TMP/server.log" && echo "   server saw the pairing header" || FAIL=1

echo "-- 3. the server never answers (black-holed address): posts after the 3 s bound"
echo false > "$TMP/done"; new_day "http://10.255.255.1:9"; walk_in_fast
n=$(count); echo "   notifications: $n"; [ "$n" -ge 1 ] || FAIL=1
$ADB logcat -d -s OpenGymGym | grep "server check" | tail -1 | sed 's/^/   log: /'

echo "-- 4. no server (local only): posts"
new_day ''; walk_in_fast
n=$(count); echo "   notifications: $n, note: $(note)"; [ "$n" -ge 1 ] || FAIL=1

$ADB shell settings delete global location_background_throttle_proximity_alert_interval_ms >/dev/null
echo "   server requests: $(grep -c nudge-check "$TMP/server.log")"
[ $FAIL -eq 0 ] && echo "== ALL GOOD" || echo "== SOMETHING DID NOT BEHAVE"
exit $FAIL
