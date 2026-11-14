# openGym on Wear OS

A watch app for Wear OS 3 and later: Samsung Galaxy Watch 4 and newer, Pixel Watch, OnePlus Watch,
TicWatch, Fossil Gen 6 and the rest. It is the Apple Watch app's twin: the phone stays the source
of truth, and the watch follows the workout the phone runs, logs sets on it and can start a
routine by itself.

**Status: beta since v1.4.4.** It builds and its tests pass, but it has met few real watches yet.
On the watch it is labelled "openGym Beta"; on Google Play it ships to the Wear OS closed-testing
track first. Drop the label (`app_name` in `wear/wear-strings.mjs`) once testers confirm it.

## What it does

- **Start**: today's planned routine with one tap, Quick start (the first routine) on a day
  without a plan, or any of the routines the phone offers. Before anything came from the phone it
  says so, instead of pretending there is nothing to do.
- **The set**: the exercise, set k of n, warm-up / side / superset tags, last time, and weight and
  reps as two big tiles. The crown (or the rotating bezel) turns the lime-outlined one; a second
  tap opens it full screen with − and + for watches without a crown. Done logs the set (a long
  press skips it). Holds log seconds; cardio is logged on the phone.
- **The rest**: a ring that empties, the countdown, the next set, +15 and Skip. A nudge ten
  seconds before the end, a clear double buzz at the end.
  A rest started on the phone runs on the watch as well.
- **Heart rate**: Health Services, as a strength-training exercise while a workout runs. Each set
  logged on the watch carries its average and maximum, exactly the `hr` the Apple Watch sends.
- **The end**: Finish and save (the phone's own Finish and save runs), Continue, or Discard (two
  taps). The summary shows time, sets, volume, heart rate and the PRs; "Ended on your phone" when
  the phone finished it first.
- **Ongoing activity**: the running workout stays on the watch face and in recents; on the watch
  face it shows the rest counting down, else the sets so far. A tap goes back in.
- **Tile**: the week streak, big (lime once this week has a workout), and today's plan, or a rest
  day. While a workout runs: its sets as a ring and the exercise up next.
- **Complication**: sets done as a ring with 3/12 during a workout, else the week streak.
- **Language**: the app's, not the watch's (the phone sends it), in all the app's languages.

No exercise media goes to the watch: text and numbers only.

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
`transferUserInfo` does on the Apple Watch. `WatchListenerService` on the phone writes each to a
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

Not ported yet from the Apple Watch: the weigh-in before a start, the effort (RPE/RIR) editor,
the forgotten-workout check, animations, and a Settings page on Android (the defaults apply).

## Building

```bash
cd frontend/android
./gradlew :wear:assembleDebug          # debug APK, ch.duartesantos.opengym.test (pairs with the phone's debug build)
./gradlew :wear:testDebugUnitTest      # SessionCore and the codec
node wear/wear-strings.mjs             # the strings, from the app's and the Apple Watch's translations
scripts/android/build-wear.sh <keystore> <password-file> <alias-file> [out]   # release AAB + APK
```

The Data Layer links two apps only with the same applicationId and the same signing key: a debug
watch with a debug phone, a release watch with a release phone (or the Play-signed pair).

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
