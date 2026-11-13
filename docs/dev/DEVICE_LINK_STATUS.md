# Device link status

A small sign that tells the lifter, at a glance, whether the things around the workout are talking
to each other: the watch on the wrist, the heart-rate source, the sync server. On the phone it sits
in the workout's top bar and opens a sheet that names each device; on each watch it is a discreet
mark on the home screen and a warning during the workout when something is wrong.

Status: design agreed with the user on 2026-11-12. Visual design still to come (see "Design rounds").

## Why

Mid-workout, a lifter who ticks a set on the watch has no way to know whether the phone got it, or
whether the heart rate is coming from anywhere. Today the answers are scattered: a warning bar for
the server only when it breaks (`components/SyncBanner.jsx`), "Last heard from the watch" deep in
Watch settings (`views/WatchSettings.jsx`), a small crossed-out phone on the Apple Watch only when
sets are waiting (`OfflineSign`), one line of text on the Wear OS and Garmin home screens. The goal
is one simple, honest answer in the place the lifter is looking.

## Goals

- The phone's workout top bar shows one small link icon. Tapping it opens a sheet with one row per
  device or link.
- Each watch shows a discreet link mark on its home (overview) screen, always.
- During a workout, each watch shows a warning only when something is wrong (phone away, sets
  waiting), the way the Apple Watch already does with `OfflineSign`.
- Plain words a non-technical lifter understands. Honest: never claim "live" or "fast" without a
  real signal behind it.

## Non-goals

- No millisecond or "kbps" numbers anywhere. Speed is a word.
- No new Bluetooth code or dependency. Bluetooth chest straps read directly by the app (and so
  Android straps, strap battery, signal strength) are a separate, later feature.
- Not building the phone half of the Garmin link (docs/GARMIN.md "to do"); that is its own project.
- No connect/pair/settings actions inside the sheet beyond one pointer to where a device is set up.
- No change to Settings → Watch, the SyncBanner or the integration cards.

## Anti-goals (would be a failure even if it works)

- A top bar that is busier or wraps on a 320 px phone.
- A sign that says "connected" while nothing has actually arrived (the WHOOP complaint).
- A ping that runs all the time and costs battery, or that blocks the UI (Android `status()` can
  wait up to 3×5 s on slow Play services).
- Status told by colour alone (WCAG 1.4.1): every state differs in shape or has a word.
- A watch workout screen that gains permanent chrome.

## Phone: the icon

- Lives in `views/Workout.jsx` header bar (`.hdr.whdr-bar`), which already holds Minimize, the name
  block, the muscle map, ⋯ and Finish. Where exactly it goes, and its shape per state, is decided in
  the design rounds; it must not push Finish or wrap at 320 px.
- Shown in a live workout. In the editor of a saved workout or a backfilled workout: hidden (nothing
  live to sync). (Builder's call if the design round shows a reason otherwise.)
- Overall state, worst one wins:
  - **All good**: quiet, calm icon.
  - **Something wrong** (any row in a warning state, see "Row states"): the icon changes shape, not
    only colour.
  - **Nothing connected** (no watch, no server, no heart-rate source; a phone on its own): the icon
    still shows, muted.

## Phone: the sheet

Opened with the house pattern (`useUI.getState().openSheet(...)`, new file in `components/`). One row
per link that applies on this device:

| Row | Shown when | Source of truth today |
|---|---|---|
| Sync server | signed in | `S.sync` (`statusOf`, `lastSynced`); reuse `connectionView()` from `components/ServerSync.jsx` |
| Apple Watch | iPhone app, watch paired | `watchStatus()` in `lib/watch-sync.js` (paired, installed, reachable), `readWatchStatus().at` |
| Wear OS watch | Android app with the watch app installed | same `watchStatus()` (Android plugin) |
| Garmin | only once the phone half exists | `status().garmin` (not returned by any plugin yet) |
| Zepp watch | relay set up | `lib/watch-relay.js` `status()` |
| Heart rate | a live source exists | `lib/phone-workout.js` `liveHeartRate()` (AirPods, and paired straps if step 5 confirms) |

Each row shows:
- **Name** of the device.
- **State**: see "Row states" below.
- **What it syncs**, in plain words (e.g. "Sets, rest timer, heart rate"). From the protocol: phone →
  Apple/Wear watch sends the workout, rest timer and routines; the watch sends back ticked sets
  (with heart rate on Apple), start, finish. The server syncs everything.
- **Speed**: the word **Fast** or **Slow** with a small icon. Only for links that can be measured
  honestly (Apple Watch, Wear OS; the server row may use its own request time). No speed on Garmin,
  Zepp, heart rate.
- **Last heard**: only when the link is down ("Last heard 4 min ago"). Never on a live row.
- **Nothing connected**: the sheet says so and gives one line on how to add a device (pointing at
  Settings → Watch / server).

### Row states (watch rows; decided with the user)

The phone does not wait to be told: at the start of a live workout, and every time the sheet opens,
it actively looks for each paired watch (status + a ping).

| State | Meaning | Top-bar icon |
|---|---|---|
| **Live** | The watch answers now. | calm |
| **Delayed** | It answered earlier in this workout, not right now (e.g. app asleep). Its sets arrive when it wakes. | calm |
| **Not answering** | Paired, app installed, but no answer yet in this workout. Row: "Open openGym on your watch". | **warning** |
| **Not found** | The phone sees no watch: not paired, app not installed, or Bluetooth off. Row says which, with the fix. | **warning** |
| **Offline** | Was answering in this workout and has dropped out. "Last heard …" shows here. | **warning** |

Why "Not answering" warns: the user's worry is a watch on the wrist that silently does not sync; a
calm "not in use" would hide exactly that. Known limit: on Apple Watch the phone can only reach the
watch app while it runs (opening it remotely needs Apple Health on, `startWatchApp`), so "Not
answering" can also mean "app closed"; the hint covers it. On Wear OS a message wakes the watch app,
so no answer really means trouble.

"Not found" applies only where a watch was ever set up on this phone (paired at some point, or the
watch app seen before); a phone that never had a watch shows no watch row at all, and with nothing
else connected falls under "Nothing connected" (muted icon). (Call made while writing, so a phone
user who owns no watch never sees a warning.)

Other rows: the server row uses `connectionView()` tones (all synced = calm; offline / error /
waiting past the grace = warning). The heart-rate row appears only while a live source reads, and
never warns.

The speed check runs **only while the sheet is open**, and the Android status call never runs on the
UI's critical path.

Fast/Slow threshold: builder's call, measured on real devices; start around 1 s round trip.

## Watches

Each watch notes for itself when it last heard from the phone (a local timestamp on snapshot
arrival); no change to the snapshot's format for this.

| | Home screen (always, discreet) | During a workout (only when wrong) |
|---|---|---|
| Apple Watch (`Watch/OpenGymWatchApp.swift`) | new mark on `IdleView` | extend today's `OfflineSign` in the `ExercisePage` header; keep it on Rest/Finish/Summary |
| Wear OS (`android/wear/.../ui/Screens.kt`) | mark on `IdleScreen` | add the sign to `SetScreen` and `RestScreen` (today only Idle/Finish/Summary) |
| Garmin (`garmin/source/Views.mc`) | mark on `IdleView`, using `System.getDeviceSettings().phoneConnected` | add the sign to `SetView` and `RestView` |

- "Wrong" = phone away **and** events waiting to send: today's Apple rule (`queued > 0 && !reachable`,
  `SessionStore.swift`), now the shared rule for all three watches. A lifter training with the phone
  in the locker and nothing waiting sees no warning; a brief queue while the phone is near never
  flickers a sign.
- Wear OS: listen for link changes instead of the current poll in `PhoneLink.refreshNear()`.
- Always On (Apple) / low power: the mark stays, dimmed.
- Watch screens never show speed.

## New messages (protocol)

One small addition; everything else reuses what exists. The maintainer asked to keep the
phone/watch message format; this is an addition, not a change, and the user chose not to ask first.
- **Ping**: phone → watch with a reply, timed on the phone. Apple: `sendMessage` with a reply
  handler. Wear: `MessageClient` request/response. Only while the sheet is open.

**Last heard** (call made while writing this doc): the phone stamps its own "last heard" time for a
watch whenever anything arrives from it: any event (set ticked, start, finish, `setHr`,
`watchStatus`) or a ping reply. No extra watch messages, no watch battery cost, no Wear
`watchStatus` needed. Kept in memory/localStorage beside `readWatchStatus()`.

**Waiting to send** on the phone (call made while writing): only the phone's own unsent server
changes (`S.sync`). Sets waiting on a watch are shown by that watch, not by the phone (that count
never leaves the watch, and sending it would be another message change).

**Heart rate** (call made while writing): the heart-rate row is only the phone's live source
(`liveHeartRate()`: AirPods, and straps if confirmed). Watch heart rate arrives with each set, never
live, so it is listed under the watch row's "what it syncs" ("heart rate per set"), not as its own
live row.

## Heart-rate straps

First a real-device test: pair a Bluetooth strap with the iPhone (iOS 26), run a workout, and check
whether `PhoneWorkoutPlugin`'s session reports its heart rate (Apple's WWDC25 session 322 says it
should). If yes, the heart-rate row covers it as "Heart rate · from Apple Health" (the source device
is not known). If no, straps stay out of scope.

## Chosen look (picked by the user on 2026-11-12)

One family everywhere: on the watches a small phone glyph, plain when linked, slashed when away; on
the phone a link glyph, because it speaks for every device at once. Amber means trouble, always with
a shape change and, where there is room, a word. Mockups: review page
https://claude.ai/artifact/3ie3yeNQTGgnjjeUhwwjED (option boards per surface).

**Phone: the device button (redesigned with the user on 2026-11-13).** A link glyph did not say
what was happening, so the sign became a picture of the device itself, glowing when it is live.
- Its own round button, the same 36 px grey circle as ⋯ (`.iconbtn`), directly left of ⋯. The name
  keeps its whole line: at 320 px with trouble and heart rate it shows about 12 characters, where a
  sign beside the name left 2.
- One symbol, never a row: the watch when a watch is set up (Apple Watch, Wear OS, Zepp relay); else
  a cloud when signed in to a server; else a dim phone. The AirPods heart rate stays in the sheet.
  When the server is the row in trouble and the watch is fine, the symbol is the cloud.
- Live: the watch's screen is lit in the status green (`--green`, never the accent the user picks),
  with a soft bloom kept inside the circle. Cloud synced: the cloud's inside is softly green.
- Checking: the screen fills and empties slowly. Delayed (a quiet watch in a long rest): the screen
  goes dark and a small clock mark shows; calm, not a warning. Nothing connected: a dim phone.
- Trouble keeps the 36 px size: an orange ring and tint, and the glyph changes shape ("!" in the
  watch screen, a slashed cloud), so colour is never the only signal. No word in the bar; the words
  live in the Devices sheet and the VoiceOver label ("Devices: Apple Watch, Not answering").
- Motion: one authored moment, the screen waking. When the watch first answers, the green rises
  through the screen (bottom to top, about 600 ms, ease-out) and the bloom follows. Delayed: the
  screen dims like a display going to sleep. Trouble: the orange ring draws round the circle and the
  "!" settles in, no shake. Recovery fades the ring out faster than it came. Live never breathes.
  All of it is CSS transitions on the state, so nothing replays on a re-render or a remount.
  Reduce Motion: no sweeps or draws, a short cross-fade of colour; Checking is a still half fill.
- Kept as the user's calls: no green tint on the whole circle; the sub-line is unchanged.
- Sheet: iOS Settings-style grouped list, title "Devices". Each row: device tile, name, state word with
  its own glyph (dot Live, clock Delayed, triangle Not answering, ? Not found, slash Offline), a quiet
  detail line (what it syncs; "Last heard …" only when down), speed as a bars glyph + Fast / Slow.
  A broken row gets one 44 px fix button, e.g. "Open Watch settings" (from B), and the server row,
  when offline, the line "Your changes wait on this phone" (from B). Heart-rate row: Live dot + "128
  bpm". Nothing connected: one short line and "Open Settings".

**Apple Watch (option C + grafts).**
- SF Symbols `iphone` / `iphone.slash`, one shared fixed box (from A) so nothing moves.
- Home (`IdleView`): top-leading in the clock row, grey when linked; slashed amber with "Phone away"
  (German "Kein iPhone") when not.
- Set and Rest: nothing when fine. Trouble (away AND waiting): slashed amber phone + count glued left
  of the clock, count capped "99+", plus the word "Waiting" ("Wartet") when it fits. On 41 mm drop the
  word first, then the count; the slashed phone always stays (ViewThatFits). Replaces `OfflineSign`.
- Always On: same marks as dim outlines, amber kept above 4.5:1, no motion. Never tappable.
- Wrist checks: 17 pt glyph at arm's length, heart rate crowding on Rest at 41 mm, amber in sunlight.

**Wear OS (option B + grafts).**
- The state rides the curved clock (`AppScaffold(timeText = …)`), built once so every screen gets it
  (from C). Glyph 15 dp with a gap around the slash (from C).
- Home: always a short word with the glyph, grey "Phone connected" / amber "Phone away".
- Set and Rest: nothing when fine. Trouble: amber "Phone away" in the clock arc plus one amber line in
  today's heart-rate slot, "2 sets saved here" (short form "2 saved here" when heart rate shares the
  line; "Syncs later" where space is tight, from A). When the phone comes back: grey "Sending 2 sets…"
  for a moment, then gone. Check on a real watch that the arc clears the Start pill and the rest ring.

**Garmin (option C + grafts).**
- Garmin's own phone glyph, solid grey when linked, amber outline with a slash when away, one shared
  11 × 18 box (a little bigger and heavier slash in trouble, from A), top centre on Home.
- Set and Rest: only when away AND waiting, in the gap above the name / inside the rest ring; never
  touches the name; no words there.
- Home, away with events waiting: "3 sets waiting" line (from B) instead of "saved for later".
- Shape carries the meaning, so it works on mono and 64-colour MIP screens; not drawn in low power.

## Design rounds (done)

Surfaces: phone top-bar icon, phone sheet, Apple Watch, Wear OS, Garmin. For each: 3 options as
static HTML rendered to PNG, an automatic review and polish pass, a ranking with a recommendation;
the user picks before build. Phone via the `impeccable` skill, Apple Watch via `watch-ui`. Use the
app's real tokens, icons and fonts.

## Order

1. Design rounds.
2. Phone: a pure helper in `lib/` (with its test) that turns the signals into rows and an overall
   state; the icon; the sheet; ping on iOS and Android plugins.
3. Apple Watch.
4. Wear OS (incl. `watchStatus`, link listener).
5. Garmin watch side.
6. Strap test on device.

## Constraints

- No new dependencies (CONTRIBUTING.md).
- Every new `t()` string in all 19 locale packs; `check-locales.mjs`, `check-source-strings.mjs`.
  Reuse existing strings where they fit ('Connected', 'All synced', 'Syncing…', 'Apple Watch').
- User-facing text plain, no em dashes.
- Watch strings via each watch's own string files (`ios/ci/watch-strings.mjs` for Apple).
- Logic with a test beside it: the phone helper in `src/lib`, watch rules in WatchCore / wear tests
  where they can live there.
