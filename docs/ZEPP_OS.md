# openGym on Zepp OS

A watch app for Amazfit watches on Zepp OS 3 and later (API level 3.0): Balance and Balance 2,
GTR 4, GTS 4, Active and Active 2, Active Edge, Cheetah, Falcon, T-Rex 2, 3 and Ultra, Bip 5 and 6,
and the rest of the family. It is the Wear OS app's twin (docs/WEAR_OS.md): it runs the same session
logic, reads the same snapshot and sends the same events, so the phone's page applies a tick from
an Amazfit exactly like one from an Apple Watch. Zepp OS 1 and 2 watches (GTR 3, GTS 3, Band 7) are
not supported: their API is too old for the messaging library.

## What it does

- **Start**: the week streak on top (lime once this week has a workout), today's planned routine
  with one tap, Quick start on a day without a plan, and two more routines. A workout running on
  the phone shows up as "Continue workout".
- **The set**: set k of n with its warm-up / left / right / superset tag, the exercise name, weight
  and reps as two big tiles. The crown turns the lime-outlined one (a tap picks the other); − and +
  under the tiles do the same on watches without a crown, and the up and down buttons on watches
  with buttons. Done logs the set, a long press on Done skips it. Holds count up and log the
  seconds; cardio is logged on the phone. A tap on the exercise name opens the menu: skip the set,
  finish, or discard (two taps).
- **The rest**: a ring that empties, the countdown, the next set, +15 and Skip. A nudge ten seconds
  before the end, a strong buzz at the end (on by default; it follows the phone's "Tap the wrist
  when a rest is over", which only the iPhone app shows so far). A rest started on the phone runs on the watch as well.
- **Heart rate**: the watch's own sensor while a workout runs. Each set logged on the watch carries
  its average and maximum, the same `hr` the Apple Watch and Wear OS send.
- **The end**: Finish and save, Continue, or Discard (two taps). The summary shows time, sets,
  volume, heart rate and the PRs; "Ended on your phone" when the phone finished it first.
- **Shortcut card** (the app widget in the watch's widget list): the week streak and today's plan,
  or the sets so far while a workout runs. A tap opens the app.
- **Language**: the app's, not the watch's (the phone sends it), in all 19 of the app's languages.
  Before the phone has said, the watch's own language if it is one of ours.

No exercise media goes to the watch: text and numbers only.

## How it talks to the phone

A Zepp OS app has two halves: the watch app, and a **Side Service** that runs inside the Zepp phone
app (JavaScript in Zepp's own sandbox). The openGym phone app cannot be that Side Service, and the
Side Service cannot call into the openGym app. Two bridges were possible:

1. **The user's own openGym server** (chosen). The Side Service has `fetch`, so it talks to the
   server the user already runs, with a token of its own. The openGym page (phone app or web app,
   signed in) leaves its snapshot there and picks up the watch's events.
2. **Localhost on the phone**: the openGym app serving `http://127.0.0.1:<port>` for the Side
   Service. Not chosen: iOS suspends a backgrounded app, so nothing would answer while openGym is
   not in front, it needs a native HTTP server in both phone apps, and whether the Zepp app's fetch
   may reach the loopback address over plain HTTP is not documented.

The server bridge needs no central server (each openGym is self-hosted, and the watch talks only to
its owner's), works with Android, iPhone and the web app alike, and needs no native code. The price:
**it needs a server**. A phone app running on its own, with no server, has no Zepp watch.

```
watch app  --'sync' {events}-->  Side Service  --POST /api/watch/box-->  your server  <--  openGym page
           <--{accepted, json}--               <--{accepted, json}------             (PUT snapshot,
                                                                                       GET events, ack)
```

| Piece | Where | What |
| --- | --- | --- |
| `api/watch-relay.js` | server | pairing codes, watch tokens, the mailbox (snapshot + event queue) per profile |
| `/api/watch/*` | server | `pair`, `redeem`, `links`, `unlink` (Settings); `snapshot`, `events`, `ack` (the page); `box` (the watch) |
| `frontend/src/lib/watch-relay.js` | page | a WatchBridge over those routes: `lib/watch-sync.js` runs its one sync over it (`startLinkSync`) |
| `frontend/src/views/ZeppSettings.jsx` | page | Settings → Zepp OS watch: pair, list, unpair |
| `watch-zepp/app-side/index.js` | Zepp app | the Side Service: one `sync` call (events up, snapshot down), pairing |
| `watch-zepp/setting/index.js` | Zepp app | the settings page: server address and pairing code |
| `watch-zepp/page/index.js` | watch | the screens |
| `watch-zepp/lib/session.js` | watch | the session logic, a port of the Wear OS `SessionCore.kt` |

The messages are the Apple Watch's, unchanged (`watch-sync.js`): the page builds the snapshot with
`buildSnapshot` and applies the events with `applyEvents`, through the workout screen's own actions.
The mailbox stores the snapshot as the page's JSON text and the events exactly as the watch sent
them; it only checks sizes (64 KB a snapshot, 4 KB an event, 50 a request, 500 queued), ids and
types. Events wait on the server until the page has applied them and saved (`ack`), for two weeks
at most; on the watch they wait in an outbox until the server took them, so neither a phone out of
reach nor a server that is down loses a set.

**The watch token** is not a session. It opens `GET`/`POST /api/watch/box` and nothing else, is kept
only as a SHA-256, and carries the account's session version, so "sign out everywhere", a new
password and a disabled account end it with the sessions. It also ends when unpaired in Settings or
after 90 days unused. The pairing code is 12 characters (60 bits), one per profile, ten minutes,
hashed, and a wrong one counts against the address like a wrong device link. Minting a code needs a
signed-in session only (not the passkey step-up phone pairing asks): what it mints reaches the
workout mailbox and nothing of the account, and ends with every session.

**When things move**: the watch syncs every 15 seconds while its app is open and right after each
set, start or finish. The page sends a snapshot whenever the workout changes and looks for events
every 15 seconds while it is in front, and when it comes back to the front. Like the other watches,
the watch runs the session on its own while the phone sleeps in a pocket; what it logged is applied
when the openGym page next wakes up.

Contract tests: `watch-zepp/test/session.test.js` parses the same `snapshot.json` the Wear OS watch
parses and builds the same `events.json` (frontend/android/wear/src/test/resources), which
`watch-sync.wear.test.js` applies on the page. `watch-zepp/test/page.test.js` runs the page against
stand-ins for the Zepp OS modules on round 480, 466 and 360 and square 390×450 and 320×380 screens:
a workout from the wrist start to summary, the rest, the menu, nothing drawn outside the screen.
`api/test/server-watch-relay.test.js` pairs a watch and passes a snapshot and events through a real
server; `frontend/src/lib/watch-relay.test.js` runs the page's sync over the relay.

## Design

The Wear OS app's tokens (`watch-zepp/lib/theme.js`), adapted for small round AMOLED screens, with
the design skills that drove each choice:

- **True black, lime for the one thing to press.** An off pixel costs no battery on AMOLED and the
  bezel disappears; a tinted near-black would be a default, not a choice (frontend-design). One
  accent per screen, flat, no gradients, glows or shadows at rest (design-taste-frontend house rules,
  frontend-design "spend boldness in one place").
- **Two sizes doing the work**: 72 px numbers and a 112 px countdown against 24 px labels, weight
  for hierarchy (design-taste-frontend "one very large, one small"; apple-design typography).
  The system font, which Zepp OS tunes for its screens (apple-design: default to the platform font).
- **Contrast and reach**: quiet text #A1A1A6 is 8:1 on black; every target at least 56 px on a
  480 px screen with 8 px or more between them; everything inside the round screen's chord, which
  the layout computes per line (ui-ux-pro-max color-contrast, touch-target-size, touch-spacing,
  safe-area-awareness).
- **Feedback that means something**: a short buzz for a crown step and for Done, a nudge ten
  seconds before the rest ends, a strong one at the end, nothing else (apple-design multimodal
  feedback: causality, utility). No animations: a screen used dozens of times a session should not
  make you wait (emil-design-eng's animation frequency rule). The ring moves with time, not for show.
- **Plain words**: sentence case, a button says what happens ("Finish and save"), destructive
  actions take two taps and say so ("Tap again to discard"); empty states say what to do
  (frontend-design writing, web-design-guidelines: no hidden destructive actions).

## Building

```bash
cd watch-zepp
npm ci                    # the Zepp toolchain (zeus-cli), locally, nothing global
npm test                  # session logic, the store, the page on five screen sizes
npm run strings           # lib/strings.js and the .po files, from the Wear OS strings + its own
npx zeus build            # dist/<appId>-openGym-<version>-<time>.zab, every Zepp OS 3+ screen
npx zeus preview          # a QR code for the Zepp app (needs a Zepp developer account login)
```

`package.json` carries a `_moduleAliases` entry: zeus-cli resolves its private `zeppos-app-utils`
through module-alias, which looks for the alias in the project's own package.json once npm has
hoisted it. Without it `zeus build` fails with "Cannot find module 'zeppos-app-utils'".

The watch's strings come from the Wear OS app's (`frontend/android/wear/wear-strings.mjs`, which takes
them from the app's own locale packs), so run that first when they change, then `npm run strings`.

### Versions

`app.json` `version.name` is the release (1.4.4) and `version.code` is `major*10000 + minor*100 +
patch` (10404), so each release's build is newer than the last. Bump both with each release.
`appId` 9990145 is a placeholder for development; the store needs the id the Zepp developer console
assigns (below).

## Installing it

**For yourself, without the store (developer mode):**

1. In the Zepp app: Profile → Settings → About, tap the Zepp icon seven times. Developer mode is on.
2. On a computer with this repository: `cd watch-zepp && npm ci && npx zeus login` (a free Zepp
   developer account), then `npx zeus preview` and pick your watch. It prints a QR code.
3. In the Zepp app: Profile → your watch → Developer mode → Scan, and scan the code. The app installs
   on the watch.
4. Pair it: in openGym, Settings → Zepp OS watch → Pair a watch. In the Zepp app, open the openGym
   app's settings (Profile → your watch → App settings → openGym), type the server address and the
   code shown, and tap Pair. Open openGym on the watch.

**From the Zepp App Store (the owner's steps):**

1. Register at the Zepp developer console (console.zepp.com) and create a Mini Program "openGym";
   put the appId it assigns into `watch-zepp/app.json`.
2. `npx zeus build`, and upload the `.zab` under the app's version. Fill in the listing: name,
   description, the category (Health / Sports), the icon, and screenshots per screen shape (the
   console asks for round 480 × 480 and square 390 × 450 at least; the simulator takes them).
3. Privacy: heart rate is read on the watch and goes only to the user's own openGym server; no data
   to the developer or any third party. Say that in the privacy form, with the link to the
   project's privacy text.
4. Licence: the code is AGPL; no exercise media is in the package (text and numbers only), so the
   Gym visual licence does not apply to it.
5. Submit for review. The review installs it on real watches; a reviewer without an openGym server
   needs one to see more than "Pair me first", so give them a demo server address and a fresh
   pairing code (codes last ten minutes: give them an account to sign in with instead, and say where
   to find Settings → Zepp OS watch).

## Honest limits

- **Not run on a real watch, nor in the simulator.** The Zepp OS simulator for Linux is an Electron
  app over QEMU that needs GTK, a desktop session and per-device firmware images; it could not run
  on the build machine. What is verified: `zeus build` for every Zepp OS 3+ screen, the session logic
  and the contract files, and the page against stand-ins for the Zepp OS modules. What is not: the
  real widget rendering (fonts, the exact arc angles, line breaks), the crown's step feel, haptics,
  the heart-rate sensor's rate, the shortcut card's size and tap, and the Zepp app's fetch and
  settings page on Android and iPhone.
- **A server is needed.** A phone app on its own, with no server, cannot reach a Zepp watch.
- **Not instant.** Up to 15 seconds each way while both apps are open; while the phone's openGym
  page sleeps, the watch's sets wait on the server and are applied when it wakes. The workout itself
  never waits: it runs on the watch.
- **While the watch app is closed** nothing syncs: Zepp OS runs the Side Service only while the watch
  app talks to it.
- **Not ported yet** from the Apple Watch: the weigh-in before a start, the effort (RPE/RIR) editor,
  the forgotten-workout check, an always-on workout indicator on the watch face, and Apple Health's
  counterpart (Zepp's own workout history is not written).
- **Older watches**: Zepp OS 1 and 2 (GTR 3, GTS 3, GTR Mini, Band 7) are left out.
