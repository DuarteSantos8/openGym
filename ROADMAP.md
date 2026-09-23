# Roadmap

Where openGym is going, in the order it is likely to land. Each block is a GitHub milestone; the
issues and pull requests attached to it are the plan, this file is the readable summary.

**A release every two weeks, on a Sunday.** Each one is small on purpose: a handful of issues, one
theme, so a version is out before the branch has drifted and every fix reaches phones within a
fortnight. Whatever is not merged and tested on gym-test by the Friday before rolls into the next
block, the date does not move. Version numbers follow the release rule, not the size of the change:
the next release is the last published one plus one patch (1.3.7 → 1.3.8), and a minor bump is
reserved for something that breaks compatibility — that is v1.4.0, the database.

- Milestones: https://github.com/DuarteSantos8/openGym/milestones — every open issue sits in exactly one
- Tracks, in order: promised items → history editing → queue and programmes → the progression
  engine → cardio → **the foundation (database, then search)** → accounts → the iOS app → Android
  and health → exercises → looks and social

---

## v1.3.2 and v1.3.3 — Cleaner workout  (released 2026-09-05)

**Theme: the workout screen gets out of the way.** Fewer things to tap, the things you tap every set
stay where they are, everything else moves one tap away. Compared with Hevy or Strong the screen was
busy: ~10 buttons under a card and ~8 per set. The new default is one "⋯" per exercise, the set
number as the set's own menu, and an optional list view.

Shipped: v1.3.2 is the contributors' batch, v1.3.3 the redesign and the bug round on top of it.

- Workout view: cards or a scrollable list, with the header pinned in list mode (!96, #28, #44, #50)
- One menu per exercise (note, details, progression, bar weight, warm-up, superset, swap, move,
  remove) and one per set (drop set, rest-pause burst, remove) (#20)
- Settings → During a workout → "Workout controls": +/− buttons, drop/burst shortcuts, superset
  buttons, move/swap/remove buttons — each switch brings an old button row back
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

## v1.3.6 and v1.3.7 — Sync, push and the phone  (released 2026-09-12)

Signed in, the server's profile is the truth: sign-in adopts it, two devices merge on a server
revision instead of overwriting each other, the app polls for changes and works offline with a
banner. Reminders fire up to 15 minutes late rather than never, push subscriptions re-register
themselves, rest-timer alerts are per device. iOS: chip rows scroll sideways only, sheets clear the
Dynamic Island, the tab bar stays put after the keyboard, the home-screen app reloads offline. The
twelve Astra findings, eleven community merges (weigh-in switch, Swiss German, iOS 26 build, PDF on
the phone, nginx resolver, custom-exercise equipment, per-side data, warm-up rest) and a headless
QA sweep of every screen. Left over: routine reordering (#142), the Smith-bar "no bar" option
(#138), two decimals (#139), delete user in the admin (#107).

## v1.3.8 — Promised items  (released 2026-09-20, a week early)

All four promises, plus the iOS keyboard, the assisted machines and a QA sweep of every screen —
twenty-four reports in total. See the changelog for the full list.

- Reorder routines in Plan; the Start sheet follows that order (#142) ✅
- "No bar" per exercise, so Smith-machine lifts calculate plates and drop sets from 0 (#138) ✅
- Two decimals on weights, as a display toggle (#139) ✅
- Delete a user from the admin dashboard: credentials, state file, subscriptions, Coach data (#107) ✅
- Custom-exercise muscle order is fixed, not click order; the import fallback classifies "wrist
  curl", "row … neutral grip" and Romanian deadlifts correctly (Discord) ✅
- The small open pull requests: unknown-path redirect (#185), manifest behind an auth proxy (#184),
  standard ß (#190) ✅ — the distance mode (#177, #178) moves to a later release

## v1.3.9 — Editing history  (2026-10-11)

- **Edit a finished workout** — date, start time, duration, name, sets, weights, add or remove an
  exercise; progression and 1RM history re-read the corrected session (#143; GitLab !127 and !139
  as reference; Discord "edit finished workouts", "edit past workouts time", "change the date")
- Save a logged workout as a routine, repeat a past workout from History, undo finish (#111, #58,
  GitLab !130; Discord "Historic tab")
- Relabel an "Unknown" exercise after an import without losing its sets; copy a workout as text
  (Discord)
- Auto-backup keeps the last N files (#161, first half); a "next step" hotkey independent of focus
  (#133); body measurements (PR #82), extra passkeys and the device link (PR #95)

## v1.3.10 — Session queue & rotation  (2026-10-25)

- A free-running session queue beside the fixed week — the next session is the next undone one,
  whatever the weekday — with an in-app editor and automatic refill (#158, #69; PR #167 and the
  editor on top of it; Discord "not forced into a weekly plan")
- Swipe between exercise cards during a workout (#113, GitLab !114)
- Drag-and-drop exercise order that survives touch (#114 — the first version came out again on
  2026-09-07); the Start/Resume button as "next" during a workout (Discord)

## v1.3.11 — Programmes & phases  (2026-11-08)

- Programmes: routines grouped into a named block over weeks, with deload and rest weeks, several
  per profile (#159, GitLab !98; Discord "Programme mode", "folders", "major good ideas" 1)
- Session phases — mobility / work / accessory / cooldown — with completion-only exercises for
  stretching that stay out of volume and PRs (#57, #140; Discord "non-typed exercises")

## v1.3.12 — Progression engine I  (2026-11-22)

- A universal AMRAP / "to failure" flag and rep or set ranges per set (#154; Discord "Sets to
  Failure", "More types of sets")
- Triple progression, reps → sets → load (#179, #186; PR #181)
- Multi-formula 1RM with Epley as the default shown (#155); assisted exercises as negative added
  weight (#176)

## v1.3.13 — Progression engine II  (2026-12-06)

- Load as %1RM or auto with a stored training max, target RPE/RIR (#153)
- Wave / percentage progression, 5/3/1 style (#70; PR #168)
- A warm-up generator that picks the ramp from load and lift (#156)
- Periodisation extras on top: mesocycle blocks, auto-regulation on RPE (#120)

## v1.3.14 — Cardio, alternatives, groups  (2026-12-20)

- Cardio: incline and intervals (rounds × work/rest), interval programmes such as C25k, rucking as
  distance + pace + load (#132, #169; Discord "incline treadmill", "cardio programs", "rucking")
- Exercise alternatives per routine slot, and Replace in the routine editor (#110; Discord)
- Complexes and interval groups beside supersets (Discord)

## v1.4.0 — Foundation: database  (2027-01-10)

**The one compatibility break.** Storage moves from one JSON file per profile to a database (#191):
tables for workouts, sets, routines, weigh-ins, custom exercises, favourites, credentials, push
subscriptions and Coach data; an idempotent migration on first start; the old files kept until the
admin removes them. The state file stays the import/export and backup format, and the revision/merge
contract from v1.3.6 stays the client contract. Which database is decided in the issue — embedded by
default so `docker compose up` stays one line, a server database as an option (Discord
"Postgres/SQLite"). Nothing else rides on this release; it gets the three-week slot over the holidays.

## v1.4.1 — Foundation: search  (2027-01-24)

- Search rebuilt over catalogue names in every language, import aliases, custom exercises and
  history: typo tolerance (GitLab !122), a live result count (!31), filters that compose, built once
  per catalogue version (#192)
- Shared custom exercises between accounts on one instance (#151)
- "Different gyms": a location on a logged set, separate histories and PRs per location, bodyweight
  shared (Discord "How to deal with different gyms")
- Admin: per-user export, invite management, audit log filters

## v1.4.2 — Accounts: password & OIDC  (2027-02-07)

- Optional username + password login next to passkeys (#118; Discord "Basic login", the
  password-manager thread)
- OIDC login for PocketID / Authelia-style setups (#130, #72; GitLab !132 is the candidate)

## v1.4.3 — Trainer & MCP write  (2027-02-21)

- Personal-trainer role: invite students by code, open a student read-only, write their plan (#119,
  GitLab !79; Discord "Trainer & Student Management")
- MCP write tools — routines, log corrections, equipment — in pieces (#116); remote MCP over OAuth
  for hosted AI clients (GitLab !88)
- Switching kg ↔ lb converts stored values instead of relabelling them (#22)

## v1.4.4 — iOS app  (2027-03-07)

- App Store / TestFlight build of the existing Capacitor target, HealthKit weight and workout
  export, the Home Screen icon and timer-sound issues gone for good (#90; Discord "Google Health")
- Apple Watch rest timer later, once the app is in the store

## v1.4.5 — Android & health  (2027-03-21)

- Health Connect for weight and sessions (Discord "Use health connect"); Withings and other scales
  (#127)
- The rest timer as an ongoing notification on the lock screen (#122); a home-screen widget (#125)
- APK back under 10 MB with ABI filters (#136); the auto-backup directory picker (#161, second half)
- Media for the routine's exercises cached on the phone, so a session works with no signal (#123;
  Discord "Download all videos")
- Firefox-on-Windows QR and third-party passkey providers stay documented, not fixed — platform
  behaviour (#103, #101)

## v1.4.6 — Exercises & catalogue  (2027-04-04)

- Pictures for custom exercises: pick from the catalogue, then upload; a video URL per exercise
  (#126, #170; Discord "custom images/GIFs", "upload videos")
- Catalogue: bench as equipment with flat / adjustable, TRX / suspension, lats and the three delts
  as their own categories, exercises that should not carry weight, more routine icons (#132, #188;
  Discord)
- Choose what the "last time" line shows on the logger (#173); one progress line per set number
  (#145); custom heatmap targets per muscle; a shareable image after a workout (Discord)

## v1.4.7 — Looks, social, plugins  (2027-04-18)

- Skins alongside the accent colour, backgrounds as part of a skin, a big-screen layout (#129,
  #134, #135)
- Social: friends, progress and plan sharing (PR #180); a plugin surface for integrations (Discord)
- Native NixOS module (GitLab !83) and Azure deployment (!35) only if someone maintains them;
  Arabic and right-to-left (GitLab !36) once rebased

## How things move

An issue sits in exactly one milestone; a milestone is a Sunday, and whatever is not merged and
tested on gym-test by the Friday before rolls into the next one — the date stays. Contributor pull requests from returning contributors get their pipeline started here
automatically; a first PR is started by hand after a look at the diff. Anything in review is on gym-test.duarte-santos.ch. Releases
bundle whatever has passed that test, with a changelog section per contributor.
