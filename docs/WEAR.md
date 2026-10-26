# The Wear OS watch app

A companion for the Android app (the **Google Play build**, see [Constraints](#constraints-worth-knowing)): pick a routine on the watch, log the sets with the crown, and the
finished workout lands in openGym on your phone. Built for a Pixel Watch 3; any Wear OS 3+ watch
should do. It is a **recorder**, not a second copy of your log: the phone stays the only source of
truth, finishes the workout the way the Finish button does (personal records, progression, sync to
your server) and the watch never talks to a server.

> Status: written and unit-tested on both sides, and first run on a Pixel Watch 3 (routines load,
> a set starts a rest). Several things below were changed after that first run and have **not**
> been run since; [What to check on a real watch](#what-to-check-on-a-real-watch) lists them.

## How a workout goes

```
 watch                                          phone (openGym, Android)
 ─────                                          ────────────────────────
 0. holds a copy of every routine ◀── list + snapshots ─ puts the routine list and each routine's
    (reads them, no waiting)           (items)            snapshot, worked out like a session
                                                          start does (progression applied, drops
                                                          and bursts filled in); again after a
                                                          workout is saved or a routine edited
 1. pick a routine: starts at once from its own copy
 2. train. Everything is local: crown for
    weight/reps, tap to confirm, rest timer
    with a buzz, drop sets, rest-pause; swipe to any other exercise
3. finish ── session + uuid (item) ──────────▶ builds the `active` workout, closes it through
    queued in an outbox until acked             the Finish path (sheets.jsx completeWorkout)
    deletes it ◀──────────── ack (item) ──────── acks once it is saved, or already was
```

- **Starting a workout does not need the phone.** Opening the phone app once is enough for the
  watch to hold every routine; the phone puts them again after anything that could change what a
  routine says (a workout saved, so the weights move; a routine edited), a few seconds after the
  change and never while a workout is going on the phone. Only what changed is sent. A routine the
  watch has no copy of yet (it was added since) is asked for with a message, which the phone
  answers only while its app is in front: the watch keeps asking for a minute, then says so.
  *Refresh from phone* asks the phone to put everything again.
- **Finishing needs the phone only to be delivered.** The session is a Wearable Data Layer *item*,
  which the system keeps and delivers whenever the phone is next in reach, so a workout finished
  in a locker room with the phone in the car arrives later by itself. The watch keeps it in its
  outbox until the phone's ack comes back (Home shows "1 workout waiting for your phone").
- **Retries are safe.** The watch makes the session's id (a UUID). The phone looks the id up first
  and acks a session it already has without saving it again, including one you deleted since.
- **A workout of your own going on the phone is never overwritten.** The phone asks: save the
  watch's as a separate workout, decide later (it stays pending and is offered again), or discard.
- **Closed app on the phone.** Play services wake the app's process; the page needs to be running
  to turn a session into a workout, so a notification asks you to open openGym. The session waits in
  the Data Layer meanwhile, nothing is lost. A request for a routine the watch has no copy of cannot
  wait for you (the watch asks again for a minute), so that one needs the phone app in front.

## What the watch does

| | |
|---|---|
| Exercises | One page per exercise: swipe sideways to go to any other, in any order. Each keeps its place, and so do the numbers you typed and did not confirm. Finishing a set carries on in the same exercise, then in the next one not done. The dots at the bottom show where you are. Swiping is off while a drop set or rest-pause is half logged |
| Progress | A ring round the edge fills as the routine is done (sets done over sets in all, a set left out does not count: the phone's top line, `setsDoneActive`) |
| Set | Weight and reps (or seconds for a hold) with the crown; tap a number to pick which one the crown edits; ✓ to confirm |
| Rest | Countdown ring (inside the progress ring), −15 / +15 / skip, buzz at the end even with the screen off; it shows on every page, so you can swipe to the next exercise while it runs. The workout shows on the watch face as an ongoing activity |
| Ambient | With the screen dimmed the app stays up: black, the exercise and, in a rest, the clock time it ends (a dimmed screen is redrawn about once a minute, so no second-by-second count; the buzz still comes on time). Raising the wrist brings the live screen back |
| Warm-ups | Marked, with the short rest between ramp sets that the phone worked out |
| Drop sets | The main set, then each drop in turn with no rest; every drop's weight and reps are editable |
| Rest-pause / myo-reps | The activation set, then each mini-set after its own short rest (automatic, with a lighter buzz); "That's all" ends it early. The set's reps are the sum, as on the phone ([SET_TYPES.md](dev/SET_TYPES.md)) |
| To failure | Shown on the set; carried through to the saved workout |
| Menu (⋯) | Skip the set, end a rest-pause, undo the last thing logged, finish early, discard |

What it does **not** do (v1), on purpose:

- **Cardio exercises** are left off the watch (it says how many). Log them on the phone.
- **Supersets** run one exercise after the other on the watch. The pairing is kept in the saved
  workout, the interleaving is not.
- **The saved workout lists the exercises in the routine's order**, whatever order they were done
  in on the watch (a superset pairing depends on neighbours staying neighbours). Every set carries
  the time it was really done.
- **No swipe to leave the app.** A swipe to the right goes back to the previous exercise, so the
  system's swipe-to-dismiss is off; leave with the watch's button.
- **A per-side exercise** logs one total on the watch; the phone splits it between the sides (an
  odd rep goes left). A drop set or rest-pause planned per side is sent as plain sets.
- **No effort rating (RIR/RPE)**, no body-weight weigh-in, no exercise notes, no photos. Add them
  on the phone afterwards, in the workout's editor.
- **A timed hold has no countdown**: set the seconds you held.
- Not for several people on one phone: it talks to the openGym on the phone it is paired with.

## Building and installing

The watch app is the `wear/` module of the Android project (`frontend/android`), Kotlin and Compose
for Wear OS, with the Wearable Data Layer as its only link to the phone.

```sh
cd frontend
npm install
npm run build:mobile               # the phone app's web bundle, and `cap sync`
cd android
./gradlew :app:assemblePlayDebug :wear:assembleDebug
```

`assemblePlayDebug` is the phone build with the watch link; the default (`sideload`) flavour does not
have it. Install the phone APK on the phone as usual. For the watch, turn on *Developer options → ADB
debugging* and *Debug over Wi-Fi* on it (Settings → System → About → tap the build number), pair
the debugging session, then:

```sh
adb connect <watch-ip>:<port>
adb -s <watch-ip>:<port> install wear/build/outputs/apk/debug/wear-debug.apk
```

### The two apps must match, or they will not see each other

The Data Layer pairs a phone app and a watch app only when both have **the same applicationId and
the same signing key**. That shapes the build:

- `wear/build.gradle` uses the phone's applicationId (`ch.duartesantos.opengym`) and, like the
  phone's debug variant, adds `.test` to it for debug builds. Pair **debug with debug and release
  with release**, never across.
- Debug builds on one machine share `~/.android/debug.keystore`, so they match. Build them on two
  machines and they do not: copy the keystore over.
- Release APKs come out unsigned, as the phone's do. Sign the watch's with the **same key** as the
  phone's (`zipalign` then `apksigner`, [MOBILE.md](MOBILE.md#android--sideload-the-apk)). Nothing in
  CI builds or signs the watch APK yet; `.gitlab-ci.yml` builds the sideload phone APK only, so
  adding this module did not change the release pipeline. The Play bundle (which carries the phone's
  side of the link) and the watch app have to go to Play together, as the same app.

Check what you installed with `aapt2 dump badging <apk> | grep package` and
`apksigner verify --print-certs <apk>` on both.

### Tests

```sh
cd frontend && npm test                          # the phone's side: lib/wear-bridge*, lib/wear-link*, sheets.watch-session
cd frontend/android && ./gradlew :wear:testDebugUnitTest   # the watch's: Engine (the set/rest state machine), Wire, the contract
```

`wear/src/test/resources/snapshot-v1.json` and `session-v1.json` are read by **both** suites: the
JS test checks the snapshot is still what the phone produces and that it reads the session back
into the workout that was lifted; the Kotlin test parses the snapshot and checks the session it
produces is the fixture. Change the format on one side and the other fails.

## Where things are

| | |
|---|---|
| `frontend/src/lib/wear-bridge.js` | Pure: `routineToWatchSnapshot(routine, state)`, `watchSessionToActive(payload, state)`, `classifyWatchSession` (finish / duplicate / conflict / empty / invalid). The wire format is documented at its top |
| `frontend/src/lib/wear-link.js` | What the app does about each event (publish, finish, ack, ask), with the plugin and the screens injected so it is testable |
| `frontend/src/wear-init.js` | Wires the plugin's listeners to the above and the conflict sheet |
| `frontend/src/sheets.jsx` | `finishWatchWorkout`: the same `completeWorkout` the Finish button runs, minus what belongs to a live session |
| `app/.../WearBridgePlugin.java` | Capacitor plugin `WearBridge`: `routineRequested` / `sessionFinished` listeners, `ready`, `refresh`, `publishIndex`, `publishSnapshot`, `ack` |
| `app/.../WearBridgeService.java` | `WearableListenerService`: wakes the process; notification when there is no page to hand the event to |
| `wear/.../Engine.kt` | The workout as a pure state machine (sets, drops, bursts, rests, undo) |
| `wear/.../Repository.kt` | Everything the watch keeps (DataStore): routine list, snapshots, the workout in progress, the outbox |
| `wear/.../WorkoutService.kt` | Foreground service: rest timer, ongoing activity |

Data Layer paths (`Paths.kt` and `WearPaths.java` list the same): `/opengym/request` (message,
watch→phone), `/opengym/session/<id>` (item, watch→phone), `/opengym/ack/<id>`, `/opengym/index`
and `/opengym/snapshot/<routineId>` (items, phone→watch). Capabilities: `opengym_phone`,
`opengym_watch`.

## Constraints worth knowing

- **The watch link is in the Play build of the phone app only.** The Data Layer is part of Google
  Play services, so `play-services-wearable` is a `playImplementation` dependency and
  `WearBridgePlugin`, `WearBridgeService` and their manifest entry live in `app/src/play`. The
  sideloaded APK (GitHub, opengym.ch) has none of it: no Play services code, no service, and the
  page does not start the link (`lib/channel.js` `hasWatchLink`). Both devices need Play services.
  The traffic is on-device between your own phone and watch and nothing goes to Google by this
  route. A phone without Play services (GrapheneOS, some de-Googled ROMs) has no watch support.
- A DataItem holds 100 KB; a routine snapshot is a few KB, and the plugin refuses over 95 KB.
- The format is versioned (`v: 1`). A phone that gets a session from a newer watch app leaves it
  un-acked and says to update, rather than dropping it.
- Notification texts shown while the phone app is closed are English (they come from Android
  resources, not the page). Everything the page shows is in all the app's languages. The watch
  has English and Spanish.

## What to check on a real watch

Run so far on a Pixel Watch 3: the app appears, the routines load, a routine starts, confirming a set
starts the rest. Everything else, and everything marked "since", has not been run. In this order:

1. The watch app opens and lists the routines **at once**, also with the phone app closed and the
   screen off (the copies are on the watch). Open openGym on the phone after changing a routine's
   weight or after saving a workout, wait a few seconds, and the watch has the new numbers.
2. A routine starts **instantly** from the copy; the numbers match the phone's session for that
   routine (weights after progression). A brand-new routine the watch has never seen is asked for
   (phone app in front).
3. Since: **swipe** sideways: another exercise, with its own set and its own numbers. Do exercise 3
   first, then 1: finishing a set stays in the exercise until it is done, then moves on. Type a
   weight, swipe away and back: the typed value is still there. Mid-drop-set the swipe is off.
4. Since: the **ring** round the edge grows with each set done and agrees with the line at the top
   of the phone's workout screen once you open the same workout there.
5. The crown changes the value without scrolling anything, and tapping a number switches which one.
6. A rest buzzes at the end with the wrist down and the screen off, and shows on the watch face.
   Since: during the rest, swipe to another exercise; the countdown is still there.
7. Since: **ambient**. Start a rest, lower the wrist and wait for the screen to dim. The app stays
   (black, exercise name, "Until 12:34") instead of the blurred clock, and still buzzes on time.
   Raise the wrist: the live countdown is right.
8. A drop set and a rest-pause routine flow as described above.
9. Finish with the phone **out of range** (Bluetooth off): Home shows the workout waiting. Turn it
   back on: it appears in History, the waiting line goes away, and nothing is duplicated. The sets
   done out of order have their real times.
10. Finish while the phone has a workout of its own going: the sheet appears, the phone's workout is untouched.
11. Finish with openGym **closed** on the phone: the notification appears, and opening the app saves the workout.
