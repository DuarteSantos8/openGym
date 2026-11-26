# openGym on Huawei watches

A watch app for Huawei watches that run "lite wearable" apps (Watch GT 2 to GT 6, Watch Fit and
the family around them), and the phone link for it in the Android app. It is the Garmin watch's
sibling (docs/GARMIN.md): the phone stays the source of truth, the watch follows the workout the
phone runs, logs sets on it and can start today's routine by itself. Its events are the Garmin's, so
the phone's page applies a set from a Huawei exactly like one from a Garmin. Its snapshot is the
Garmin's (`frontend/src/lib/garmin-snapshot.js`): the watch app is cut to the Garmin's level, so it needs no
more. Source: `watch-huawei` (the watch app),
`frontend/android/app/src/hms` (the phone's end), Settings → Watches → Huawei watch (the page).

**Status (v1.4.6): written and unit-tested, never run.** Be clear about what that means:

- The watch app has **never been built in DevEco Studio**, never run in Huawei's simulator and
  never run on a watch. Nobody on the project has a Huawei watch yet. What is checked is the logic,
  the screens' data, the framing and the saving, under plain Node (390 tests, `npm test` in
  `watch-huawei`), and that the source keeps to the language subset Huawei says the watch runs.
- The Android link **compiles against Huawei's Wear Engine SDK** but has never met a watch. The
  plain-Java parts have JVM tests: the framing (`HuaweiFramesTest`), the one-snapshot-at-a-time
  choice (`HuaweiSendTest`) and when a watch is forgotten (`HuaweiForgetTest`). `HuaweiLink` itself
  (the SDK calls, the timers, the retries, the hello handling) has no test at all.
- **Huawei has not approved openGym for Wear Engine.** The application has not been made yet (see
  "What the owner does"). Until Huawei approves it, every call to the SDK fails with "scope
  unauthorized" (error 8), and the two ids the link needs (`huaweiAppId`,
  `huaweiWatchFingerprint`) are empty, so a build says "this version comes without the Huawei
  link". There is no store listing and no download for the watch app.
- Android only. The iPhone app has no Huawei page, see "Android only, and not iPhone yet".

"Honest limits" at the end lists everything unverified.

## Which watches

The watch app is a `liteWearable` project (`entry/src/main/config.json`): the kind of Huawei
watch that runs small JavaScript apps in Huawei's lite engine. Huawei's Wear Engine documentation
names these for app-to-app messages: Watch GT 2 and GT 2 Pro (lite wearable OS 10.1 or later), GT 2e
(11.0.14 or later), GT 2022 Premium Edition, GT 3 and later (GT Runner, GT Cyber included), Watch
Fit 1 and later, and Huawei's own 2026 sample lists GT 4 and 5, GT 4 and 5 Pro and Fit 3 and 4 as
lite targets. The Wear Engine library for the watch asks for watch firmware HarmonyOS 2.1.0.201 or
later. Which of these have really been tried: **none**.

- The GT 2 and GT 2e cannot install watch apps from Huawei Health's app store ("not supported on
  GT 2 or GT 2e", Huawei's support page); a test build can only be sideloaded there.
- Watches that run full HarmonyOS apps instead of lite ones (Watch 4, 5) are not what this project
  builds for. Huawei's sample also lists Watch D2 and Ultimate as lite targets. Not checked here.
- Band 6 has no app messaging at all; Band 7 and later do.
- Screens: Huawei's docs do not list the resolutions. Third-party project files show 454 × 454 round
  (GT 2 Pro), 466 × 466 round (GT 3, GT 3 Pro, GT Runner) and 336 × 480 rectangular (Fit 2). The
  layout uses percentages and one text size per role, and has **not been looked at on any screen**.

The phone must have the **Huawei Health** app, signed in with a HUAWEI ID, with the watch paired
there. On a phone that is not a Huawei one, Huawei also asks for HMS Core and for Huawei Health to be
allowed to show pop-ups while it runs in the background. Huawei lists Android 6 to 14; Android 15 and
16 are not listed, so they are not known to work. Wear Engine is not offered in every country (the
United States is not on Huawei's list; Spain, Switzerland, Germany, the UK and most of Europe are).

## What it does

One page in the watch app, `pages/index`, shows one screen at a time. `common/view.js` decides
which screen and what it says (every line is tested); the page only copies that into the HML.
The screens are the Garmin's and Wear OS's, fitted to a touch screen with no crown and no side-button
handling: every control is a button on the screen, and the look is the Apple Watch app's (see "The look" below). Besides the ones in the table there is a "could
not read the saved workout" screen with a Retry button: when the watch's files cannot be read it
changes and saves nothing, rather than start over on top of them.

| Screen | What you see | Taps |
| --- | --- | --- |
| Check-in | before a start, when the phone has its daily check-in on and today's is not answered: sleep, energy and soreness, one question at a time, five dots from low to high, "1/3" | a dot answers and moves on, Skip, Cancel |
| Weigh-in | before a start, when the phone has it on: the weight big (kg or lb, as the phone has it), -1, +1, -0.1, +0.1 | Save and start, Start without weighing, Cancel |
| Start | "Today" (or "Rest day" when the first routine is not today's; "Not synced yet" or "No workout running" when there is nothing), the routine's name, "5 exercises · 17 sets", the week streak when there is nothing else to hint at (in the accent once this week's workout is done), Start, and along the bottom "Phone connected" or "Phone away" (nothing when the watch cannot tell) with "Waiting to sync 3" | Start (Quick start on a day without a plan), Routines when there are more |
| Routines | three routines a page, "Today" on today's and the folder's name under the others (routines without a folder first, then each folder's together) | tap one to start it, Cancel, `>` for the next page |
| 3-2-1 | a big 3, 2, 1, then "Go!" (3.7 s in all) | a tap on the number starts at once, Cancel |
| Set | the heart rate and sync line, the exercise, "Set 2 of 4" (warm-up, left or right, "Edit" while fixing), the resistance band tag when the phone names one ("Red + Yellow"), the superset partner ("+ Lateral Raise"), weight and reps as two tiles with − and + under each ("Added weight" for a bodyweight exercise), last time, Done | − and + on each tile (the exercise's own plate step, one rep, five seconds for holds), Done, `<` fixes the last logged set, Menu |
| Hold | the exercise, the seconds left big (orange for the last five), a bar, Stop | Stop logs the seconds held; at zero it logs itself |
| Rest | a ring that empties (or a plain countdown when the phone's rest style is plain), the time, "Up next" with its numbers, four effort chips (RIR or RPE, the phone's setting) until one is picked, −15, Skip, +15 | the chips, −15, Skip, +15, Menu |
| Menu | Previous set, Overview, Add set, Remove set, Skip set, Next exercise, Finish and save, Discard workout, Continue workout (a list, it scrolls) | each one |
| Finish, discard or remove | the question, Cancel, and the action | Finish, Discard and Remove set always ask first |
| Overview | "7 of 17 sets", the phone's session note at the top when there is one (read only), four exercises a page with their sets done ("> " marks the one up now, a "Superset" heading above the first exercise of each superset), "+3 exercises" still to come from the phone, "Waiting to sync 3" or "All synced", Finish | an exercise with sets left takes you there, `>`, Finish, Continue workout |
| All sets done | "All sets done", the count, Finish | Finish |
| Cardio, or a timed exercise with nothing left | "Log this one on your phone." or "All sets done", Next exercise | Next exercise |
| Waiting for the phone | the workout's name and "Next exercise is on its way from your phone" (or "Waiting for the phone") | Menu |
| Still training? | after 20 minutes without a set ("No set for 23 min. Still at it?"), or at once when the phone says you left the gym | Keep going (the phone hears it, a `stillHere` event) or Finish (the Overview) |
| Summary | "Workout saved" (or "Ended on your phone"), the name, a still medal (gold on a records day, steel otherwise) with the minutes big, a diamond per record and the set count or record count under it, up to four record plates ("Bench 60 to 62.5 kg", "+2 more" past four), the time, sets and volume, average and maximum heart rate, the sync line | scroll, Done (a tap in its first second is ignored) |
| Metrics | five pages, reached by a swipe left from Set or Rest: the numbers (time big, heart rate in red, "5/13 Sets", volume), Pulse (average, lowest, highest and twelve bars), Effort (RIR or RPE, the mean per exercise rated here, the latest five, "+n more"), Zones (the five bands, the time in each, the zone now marked; "Add your birth year" without one) and Muscles (sets done per muscle, most first). Pulse is left out without heart-rate readings or when the phone's heart-rate switch is off, and Zones also when its zones switch is off | a swipe left for the next page, a swipe right or the small `<` button at the top left for the one before (from the first, back to the workout) |

Things that are the same as on the other watches, taken from the Garmin's `Core.mc` as a port
(`common/core.js`): the phone's workout window, today's routine started by the watch with the phone
away, warm-ups, per-side sets, supersets, timed holds (and "Timed holds start by themselves" when
the phone has it on), one rest for the phone and the watch (protocol 2, docs/WATCH_SYNC.md), the
clock offset sent as `off`, the outbox until the phone acknowledges, a set ticked on the phone
moving the watch on, "Still training?", fixing a set and the effort chips. Event ids start with
"h" (the Garmin's with "g") so two watches cannot clash. Taken from Wear OS and the Apple Watch
instead: the check-in and weigh-in before a start, Add set and Remove set, and the heart rate of a
set ticked on the phone.

- Buzzes: a short one ten seconds before a rest ends, two long ones at the end of a rest and of a
  hold, a tick for each number of a 3-2-1 and for a hold's last three seconds, one for Done, and one when
  a workout is finished (short, long on a records day). The
  phone's "rest haptics" setting turns them all off. The watch has only `short` and `long` (no
  pattern, no strength), so `view.js` turns each of the core's patterns into some of those.
- The screen is kept on during a rest and a hold (`setKeepScreenOn`), and only then. Huawei says
  this only stops the inactivity timeout, not the screen going off because you cover it or lower
  your wrist.
- **Heart rate** from the watch's own sensor (`subscribeHeartRate`) while a workout runs. Each
  set logged on the watch carries `hr: { avg, max }`, as on the other watches. Huawei says the
  sensor reports every five seconds; the watch lets the last reading count for 15 seconds and then
  counts none. Needs the `READ_HEALTH_DATA` permission, which the app asks for in its manifest.
  Whether the watch grants it is not verified. The watch keeps the workout's readings in memory
  (5-second buckets, so a long workout thins out but each average and maximum stays exact), so it
  can also send a `setHr` event with the heart rate of a set that was ticked **on the phone**, and
  the heart rate of the rest after a set (`restHr`). A watch that has done nothing for three hours
  may stop the sensor (`sensorShouldRest`) and starts it again at the next action.
- **Add set and Remove set** in the Menu change the lifter's own workout at once and go to the phone
  as `addSet` and `removeSet` events. Until the phone names the event in `acked`, the watch lays its
  own edits over every snapshot, so an older snapshot does not undo them; after that the phone's
  snapshot is the truth (a removal the phone refused, because the set was ticked there meanwhile,
  is simply back). Remove asks first and has no undo: a set that can be removed is not done, so
  nothing logged is lost. The watch is more careful than the phone: no add or remove on cardio or
  on a timed exercise done per side, and a remove only when every set of the exercise has an id.
- **Watch status**: at start the watch tells the phone its app version (`watchStatus`, only the
  newest waits in the outbox). The phone stores it as it does the Apple Watch's. What the phone
  shows with it for a Huawei watch was not checked.
- **The session note** is the phone's, read only: the watch cannot type.
- **Records** are found on the watch by Wear OS's rules, from the sets it saw (`records.js`, keyed by the
  exercise's place and id, so an exercise the phone moves keeps one line).
- **The phone's look**: the accent colour (`settings.accent`) and the ink on it, otherwise openGym's
  lime. The phone's "show" switches (heart rate, last time, up next, zones, and the rest style ring or plain) are followed; the others the
  phone sends (kcal, clip) are stored and not used yet.
- **Language**: the phone's (`settings.lang`), else the watch's own language when it is one of ours,
  else English. The words are the Wear OS watch's and the Garmin's, plus a few of its own, in the
  26 languages (the app's, except Japanese, which the Wear OS watch has no words for yet, so it shows
  English). Arabic, Bengali, Persian, Hindi and Thai are in the file but shown in English, because
  the watch's one font (SourceHanSansSC-Regular) may not draw them. See "Honest limits".
- **Saving**: the watch keeps its state in files, so closing the app, the watch running out of
  battery or Huawei ending the app does not lose a set (see "How it talks to the phone").

No exercise media goes to the watch: text and numbers only (and the licence would not allow it).

### The look

The whole UI now follows the Apple Watch app's current look (the open 1.4.6 Apple Watch pull requests, for example #1139, #1314 and
#1198): black ground, the accent on Done and Start, weight and reps as two tiles, the heart rate in red, the effort colours by band,
the summary as a medal. The Huawei watch cannot copy all of it:

- one font, so no bold;
- no glass and no blur;
- no icons such as the heart or the tick (words and plain characters only);
- no crown, so the − and + buttons stay;
- no curved lettering on the medal rim (the legend sits under the medal instead).

Left out because the Huawei core has no logic for it yet: the set types Warm-up, Failure and Drop, half-step effort, the ±15 circle on
the rest, the session note (read only here) and re-rating a set. The Set page's `>` is drawn dimmed and takes no tap outside fixing,
because the core has no "look at the next set" action.

### What it leaves out

Compared with the Garmin app, and with Wear OS and the Apple Watch:

- The medal's animation, its back face, its rim lettering and notches, calories, and a Metrics page for the clip or the
  kcal.
- Buttons, the crown and swipes. There is no way to step a number with the crown or to pick a box
  by touch and then turn it; the − and + under each number do it. A swipe left opens the Metrics pages from the Set or the Rest and a swipe right goes back through them; a swipe right
  leaves the app from the Start screen only, never in the middle of a workout.
- The keypad, typing a session note, music, exercise pictures, the glance or widget.
- Finishing a workout by holding a button (Wear OS has it). Finish takes a tap and a confirmation.
- Undo after Remove set (Wear OS has it). Here Remove asks first instead.
- A workout recorded in Huawei Health. The Garmin app can save its workout to Garmin Connect; this
  watch app writes nothing to Huawei Health, so there are no Huawei activity records and no
  double-counting to worry about. (Health Service Kit for lite watches exists from HarmonyOS 6.1.1 and
  needs its own Huawei application; it is not used.)
- Cardio is logged on the phone (the watch says so and moves on).
- The memory tricks the Garmin app needs for its smallest watches (a held-back tick, a short
  outbox). The outbox holds 100 events (160 when nothing has been sent at all). Huawei's docs give
  no memory figure for a lite app; see "Honest limits".

## How it talks to the phone

The same protocol as the Garmin (docs/GARMIN.md, docs/WATCH_SYNC.md): `{ "events": [...] }` comes
back, each event stays on the watch until a snapshot's `acked` names it, and the phone applies each
event once, by its id, through the workout screen's own actions. The snapshot is the Garmin's
(`lib/garmin-snapshot.js`, at most 3 KB, a window of the workout), made in JavaScript so Java does not
repeat it.

- **`WatchBridge`**: `status()` says `garmin` for the Garmins alone and `huawei` for a Huawei watch
  with the app, each flag meaning the page makes that watch's snapshot; `sendSnapshot` takes a `garmin`
  and a `huawei` string and each goes to its own watches.
- The phone names the applied events in `acked` per watch (`unnamed` in `watch-sync.js`), so the
  Huawei watch's ids are named without waiting for its second send. A review found that ids cut from
  `acked` for size can leave that list without having been named; the watch then sends them again and
  they are named the second time, so a set is delayed and never lost.

Only the wire differs. Huawei's Wear Engine carries **text of at most 1 KB per message**, both ways,
through the Huawei Health app (Bluetooth, Huawei's own protocol). So a message is one JSON text, cut
into frames.

```
watch app  --frames-->  Wear Engine  -->  Huawei Health  -->  HuaweiLink  -->  queue file  -->  openGym page
           <--frames--                <--                 <--           <--  (snapshot from the page)
```

| Piece | Where | What |
| --- | --- | --- |
| `watch-huawei/.../common/core.js` | watch | the logic, a port of the Garmin's Core, Actions and Link as plain JavaScript |
| `watch-huawei/.../common/view.js` | watch | which screen, every line of text, what each tap does |
| `watch-huawei/.../pages/index/` | watch | the one page: `index.hml`, `index.css`, `index.js` (glue only, the only file that touches Huawei's APIs besides `wearengine.js`) |
| `watch-huawei/.../common/frames.js`, `radio.js` | watch | the framing, and the sending and receiving through Huawei's `P2pClient` |
| `watch-huawei/.../common/store.js` | watch | the state in the watch's files, safe against being killed |
| `watch-huawei/.../common/texts.js` | watch | the words, generated by `huawei-strings.mjs` |
| `watch-huawei/.../common/wearengine.js` | watch | Huawei's own SDK file, unchanged (Apache-2.0) |
| `frontend/android/app/src/hms/.../HuaweiLink.java` | phone | the link: Huawei Health, permission, watches, receivers, sending |
| `frontend/android/app/src/main/.../HuaweiFrames.java`, `HuaweiSend.java`, `HuaweiForget.java` | phone | the framing (same vectors as the watch), one-snapshot-at-a-time sending, and when a watch is forgotten (two lists in a row leave it out; an empty list forgets nothing), JVM-tested |
| `frontend/android/app/huawei.gradle` | phone | everything of Huawei's for the build |
| `frontend/android/app/src/{sideload,play,playNoBackgroundLocation}/AndroidManifest.xml` | phone | the Wear Engine app id as manifest meta-data |
| `WatchBridgePlugin` (`huaweiStatus`, `huaweiPick`) | phone | the two calls the page makes; the F-Droid and Offline builds answer "build" |
| `frontend/src/views/HuaweiSettings.jsx`, `lib/huawei-view.js` | page | Settings → Watches → Huawei watch: state, watches, Allow in Huawei Health, Look again, the link to this guide |

### The frames

Before framing, every character outside 0x20 to 0x7E is written as `\uXXXX` (four lower-case hex
digits), so every frame is plain ASCII. (How other text survives Huawei's link is not documented, so
nothing is left to chance.) The escaped text is cut into parts of at most 960 characters, and each
part goes as one text message:

```
<id>.<i>.<n>|<part>
```

`id` is 1 to 6 characters of `[0-9a-z]` (the sender's counter in base 36), `i` the part's number from
0, `n` the number of parts (1 to 16). A receiver keeps one message in the making: a frame with another
`id` (or `n`) starts over, the same part twice means the later one stands, and when all parts are
there they are joined and parsed. A frame that does not match is ignored; so is a text that is not a
JSON object. The next frame goes when the one before reported success; a failure ends that
message and nothing half-sent is repaired, because the next `hello` or snapshot sends the latest
whole. A message of more than 16 parts is not sent. `watch-huawei/test/frames.json` holds the
vectors both codecs (JavaScript and Java) must reproduce.

### Who speaks when

- The watch app opens (or comes back to the front): it registers its receiver and sends `hello`.
- The phone gets `hello` and sends the latest snapshot to that watch.
- The page changes the workout: `sendSnapshot` goes to every connected Huawei watch that has the app. The page's `again`
  flag (a deliberate resend, such as an event that came a second time) is passed on by `WatchBridgePlugin.sendSnapshot` to
  `HuaweiLink.send(json, again)`, so it always goes.
- A workout starts on the phone: the link **pings** each connected watch with the app. On a lite
  watch a ping opens the app (Huawei's guide says so), and the app then says `hello`.
- A set is done on the watch: the event goes to the phone, which writes it into the same queue file
  as the Wear OS watch's and the Garmin's. A `hello` is never queued for the page.

### Messages only arrive while the watch app is on screen

This is Huawei's rule, not a choice: a message to a lite watch whose app is not in the foreground
fails (code 206), and Huawei keeps nothing for it. The watch app is built around that:

- It registers its receiver when it comes to the front and lets go of it (and of the heart-rate
  sensor and its one-second clock) when it is hidden.
- It says `hello` each time it comes back to the front, and the phone answers with the latest
  snapshot. So whatever the phone changed while the watch app was away reaches it as soon as you look
  at it again.
- Events wait on the watch (in its outbox, saved in files) until the phone's snapshot names them in
  `acked`. A phone out of reach, a phone app that is not running, a failed send: none of them loses a
  set. They go again (an unsent one after 30 seconds, one not confirmed after a minute) while the app
  is in front, and an event the phone gets twice is applied once.

**What this means for the lifter.** The watch runs the workout by itself: it has the routine,
the sets, the rest and the hold timers, and it keeps every set until the phone confirms it. But
nothing moves between the watch and the phone while the watch's screen is off or another app is in
front. In practice: raise your wrist or touch the screen and the watch app (which stays the app in
front for as long as the watch keeps it there) syncs within seconds. A set you log and then lower
your wrist on is sent the next time the app is on screen. "Waiting to sync 2" on the watch means
two sets are still waiting. The phone's own display of the workout can therefore be behind the watch,
and the other way round. Whether the watch keeps the app in front between sets with the screen
dark, and for how long, is Huawei's setting and **not verified**.

The phone's side is the mirror of this: a send to a watch whose app is away fails and is ignored
(it is normal), the last snapshot is kept and sent again when the watch says `hello`, and at
most one snapshot is on its way to a watch at a time (`HuaweiSend`). An identical snapshot is not sent twice within 20 seconds
(`REPEAT_MS`), unless the watch said hello or the page sent it with `again`; the 20 seconds are a fallback for a page without `again`. A frame that gets no answer in
10 seconds marks its message stalled; the next message then waits for that frame's answer or 30
more seconds (`STALL_MS`, `GRACE_MS` in `HuaweiLink.java`).

### The phone side

**Settings → Watches → Huawei watch** (Android app only; `HuaweiSettings.jsx`, words in
`lib/huawei-view.js`, each state tested). Opening the page is what starts the link: nothing of
Huawei's runs for someone who never opened it (the same rule as the Garmin's). Each state says what
to do next:

| `huaweiStatus` state | The line | Button |
| --- | --- | --- |
| `build` (F-Droid, Offline, or no ids in this build) | this version comes without the Huawei link; the Google Play and GitHub versions have it | none |
| `no-health` | Huawei Health is not on this phone: install it, pair the watch there, come back | none (noticed by itself) |
| `no-permission` | openGym needs your OK in Huawei Health | Allow in Huawei Health |
| `error` | could not reach Huawei Health | Look again |
| `starting` | looking for your watch | none |
| `ready`, no watch | Huawei Health does not know a watch yet | Look again |
| `ready`, watches | open openGym on your watch and keep it open while you train | Look again, and Get openGym for Huawei while a watch lacks the app |

That `build` line is true for F-Droid and Offline. It is also what a Play or GitHub build says until
the two ids are in it (they stay empty until Huawei approves the app), and then it wrongly says those
builds have the link. A review found this; the words need a second case before such a release.

Each watch says "Connected", "Not in reach" or "openGym isn't on it yet". "Get openGym for Huawei"
opens this guide on GitHub (there is no store page yet).

**HuaweiLink.** It starts from `WatchBridgePlugin.load` once the page was opened. It checks that Huawei
Health is installed, sets the peer package (`ch.duartesantos.opengym.huawei`, the watch app's
`bundleName`) and the watch app's fingerprint, asks Huawei Health whether openGym is allowed
(`Permission.DEVICE_MANAGER`, basic device information), lists the watches (`getBondedDevices`),
registers a receiver for each connected one, and remembers which watches have spoken to it. When
Huawei Health goes away (updated, stopped) it brings everything up again: asked again after 5
seconds, doubling up to 5 minutes (`REVIVE_FIRST_MS`, `REVIVE_MAX_MS`); a start that does not come
up is tried a few times (`GarminUse`), then says `error`. A watch is forgotten (`HuaweiForget`) only
when two lists from Huawei Health in a row leave it out. A review found one gap: if Huawei Health's
first list of watches is empty or fails, nothing asks again until Settings → Huawei watch is opened,
so the watch's `hello` is not heard before that (sets wait on the watch, none is lost).
`open()` also pings the watches. Everything is guarded: a failing SDK call leaves the link in a state
the page shows, never a crash.

The link asks `isAppInstalled` for "openGym is on this watch", but a watch that ever spoke to the
phone counts as having the app whatever the SDK says (the code comment says it is not known whether
the SDK answers that for a lite watch).

**The F-Droid and Offline builds** answer `huaweiStatus` with `state: "build"` and `huaweiPick` with
`{ ok: false }`, as with the Garmin.

## Where it differs from the Garmin, on purpose

- **The snapshot.** None of its own: the Huawei watch gets the Garmin's.
- **The wire.** Garmin sends a dictionary (Monkey C has no JSON parser). Huawei carries text, so the
  watch parses and writes JSON, framed and escaped as above.
- **Touch only.** The Garmin app has a layout per kind of watch (buttons, touch, black and white).
  The Huawei watches this targets are touch AMOLED watches, so there is one layout and no button
  handling.
- **Two buttons under each number**, not a box you pick and then step. There is no "outlined box"
  state to remember.
- **The phone's language**, not the watch's. Connect IQ picks resources by the watch's system language,
  so the Garmin cannot follow the phone; the Huawei watch can, because its words are in one file.
- **Saved in files** (`store.js`). The lite engine reads at most 4 KB of text per call and writes
  about 4 KB, so the state is escaped to ASCII and cut into parts of 3,000 characters. A save never
  touches what the last complete save wrote: the new parts first, then a small head file
  naming them (two head files take turns), then the old parts are deleted. A save cut off by the
  app being killed leaves the other head, and the parts it names, whole. A load takes the newest head
  whose parts all read back to the length the head names. This is a design, tested with a file API
  that tears a write; it has not run on a watch.
- **A rest alarm that the page cannot guarantee.** The Garmin has a background timer and its own
  buzz. A lite JavaScript app has no documented way to run while its page is hidden, so the countdown
  is computed from the clock each time the page draws, and the buzz at the end of a rest happens only
  if the page is running. The screen is kept on during a rest to give it the best chance, which
  Huawei says does not survive covering the screen. If this turns out to matter, the phone could send
  a Wear Engine notification (the `NOTIFY` permission is open to individual developers); that is not
  built.
- **No recorded activity**, see above.
- **Before a start.** The Garmin has no check-in or weigh-in. The Huawei watch has both, as Wear OS
  does, and the weigh-in is four buttons (-1, +1, -0.1, +0.1) rather than a keypad. Add set and
  Remove set are here and not on the Garmin.

### Where it differs from Wear OS

The Wear OS app is the model for the behaviour; these are the places this watch does it otherwise.

- **No undo on Remove set, but a confirmation.** A removed set was never done, so nothing logged is
  lost; Wear OS lets you undo, this watch asks first.
- **No finish by holding.** Finish and Discard are a menu entry and a confirmation.
- **No typing a note.** The phone's note shows read only on the Overview.
- **Touch only, no crown**, and the screen is a lite JavaScript page, not Compose.
- **Messages only while the app is on screen** (see above). Wear OS's Data Layer queues; Huawei does not.
- **Stricter Add and Remove.** No add or remove on cardio or a timed exercise done per side, and a
  remove only when every set of the exercise has an id.
- **The pages.** The Metrics pages and the summary's medal are built, as still pictures: no animation, no back face, no rim lettering.
- **Ids.** Events are `h…`, the Garmin's `g…`, so two watches cannot clash. The two fingerprints are
  placeholders until the owner has the Huawei accounts (see "What the owner does").

## What is planned next

The phone-and-watch parity was built in two steps, and both are in this guide: the first is the workout itself, the second is the
Metrics pages, the records, the medal, the streak and the Apple look. What is left is what "The look" lists as left out (it needs
new core logic first) and everything the first run on a real watch will show.

Exercise pictures are out until the owner decides a licence question. The pictures and animations
are Gym visual's, not AGPL, and its notice in `NOTICE.md` says they are "provided strictly for use
within the openGym application" and that third parties have no right to extract or integrate them
into other apps. A watch app is a separate package, signed for and published through Huawei's store.
The question is whether a few small stills inside that package still count as "within the openGym
application", or whether Gym visual has to agree to it first. Until that is answered, no media goes
to the watch (the 180 px rule in `NOTICE.md` and `scripts/catalogue/check-media.mjs` applies to the
repository either way).

## Android only, and not iPhone yet

The settings page exists in the Android app only (`settings-pages.js`: `mobile` and `android`),
like the Wear OS page. Huawei has an iOS Wear Engine SDK (`iOS_WearEngineSDK_1.0.0.305`, Huawei Health
15.0.10.315 or later, its own application form, no fingerprints), so an iPhone link is possible. It
is not built, because:

- nobody has a Huawei watch to try either phone with, and Android is the platform Huawei's lite
  watches are most used with;
- on iOS the phone can ping the watch app open, but the watch cannot start the phone app, and the
  iPhone suspends a backgrounded app, so the watch's events would wait until openGym is opened;
- it needs a new Swift bridge, its own Wear Engine application and another closed SDK in the App
  Store build.

If someone has a Huawei watch and an iPhone, that is the next thing to ask for.

## Licence and builds

Huawei's Wear Engine SDK for Android (`com.huawei.hms:wearengine`) is **not open source** and comes
from Huawei's own Maven repository. So, as with Garmin's SDK:

- It is in the GitHub APK (`sideload`) and the Google Play build (`play`) only. The F-Droid flavour
  and openGym Offline have no Huawei code; `scripts/android/check-fdroid.sh` and `check-offline.sh`
  fail if `huawei` or `wearengine` is in their classpath or `com.huawei` in their manifest (CI runs
  both).
- All of Huawei's build parts are in one file, `frontend/android/app/huawei.gradle`, applied by
  `app/build.gradle` only when the file exists: the repository URL (limited to `com.huawei.*`), the
  dependency, the source set `src/hms`, the two values as `BuildConfig` fields and the manifest
  placeholder. F-Droid's scanner refuses an unknown Maven repository, so **the F-Droid recipe must
  delete this file** (`rm: frontend/android/app/huawei.gradle`, next to the `wear` entry; the recipe
  lives in fdroiddata, outside this repository). `scripts/android/fdroid-prebuild.sh` deletes it as
  its first step as well, for a recipe that does not list it, and `check-fdroid.sh` fails if
  `developer.huawei.com` appears in any other Gradle or Kotlin script file under `frontend/android`
  (the script runs from there).
- Without the file, `sideload` and `play` do not build at all (the plugin calls `HuaweiLink`), so a
  release can never go out without the link by accident. With the file but without the two values
  the link says `build`.
- The two values are `-PhuaweiAppId=...` and `-PhuaweiWatchFingerprint=...` (on the command line or in
  the release machine's `gradle.properties`, never committed). Both empty by default.
- There is no ProGuard rule for Huawei's SDK: the sideload and play builds are not shrunk today
  (`huawei.gradle` says so). Huawei's guide asks for `-keep class com.huawei.wearengine.**{*;}` the
  day they are, so that rule must be added then.
- The watch app's `wearengine.js` is **Huawei's file, Apache-2.0, Copyright (c) 2021 Huawei Device
  Co., Ltd.**, version 5.0.2.306, copied unchanged. It is the SDK for lite watches that Huawei tells
  developers to copy into their project. NOTICE.md lists it. Everything else in `watch-huawei` and
  the phone code is openGym's, AGPL. Whether the AGPL needs an explicit additional permission for
  Huawei's closed phone SDK, as for Garmin's and for Google Play services, is the owner's call.
- The licence of the exercise media does not come into it: no media goes to the watch.

## Building and testing

The tests need only Node (no install, no dependencies):

```bash
cd watch-huawei
npm test                          # 390 tests, see below
node huawei-strings.mjs           # regenerates common/texts.js after the words change
```

CI runs `npm test` in `watch-huawei` (job `huawei` in `.github/workflows/test.yml`) when
`watch-huawei/**` changes or one of the files its tests import or read does: the Garmin and Huawei
snapshot code (`garmin-snapshot.js`), `watch-sync.js`, `watch-settings.js`,
`daily-form.js` and the Garmin fixture `frontend/garmin/test/snapshot.json`. The filter is in one
place, the `huawei:` list of the `changes` job. **It leaves out the words on purpose**: the app's
locale packs and the Wear OS and Garmin strings files do not start it, so a translation pull request
never waits on this job. That is how the repo treats the other watches' words too: nothing checks
`wear-strings.mjs`, `garmin-strings.mjs` or `zepp-strings.mjs` output against the packs
(`garmin/check.mjs` only checks the Garmin's own files agree with each other). The price is the
same: `texts.js` can be a little behind a new translation until someone regenerates it, and the next
pull request that touches `watch-huawei` then fails `strings.test.js` ("texts.js is what the generator
writes now"). The job's failure message says to run `node watch-huawei/huawei-strings.mjs` and commit
`common/texts.js`.

What the tests cover (15 test files): `core.test.js` the logic against the Garmin's own fixture; `view.test.js` every
screen, taps and the data the HML binds to; `metrics.test.js`, `medal.test.js` and `records.test.js` the Metrics numbers, the
medal's data and the record lines (ported from Wear OS's tests); `frames.test.js` and `HuaweiFramesTest` the same
vectors; `radio.test.js` sending and receiving with a fake client; `store.test.js` saving with a
torn write; `link.test.js` the whole wire with the phone's real snapshot code and a page that
applies events as `watch-sync.js` does, over a radio that drops, fails or never answers;
`page.test.js` the page file run under Node with fake Huawei APIs; `strings.test.js` that `texts.js`
is what the generator writes now and that every language has every word; `syntax.test.js` and
`methods.test.js` that no file uses what Huawei's engine does not promise (classes, spread, template
strings, `for...of`, `Promise`, `find`, `includes` and the like) or a method outside a short list;
`labels.test.js` that no button label is wider than its button (an estimate, not a render);
`layout.test.js` the page's boxes added up (explicit sizes, targets of at least 56 px with 8 px
between them, nothing wider than the circle on a round screen). The fixture is `frontend/garmin/test/snapshot.json`.

The strings come from the Wear OS watch's (`frontend/android/wear/src/main/res`), the Garmin's and
the app's packs, so run `frontend/android/wear/wear-strings.mjs` and `frontend/garmin/garmin-strings.mjs`
first when those change, then `node watch-huawei/huawei-strings.mjs`.

**The watch app.** You need Huawei's DevEco Studio (a free HUAWEI developer account for the signing).
Open `watch-huawei` as a project. The layout is the one of Huawei's current sample for lite wearables
(`apiType` `faMode`, hvigor model 5.1.0, compatible SDK 4.0.0(10), target 5.1.0(18)). From the
command line Huawei's "Command Line Tools" give `hvigorw`; the task is `assembleHap`, usually
`hvigorw assembleHap --mode module -p product=default -p buildMode=debug`. The exact flags for a
lite project are **not verified**. Wear Engine needs "Compile SDK 10" in DevEco Studio, per Huawei.

**The simulator.** In DevEco Studio pick "Huawei Lite Wearable Simulator" in the device list, press
Run and choose the shape and resolution (it can also set heart rate, screen on and off and the
language). Huawei documents that it runs signed and unsigned apps. Whether it provides
`@system.wearengine` is not documented; the page guards every Wear Engine call, so without it the
app should come up and say "Not synced yet" and nothing more, because only the phone can give it
a workout. This has not been tried. A phone side cannot be tried in a simulator at all; that needs
the real Huawei Health and a real watch.

**The phone app.** The sideload and play builds with the two properties:

```bash
cd frontend/android
./gradlew assembleSideloadDebug -PhuaweiAppId=<id> -PhuaweiWatchFingerprint=<fingerprint>
```

A debug build has the package `ch.duartesantos.opengym.test`, which is not the one registered with
Huawei, so Huawei will most likely refuse it (the code comment says so, and it is not verified). Test
with a release-signed build of the real package.

## What the owner does

Only the project owner can do these. In this order; the first three take Huawei up to two weeks.
Each step says where its facts come from. "Confirmed" means read in Huawei's own documentation or
sample code; "not verified" means a blog, a third-party project or a guess.

1. **Make a Huawei developer account** at developer.huawei.com and pass the identity check. An
   individual account is enough for what openGym uses (basic device information, which includes
   app-to-app messages; Huawei says individuals can apply for it). Wear status and heart-rate alerts
   through the phone's SDK are for companies, and openGym does not use them. Confirmed.
2. **Apply for the HUAWEI ID service for the phone app.** In AppGallery Connect: Console → App
   services → Development → HUAWEI ID → Apply. Product type "Mobile app"; create the app; enter the
   Android package `ch.duartesantos.opengym` (Huawei says it cannot be changed after submitting) and the
   **SHA-256 fingerprint of the phone app's signing certificate**: that of the release keystore
   (`keytool -list -v -keystore $K/opengym-release.keystore`, the `SHA256:` line). The GitHub APK and
   the Play build use the same key (`app/build.gradle`), so one fingerprint covers both. The app gets an
   **app id**. Register every fingerprint a build can be signed with before you test:
   Huawei says to do so in advance for several stores; how many one app may register is not verified.
   Confirmed, except the number.
3. **Apply for Wear Engine.** Console → App services → Development → Wear Engine → Apply. Choose
   the Android app from step 2 and the permission "Basic device information / DEVICE_MANAGER". Upload the
   data-use spreadsheet and screenshots of the authorization path the user sees (in openGym: Settings →
   Watches → Huawei watch → Allow in Huawei Health). Huawei says to expect one to two weeks. Until it
   is approved every call fails with error 8 ("scope unauthorized"); after approval the phone's
   cache updates within 24 hours (clearing Huawei Health's data forces it). Confirmed. Nothing here
   needs the watch app to exist yet.
4. **Put the app id in the build**: `-PhuaweiAppId=<id>` (step 2's app id) on the release machine's
   command line or in its `gradle.properties`. Never commit it. It goes into the manifest as
   `com.huawei.hms.client.appid` (the three manifests under `src/sideload`, `src/play`,
   `src/playNoBackgroundLocation`) and into `BuildConfig.HUAWEI_APP_ID`. Confirmed (the manifest
   entry); `scripts/android/build-release.sh` does not pass it, so set it in the release machine's
   `gradle.properties`.
5. **Sign the watch app.** In AppGallery Connect make a certificate and a provisioning profile for
   the watch app (bundle name `ch.duartesantos.opengym.huawei`): a debug pair to test, a release pair to
   publish. In DevEco Studio: File → Project Structure → Signing Configs, which fills the
   `signingConfigs` of `watch-huawei/build-profile.json5` (the product `default` already names a
   signing config, and none is in the repository). The `.cer`, `.p12` and `.p7b` files are in
   `.gitignore`: keep them with the other signing keys. Whether a lite watch's device id (UDID)
   must be registered for a debug profile is **not verified**.
6. **Work out the watch app's fingerprint** and give it to the phone build:
   `-PhuaweiWatchFingerprint=<value>`. Huawei's steps: take the watch app's signing `.cer`; keep the
   last `BEGIN CERTIFICATE` block as a new `.cer`; run `openssl x509 -in test.cer -text -noout`;
   take the public key's hex, strip spaces and colons, and Base64-encode those bytes. Huawei's
   format is "package name, an underscore, the Base64 text" (their example:
   `com.huawei.wearengine_BC5Z9/29Yn...`), so here
   `ch.duartesantos.opengym.huawei_<base64>`. The limit on a lite watch is 127 characters (Huawei writes
   "bits"). It must be the fingerprint of the certificate the **installed** watch app was signed with,
   so a debug and a release watch app need different values. Confirmed from Huawei's guide; the unit
   and the exact format of the underscore part I read as characters: not verified.
7. **Give the phone's fingerprint to the watch app, in two places.** The SHA-256 of the phone's release
   certificate from step 2 (hex, no colons), in:
   - `PHONE_FINGERPRINT` in `watch-huawei/entry/src/main/js/MainAbility/pages/index/index.js` (the
     placeholder is `REPLACE_WITH_SHA256_OF_SIGNING_CERT`), and
   - `supportLists` in `watch-huawei/entry/src/main/config.json`, as
     `ch.duartesantos.opengym:<the same value>` (the same placeholder; at most 255 characters).

   Huawei says older watch firmware reads only `supportLists` and newer reads the fingerprint from
   code, and tells you to set both. The watch app takes one value, so it works with one phone
   signing key; the GitHub APK and the Play build share one. A phone build signed with another key
   (a debug build) will not match. Confirmed.
8. **Build the watch app, first in the simulator**, then a signed `.hap`:
   DevEco Studio → Build → Build Hap(s), or `hvigorw assembleHap` (see "Building and testing").
   Look at every screen at 466 × 466 and 454 × 454 round and a rectangular one. The first build is
   where the project files, which were written by hand from Huawei's sample and never opened in
   DevEco Studio, will show what is wrong with them.
9. **Install it on a real watch** for the first test. Huawei Health and DevEco Assistant: build a signed
   `.hap`; copy it to `/sdcard/haps/` on the phone; pair the watch in Huawei Health; open DevEco
   Assistant (from AppGallery) and tap "Install watch app". This is from a Huawei DevRel article
   and a third-party sample; whether it works from a phone that is not a Huawei one is **not
   verified**. For the GT 2 and GT 2e this is the only way. A third-party report says a real lite watch gives no logs back (not verified).
10. **Build the phone app** with both properties (steps 4 and 6): `./gradlew assembleSideloadRelease`
    (and the Play bundle) with `-PhuaweiAppId` and `-PhuaweiWatchFingerprint`. Install a
    **release-signed** one of the real package on the test phone, with Huawei Health installed and the
    watch paired in it (and HMS Core if the phone is not a Huawei one).
11. **A first test on a real phone and a real watch.** Tick these off, and write down what fails:
    - [ ] Settings → Watches → Huawei watch goes from "Looking for your watch…" to "openGym needs
      your OK in Huawei Health", the button opens Huawei Health's own screen, and after
      allowing it the watch shows as Connected.
    - [ ] Open openGym on the watch: it says "Not synced yet" until the phone answers, then today's routine
      appears. (This is the first message in each direction, and the first test of the fingerprints and
      the app id.)
    - [ ] Start a routine on the watch: 3-2-1, the first set, Done, the rest ring, the buzz ten seconds
      before the end and at the end, +15 and Skip. Does the set show on the phone's workout?
    - [ ] Start a workout on the phone: does the watch app open by itself (the ping), and show it?
    - [ ] Exercises with accents, Cyrillic, Chinese in their names: do they arrive whole on the watch
      (the frames are ASCII-escaped, and this is the test of that)? A routine of many exercises, so
      the snapshot is several frames.
    - [ ] Lower the wrist and raise it between sets: does the watch app come back at once, does it say
      hello, do "Waiting to sync" and the phone catch up? How long does the app stay in front?
    - [ ] The screen dark during a rest: does the buzz at the end come? Does the rest time on screen
      match the real time when you wake it?
    - [ ] Close the app on the watch in the middle of a workout and open it again: is the workout
      still there, with its sets?
    - [ ] Turn the phone's openGym off (swipe it away) and log two sets: do they reach the phone when it is
      opened again? (Whether a watch message wakes the Android app is not documented.)
    - [ ] Heart rate: is a reading shown, does it reach the set, does the permission prompt appear?
    - [ ] A timed hold, a left and right set, a superset, a warm-up, the effort chips, Previous set, Skip
      set, Finish, Discard, the summary.
    - [ ] The words: the watch's language and the phone's, and the five languages that show
      English (Arabic, Bengali, Persian, Hindi, Thai): try a letter of each in the font, and if the
      watch draws them empty `NO_GLYPHS` in `view.js`.
    - [ ] The date and the timers: `Date.now`, `setTimeout` and the file calls work (Huawei's lite docs do
      not list `Date` or timers).
    - [ ] The layout on each watch you can get: text that fits, buttons that can be hit, the Done
      button not hidden by the round corner.
12. **The F-Droid recipe**: add `rm: frontend/android/app/huawei.gradle` next to the `wear` entry in
    fdroiddata's `metadata/ch.duartesantos.opengym.yml`, before the first release that has this file
    (`fdroid-prebuild.sh` also deletes it, but a recipe that lists it is the one F-Droid's scanner
    reads). Then run `scripts/android/check-fdroid.sh` and `check-offline.sh` on the result.
13. **Release the watch app.** Upload it to AppGallery Connect as a HarmonyOS app (a signed `.app`
    package, release countries and regions, review). Huawei says that without identity verification and
    an invitation to its HarmonyOS services you can only develop and debug, not release; the way in is
    to write to agconnect@huawei.com with name and ID. Whether an individual account outside
    mainland China can release a lite watch app, and whether the review needs the phone app to be on
    AppGallery, are **not verified**. Fill in the listing (name, description, a screenshot per screen
    shape, icon, category Health and fitness); the privacy text is that heart rate is read on the
    watch and goes only to the user's own openGym on their phone (no data to the developer or any third
    party); no exercise media is in the package. Then give the watch app a real store link: put it in
    `lib/huawei-view.js` (`HUAWEI_DOCS` links to this guide today), docs/APP_STORES.md and the FAQ.
14. **Each release after that**: bump `version` in `watch-huawei/entry/src/main/config.json` (`name`
    is the release, `code` is `major*1000000 + minor*1000 + patch`, 1004006 for 1.4.6, like the
    phone's `versionName`), build, sign and upload a new version. Nothing checks this number yet (the
    Garmin's `check.mjs` checks its own).

## Honest limits

- **Never built, never run.** The project files (`config.json`, `build-profile.json5`,
  `hvigorfile.ts`, `oh-package.json5`, `hvigor/`) were written from Huawei's current sample and the
  documentation. No DevEco Studio has opened them, no simulator has run the app, no watch has shown
  it. Everything about how the screens look, how the touch feels and whether the text fits is
  unseen. The tests run the logic and the screens' data under Node, not Huawei's engine.
- **The language subset is Huawei's promise, not a test.** Huawei's docs list ten ECMAScript 6
  features lite watches run (let and const, arrow functions, classes, default values, destructuring
  and destructuring patterns, enhanced object literals, `for...of`, rest parameters, template
  strings). The watch code uses `const`, `let`, arrow functions and `import` and `export`, and keeps
  out classes, spread, template strings, `for...of`, `Promise`, `Map`, `find`, `includes` and
  `Object.assign`, which `syntax.test.js` and `methods.test.js` enforce. The core's header says the
  build must turn what is used into what the engine runs, and that nothing checks that. Whether the
  real engine, with its build switches, runs even this is not verified.
- **`Date`, `setTimeout` and `setInterval` are in no Huawei lite page.** The page uses `Date.now()` for
  the clock and `setTimeout` for its one-second loop, and the core needs both. The code comment
  says so (`// unsure: Date is not in Huawei's lite docs; check on a real watch`). If either is
  missing, the app cannot run its clock.
- **What happens to the page when the screen sleeps is undocumented.** Huawei describes no background
  running for lite JavaScript apps. The watch app assumes the page stops (no clock, no messages)
  when hidden, ends its timers on `onHide`, and works the rest and hold times out from the clock on
  `onShow`. No rest buzz is promised while the screen is off. The vibrator has `short` and `long`
  only, and Huawei documents it for a live app.
- **The heart-rate permission** (`READ_HEALTH_DATA`) and the `reqPermissions` block in `config.json`
  were assembled from Huawei's field list and a third-party project's real file, not copied from a
  sample that reads heart rate. The sensor, the permission prompt and whether the app can read
  heart rate on every watch model are not verified.
- **Languages the font may not draw.** Arabic, Bengali, Persian, Hindi and Thai show English until
  someone looks (`NO_GLYPHS` in `view.js`: "check on a real watch and empty this list if it does").
  Huawei says the lite text component supports only the SourceHanSansSC-Regular font. Japanese has no
  watch words yet (the Wear OS watch has none).
- **Text across the link.** Frames are ASCII-escaped because how Huawei carries other text is not
  documented. That keeps non-ASCII names safe at the cost of up to six characters for each, so a
  snapshot full of accents takes more frames. Whether a message of 16 frames (the limit) is too slow
  or too many for Huawei's link is not known. The 1 KB limit and the frame size (960 characters) leave
  room for the `<id>.<i>.<n>|` prefix; that is arithmetic, not a measured fact.
- **Delivery when the phone's app is not running is undocumented.** Huawei describes no queue.
  The watch's outbox is what makes this safe; whether a message from the watch wakes the Android
  app, or arrives only while openGym is in memory, is not verified. The Garmin link has the same
  question, and the same answer: the watch keeps everything until `acked`.
- **Frame timing.** The phone marks a frame stalled after 10 seconds and gives the next message
  another 30 (`STALL_MS`, `GRACE_MS`), the watch retries an unsent event after
  30 seconds and an unconfirmed one after a minute (the Garmin's numbers). Whether Huawei's link is
  fast or slow enough for them is not known.
- **`isAppInstalled` for a lite watch** may not be answered by the SDK. The link treats a watch that has
  ever spoken to it as having the app (`HuaweiLink`: "lean: unsure the SDK answers this for a lite
  watch").
- **Known gaps from the phone review, not fixed when this was written.** The Huawei watch gets the
  Garmin snapshot, so its cut order is the Garmin's (`lib/garmin-snapshot.js`); ids cut from
  `acked` leave the phone's "still to name" list unnamed (a delay, no loss); the link can stay deaf
  for a session if Huawei Health's first list of watches is empty or fails; every hello makes the
  page resend to every link; and the page's `build` words are wrong for a Play or GitHub build
  without ids.
- **Memory and size.** No limit on a lite app's size or memory is documented; the Garmin app's tricks
  for small watches are left out. Saving is cut into parts of 3,000 characters because Huawei's docs say the file
  API reads at most 4 KB per call; one write near 4 KB is from a blog (not verified). A failed delete of an old
  part leaves the file behind (`// lean:` in `store.js`: nothing reads it, and a new save under the
  same generation overwrites it; add a sweep if the folder is ever seen to fill up).
- **Message ids**: the phone's frame ids are the clock in seconds, counting up; six base-36
  digits last until 2038 (`// lean:` in `HuaweiLink.java`).
- **A debug build of the phone app** (`.test`) is not the package registered with Huawei and will most likely be refused.
  The Play and GitHub builds share one signing key, so one fingerprint serves both; the watch
  app takes only one.
- **Android 15 and 16** are not on Huawei's list of phone versions (6.0 to 14). Huawei Health
  14.0.12.310 or later is needed for the latest SDK (5.0.3.304, "Android 14 support").
- **The phone's SDK is a version behind its own docs.** The integration page of Huawei's guide still shows
  5.0.2.306 as its example; this project uses 5.0.3.304, the newest in Huawei's change history.
- **Release rules.** Whether Huawei lets an individual outside mainland China release a lite watch
  app, which countries show third-party watch apps in Huawei Health, and whether the review wants the
  phone app on AppGallery: not verified. Wear Engine is not offered in the United States.
- **CI** runs the watch app's tests, not a DevEco build and not the Android link against a
  watch. The Android CI job compiles `HuaweiLink` against the real SDK only if Gradle on the
  runner can reach Huawei's Maven repository without a login; that has not been seen. If it
  cannot, the `sideload` and `play` tasks in the Android job fail.
- **No iPhone**, see above. No Huawei page in the web app or the iPhone app.
- **The dependency on Huawei Health.** The link works only with the Huawei Health app on the phone,
  logged in with a HUAWEI ID, allowed to run in the background, and (on a non-Huawei phone) HMS
  Core. If Huawei Health stops in the background for power saving, the link says so and tries again;
  a message sent meanwhile is lost and the watch's `hello` brings the latest.
