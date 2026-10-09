# Roadmap

Where openGym is going, in the order it is likely to land. Each block is a GitHub milestone; the
issues and pull requests attached to it are the plan, this file is the readable summary.

**A release every two weeks, on a Sunday.** Each one is small on purpose: a handful of issues, one
theme, so a version is out before the branch has drifted and every fix reaches phones within a
fortnight. Whatever is not merged and tested on gym-test by the Friday before rolls into the next
block, the date does not move. Version numbers follow the release rule, not the size of the change:
the next release is the last published one plus one patch (1.3.7 → 1.3.8), and a minor bump is
reserved for a step as big as the new exercise database (v1.4.0).

- Milestones: https://github.com/DuarteSantos8/openGym/milestones (every open issue sits in exactly one)
- Tracks, in order: the new exercise database with the community round (v1.4.0) → programmes → the
  progression engine → cardio → sharing and gyms → accounts → the iOS app → Android and health →
  looks and social, with database storage after that

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

## v1.4.1: Programmes & phases  (2026-11-29)

- Programmes: routines grouped into a named block over weeks, with deload and rest weeks, several
  per profile (#159, GitLab !98; Discord "Programme mode", "folders", "major good ideas" 1)
- Session phases (mobility / work / accessory / cooldown) with completion-only exercises for
  stretching that stay out of volume and PRs (#57, #140; Discord "non-typed exercises")

## v1.4.2: Progression engine I  (2026-12-13)

- Rep or set ranges per set and AMRAP targets beyond the "to failure" flag (#154; Discord "More
  types of sets"); the flag itself and triple progression came early in v1.4.0 (#179)
- Assisted exercises as negative added weight (#176); the multi-formula 1RM came in v1.4.0 (#155)

## v1.4.3: Progression engine II  (2026-12-27)

- Load as %1RM or auto with a stored training max, target RPE/RIR (#153)
- Wave / percentage progression, 5/3/1 style (#70; PR #168)
- A warm-up generator that picks the ramp from load and lift (#156)
- Periodisation extras on top: mesocycle blocks, auto-regulation on RPE (#120)

## v1.4.4: Cardio, alternatives, groups  (2027-01-10)

- Cardio: intervals (rounds × work/rest), interval programmes such as C25k, rucking as distance +
  pace + load, distance for cardio (#132, #169, #177; Discord "cardio programs", "rucking");
  treadmill incline came early in v1.4.0
- Exercise alternatives per routine slot (Discord); Replace in the routine editor came in v1.3.9
  (#110)
- Complexes and interval groups beside supersets (Discord)

## v1.4.5: Sharing, gyms, admin  (2027-01-24)

- Search itself was rebuilt in v1.4.0 (#192); left here: searching your own history and import
  aliases by name
- Shared custom exercises between accounts on one instance (#151)
- "Different gyms": a location on a logged set, separate histories and PRs per location, bodyweight
  shared (Discord "How to deal with different gyms")
- Admin: per-user export, invite management, audit log filters

## v1.4.6: Accounts: password & OIDC  (2027-02-07)

- Optional username + password login next to passkeys (#118; Discord "Basic login", the
  password-manager thread), shipped early in v1.3.9, behind `PASSWORD_LOGIN`
- OIDC login for PocketID / Authelia-style setups (#130, #72; GitLab !132 is the candidate)

## v1.4.7: Trainer & MCP write  (2027-02-21)

- Personal-trainer role: invite students by code, open a student read-only, write their plan (#119,
  GitLab !79; Discord "Trainer & Student Management")
- MCP write tools (routines, log corrections, equipment) in pieces (#116); remote MCP over OAuth
  for hosted AI clients (GitLab !88)
- Switching kg ↔ lb converts stored values instead of relabelling them (#22)

## v1.4.8: iOS app  (2027-03-07)

- App Store / TestFlight build of the existing Capacitor target, HealthKit weight and workout
  export, the Home Screen icon and timer-sound issues gone for good (#90; Discord "Google Health")
- Apple Watch rest timer later, once the app is in the store

## v1.4.9: Android & health  (2027-03-21)

- Health Connect for weight and sessions (Discord "Use health connect", pulled forward into v1.3.11); Withings and other scales
  (#127)
- The rest timer as an ongoing notification on the lock screen (#122, PR #296) (shipped in v1.3.9); a
  home-screen widget (#125, #299) and logging a set from the lock screen (Discord); the timer
  rework (#165)
- APK ABI filters (#136) (shipped in v1.3.9), about 12 MB smaller; the auto-backup directory picker (#161,
  second half)
- Media for the routine's exercises cached on the phone, so a session works with no signal (#123;
  Discord "Download all videos")
- Firefox-on-Windows QR and third-party passkey providers stay documented, not fixed: platform
  behaviour (#103, #101)

## v1.4.10: Looks, social, plugins  (2027-04-04)

- Skins alongside the accent colour, backgrounds as part of a skin, a big-screen layout (#129,
  #134, #135)
- Social: friends, progress and plan sharing (PR #180); a plugin surface for integrations (Discord)
- Native NixOS module (GitLab !83) and Azure deployment (!35) only if someone maintains them;
  Arabic and right-to-left (GitLab !36) (shipped in v1.3.9)

## Later: database storage

**The one compatibility break.** Storage moves from one JSON file per profile to a database (#191):
tables for workouts, sets, routines, weigh-ins, custom exercises, favourites, credentials, push
subscriptions and Coach data; an idempotent migration on first start; the old files kept until the
admin removes them. The state file stays the import/export and backup format, and the revision/merge
contract from v1.3.6 stays the client contract. Which database is decided in the issue: embedded by
default so `docker compose up` stays one line, a server database as an option (Discord
"Postgres/SQLite"). It gets a version number once the work starts, and nothing else rides on that release.

## How things move

An issue sits in exactly one milestone; a milestone is a Sunday, and whatever is not merged and
tested on gym-test by the Friday before rolls into the next one, and the date stays. Contributor pull requests from returning contributors get their pipeline started here
automatically; a first PR is started by hand after a look at the diff. Anything in review is on gym-test.duarte-santos.ch. Releases
bundle whatever has passed that test, with a changelog section per contributor.
