# openGym on Wear OS

A watch app for Wear OS 3 and later: Samsung Galaxy Watch 4 and newer, Pixel Watch, OnePlus Watch,
TicWatch, Fossil Gen 6 and the rest. It is the Apple Watch app's twin: the phone stays the source
of truth, and the watch follows the workout the phone runs, logs sets on it and can start a
routine by itself.

**Status: beta since v1.4.4.** It builds and its tests pass, but it has met few real watches yet.
On the watch it is labelled "openGym Beta"; on Google Play it ships to the Wear OS closed-testing
track first. Drop the label (`app_name` in `wear/wear-strings.mjs`) once testers confirm it.

## What it does

Since 1.4.5 it has the Apple Watch's design and features (the watch redesign, idea and first
versions by @cubetes): one design on every wrist. The rules live in `WatchLogic.kt`, the twin of
`ios/App/WatchCore` (Plan, Overview, SetNav, RestMath, Outbox), tested case for case in
`WatchLogicTest.kt`; the screens are Compose for Wear OS (`ui/`).

- **Look**: the phone's dark tokens and the accent the app wears (`settings.accent`/`onAccent`
  from watchExtras), green until the phone has said. Always On draws outlines, no lit fills, and
  nothing moves.
- **Start**: "Today" beside the clock, the routine's name, its exercises and sets, one wide Start,
  the other routines as rows, the build number at the bottom. Quick start on a day without a plan.
  Before anything came from the phone it says so. Start waits a second after the summary's Done.
- **Weigh-in** before a start on the watch (unless the phone's check-in is off), then a 3-2-1 ring
  that ends on Go! while the heart-rate sensor warms up.
- **One session screen**, pages side by side: Overview ← Set → Metrics → Music.
  - Overview: every exercise with its work sets, the current one outlined, supersets under one
    heading, "Waiting to sync 3" or "All synced", **Finish as a 1 s hold**, Discard with its own
    question. It comes up by itself after the last set. Wrist down there: back to the set.
    Each row leads with the exercise's still, as on the Apple Watch: the phone sends the running
    workout's 180 px stills from its own app package (`/opengym/still/<exId>`, ~5 KB each, never
    fetched), greyed when done, the state on its corner, none in Always On or with the phone's
    animations off; the watch deletes them when the workout ends.
  - Set: the exercise, "Set 2 of 4" with warm-up / left / right, the superset partner, the numbers
    in boxes, last time, and ‹ Done ›. The crown (or bezel) turns the outlined number in the
    exercise's steps; tap the other box to hand it the crown, tap the outlined one again for a
    keypad (62.25 kg). ‹ › open a logged set to fix it: the same `setDone` again with a later `at`
    and no `hr`, so the phone keeps the set's heart rate. A long press on Done skips the set.
  - Rest (on the set page): the time big, a draining bar, Up next with what to load, effort chips
    (RIR 0/1/2/3+ or RPE 10/9/8/≤7, as the phone logs), −15 s / Skip / +15 s, which ignore taps for
    a second after Done. ‹ opens the set just done to fix it while the rest runs on.
  - Hold: the seconds left big, a teal bar whose last 5 s turn orange, a tick for each of the last
    three, Stop. Finish mid-hold logs the seconds held. "Timed holds start by themselves" on the
    phone: a 3-2-1 after the rest, then the hold.
  - Metrics: the workout's time (it stands still while the phone has the workout paused), heart
    rate, volume, sets. Music: a small remote (previous, play/pause, next, volume) for whatever
    plays on the watch.
- **"All done?"** after 20 minutes without a set: a card, Continue or Finish (which goes to the
  Overview's hold). On Wear OS it only asks; it never ends a workout by itself.
- **Summary**: the time big, sets, volume, PRs, heart rate, the sync line; Done ignores its first
  second.
- **Sync status**: sets the phone's side has not stored yet (`setDone` events in the outbox not
  delivered), as an orange pill beside the clock, in words on Start, the Overview and the summary,
  and on the Tile and the complication.
- **Motion**: screens and panels fade (0.2 s ease-out), ‹ › slide the set's lines in from that
  side, the 3-2-1 springs each number in. With Remove animations on: short fades only.
- **Heart rate**: Health Services while a workout runs, as the workout's own type (the phone's
  `healthType`: a run, a ride, yoga…; strength training otherwise). Each set logged on the watch
  carries its average and maximum, exactly the `hr` the Apple Watch sends; a set ticked on the
  phone gets its heart rate from the watch afterwards, measured from the set's start to the
  phone's tick (`setHr`, `SessionCore.phoneTicks`), and the rest after a set sends its own
  reading once it is over (`setHr` with `restHr`: ran out, skipped, the next set logged, or the end). Three hours with nothing happening in the
  workout (`SensorPlan`) and the sensor rests; the next set or phone change wakes it.
- **Ongoing activity**, **Tile** (streak and today's plan, or the sets as a ring and the exercise
  up next, plus the waiting count) and **complication** (sets done as a ring, else the streak;
  "↑3" as its title while sets wait).
- **Language**: the app's, not the watch's (the phone sends it), in all 24 of the app's languages.
- **Always On** on a screen that can burn in: the whole screen moves up to 3 dp once a minute,
  round a 3 × 3 grid (`BurnIn`).
- **TalkBack**: a number box (weight, reps, seconds) and the weigh-in read their name and value
  apart, and offer More and Less in TalkBack's actions, like the Apple Watch's adjustable numbers.
- **The rest from the phone**: a rest started on the phone runs on the watch as well. The watch
  follows only a *new* rest end from the phone, so a snapshot with the same end can't undo a ±15
  or a Skip pressed on the watch (`RestMath.follows`).

No exercise media goes to the watch beyond the Overview's stills (above): no animations.

Still not on Wear OS: calories (Health Services can give them; not wired up yet), the
forgotten-workout end after 45 minutes (it needs the phone's answer, #904), and a Settings page on
the watch (the phone's settings apply).

### Screenshots

Debug builds show any screen with a demo workout (`src/debug/assets/demo-snapshot.json`, text
and numbers only):

```bash
adb shell am start -n ch.duartesantos.opengym.test/ch.duartesantos.opengym.wear.MainActivity --es demo rest
# start, rest, overview, metrics, media, fix, hold, summary, weighin, countdown, go, idle; --es ambient 1 for Always On
```

## Installing

The watch app has to come from where the phone app came from. The Data Layer only links two apps
with the same package name **and the same signing key**, so:

| Phone app | Watch app |
| --- | --- |
| Google Play | Play Store on the watch → "Apps on your phone" → openGym |
| The APK from opengym.ch / GitHub | `openGym-Wear-<version>.apk` of the same release (same key) |
| F-Droid, openGym Offline | none: no Google Play services, no Wear OS link |

A watch with the other one looks to the phone exactly like a watch without the app. Settings →
Wear OS watch on the phone says which of the two you need.

Sideloading the APK (Galaxy Watch 4 and newer, Pixel Watch):

1. On the watch: Settings → About watch → Software → tap "Software version" seven times, then
   Settings → Developer options → ADB debugging on, Wireless debugging on. Note the IP and port.
2. On a computer in the same Wi-Fi: `adb pair <ip>:<pair-port>` (the code is on the watch), then
   `adb connect <ip>:<port>` and `adb install openGym-Wear-<version>.apk`.
3. Open openGym on the phone once, then on the watch. Settings → Wear OS watch on the phone should
   say "openGym is on your watch and in reach" and, a moment later, when it last heard from the watch.

If it does not connect:

- "Your watch is here, openGym isn't on it yet" although it is installed: the two apps are from
  different sources (different keys). Install the matching one.
- "Not synced yet" on the watch: open openGym on the phone once. The routines come with the first snapshot.
- Sets arrive only when the phone app is opened: the phone keeps the app from running in the
  background (Samsung: Settings → Apps → openGym → Battery → Unrestricted, and take it off "Deep
  sleeping apps"). Nothing is lost either way: the sets wait on the watch and in the Data Layer.
- No heart rate, or no rest buzz with the screen off: allow the sensor permission the watch asks
  for at the first workout. Without it the workout service may not run in the background.

## How it talks to the phone

The same JSON the Apple Watch gets and sends (frontend/src/lib/watch-sync.js), over the Wearable
Data Layer instead of WatchConnectivity. On the phone, `WatchBridgePlugin.java` has the same name
and the same calls as the iPhone's `WatchBridgePlugin.swift`, so the page needs no second code
path: it only lets Android in as a platform with a watch link.

| Path | Kind | Direction | Content |
| --- | --- | --- | --- |
| `/opengym/snapshot` | data item | phone → watch | `snapshot` (buildSnapshot's JSON, plus `streak`), `at` |
| `/opengym/event/<id>` | data item | watch → phone | `event` (one event's JSON), `seq` (order) |
| `/opengym/open` | message | phone → watch | a workout started on the phone: show it |

Events are data items, so the Data Layer keeps them while the phone is asleep or away, the way
`transferUserInfo` does on the Apple Watch. The phone deleting an item is the watch's sign that it
was stored (`WearListener` listens on `/opengym/event/` for exactly that); until then the watch puts
it again, each time waiting twice as long (20 s up to 10 min, `OutboxCore.wait`), and looks after
the link every 30 s while a workout runs. The watch also checks in (`watchStatus`, at most every six
hours and after an update), which is what "Last heard from the watch" in the phone's Settings shows. `WatchListenerService` on the phone writes each to a
queue file (even with the app closed), then deletes the item; the page drains the queue, applies
each event once by its id and acknowledges it (`WatchEventQueue.java`). Capabilities:
`opengym_phone` (phone app) and `opengym_wear` (watch app) let each side find the other.

Without Google Play services or without the watch app, `status()` says "no watch" and the page
sends nothing: the phone behaves as before.

Contract tests, both reading the same files in `frontend/android/wear/src/test/resources`:
`snapshot.json` is built by `watch-sync.wear.test.js` and parsed by `CodecTest.kt`; `events.json`
is built by `SessionCore.kt` (`CodecTest.kt`) and applied by `watch-sync.wear.test.js`. The
session logic (`SessionCore.kt`) is a port of `ios/App/WatchCore` with its cases in
`SessionCoreTest.kt`.


## Building

```bash
cd frontend/android
./gradlew :wear:assembleDebug          # debug APK, ch.duartesantos.opengym.test (pairs with the phone's debug build)
./gradlew :wear:testDebugUnitTest      # SessionCore, the codec, the offline scenarios (OfflineSyncTest)
node wear/wear-strings.mjs             # the strings, from the app's and the Apple Watch's translations
scripts/android/build-wear.sh <keystore> <password-file> <alias-file> [out]   # release AAB + APK
```

The Data Layer links two apps only with the same applicationId and the same signing key: a debug
watch with a debug phone, a release watch with a release phone (or the Play-signed pair).

### Emulators

A phone emulator and a watch emulator cannot be paired without a Google account. The watch
emulator has a working Data Layer of its own, so the debug `RigReceiver` (watch, `src/debug`) puts
the phone's snapshot there as the real data item and lists and deletes the watch's event items
the way the phone does: `WearListener`, the outbox and the store are the shipped code, and the
phone is played by the page's own `watch-sync.js` in Node. On a phone emulator without a Wear OS
companion the Data Layer answers "API unavailable" to everything (which is what `status()` turns
into "no watch"), so its twin `WatchRigReceiver` (phone, `src/sideloadDebug`) is only of use on a
phone image that has one. Neither receiver exists in a release build.

### Versions

The watch app takes the phone's `versionName` and **`versionCode` = phone versionCode + 10000**
(read from `app/build.gradle` by `wear/build.gradle`, nothing to bump by hand). Google Play keeps
one versionCode space per app for every form factor, so the phone (30 for 1.4.4) and the watch
(10030) never collide, and each release's watch build is newer than the last one's.

## Google Play

The watch app goes into the phone app's listing (same package), as its own bundle:

1. Play Console → the app → Test and release → Advanced settings → Form factors → **Add form
   factor → Wear OS**, and accept the Wear OS terms.
2. Store listing → the Wear OS section: at least one Wear OS screenshot (384 × 384 or larger,
   round content on a square canvas) and, optionally, a Wear-specific description.
3. Upload `openGym-Wear-<version>.aab` to the **Wear OS** track (closed testing first; Wear OS has
   its own dedicated tracks), with the same release notes.
4. Data safety: unchanged in kind (heart rate stays on the device and goes only to the user's own
   phone app), but add "Health info: heart rate" as collected, not shared, if the review asks.
5. Send it for review. Wear OS apps get their own quality review (round layout, no cut-off text,
   works with the phone app).
