# openGym on Garmin

A Connect IQ watch app for Garmin watches, the Apple Watch and Wear OS apps' little sibling: the
phone stays the source of truth, the watch follows the workout the phone runs, logs sets on it and
can start today's routine by itself. Source: `frontend/garmin` (Monkey C).

**Status (v1.4.5):** the watch app is written, its strings are in, its logic has unit tests, and
`node frontend/garmin/check.mjs` passes. It has **not been compiled yet**: Garmin's compiler needs
each watch's device files, and those only come through the SDK Manager with a Garmin account
(see "What the owner does"). The phone side (the Connect IQ Mobile SDK in the Android and iPhone
apps) is specified below but not wired up, so the watch app does nothing useful until it is.

## What it does

| Screen | What you see | Buttons | Touch |
| --- | --- | --- | --- |
| Start | your week streak, big (lime once this week has a workout), today's routine, Start | START starts today's (or Quick start: the first routine), UP / DOWN / MENU list the routines, BACK leaves | tap Start, tap elsewhere for the list |
| Set | the exercise, "Set 2 of 4" (warm-up, left / right, superset), weight and reps as big numbers, heart rate and last time, Done | START logs the set (a short buzz), UP / DOWN change the lime number by one step (the exercise's own plate step, 1 rep, 5 s for holds), BACK switches weight and reps, MENU: skip set, next exercise, finish, discard | tap a number to pick it, swipe down / up for more / less, tap Done, touch and hold (or tap the name) for the menu |
| Rest | a ring that empties, the countdown, the next set, heart rate | START or BACK skips, UP +15 s, DOWN -15 s | +15, Skip |
| Summary | "Workout saved" (or "Ended on your phone"), time, sets, volume, average / max heart rate | any button | a tap |

- A buzz ten seconds before the rest ends and a clear double buzz at the end (the phone's
  "rest haptics" setting turns them off). A rest started on the phone runs on the watch too.
- BACK never ends a running workout by accident: on a set it switches weight and reps, and where
  there is only one number it opens the menu. Finish and Discard ask first.
- Holds log seconds, cardio is logged on the phone (the watch says so and moves on).
- No exercise media goes to the watch, text and numbers only (and the licence would not allow it).
- Heart rate: the watch's optical sensor (`Toybox.Sensor` / `Activity.Info.currentHeartRate`)
  while a workout runs. Each set logged on the watch carries `hr: { avg, max }`, exactly what the
  Apple Watch and Wear OS send, so the phone shows it per set the same way.

Not here yet (the Apple Watch has them): the weigh-in before a start, the effort (RPE / RIR) editor,
the forgotten-workout check, a glance / complication. The language is the watch's own (Connect IQ
picks resources by the watch's system language; the phone's `lang` is sent but not used).

### Design

Garmin screens are small (176 to 454 px) and many are MIP (memory-in-pixel: 64 colours, made for
sunlight) or, on the Instinct, black and white. So: white on black, the numbers in the system's
number fonts as big as the screen allows, one accent colour that means "this is what you change or
press" (the value UP and DOWN move, Done, a streak kept this week), and no animation beyond the rest
ring. The accent is openGym's green on AMOLED and the palette's own bright lime on MIP (so it is not
rounded to a dull green); the Instinct builds use white instead (`(:mono)` in `source/Ui.mc`, picked
per device in `monkey.jungle`). Every text line is cut to the width the round screen really has at
its height, and every touch target is at least a finger wide.

### Watches

`manifest.xml` lists 82 products, everything from Connect IQ 3.2 up that is a watch people lift
with: Forerunner 165 / 245 / 255 / 265 / 55 / 570 / 745 / 945 / 955 / 965 / 970, fēnix 6 / 7 / 8 / E,
epix (Gen 2) and epix Pro, enduro / enduro 3, Venu 1 / 2 / 3 / 4 / Sq / Sq 2 / X1, vívoactive 4 / 5 / 6,
Instinct 2 / 2S / 2X / 3 / Crossover / E, MARQ (Gen 2), Descent Mk2 / Mk3 / G2, D2 Mach, Approach S70.
Adding one is a line in `manifest.xml` (and, for a black-and-white screen, one in `monkey.jungle`).
The oldest watches here (Forerunner 55 and 245, fēnix 6) give a watch app the least memory; the app
keeps its state small for them (see "How it talks to the phone"), but they are the first to try in
the simulator.

## How it talks to the phone

The same protocol as the other two watches (`frontend/src/lib/watch-sync.js`): snapshots from the
phone, events from the watch, the phone applying each event once, by its id, through the workout
screen's own actions. Only the wire differs: Connect IQ messages through Garmin Connect Mobile.

### Phone → watch: the snapshot

`lib/garmin-snapshot.js` `garminSnapshot(snap)` cuts the snapshot `startWatchSync` builds (with
settings, streak and discarded) down to what a Connect IQ message carries:

- the running workout's **window**: the exercise up now, its whole superset, and the one after it,
  each with `i` (its place in the whole workout, the events' `entryIdx`); plus `count`,
  `progress: [done, total]` and `volume` over the whole workout, for the end page and the summary;
- **today's routine** with its exercises (so the watch can start it with the phone away), the
  **other routines by name** only (up to 8; the watch asks the phone to start those);
- settings (`restHaptics`, `lang`, `show`), the streak, the last few discarded ids;
- at most **4 KB as JSON** (`GARMIN_MAX_BYTES`), cutting the least useful parts first.

Same field names as the other watches' snapshot. The fixture `frontend/garmin/test/snapshot.json`
is what the watch is written against; `garmin-snapshot.test.js` builds it from the Wear OS fixture
(`UPDATE_GARMIN_FIXTURES=1` to change it on purpose). The bridge sends it as a **dictionary**, not a
JSON string: Monkey C has no JSON parser, and Connect IQ converts maps, lists, strings, numbers and
booleans on its own.

### Watch → phone: the events

`Communications.transmit({ "events" => [ … ] })`, up to four at a time, each exactly as in
`frontend/android/wear/src/test/resources/events.json`:

| type | fields |
| --- | --- |
| `setDone` | `id, wid, exId, entryIdx, setIdx, at, w?, r?, sec?, side?, hr? { avg, max }` |
| `start` | `id, routineIds, wid, at` |
| `finish` / `discard` | `id, wid, at` |
| `hello` | `id, at`: for the bridge only ("send me the latest snapshot"), never queued for the page |

Events wait in the watch's storage until `transmit` reports them delivered, so a set logged with
the phone away is sent when it is back; one sent twice is applied once (the page keeps the ids).
Times are ms since 1970 as `Long`.

### The phone side (to do)

Nothing on the page changes: the bridge plugs into `WatchBridge`, the plugin both phone apps
already have, so `startWatchSync` keeps calling `status`, `sendSnapshot`, `drain` and `ack`.

1. **Android** (`android/app`, play flavour first): the Connect IQ Mobile SDK
   (`com.garmin.connectiq:ciq-companion-app-sdk`, Maven Central, Garmin's licence). On start,
   `ConnectIQ.getInstance(ctx, IQConnectType.WIRELESS)`, `initialize`, then for each
   `getConnectedDevices()` an `IQApp("3c533c63754d40189c000ad529e400b9")` (the manifest id) and
   `registerForAppEvents`. Incoming `events` go into the same `WatchEventQueue` file the Wear OS
   listener writes (the page drains them as it does now); a `hello` instead re-sends the last
   snapshot. `sendSnapshot({ json })` additionally converts `garminSnapshot(JSON.parse(json))` to
   `Map`/`List` and calls `sendMessage`. `status()` reports `paired && installed` when a Garmin
   with the app is connected (`getApplicationInfo`). One addition on the page: `startWatchSync`
   passes `garmin: JSON.stringify(garminSnapshot(fitted))` with `sendSnapshot`, so the cut is made
   (and tested) in JavaScript, not twice in Java and Swift.
2. **iPhone** (`ios/App/App`): the Connect IQ iOS SDK (`ConnectIQ.xcframework`). It needs a URL
   scheme in Info.plist: `showConnectIQDeviceSelection` hands over to Garmin Connect Mobile, which
   returns the chosen watches through that URL; the app keeps them. Then `register(forAppMessages:)`
   and `sendMessage` as on Android. The Apple Watch keeps priority when both are paired.
3. **Licence and builds.** The Connect IQ Mobile SDK is not open source. It goes into the store
   flavours only (Play, App Store); the sideload / F-Droid-style APK stays free of it, and there the
   Garmin app simply finds no phone. This needs a check against the CLA and AGPL notes in
   NOTICE.md before it ships.
4. **Opening the app on the watch** when a workout starts on the phone: the Mobile SDK's
   `openApplication` shows a prompt on the watch ("open openGym?"); the Settings → Apple Watch
   "Open on the watch" switch can drive it.

This was left out of v1.4.5 on purpose: adding a closed-source SDK and a second link to both phone
builds is the kind of change that wants its own release, a real watch and a review.

## Garmin Connect and the health apps

With "Also save to Garmin Connect" on (the watch app's one setting, default on, changed in the
Connect IQ app on the phone), the watch records the workout as an activity
(`ActivityRecording`, `SPORT_TRAINING` / `SUB_SPORT_STRENGTH_TRAINING`) with a lap per set. It lands
in Garmin Connect with its duration, heart rate and calories, and counts towards training load,
intensity minutes and the rest of Garmin's numbers. Saved at Finish, thrown away at Discard; if the
app is closed mid-workout, what was recorded is kept and not started again for that workout.

**Double counting.** openGym on the phone can write each workout to Health Connect (Android) or
Apple Health (iPhone), and Garmin Connect can share its activities there too (Apple Health on the
iPhone; Health Connect on Android, depending on the Garmin Connect version and its settings). With
both on, the hub has the same workout twice and its calories add up twice. What the user can do
today, and what the docs and the store listing should say:

- keep openGym's Health Connect / Apple Health export on and turn Garmin Connect's sharing of
  activities off, **or**
- keep Garmin's sharing and turn the watch's "Also save to Garmin Connect" off, **or**
- keep Garmin's recording and turn openGym's export off (Garmin then writes the workout, openGym
  only reads its heart rate back, which v1.4.3 already does for any watch).

A better fix for later, on the phone: when the Garmin bridge reports that the watch recorded a
workout (a `watchStatus` with `health: "on"`, as the Apple Watch does), the phone leaves that
workout out of its own Health export. `watchClaimed` in `watch-sync.js` is the existing hook.

## Garmin's other programmes

The **Garmin Connect Developer Program** (Health API, Activity API, Training API, Women's Health and
Courses) is separate from Connect IQ: it is a server-to-server integration with Garmin Connect, for
companies. It needs an application to Garmin (company name, use case, privacy policy, a server that
receives Garmin's pushes), Garmin's approval, and a signed agreement; approved partners get consumer
keys. What it would give openGym:

| API | What | Use for openGym |
| --- | --- | --- |
| Activity API | every activity's summary and FIT file, pushed after each sync | import runs, rides and Garmin's own strength activities (with their sets) into the log, automatically |
| Health API | daily summaries: steps, heart rate, resting HR, sleep, stress, Body Battery, body composition (Index scale weigh-ins) | weigh-ins and resting HR into openGym without a phone hub in between |
| Training API | push workouts (including strength workouts with exercises, sets and reps) to the user's Garmin Connect calendar | today's routine shows up in Garmin's native strength activity on every Garmin, no Connect IQ app needed |

It does not fit openGym's model as it is: keys are per company, not per server, so every
self-hosted instance would need the owner's keys, or the owner would run a relay server that every
instance talks to. That is a third-party service in the middle, the opposite of "no third-party
account, no telemetry". If it is ever done, it should be an opt-in relay with its own privacy note.
Garmin also asks partners for a business entity, and reviews the app before keys are issued.

The Connect IQ app needs none of this: a free developer account is enough.

## Building

You need the Connect IQ SDK and the device files:

1. Download the **SDK Manager** from developer.garmin.com/connect-iq/sdk (Linux, macOS, Windows),
   sign in with a Garmin account, install the newest SDK and, under Devices, the watches you build
   for (all of `manifest.xml`, or a few for testing). Device files land in
   `~/.Garmin/ConnectIQ/Devices`. (The bare SDK zip also downloads without an account; the device
   files do not.)
2. A **developer key**, once, kept safe and private: every store update must be signed with the
   same key.

   ```bash
   openssl genrsa -out developer_key.pem 4096
   openssl pkcs8 -topk8 -inform PEM -outform DER -in developer_key.pem -out developer_key.der -nocrypt
   ```

   Keep it next to the Android keystore (`/root/.config/opengym` on the release machine), never in
   the repository.
3. Build and run (`SDK=…/connectiq-sdk-lin-<version>`):

   ```bash
   cd frontend/garmin
   node check.mjs "$SDK"                                    # quick, no device files needed
   "$SDK/bin/monkeyc" -f monkey.jungle -d fr265 -y developer_key.der -o bin/opengym-fr265.prg -w
   "$SDK/bin/connectiq" &                                   # the simulator (needs a display)
   "$SDK/bin/monkeydo" bin/opengym-fr265.prg fr265
   # unit tests (source/CoreTest.mc)
   "$SDK/bin/monkeyc" -f monkey.jungle -d fr265 -y developer_key.der -o bin/test.prg -t
   "$SDK/bin/monkeydo" bin/test.prg fr265 -t
   # the store package, every watch in manifest.xml
   "$SDK/bin/monkeyc" -f monkey.jungle -y developer_key.der -o bin/openGym.iq -e -r -w
   ```

   On pve: wait for a load under 1.5 and wrap the compiler in
   `systemd-run --scope -q -p CPUQuota=150% -p MemoryMax=4G nice -n 15 ionice -c3 …`. The simulator
   needs a display, so it runs on a desktop, not on pve.

   Try at least one of each kind in the simulator: `fr265` (AMOLED, round), `fr255` (MIP, round),
   `venusq2` (square, touch), `instinct2` (black and white, with the sub-screen), `fr55` (least
   memory), `fenix847mm` (big). To feed it a snapshot without a phone, the simulator can deliver
   phone app messages (the SDK's `samples/Comm` shows how); `test/snapshot.json` is the one to send.
4. **Sideload** onto your own watch: connect it by USB and copy the `.prg` built for that model
   into `GARMIN/APPS/`. It shows up under Activities & Apps.

The strings come from the Wear OS watch's (which come from the app's packs and the Apple Watch's):
`node frontend/garmin/garmin-strings.mjs` writes `resources*/strings/strings.xml`; run it after
changing them there. 17 languages; Connect IQ has no Hindi or Bengali, and one Portuguese (pt).

## What the owner does

1. Create a free Garmin developer account (a Garmin Connect account works) and accept the Connect
   IQ developer agreement at developer.garmin.com.
2. Install the SDK Manager, sign in, download the SDK and the device files (step 1 above).
3. Generate the developer key (step 2 above) and store it with the other signing keys.
4. Build, run the unit tests, and try the six watches above in the simulator. Fix what the compiler
   says: this code has not met it yet.
5. Wire up the phone side ("The phone side (to do)"), then test with a real Garmin: borrow one or
   ask a Garmin owner from Discord for a sideload test.
6. Publish: apps.garmin.com/developer → Upload an app → `openGym.iq`, with the store listing
   (name, description, at least one screenshot per screen shape, the icon, category Health &
   Fitness), the privacy policy URL (the app sends heart rate only to the user's own phone app),
   and "requires a companion app" pointing at the Play Store and App Store listings. Garmin reviews
   it, usually within a few days. The app id in `manifest.xml` stays the same forever.
7. Each release after that: `monkeyc … -e` with the same key and a higher `version` in
   `manifest.xml`, uploaded as a new version of the same app.
