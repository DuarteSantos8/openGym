# Roadmap

Where openGym is going, in the order it is likely to land. Each block is a GitLab milestone; the
issues and merge requests attached to it are the plan, this file is the readable summary. The
dates are the order, not a promise: a one-maintainer self-hosted project ships a version when the
branch has been used in a real gym for a while. Blocks are deliberately over-full — whatever is not
done when a version ships rolls into the next one. Version numbers follow the release rule, not the
size of the change: the next release is the last published one plus one patch (1.3.1 → 1.3.2), and a
minor bump is reserved for something that breaks compatibility.

- Board: https://gitlab.com/DuarteSantos8/opengym/-/boards — planned → in progress → in review → closed
- Milestones: https://gitlab.com/DuarteSantos8/opengym/-/milestones
- "In review" means: on a branch and deployed to gym-test.duarte-santos.ch, waiting for a real session.

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

## v1.3.5 — Programmes & progression  (October 2026)

**Theme: training structure beyond one weekly template.** Most of this is the Space-Hermes series.
It changes the training model (per-set roles, explicit phases, normalisation on every persist), so
it goes in one MR at a time, each rebased and tested on gym-test before the next.

- Explicit warm-up / work phases on every row, with legacy rows still readable (!76)
- Per-phase settings during a workout: set count, targets, fixed or percentage loads (!56)
- Choose which set drives AMRAP progression instead of "the last one" (!78)
- Multi-week programmes: 1–52 weeks, normal/deload/rest weeks, several sessions per day,
  start/complete lifecycle, off by default (!98, #15)
- Home: several routines on one day with a session chooser; date overrides as ordered lists (!74)
- Per-exercise strength with an adaptive estimated 1RM; one point per workout and exact exercise (!50)
- Import: kg/lb normalised per row to the profile unit, malformed rows reported before confirming;
  duration-only rows classified as timed strength or cardio (!53)
- Plan sharing: versioned payload, custom exercises carried across, repeat imports idempotent (!49)
- Resistance bands treated like bodyweight in config and progression (#39)
- Exercise history and a progress chart from inside the workout (#43) — reachable from the ⋯ menu
- Pictures for custom exercises: pick from the catalogue, later upload (#30)
- Percentage / training-max programming (5/3/1 style) on top of the policy interface
- Rest-pause and drop sets configurable in the routine editor, with adjustable rest (#17)
- Catalogue cleanup: exercises that should not carry weight, incline and interval fields for
  cardio (#46); timers for planks and outdoor cardio are already there, document them (#45)

## v1.3.6 — Accounts & sync  (November 2026)

**Theme: who may sign in, and what else may read or write your data.**

- Optional username + password login next to passkeys, for devices without a passkey (#1)
- OIDC login for people with an existing SSO such as PocketID or Authelia (#40)
- Personal-trainer role: invite students by code, open a student in a read-only context, write
  their plan from a template library, assign in one tap (!79, #8)
- Remote MCP over OAuth for hosted AI clients, with per-connection profile and read/write scopes,
  and compare-and-swap writes to the profile state (!88)
- MCP write tools: create/update routines, correct a logged set, delete a duplicate session,
  manage equipment profiles (#24)
- Switching kg ↔ lb converts stored values instead of relabelling them (#22)
- Offline: saved routines and the active workout usable without the server, sync on return (#23)
- Sync reports still waiting on details: routines created on the web not reaching the phone (#33),
  logged sessions lost after editing a routine (#25)
- Admin: per-user export, invite management, audit log filters

## v1.3.7 — Mobile  (December 2026)

**Theme: the Android app catches up with the web app.**

- In-app update check against the GitLab releases, APK download with SHA-256 check and install (!40, #38, #9)
- Rest timer as an ongoing notification and on the lock screen, with "next set" from there (#19, #26)
- Home-screen widget for today's session
- Body weight from Withings or the phone's health store (#31)
- External links open in the system browser; Android back gesture across every screen
- Play Store / F-Droid feasibility check (the app stays sideload-first)

## Later — ideas, not scheduled

- Skins alongside the accent colour, default look untouched (#34); background wallpapers (#48)
- Big-screen / kiosk layout for a wall display (#49) and a physical "next" button, keyboard first (#47)
- Native NixOS module (!83) and Azure App Service deployment (!35) — only if someone maintains them
- Arabic and right-to-left layout (!36) — needs a rebase, then a visual round
- Periodisation extras: wave progression, auto-regulation on RPE, training-age based recommendations (#15)
- Watch app / companion for the rest timer

## How things move

An issue goes planned → in progress → in review → closed on the board. Contributor merge requests
from returning contributors get their pipeline started here automatically; a first MR is started
by hand after a look at the diff. Anything in review is on gym-test.duarte-santos.ch. Releases
bundle whatever has passed that test, with a changelog section per contributor.
