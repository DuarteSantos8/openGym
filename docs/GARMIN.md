# openGym on Garmin

A Connect IQ watch app for Garmin watches, the Apple Watch and Wear OS apps' little sibling: the
phone stays the source of truth, the watch follows the workout the phone runs, logs sets on it and
can start today's routine by itself. Source: `frontend/garmin` (Monkey C).

**Status (v1.4.5):** the watch app is written, its strings are in, its logic has unit tests, and
`node frontend/garmin/check.mjs` passes (CI runs it). It **compiles with the real device files**
(SDK 9.2.0 against the SDK Manager's 9.3.0 device files) for the six watches below, without a
warning beyond the launcher icon's scaling, and **runs in Garmin's simulator** on all six: the
unit tests pass there (fr265, fr55, instinct2), and Start, Set, Rest, the menu, Finish and the
summary were driven with the watch's own buttons (and touch on the Venu Sq 2), with screenshots
of each. On the Instinct 2 family (92 KB for the app) the redesign runs close to the limit: it
keeps today's routine to its first 16 sets and at most 6 sets in the outbox while the phone is away
(the rest wait as pending ticks and all go out at Finish), and `sim/run.sh long <dev> [sets]`
measures a watch-only workout's memory peak. **The phone side is wired up in v1.4.5**: the Connect IQ Mobile SDK in the
Android app (APK and Play builds, `android/app/src/ciq`) and in the iPhone app
(`ios/App/App/GarminLink.swift`, the Swift package added at build time by `ios/ci/add-garmin.rb`),
behind the same `WatchBridge` plugin as the other watches, with Settings → Garmin for pairing and
status. Both compile in CI; none of it has met a real Garmin yet. That and the Connect IQ Store
submission are the owner's (see "What the owner does" and `/root/uploads/opengym-146/garmin-store/`).

## What it does

Since v1.4.5 the Garmin app has the watch redesign the Apple Watch and Wear OS got (idea and first
versions by @cubetes, #832 to #966; ours is a port of the Apple Watch's behaviour, see
`ios/App/Watch` and `frontend/android/wear`), fitted to Connect IQ: buttons on most watches, touch
on some, MIP and black-and-white screens, and as little as 92 KB for the whole app.

| Screen | What you see | Buttons | Touch |
| --- | --- | --- | --- |
| Start | the time (and the sync pill), "Today", the routine's name big, "5 Exercises · 17 Sets", Start | START starts today's (or Quick start: the first routine), UP / DOWN / MENU list the routines, BACK leaves | tap Start, tap elsewhere for the list |
| 3-2-1 | a ring that drains, 3, 2, 1, then Go! | START: go now, BACK: cancel | a tap: go now |
| Set | the time, heart rate and sync pill, the exercise (a long name wraps), "Set 2 of 4" (warm-up, left / right), the superset partner ("+ Lateral Raise"), weight and reps in boxes, last time, Done | START logs the set, UP / DOWN change the outlined number by one step (the exercise's own plate step, 1 rep, 5 s for holds), BACK switches weight and reps, MENU (UP held): Previous set, Overview, Metrics, skip set, next exercise, finish, discard | tap a box to pick it, swipe down / up for more / less, tap Done, ‹ beside Done opens the last logged set, swipe left for Metrics, again for the Overview (swipe right is the watch's BACK: back to the set), touch and hold (or tap the name) for the menu |
| Fixing a set | "Edit · Set 1 of 2", the logged numbers, Save; a rest keeps running at the top | START saves, UP / DOWN change, BACK switches the box (or leaves), MENU: Save, Previous set, Next set, Cancel | ‹ Save › |
| Rest (on the set page) | a ring that empties (a bar on square screens), the time left, Up next with its numbers, the effort, −15 / Skip / +15 | START or BACK skips, UP +15 s, DOWN −15 s (at 15 s or less that is a Skip); MENU: "How hard was that set?" (RIR 0 / 1 / 2 / 3+ or RPE 10 / 9 / 8 / <8), Previous set | the effort chips, then a capsule ("RIR 2", tap to change); −15, Skip, +15 |
| Hold (on the set page) | Start hold, its own 3-2-1, then the time left big, a teal bar that goes orange for the last 5 s (on black and white the number turns inverted), Stop | START or BACK stops and logs the seconds held; at zero it logs itself | a tap stops |
| Overview | "7 of 17 sets", "Waiting to sync 3" / "All synced", the exercises the watch has (the one up now outlined, a superset under its heading, "+3 Exercises" still to come from the phone), Finish | START asks "Finish workout?", DOWN or BACK back to the set | touch and hold Finish ends it at once, a tap asks; tap an exercise to go there |
| Metrics | the workout's time big (yellow; it stands still while the phone has it paused), sets, volume, heart rate, calories | START, UP or BACK back to the set | a tap, or swipe right (BACK) |
| Still training? | after 20 minutes without a set ("No set for 23 min. Still at it?"), or at once when the phone left the gym during the workout (`active.leftGymAt`, forgotten workouts): "Looks like you left the gym" | START or BACK: keep going (the phone hears it, a `stillHere` event, and stops asking too), DOWN: Finish (the Overview, with its Finish) | Keep going / Finish |
| Summary | "Workout saved" (or "Ended on your phone"), the name, the time big, sets, volume, average and max heart rate, "Waiting to sync 3" / "All synced" | any button (not in its first second) | a tap |

- A buzz ten seconds before the rest ends and a clear double buzz at the end (the phone's
  "rest haptics" setting turns them off), a tick for each number of a 3-2-1 and each of a hold's
  last three seconds. A rest started on the phone runs on the watch too, but only a new one: a
  snapshot that sends the same rest end again no longer undoes a ±15 or a Skip pressed on the watch
  (`Core.restFollows`, state `pre`).
- BACK never ends a running workout by accident: on a set it switches weight and reps, and where
  there is only one number it opens the menu; elsewhere it goes back to the set. Finish and Discard
  ask first (or Finish is a touch and hold on the Overview).
- −15 / Skip / +15, the effort and Done wait a second after Done (the thumb is still there); the
  summary's Done waits its first second, and Start a second after that.
- Fixing a set (Previous set, ‹ ›) and the effort send the `setDone` the phone already knows, a
  moment later than the set's own tick and without `hr`, so the phone takes the new numbers and
  keeps the set's heart rate (`Core.fix`, as `SetFix.correct` on Wear OS and iOS).
- "Timed holds start by themselves" on the phone: after a rest the hold's 3-2-1 comes up by itself.
- Cardio is logged on the phone (the watch says so and moves on).
- No exercise media goes to the watch, text and numbers only (and the licence would not allow it).
- Heart rate: the watch's optical sensor (`Toybox.Sensor` / `Activity.Info.currentHeartRate`)
  while a workout runs. Each set logged on the watch carries `hr: { avg, max }`, exactly what the
  Apple Watch and Wear OS send, so the phone shows it per set the same way.

Not here (the Apple Watch has them): the weigh-in before a start, the keypad, music (Garmin has its
own music controls), exercise pictures, a glance. The forgotten-workout check only asks, it never
ends a workout by itself (the other watches end it after asking, with `finish { idle }`; the
Garmin leaves that to the phone). The language is the watch's own (Connect IQ picks resources by the
watch's system language; the phone's `lang` is sent but not used).

### Design

Garmin screens are small (176 to 454 px) and many are MIP (memory-in-pixel: 64 colours, made for
sunlight) or, on the Instinct, black and white. So, like the other watches but fitted:

- **Black, one accent, numbers in boxes.** The accent is the phone's (`settings.accent` in the
  snapshot, openGym's green until the phone says): as is on AMOLED, each channel rounded to the
  MIP palette elsewhere (`Ui.onScreen`), the ink on it black or white by its lightness. AMOLED
  watches get the other watches' grey boxes (#1c1c1e); MIP watches outlines; the Instinct builds
  (`(:mono)` in `source/Ui.mc`, picked per device in `monkey.jungle`) white outlines, and the box
  you are changing inverted. Numbers are the system's bold number fonts, as big as the screen
  allows (Connect IQ has no rounded font on most watches).
- **Text that fits.** Every line is cut to the width the round screen really has at its height
  (and left of the Instinct's sub-screen). Names and titles first wrap onto a second line and step
  down a font size (`Ui.title`); only then is the end cut with "...".
- **Sync you can see.** The status line at the top of each screen has the time, the heart rate and
  an orange pill with an arrow and the number of sets still in the outbox (`Core.waiting`: the
  `setDone` events the phone has not confirmed). The arrow is drawn, not a glyph: Garmin's bitmap
  fonts have no arrows.
- **Motion only where it is cheap.** The 3-2-1 drains its ring smoothly on AMOLED (a 100 ms timer
  for its 3.7 s, `Motion` in `App.mc`) and steps once a second on MIP and black-and-white screens.
  Nothing else animates.

| Kind | Watches (the six tried) | Pages | Effort | Look |
| --- | --- | --- | --- | --- |
| touch + buttons | fr265, fenix847mm | swipe left (or the menu) | chips | AMOLED: grey boxes |
| touch only | venusq2 | swipe left | chips | MIP: outlines |
| buttons only | fr255, fr55 | the menu | the menu | MIP: outlines |
| buttons, black and white | instinct2 | the menu | the menu | outlines, inverted focus |

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
- settings (`restHaptics`, `lang`, `show`, and since v1.4.5 `accent` / `onAccent`, `crown`,
  `effort`, `autoHolds`, each only when the phone has it: `garminLook`), the streak, the last few
  discarded ids;
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
| `stillHere` | `id, wid, at`: "Keep going" on "Still training?" (1.4.5) |
| `hello` | `id, at`: for the bridge only ("send me the latest snapshot"), never queued for the page |

Events wait in the watch's outbox (`ob`) until the phone's snapshot names them in `acked` (the
1.4.5 outbox protocol of the other watches, `Core.ackOutbox`): `transmit` reporting a message
delivered only means Garmin Connect took it, and with openGym on the phone not running it can go
nowhere. So `obn` counts the events at the front already sent; what is not confirmed a minute later
goes again (`Link.retry`), what was never sent after 30 s. One sent twice is applied once (the page
keeps the ids, and names a resent one again as the newest, so the short `acked` list of a Garmin,
`GARMIN_ACKED_MAX` = 16, still gets to it). A workout logged with the phone away comes back as
dozens of events within a second or two: the page names those oldest first, 16 per snapshot
(`unnamed` in `runLink`), so the watch lets go of all of them at once and not only of the newest
16. An event that arrives a second time means the watch never got the snapshot that named it, so
that snapshot goes again even when nothing in it changed. The outbox keeps at most 60, dropping
the oldest sent ones first; with nothing sent at all (the phone out of reach for days) it grows to
90 and then drops the oldest, a workout's `start` last (`Core.room`): it is loaded at every start
of the app, and one without end would run a small watch out of memory for good. Times are ms
since 1970 as `Long`.

Three more things keep the link from stopping (`Link.retry`, once a second): a `transmit` that
never calls back at all is given up on after 45 s (`busy` used to stay true until the app was
restarted); the `hello` of the start is asked again once a minute until the phone has answered
once; and the callback of a transmit that was given up on is ignored (`gen`). "Waiting to sync 3"
counts sets (`Core.waiting`): a set rated or fixed after its tick is two events and one set.

**Tested end to end without a watch.** `frontend/garmin/test/watch-model.mjs` is the watch's sync
as JavaScript (a port of `Core.mc`'s state, outbox and `applySnapshot` and of `App.mc`'s `Link`);
`src/lib/garmin-link.e2e.test.js` runs it against the page's real sync with the bridge modelled
on `GarminLink.java` (the queue file, the last snapshot, hello) and switches on what goes wrong:
the watch out of range, openGym killed on the phone, an answer lost, a restart mid-queue, a
transmit that never calls back. `src/lib/garmin-contract.test.js` reads the Monkey C, Java, Swift
and JavaScript sources and fails when a field name, an event type, a constant, the app id, the
store id or an Info.plist entry stops matching between them (and so keeps the model honest).
The real Monkey C runs the same cases in the simulator (`source/CoreTest.mc`).

### The phone side

**The page (done in v1.4.4).** The bridge plugs into `WatchBridge`, the plugin both phone apps
already have, so `startWatchSync` keeps calling `status`, `sendSnapshot`, `drain` and `ack`. When
`status()` answers `garmin: true` (with `paired` and `installed`), every `sendSnapshot` also
carries `garmin: JSON.stringify(garminSnapshot(snap))`, so the cut is made (and tested) in
JavaScript, not twice in Java and Swift (`watch-sync.garmin.test.js`). With the **Watch module**
off (Settings → Modules) or the watch's own switch off, that is the empty snapshot, as for every
other watch: no workout, nothing ready, no streak. The Garmin stays paired, and the Modules page
asks once before Watch goes off while one is there (it remembers the last `status()` in
`localStorage` `gym_garmin_link_v1`, `readGarminLink` in lib/watch-settings.js).

**Settings → Garmin (v1.4.5, `views/GarminSettings.jsx`, words in `lib/garmin-view.js`).** In the
phone apps (module Watch): the Garmins the phone knows (connected or not, openGym on them or not),
"Choose watches" on the iPhone (Garmin Connect opens with its list and comes back) or "Look again"
on Android (Garmin Connect's pairing is the list), "Get openGym for Garmin" while a watch lacks the
app (Garmin Connect opens the Connect IQ Store page; when it cannot, the page on the web,
`GARMIN_STORE`), and
the two switches every watch shares: send workouts, open on the watch. In a build without the link
(F-Droid, or an iPhone build without the package) it says why. It asks the native side through
`garminCall` in lib/watch-sync.js: `garminStatus`, `garminPick`, `garminStore`.

Every state says what to do next (`garminView`, each with a test):

| state | the line | button |
| --- | --- | --- |
| this build has no link (F-Droid) | says so, and which builds have it | none |
| Garmin Connect not installed | install it, pair the watch there, come back (the page notices by itself) | Choose watches (iPhone) |
| Garmin Connect too old | it needs an update (noticed by itself on Android once updated) | Look again |
| the link did not come up | could not reach Garmin Connect | Look again (starts it over) |
| no watch in Garmin Connect / none picked | pair yours there first / pick it | Look again / Choose watches |
| a watch, out of reach, never heard from | not in reach, bring it close with Bluetooth on | Look again |
| a watch in reach without openGym | get it, then open it once on the watch | Get openGym for Garmin |
| openGym on the watch, in reach / away | sets land here / it catches up when in reach | Look again |

A watch that is out of reach cannot say whether it has the app: it is never told "openGym isn't on
it yet" on a guess. The watch itself, before it ever heard from the phone, says "Not synced yet.
In openGym on your phone, open Settings, then Garmin." (opening the app alone is not enough on
Android: the link only starts once that page was opened).

**The native half (done in v1.4.5).**

1. **Android** (`android/app/src/ciq/.../GarminLink.java`, pure parts in `main/.../GarminMessages.java`
   with `GarminMessagesTest`): `com.garmin.connectiq:ciq-companion-app-sdk:2.4.0` (Maven Central),
   in the `sideload` and `play` flavours only. One `GarminLink` per process. Nothing of Garmin's
   runs until the user opens Settings → Garmin once (remembered in the `opengym-garmin` prefs; the
   iPhone waits for "Choose watches" the same way), and only with Garmin Connect Mobile installed
   (else `state: "no-gcm"` without touching the SDK). Then: `ConnectIQ.getInstance(ctx, WIRELESS)`, `initialize` (no SDK dialogs),
   then for each `getKnownDevices()` `registerForDeviceEvents`, `registerForAppEvents` for
   `IQApp("3c533c63754d40189c000ad529e400b9")` and `getApplicationInfo` (installed or not). Incoming
   `events` go into the same queue file as the Wear OS watch's (`WatchBridgePlugin.storeEvent`, by
   the event's `at` as `seq`), a `hello` re-sends the last snapshot instead. `sendSnapshot({ json,
   garmin })` turns the Garmin JSON into maps and lists (nulls left out, ms as `Long`) and sends it
   to every connected Garmin with the app; the last one goes again when a watch connects or says
   hello. `status()` adds `garmin: true` when a Garmin has the app, and counts it as paired and
   installed so the page sends at all. `openOnWatch` also asks each connected Garmin to open the app
   (`openApplication`: "open openGym?" on the watch, Settings → Garmin "Open on the watch").
   Garmin Connect Mobile delivers messages while the app's process lives (the page may sleep); with
   the process gone they are lost on the phone, which is why the watch now keeps them until `acked`.
   When Garmin Connect itself goes away (updated by the Play Store, stopped, crashed), the SDK's
   link to it ends (`onSdkShutDown`) and Garmin Connect forgets which app wanted which watch's
   messages: `revive` then brings the SDK up from scratch and `refresh` registers every watch
   again after each `onSdkReady` (before, sets from the wrist stopped arriving until openGym was
   restarted, and Settings → Garmin stood on "Checking…"). A start that does not come up within
   15 s is tried three times, then the state is `error` and "Look again" starts over
   (`GarminUse`, with JVM tests). `onApplicationNotInstalled` only counts from a connected watch,
   the watches that have the app are remembered (`has` in the `opengym-garmin` prefs) so the page
   makes the Garmin snapshot from its first send, and a snapshot lost in transfer goes once more.
2. **iPhone** (`ios/App/App/GarminLink.swift`): the Swift package
   `github.com/garmin/connectiq-companion-app-sdk-ios` 1.8.0 (a binary `ConnectIQ.xcframework`),
   added to the App target at build time by `ios/ci/add-garmin.rb` (ios.yml runs it in all three
   jobs, so the App Store archive has it; `-ObjC` as Garmin asks). The file compiles either way:
   without the package `canImport(ConnectIQ)` is false and it answers "no Garmin" (`state: build`).
   Info.plist: the URL scheme `opengym-ciq` (Garmin Connect returns the picked watches there;
   SceneDelegate and AppDelegate hand it to `GarminLink.handle`), `LSApplicationQueriesSchemes`
   `gcm-ciq`, the Bluetooth usage strings and the `bluetooth-central` background mode (a set from
   the wrist reaches the phone in the pocket). The SDK starts only once a Garmin was picked (it
   opens Bluetooth, and iOS asks): at launch when one is saved (`garmin-devices.plist`, the picked
   `IQDevice`s), else on "Choose watches". Then `register(forDeviceEvents:)`,
   `register(forAppMessages:)`, `getAppStatus`, `sendMessage`, `openAppRequest` as on Android. The
   Apple Watch keeps its own snapshot; both can be linked at once. A watch that is "connected" is
   not ready to be talked to yet (Garmin's header): the app status is asked and the snapshot sent
   again at `deviceCharacteristicsDiscovered`. No answer from `getAppStatus` is "unknown", not
   "not installed". The picked watches are read back with the strict coding rules first and
   plainly if Garmin's `IQDevice` does not pass them, so they cannot silently be gone at launch.
3. **Licence and builds.** The Connect IQ Mobile SDK is not open source (Garmin's Connect IQ SDK
   License Agreement and Application Developer Agreement; the Maven POM says so too). It is in the
   builds that already carry closed platform code: the GitHub APK and Play build (beside Google Play
   services) and the App Store build. The F-Droid flavour has none of it: its `WatchBridgePlugin`
   (src/fdroid) answers `garmin: false` and `garminStatus` `state: "build"`, and
   `scripts/android/check-fdroid.sh` fails on `connectiq` / `com.garmin` in its classpath or
   manifest. Nothing of Garmin's is in the repository: Gradle and Xcode fetch it. NOTICE.md says so.
   Whether AGPL distribution next to it needs an explicit additional permission (as for the app
   stores) is the owner's call; it is the same question as Play services and ML Kit in the APK.
4. **Opening the app on the watch** when a workout starts on the phone: done, see 1.

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

   The compiler parses with gradual type checking on: a few hundred "Cannot determine if container
   access is using container type" warnings are expected (the state is plain dictionaries) and
   harmless; errors are not. The launcher icon (70 × 70) is scaled per watch, with a warning.

   On pve: wait for a load under 1.5 and wrap the compiler in
   `systemd-run --scope -q -p CPUQuota=150% -p MemoryMax=4G nice -n 15 ionice -c3 …`.

   Try at least one of each kind in the simulator: `fr265` (AMOLED, round), `fr255` (MIP, round),
   `venusq2` (square, touch), `instinct2` (black and white, with the sub-screen), `fr55` (least
   memory), `fenix847mm` (big).

   **Simulator without a desktop (`sim/run.sh`).** The SDK's simulator runs on Xvfb on a headless
   Linux box too (pve), driven by `frontend/garmin/sim/run.sh`:

   ```bash
   cd frontend/garmin
   sim/run.sh setup                 # once: private libs + Roboto fonts (nothing installed system-wide)
   sim/run.sh tour fr55 /tmp/shots  # build, load, Start / Set / Rest / menu / confirm / Summary PNGs
   sim/run.sh test fr265            # the unit tests, in the simulator
   sim/run.sh key fr55 enter        # by hand: enter | up | down | esc | menu (UP held) | hold-enter
   sim/run.sh tap venusq2 160 300   # a tap, in screen pixels
   sim/run.sh shot fr55 /tmp/a.png  # the screen only (round ones masked)
   sim/run.sh stop                  # stops what start started, nothing else
   ```

   It builds `sim/monkey.jungle`: the app plus `sim/source`, which plays the phone. The simulator
   has no phone of its own (it wants an Android phone on ADB, shows "There is no data connection"
   at the first `transmit` and crashes after it), so in that build `Link.wired()` is false and
   `Sim.begin()` applies the snapshot `sim/gen.mjs` makes from `test/snapshot.json` (today's
   routine ready, two more by name, a streak), fresh on every load. It also prints the memory in
   use every 2 s (`mem <used> <peak> <total>` in `bin/sim/logs/monkeydo-<dev>.log`). The real
   builds leave `(:sim)` out (`monkey.jungle`). `SIM_NONE=1 sim/run.sh build <dev>` builds a watch
   that has never heard from the phone (the "Not synced yet" screen).

   What `setup` works around (paths in the script's variables): the simulator is built for Ubuntu
   22.04; on Debian 13 it lacks GTK 3 (taken from Debian's packages into a private folder),
   WebKitGTK 4.0, libsoup 2.4, JavaScriptCore 4.0 and libjpeg 8 (only its help browser uses them:
   stub libraries), and crashes in its built-in FreeType against Debian's newer libfreetype
   (Ubuntu 22.04's 2.11.1 goes next to it). It also needs the SDK Manager's **font pack**
   (`~/.Garmin/ConnectIQ/Fonts`), which is separate from the device files, and crashes on the
   first text without it. The newer AMOLED watches use plain Roboto TTFs, which `setup` puts there
   (open fonts, so fr265 and fenix847mm render as on the watch); the others' bitmap fonts (fr255,
   fr55, instinct2, also the Venu Sq 2) are Garmin's, so `sim/patch-fonts.py` points them at Roboto
   of the same height from the SDK's Device Reference. Close, not exact: with the real font pack copied to `~/.Garmin/ConnectIQ/Fonts`, skip
   the patch (`simulator.json.orig` is the original). Black text on lime (the Start and Done
   buttons, Garmin's own menus) shows as blocks on MIP watches with the stand-ins: the stand-ins'
   antialiasing on a 64-colour palette, not the app.
   **Compile checks without a Garmin login.** The SDK zip downloads without an account, and its
   `bin/monkeybrains.jar` carries a `devices.xml` with every watch in `manifest.xml` (resolution,
   colours, palette, Connect IQ version, languages), but not the memory limits.
   `node frontend/garmin/stand-in-devices.mjs "$SDK" <home>/.Garmin/ConnectIQ/Devices` turns that
   into stand-in `compiler.json` files, enough for `monkeyc` to compile, type-check and package
   (`-e`) for every watch; point Java at them with `_JAVA_OPTIONS=-Duser.home=<home>`. That is how v1.4.4 was checked (fr265, fr255, venusq2,
   instinct2, fr55, plus the unit-test build and the full `-e` package). It proves the code
   compiles, not that it fits a watch's memory or looks right: the real device files from the SDK
   Manager stay the ones to build the store package with.
4. **Sideload** onto your own watch: connect it by USB and copy the `.prg` built for that model
   into `GARMIN/APPS/`. It shows up under Activities & Apps.

The strings come from the Wear OS watch's (which come from the app's packs and the Apple Watch's
translations): `node frontend/garmin/garmin-strings.mjs` writes `resources*/strings/strings.xml`;
run it after changing them there. 21 languages (each listed in `manifest.xml`); Connect IQ has no
Hindi, Bengali or Persian, and one Portuguese (pt).

## What the owner does

1. Create a free Garmin developer account (a Garmin Connect account works) and accept the Connect
   IQ developer agreement at developer.garmin.com.
2. Install the SDK Manager, sign in, download the SDK and the device files (step 1 above).
3. Generate the developer key (step 2 above) and store it with the other signing keys.
4. Done on pve with the real device files (`sim/run.sh`, above): the six watches build, the unit
   tests pass, each screen was looked at. Still worth a look on a desktop with the real font pack:
   fr255, fr55, instinct2 and venusq2 with Garmin's own bitmap fonts.
5. Test the phone side (done in v1.4.5) with a real Garmin: sideload the `.prg`, install the APK
   or a TestFlight build, Settings → Watches → Garmin. Borrow one or ask a Garmin owner from Discord.
6. Publish: apps.garmin.com/developer → Upload an app → `openGym.iq`, with the store listing
   (name, description, at least one screenshot per screen shape, the icon, category Health &
   Fitness), the privacy policy URL (the app sends heart rate only to the user's own phone app),
   and "requires a companion app" pointing at the Play Store and App Store listings. Garmin reviews
   it, usually within a few days. The app id in `manifest.xml` stays the same forever.
   Its store id (62e66310-66de-4bdd-8e40-5d2c0d853a08, https://apps.garmin.com/apps/62e66310-66de-4bdd-8e40-5d2c0d853a08)
   is in `GarminLink.STORE_ID` (Android) and `GarminLink.storeId` (iPhone), so "Get openGym for Garmin" opens its store page. The listing text and a checklist are in
   `/root/uploads/opengym-146/garmin-store/` on the release machine.
7. Each release after that: `monkeyc … -e` with the same key and the new `version` in
   `manifest.xml`, uploaded as a new version of the same app.

### Versions

`manifest.xml` `version` is the release, the same as the phone app's `versionName` and Zepp OS's
`version.name` (1.4.4 now). Connect IQ has no separate build number to bump (Wear OS derives its
`versionCode` from the phone's, Zepp OS counts `major*10000 + minor*100 + patch`): the store only
wants each upload's version higher than the last, which the release number already is.
`node frontend/garmin/check.mjs` fails when it is not `frontend/package.json`'s, so the release
bump has to touch it.
