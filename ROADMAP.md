# Roadmap

Where openGym is going, in the order it is likely to land. The next two releases are planned in
detail; everything after that is a list in rough order, and any date on it is a guess. The GitHub
milestones and the issues in them are the working plan, this file is the readable summary.

**A release roughly every one to two weeks.** Each one bundles whatever has been merged and tested
on gym-test by then, so a fix reaches phones quickly and a branch never drifts for a month. Store
builds add a few days of App Review on top, which is why a version can be "done" before it is out.
Version numbers follow the release rule, not the size of the change: the next release is the last
published one plus one patch (1.4.2 → 1.4.3), and a minor bump is saved for a step as big as the
new exercise database (v1.4.0).

- Milestones: https://github.com/DuarteSantos8/openGym/milestones
- Next, in order: programmes, tour & fixes (v1.4.4) → Google Play, F-Droid & integrations (v1.4.5) →
  Wear OS & Health Connect (v1.4.6) → the progression engine & circuits (v1.4.7) → the list after that

---

## v1.3.2 and v1.3.3: Cleaner workout  (released 2026-09-05)

**Theme: the workout screen gets out of the way.** Fewer things to tap, the things you tap every set
stay where they are, everything else moves one tap away. Compared with Hevy or Strong the screen was
busy: ~10 buttons under a card and ~8 per set. The new default is one "⋯" per exercise, the set
number as the set's own menu, and an optional list view.

Shipped: v1.3.2 is the contributors' batch, v1.3.3 the redesign and the bug round on top of it.

- Workout view: cards or a scrollable list, with the header pinned in list mode (!96, #28, #44, #50)
- One menu per exercise (note, details, progression, bar weight, warm-up, superset, swap, move,
  remove) and one per set (drop set, rest-pause burst, remove) (#20)
- Settings → During a workout → "Workout controls": +/− buttons, drop/burst shortcuts, superset
  buttons, move/swap/remove buttons; each switch brings an old button row back
- Colour-coded RIR/RPE picker with a plain-language explanation per level; the empty cell is one
  button, a logged rating is tinted by how close to failure it was (!91, #32)
- Automatic working weight, no confirmation prompt, no auto-advance (!92, #18)
- Stepper fixes: one tap = one step in supersets (!97, #41); the +/− uses the exercise's own
  increment and progression's rounding, without snapping off-grid values (!84)
- Progression: routines with progression off keep their targets everywhere (!71); a weight change
  starts a new stall streak so a deload cannot spiral (!93); the progression sheet cannot save into
  the wrong entry (!77)
- Starter plans: Push/Pull/Legs, Upper/Lower, Full Body, 5×5 with a chooser and confirmation (!94)
- Muscle explorer in the library and the exercise picker, honouring the equipment profile (!87)
- Copy routine (!85); the "+" in the exercise picker adds immediately (!72)
- Timer flash blinks the theme; no replay after the app was hidden; a quiet toast on reopen (!89)
- MCP: `preview_session` shows what a routine will really open with; `rest_sec` in `get_routine` (!90, !81, #36)
- Coach: the create schema requires routine ids and a week, and caps the arrays (!99)
- Infrastructure: nginx re-resolves the api container (#16); Renovate config repaired (#37); CI with
  JUnit/coverage, stack smoke test, Trivy scan, SBOMs, release preflight, fork-MR pipelines

Also in v1.3.3: exercise history and a progress line from the ⋯ menu (#43), favourite exercises
(#6), the in-app update check for the Android build (!40, #38, #9), the Coach save fix on Android
(#42), bands as bodyweight equipment (#39), kg ↔ lb conversion (#22), the centre tab button on the
workout screen (#29, #21), warm-up ramps on the exercise increment, and the small fixes from the
tester round.

Left over from this block:

- "By muscle" inside the Add-exercise sheet keeps the keyboard-aware search
- A real pause for the workout timers (#29 asked for it)
- Discord announcement (owner)

## v1.3.6 and v1.3.7: Sync, push and the phone  (released 2026-09-12)

Signed in, the server's profile is the truth: sign-in adopts it, two devices merge on a server
revision instead of overwriting each other, the app polls for changes and works offline with a
banner. Reminders fire up to 15 minutes late rather than never, push subscriptions re-register
themselves, rest-timer alerts are per device. iOS: chip rows scroll sideways only, sheets clear the
Dynamic Island, the tab bar stays put after the keyboard, the home-screen app reloads offline. The
twelve Astra findings, eleven community merges (weigh-in switch, Swiss German, iOS 26 build, PDF on
the phone, nginx resolver, custom-exercise equipment, per-side data, warm-up rest) and a headless
QA sweep of every screen. Left over: routine reordering (#142), the Smith-bar "no bar" option
(#138), two decimals (#139), delete user in the admin (#107).

## v1.3.8: Promised items  (released 2026-09-20, a week early)

All four promises, plus the iOS keyboard, the assisted machines and a QA sweep of every screen:
twenty-four reports in total. See the changelog for the full list.

- Reorder routines in Plan; the Start sheet follows that order (#142)
- "No bar" per exercise, so Smith-machine lifts calculate plates and drop sets from 0 (#138)
- Two decimals on weights, as a display toggle (#139)
- Delete a user from the admin dashboard: credentials, state file, subscriptions, Coach data (#107)
- Custom-exercise muscle order is fixed, not click order; the import fallback classifies "wrist
  curl", "row … neutral grip" and Romanian deadlifts correctly (Discord)
- The small open pull requests: unknown-path redirect (#185), manifest behind an auth proxy (#184),
  standard ß (#190); the distance mode (#177, #178) moves to a later release

## v1.3.9: Editing history  (released 2026-09-28, two weeks early)

Edit a saved workout, its date, start time and duration, with photos and videos on it, plus the
two Discord reports (a paired phone that silently stopped syncing, a plan that opened at the wrong
reps) fixed at the root, and a good part of later milestones pulled forward: password sign-in and
extra passkeys, custom-exercise pictures, the Android rest notification, plate loading per set,
Structural Balance, Ukrainian and Arabic. Thirty-nine community pull requests. See the changelog.

- **Edit a finished workout**: date, start time, duration, sets, weights, exercises; progression
  and 1RM history re-read the corrected session (#143, #203, #263, #218)
- Save a logged workout as a routine (#111, #211); repeating a past workout from History and
  undo finish (#58, GitLab !130) move to v1.3.10
- Copy a workout as text; relabelling an "Unknown" exercise after an import moves to v1.3.10
- Auto-backup keeps the newest 14 files (#161, first half); a "next step" hotkey independent of
  focus (#133); extra passkeys and the device link (PR #95); body measurements (PR #82) move
  to v1.3.10

## v1.3.10: New design, rotation & safer sync  (released 2026-10-07)

Bigger than planned, on purpose: the queue and rotation from this block, the redesign that was
pencilled in for v1.3.11, and a sync rework so no device loses data again. See the changelog for
the full list.

- A rotation beside the fixed week: the next session is the next one you haven't done, whatever
  the weekday, with an editor in Plan (#158, #69; PR #167 and kurktchiev/openGym#1)
- A calmer app: Settings on one screen with search, Plan as Schedule and Routines, a workout screen
  without the tab bar, a docked rest bar and a rest-time wheel up to 15:00, one icon per idea
- Swipe actions on sets, routines and the loop, with Undo; a colour of your own as the accent
- Safer sync: every change stamped down to the field, deletions that stay deleted, two tabs that no
  longer overwrite each other, durable writes and `db.json.bak` on the server
- Repeat a past workout today (#58), pyramid sets (#362, PR #367), progress photos (PR #361), per
  side on timed holds (PR #322), the backup folder on Android (#161), FIRST_USER_ADMIN (#328),
  the connection line can be hidden (#330, #369), Traditional Chinese (PR #368)
- Still to come from the old block: undo finish (GitLab !130), relabelling an "Unknown" exercise
  after an import, body measurements (PR #82), drag-and-drop on touch (#114)

## v1.4.0: A new exercise database, plus everything planned for v1.3.11 and v1.3.12  (released 2026-10-09)

v1.3.11 and v1.3.12 never shipped on their own: their release candidate grew into this one, so a
single update brings the new catalogue and two rounds of community work. **No data changes:**
every exercise id that ever shipped keeps its number, name and muscles, so history, routines,
records and backups stay exactly as they are, and a phone on v1.3.x keeps working with a v1.4.0
server.

- **5,632 exercises instead of 1,324**, with new licensed animations (sharper in the app), a
  description and steps for each, names in every app language, a type filter (strength,
  stretching, mobility, yoga...) and male or female drawings where both exist
- The catalogue lives in the repository (`catalogue/`), one file per exercise, open to fixes and
  translations by pull request; "Suggest a fix" in the app opens an issue for one exercise
- Search rebuilt: results ranked, typo tolerance, gym shorthand (db, rdl, ohp), plurals, similar
  exercises under the results (#192, pulled forward from v1.4.5)
- The v1.3.11 round: Health Connect (#371), body measurements (#82), a 1RM formula picker (#195),
  collapsing finished exercises (#241), superset name and rest (#292, #293), focus view (#222),
  last and next on the finish sheet (#324), share a workout as an image (#453), pyramid weights
  (#445), bench and pull-up bar as equipment, Bengali, a Helm chart and a Nix module
- From later milestones: a "to failure" set and triple progression (#179, from v1.4.2), treadmill
  incline (from v1.4.4), per-dumbbell weights (#474) and a dumbbell inventory (#376), back-off
  sets (PR #475), a sets-based fatigue map (PR #436), a note for a missed day (#261), the rest-end
  sound of your choice (#306), exercise chips at the top of the workout (#323), Garmin .fit export
  (#447), Cloudflare Access for the app (PR #439), a web image without root (PR #466)
- Still open from the old v1.3.12 list: the timer rework (#165), a home-screen widget (#299) and
  distance for cardio (#177), now in their own milestones below

## v1.4.1: Bug fixes for v1.4.0  (released 2026-10-10)

The animations come back as WebP, and the Android update check reads GitHub.

## v1.4.2: openGym in the App Store  (released 2026-10-23)

- The iPhone app in the App Store, with an Apple Watch app, widgets, a Live Activity and Apple
  Health (#90, #125 on iOS)
- Animation quality to pick: built in 180 px, or 240 to 1080 px downloaded from the store
- Three APK sizes on GitHub: Standard, Plus and HD
- Your bars, rest between warm-ups and between sides, backups for an exercise, the boot screen,
  five reported security holes closed

## v1.4.3: The community release  (released 2026-10-26, a week early)

Most of it was asked for on GitHub and Discord or sent in as a pull request. The full list is in
the changelog; the headlines:

- A Halloween costume until 1 November (spiders, bats, a witch, a skeleton on Stats), and nine
  app icons to pick from on iPhone, a Halloween one included
- openGym starts again on iOS 15.5 to 16.3, where 1.4.2 sat on the splash screen forever
- Gym reminder: a nudge when you walk into your gym, gyms stay on the phone (#614)
- A tiny muscle map on every routine and in the workout (#670); volume while you lift (#774)
- CSV export and GymMane import (#647); keep an exercise you added mid-workout (#592)
- Backups per routine slot for when the machine is taken (#649), weight stacks for machines with
  odd steps (#688), rest after a single set (#609), rest days in the rotation (#536)
- Heart rate and weigh-ins read back from Apple Health and Health Connect (#544, #127)
- The Apple Watch learns RPE, a countdown, Water Lock and proper Discard (#776, #783, #789 to
  #791); next exercise and Skip rest on the Lock Screen
- The Coach answers questions and plans into the rotation (#778, #779); Swedish, and Spanish
  from Spain (#786); the MCP server can log a workout (#739)

## v1.4.4: Programmes, tour & fixes  (in TestFlight, out around 2026-11-08)

Done and on the test server:

- **Programmes**: routines grouped into a block over several weeks, with targets as %1RM or RPE
  per week, deloads included, and three starter programmes (#159, #679)
- **A tour and four tutorials**: a 1-minute walk around the app after setup, then build your first
  plan, create your own exercise, edit your data, export and import
- **openGym's own date picker** everywhere, no more sheets that scroll sideways (#809)
- **AirPods Pro 3 heart rate** on iPhone with iOS 26, no watch needed (#818)
- **Pictures on the printed plan** (#817), barcode gym cards next to QR codes (#550)
- **kg or lb per exercise**, also on the Apple Watch (#657); body weight in pull-up and dip volume
  as a switch (#794); a default progression rule for the profile
- **The gym location screen redone**: search like Apple Maps, the map moves under the pin
- App icons on Android too, back to the top with one tap, the Coach working again with
  OpenAI-compatible endpoints (#804) and keeping follow-up questions in context
- The catalogue files each exercise under the muscle it is known for (#788)

Still going in before the release: the bug fixes from TestFlight and Discord (rest after the last set
#853, a discarded workout that still reached Apple Health, the Coach shortlist #829, music pausing on
the rest sound), and two security fixes.

## v1.4.5: Google Play, F-Droid & integrations  (planned for the end of November)

- **openGym on Google Play.** A new developer account needs a closed test with 12 testers for
  14 days first. Until then the signed APK on GitHub is the Android app
- **F-Droid** (#325): a build without Google's barcode scanner, store texts in F-Droid's format, and
  the licensed exercise animations marked as non-free assets. Their review can take a few weeks
- **Settings → Integrations**, one page with a card per service:
  - webhooks with ready-made presets for Discord, Slack, Telegram, ntfy, Home Assistant and n8n
  - your planned workouts as a calendar feed for Apple, Google or Outlook
  - Strava upload (#478), FIT files for Garmin, COROS and Suunto, intervals.icu
  - a daily backup to Nextcloud or any WebDAV folder (#582)
  - MCP over HTTPS with OAuth (#781, #314) and scoped API tokens (#480, #566)
- **Timed holds that start by themselves**: rest ends, 3-2-1, the hold runs, the next rest starts.
  For planche, L-sit and friends (#490)
- A sound for each kind of rest and a count-in you hear from a pocket (#165), tempo per set (#572)
- Switch off the features you don't use (#240)
- More languages: Italian, Persian, Czech, Lithuanian, Vietnamese, better Chinese names

## v1.4.6: Wear OS & Health Connect  (planned for mid December)

- **A Wear OS app**: record a workout on an Android watch (#673)
- **Android lock screen and widget**: the workout card between sets, like on the iPhone (#760, #125,
  #299), and the rest timer in Xiaomi's HyperIsland (#727)
- **Deeper Health Connect**: real sets and segments out (#816, #654), calories (#724), weigh-ins on
  the right day (#682)
- **Body composition**: fat %, muscle mass and friends in measurements, body-fat tracking (#648, #197)
- Maybe: sign in with OpenID Connect (#130, #391) and the Remote-User header (#522)

## v1.4.7: Progression engine & circuits  (planned for the end of December)

- **The progression engine** by @giulioleuci, reviewed in three pieces (#823, #824, #825): smarter
  targets, wave / percentage progression 5/3/1 style (#70, #153), rep ranges and AMRAP (#154), a
  warm-up generator (#156), auto-regulation on RPE (#120), custom and built-in exercises on equal
  terms (#199)
- **Circuits, AMRAP, EMOM and Tabata** as one design (#765, #725, #560), editable supersets with a
  better look (#292, #293), session phases like mobility and cool-down (#57)
- Distance for cardio, weekly set coefficients (#771)

## After v1.4.7  (dates are guesses)

- **v1.4.8: Search, catalogue & equipment** (January): merge exercises (#656), front, side and
  rear delts (#638), your own photos on built-in exercises (#534), per-stack cable weights (#671),
  any plate weight, sharing exercises between users (#151)
- **v1.4.9: Accounts** (January): account recovery when every passkey is lost (#584) and the rest
  of the account work
- **v1.4.10: Trainer, Coach & MCP write** (February): an optional personal-trainer role (#119),
  the Coach adapting the workout in progress, MCP that can write routines and fix logs (#116)
- **v1.4.11: Looks, social & goals** (February): skins (#129), a redesign of the workout display
  modes (#533), exercise goals, favourite lifts on Home, friends on the same server
- **v1.4.12: Garmin & more integrations** (March): Garmin's developer program for workouts to the
  watch, and whatever people ask for most on the integrations page
- **Later, ideas**: a calisthenics skill tree (#223), Navidrome (#291), a free Coach on the phone
  itself, openNutrition, the sister app for food

## Later: database storage

**The one compatibility break.** Storage moves from one JSON file per profile to a database (#191):
tables for workouts, sets, routines, weigh-ins, custom exercises, favourites, credentials, push
subscriptions and Coach data; an idempotent migration on first start; the old files kept until the
admin removes them. The state file stays the import/export and backup format, and the revision/merge
contract from v1.3.6 stays the client contract. Which database is decided in the issue: embedded by
default so `docker compose up` stays one line, a server database as an option (Discord
"Postgres/SQLite"). It gets a version number once the work starts, and nothing else rides on that
release.

## How things move

An issue sits in at most one milestone. Whatever is not merged and tested on gym-test by release
day rolls into the next one; the release does not wait for it. Pull requests from returning
contributors get their pipeline started automatically; a first PR is started by hand after a look
at the diff. Anything in review is on gym-test.duarte-santos.ch. Releases bundle whatever has
passed that test, with a thank-you per contributor in the changelog.
