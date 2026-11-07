#!/bin/bash
# The Connect IQ simulator without a desktop: Xvfb, the SDK's simulator, xdotool for the watch's
# buttons and ffmpeg for screenshots. docs/GARMIN.md "Simulator" has the why; in short:
#
#   sim/run.sh setup              once: private libs for the simulator (see below), Roboto fonts
#   sim/run.sh start              Xvfb on :$SIM_DISPLAY and the simulator (PIDs in $SIM_OUT/pids)
#   sim/run.sh build <dev>        the simulator build (sim/monkey.jungle) -> $SIM_OUT/sim-<dev>.prg
#   sim/run.sh load <dev>         runs it in the simulator (a fresh start: the phone's snapshot again)
#   sim/run.sh key <dev> <k>      presses enter|up|down|esc, or holds: menu (UP held) | hold-enter
#   sim/run.sh tap <dev> <x> <y>  a tap on the screen, in screen pixels
#   sim/run.sh shot <dev> <png>   the watch's screen only, outside a round screen black
#   sim/run.sh window <png>       the whole simulator window (menus, dialogs)
#   sim/run.sh tour <dev> <dir>   build, load, then Start / Set / Rest / Summary screenshots
#   sim/run.sh test <dev>         the unit tests (source/CoreTest.mc) in the simulator
#   sim/run.sh stop               stops only what start started
#
# Needs: the SDK ($CIQ_SDK), the device files in ~/.Garmin/ConnectIQ/Devices (SDK Manager, Garmin
# login; never in the repo), a developer key ($CIQ_KEY), Xvfb, ffmpeg, python3 with Pillow.
#
# Why "setup": the Linux simulator is built for Ubuntu 22.04. On Debian 13 it lacks GTK 3 (taken
# from Debian's packages into a private folder, not installed), WebKitGTK 4.0 / libsoup 2.4 /
# JavaScriptCore 4.0 / libjpeg 8 (only used for its help browser: stub libraries stand in) and it
# crashes in its own built-in FreeType against a newer system libfreetype (Ubuntu 22.04's 2.11.1
# goes next to it). Without Garmin's font pack (~/.Garmin/ConnectIQ/Fonts, also from the SDK
# Manager) it crashes on the first text: setup puts Roboto there, and sim/patch-fonts.py points the
# MIP watches' bitmap fonts at Roboto of the same height (an approximation, see that file).
# The simulator has no phone (it would want an Android phone on ADB, and crashes after its "no data
# connection" dialog), so the simulator build plays the phone: sim/source/Sim.mc.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
garmin=$(dirname "$here")
CIQ_SDK=${CIQ_SDK:-/mnt/build-fast/from-hdd/build-cache/connectiq/sdk-9.2.0}
CIQ_KEY=${CIQ_KEY:-/root/.config/opengym/garmin/developer_key.der}
SIM_LIBS=${SIM_LIBS:-/mnt/build-fast/from-hdd/build-cache/connectiq/simlibs}
SIM_FONTS=${SIM_FONTS:-/mnt/build-fast/from-hdd/build-cache/connectiq/fonts}
SIM_OUT=${SIM_OUT:-$garmin/bin/sim}
SIM_DISPLAY=${SIM_DISPLAY:-77}
DEVICES=${CIQ_DEVICES:-$HOME/.Garmin/ConnectIQ/Devices}
mkdir -p "$SIM_OUT/pids" "$SIM_OUT/logs"
export DISPLAY=:$SIM_DISPLAY

xdo() { LD_LIBRARY_PATH=$SIM_LIBS/lib "$SIM_LIBS/xdotool" "$@"; }
alive() { [ -f "$SIM_OUT/pids/$1" ] && kill -0 "$(cat "$SIM_OUT/pids/$1")" 2>/dev/null; }

setup() {
  local d=$SIM_LIBS/debs
  mkdir -p "$d" "$SIM_LIBS/lib" "$SIM_LIBS/stub" "$SIM_FONTS"
  ( cd "$d"
    apt-get download libgtk-3-0t64 libgtk-3-common libsecret-1-0 libcolord2 libcloudproviders0 xdotool libxdo3 fonts-roboto-unhinted 2>&1 | grep -v '^W:' || true
    [ -f libfreetype6_2.11.1+dfsg-1ubuntu0.4_amd64.deb ] || curl -sfO http://archive.ubuntu.com/ubuntu/pool/main/f/freetype/libfreetype6_2.11.1+dfsg-1ubuntu0.4_amd64.deb
    rm -rf x && mkdir x && for f in *.deb; do dpkg -x "$f" x; done )
  cp -a "$d"/x/usr/lib/x86_64-linux-gnu/*.so* "$SIM_LIBS/lib/"
  cp "$d/x/usr/bin/xdotool" "$SIM_LIBS/"
  # stubs: every webkit_/JS/soup/jpeg symbol the simulator binds at load, returning 0
  ( echo '#include <stdio.h>'
    nm -D --undefined-only "$CIQ_SDK/bin/simulator" | awk '{print $2}' | sed 's/@.*//' | grep -E '^(webkit_|JS|soup_|jpeg_)' |
      sed -E 's/^(.*)$/long \1(void){fprintf(stderr,"stub \1\\n");return 0;}/'
    nm -D --undefined-only "$CIQ_SDK/bin/simulator" | awk '{print $2}' | sed 's/@.*//' | grep -E '^kJS' | sed -E 's/^(.*)$/long \1;/'
  ) > "$SIM_LIBS/stub/stubs.c"
  for so in libwebkit2gtk-4.0.so.37 libsoup-2.4.so.1 libjavascriptcoregtk-4.0.so.18 libjpeg.so.8; do
    gcc -shared -fPIC -o "$SIM_LIBS/lib/$so" -Wl,-soname,$so "$SIM_LIBS/stub/stubs.c"
  done
  cp "$d"/x/usr/share/fonts/truetype/roboto/unhinted/RobotoTTF/*.ttf "$d"/x/usr/share/fonts/truetype/roboto/unhinted/RobotoCondensed-*.ttf "$SIM_FONTS/"
  ( cd "$SIM_FONTS"
    ln -sf RobotoCondensed-Regular.ttf Roboto-Condensed_0.ttf; ln -sf Roboto-Medium.ttf Roboto-Medium-Outdoor.ttf
    ln -sf Roboto-Bold.ttf Bionic_Bold.ttf; ln -sf Roboto-Medium.ttf Bionic_Medium.ttf
    for f in Kosugi-Regular Kosugi-Regular-2 Kosugi-Regular-Outdoor NanumGothic-Bold NotoNaskhArabic-Bold NotoNaskhArabic-Regular \
      NotoSansArmenian-Bold NotoSansArmenian-Regular NotoSansHebrew-Bold NotoSansHebrew-Regular NotoSansSC-Medium NotoSansSC-Medium-2 \
      NotoSansSC-Medium-Outdoor Pridi-Regular; do [ -e $f.ttf ] || ln -sf Roboto-Regular.ttf $f.ttf; done )
  local fonts=$HOME/.Garmin/ConnectIQ/Fonts
  if [ ! -e "$fonts" ] || { [ -d "$fonts" ] && [ -z "$(ls -A "$fonts")" ]; }; then rm -rf "$fonts"; ln -s "$SIM_FONTS" "$fonts"; fi
  echo "setup done: libs in $SIM_LIBS, fonts in $fonts"
}

start() {
  if ! alive xvfb; then
    nice -n 10 Xvfb :$SIM_DISPLAY -screen 0 1400x1200x24 -nolisten tcp > "$SIM_OUT/logs/xvfb.log" 2>&1 < /dev/null &
    echo $! > "$SIM_OUT/pids/xvfb"; sleep 2
  fi
  if ! alive sim; then
    ( cd "$CIQ_SDK/bin" && LD_LIBRARY_PATH=$SIM_LIBS/lib nice -n 10 ./simulator > "$SIM_OUT/logs/sim.log" 2>&1 < /dev/null & echo $! > "$SIM_OUT/pids/sim" ) > /dev/null 2>&1
    sleep 5
  fi
  alive sim || { echo "simulator did not start, see $SIM_OUT/logs/sim.log" >&2; exit 1; }
}

stop() {
  for p in monkeydo sim xvfb; do
    if alive $p; then kill "$(cat "$SIM_OUT/pids/$p")" 2>/dev/null || true; fi
    rm -f "$SIM_OUT/pids/$p"
  done
}

build() {
  ( cd "$garmin" && node sim/gen.mjs >/dev/null &&
    nice -n 15 "$CIQ_SDK/bin/monkeyc" -f sim/monkey.jungle -d "$1" -y "$CIQ_KEY" -o "$SIM_OUT/sim-$1.prg" -w > "$SIM_OUT/logs/build-$1.log" 2>&1 ) ||
    { grep -E 'ERROR' "$SIM_OUT/logs/build-$1.log" >&2; exit 1; }
}

load() {
  start
  if alive monkeydo; then kill "$(cat "$SIM_OUT/pids/monkeydo")" 2>/dev/null || true; fi
  # the screen as it was, to see when the app has drawn over it
  sleep 1; shot "$1" "$SIM_OUT/before.png" 2>/dev/null || true
  ( cd "$SIM_OUT" && nice -n 10 "$CIQ_SDK/bin/monkeydo" "sim-$1.prg" "$1" > "$SIM_OUT/logs/monkeydo-$1.log" 2>&1 < /dev/null & echo $! > "$SIM_OUT/pids/monkeydo" ) > /dev/null 2>&1
  local i
  for i in $(seq 1 60); do
    sleep 1
    alive sim || { echo "simulator died, see $SIM_OUT/logs/sim.log" >&2; exit 1; }
    shot "$1" "$SIM_OUT/now.png" 2>/dev/null || continue
    if python3 - "$SIM_OUT/now.png" "$SIM_OUT/before.png" <<'PY'
import sys
from PIL import Image, ImageStat
im = Image.open(sys.argv[1]).convert('L')
w, h = im.size
centre = im.crop((w // 4, h // 4, w * 3 // 4, h * 3 // 4))
# the app's screens are black with text: a dark centre with some contrast
st = ImageStat.Stat(centre)
ok = st.mean[0] < 120 and st.stddev[0] > 8
try:
    from PIL import ImageChops
    b = Image.open(sys.argv[2]).convert('L')
    if b.size == im.size and not ImageChops.difference(b, im).getbbox():
        ok = False   # still what was there before the load
except Exception:
    pass
sys.exit(0 if ok else 1)
PY
    then sleep 2; return 0; fi
  done
  echo "no new screen after 60 s (or the same one as before), see $SIM_OUT/logs/monkeydo-$1.log" >&2
}

# geometry <dev> <what>: screen x y w h | key <id> cx cy (absolute, on the X display)
geo() {
  local win; win=$(xdo search --name "CIQ Simulator" | head -1)
  local g; g=$(xdo getwindowgeometry --shell "$win" | tr '\n' ' ')
  python3 - "$DEVICES/$1" "$1" "$g" "$2" "${3:-}" <<'PY'
import json, sys
d, dev, g, what, arg = sys.argv[1:6]
g = dict(kv.split('=') for kv in g.split())
j = json.load(open(f'{d}/simulator.json'))
# the device picture sits under the menu bar, left-aligned, inside a 1 px border
wx = int(g['X']) + 1
wy = int(g['Y']) + 26
if what == 'screen':
    l = j['display']['location']; print(wx + l['x'], wy + l['y'], l['width'], l['height'], j['display']['shape'])
else:
    for k in j['keys']:
        if k['id'] == arg:
            l = k['location']; print(wx + l['x'] + l['width'] // 2, wy + l['y'] + l['height'] // 2); break
    else:
        sys.exit(f'no key {arg}')
PY
}

key() {
  local k=$2 id=$2 hold=0
  case $k in menu) id=up; hold=1 ;; hold-enter) id=enter; hold=1 ;; esac
  # a watch without UP (Venu Sq 2) has its menu on the START button
  if [ $k = menu ] && ! geo "$1" key up >/dev/null 2>&1; then id=enter; fi
  read -r x y < <(geo "$1" key $id)
  if [ $hold = 1 ]; then xdo mousemove $x $y mousedown 1 sleep 1.6 mouseup 1; else xdo mousemove $x $y click 1; fi
  xdo mousemove 1390 1190   # the pointer out of the screenshots
  sleep 1.2
}

tap() {
  read -r sx sy w h shape < <(geo "$1" screen)
  xdo mousemove $((sx + $2)) $((sy + $3)) click 1
  xdo mousemove 1390 1190
  sleep 1.2
}

window() { ffmpeg -loglevel error -y -f x11grab -video_size 1400x1200 -i :$SIM_DISPLAY -frames:v 1 "$1"; }

shot() {
  read -r sx sy w h shape < <(geo "$1" screen)
  ffmpeg -loglevel error -y -f x11grab -video_size ${w}x${h} -i :$SIM_DISPLAY+$sx,$sy -frames:v 1 "$2"
  if [ "$shape" = round ]; then
    python3 - "$2" <<'PY'
import sys
from PIL import Image, ImageDraw
im = Image.open(sys.argv[1]).convert('RGB'); w, h = im.size
m = Image.new('L', (w * 4, h * 4), 0); ImageDraw.Draw(m).ellipse((0, 0, w * 4 - 1, h * 4 - 1), fill=255)
out = Image.new('RGB', (w, h), (0, 0, 0)); out.paste(im, mask=m.resize((w, h), Image.LANCZOS)); out.save(sys.argv[1])
PY
  fi
}

tour() {
  local dev=$1 dir=$2
  mkdir -p "$dir"
  build "$dev"; load "$dev"
  shot "$dev" "$dir/$dev-1-start.png"
  key "$dev" enter;                         shot "$dev" "$dir/$dev-2-set.png"
  key "$dev" enter;                         shot "$dev" "$dir/$dev-3-rest.png"
  # the workout menu: skip set, next exercise, finish and save, discard, continue
  key "$dev" menu;                          shot "$dev" "$dir/$dev-5-menu.png"
  if geo "$dev" key down >/dev/null 2>&1; then
    key "$dev" down; key "$dev" down; key "$dev" enter
    shot "$dev" "$dir/$dev-6-confirm.png"
    key "$dev" enter
  else
    # touch only (Venu Sq 2): the third item, then Confirm (bottom right)
    read -r sx sy w h shape < <(geo "$dev" screen)
    tap "$dev" $((w / 2)) $((h * 83 / 100))
    shot "$dev" "$dir/$dev-6-confirm.png"
    tap "$dev" $((w * 3 / 4)) $((h * 63 / 100))
  fi
  shot "$dev" "$dir/$dev-4-summary.png"
  echo "$dev: screenshots in $dir"
}

unit_tests() {
  start
  ( cd "$garmin" && node sim/gen.mjs >/dev/null &&
    nice -n 15 "$CIQ_SDK/bin/monkeyc" -f sim/monkey.jungle -d "$1" -y "$CIQ_KEY" -o "$SIM_OUT/test-$1.prg" -t -w > "$SIM_OUT/logs/testbuild-$1.log" 2>&1 ) ||
    { grep -E 'ERROR' "$SIM_OUT/logs/testbuild-$1.log" >&2; exit 1; }
  ( cd "$SIM_OUT" && timeout 150 nice -n 10 "$CIQ_SDK/bin/monkeydo" "test-$1.prg" "$1" -t > "$SIM_OUT/logs/test-$1.log" 2>&1 < /dev/null ) || true
  grep -a -A30 '^RESULTS' "$SIM_OUT/logs/test-$1.log" || { echo "no results, see $SIM_OUT/logs/test-$1.log" >&2; exit 1; }
  grep -aq 'failed=0, errors=0' "$SIM_OUT/logs/test-$1.log"
}

cmd=${1:-}; shift || true
case $cmd in
  setup|start|stop|build|load|key|tap|shot|window|tour) $cmd "$@" ;;
  test) unit_tests "$@" ;;
  *) sed -n '2,21p' "$0"; exit 1 ;;
esac
