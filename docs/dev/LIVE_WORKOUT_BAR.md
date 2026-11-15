# Live workout bar

A small capsule of accent-coloured glass that floats above the tab bar while a workout is running
and the lifter is on another screen. It shows the routine, the exercise and set to do next, the
clock, the heart rate and the watch link. Tapping it goes back to the workout.

Status: built on `feat/live-workout-bar`. It is stacked on `feat/device-link-status` (PR #1160)
and cannot merge before it. Spec: `.claude/live-bar/DESIGN.md`.

## When it shows

One rule, `liveBarShows(S, pathname)` in `lib/live-bar.js`: a workout is running (`S.active.start`
is set), the route is not `/workout`, and it is not an edit or a backfill. `App.jsx` uses it to
mount the bar (with `liveBarHidesRest`, see below).

## What it reads

`liveBarState(S, { timer, live, rows, checking })` in `lib/live-bar.js` is pure and has a test
beside it. It adds no workout maths. It reuses `upcomingSets` (`live-activity.js`, the Lock Screen
source), `heartNow` (`live-tiles.js`) and the watch row from the device link status. `components/
LiveBar.jsx` only draws it. A paused workout or rest stands still. An empty or unnamed workout
shows "Workout". Every set done shows "All sets done".

## The rest bar

The capsule is the countdown for a plain rest (and the ready state after it); `RestTimer` is not mounted
then. `liveBarHidesRest` in `lib/live-bar.js` says when the old rest bar must take over instead: a timed
hold, a count-in, a paused rest and a rest that starts a hold by itself (it has Done, Pause, Resume and
Stop auto). For those the capsule is not mounted at all (App.jsx), so it never sits under the old bar and
the existing `body.resting` page padding and back-to-top positions apply unchanged. The tab bar's centre
tab still follows `liveBarShows` only. The timer's work (count, end tone, haptics, notifications) lives in
`store/useUI.js`, so unmounting either one only hides it.

## The glass

The fill is the accent at `--livebar-a` (86% or more, as in the approved picture), over a blur. `liveBarAlpha` in `lib/accent.js` picks the
most see-through value that keeps the text at 4.5:1 over a black and a white backdrop. Sky,
violet, pink and red are solid, so are the deeper light colours, and so is high contrast. Without
`backdrop-filter` the fill is solid too. A test checks every preset in both themes.

## The rise

Tapping the bar navigates at once with `state: { rise: 'rise' }`; the workout's chevron does the same
with `'fold'`. App.jsx hands that to the page as its arrival motion (`vrise`, `vfold` in index.css):
one 280 ms keyframe, transform and opacity only, on `--ease`. The workout page grows up from the bottom
edge; the page it folds back to settles down from a touch larger. Reduced motion: the app's global rule
removes the animation.

A view transition was tried and dropped: on iPhone it snapshotted the whole workout page and froze the
app for seconds. The router's own `viewTransition` option does not apply either (HashRouter).

Tapping the bar buzzes once through the app's `vibrate()` (lib/sound.js), the native pulse on the
phones; on iPhone it may feel medium rather than light, tune it on the phone.

## Left out on purpose

- No buttons on the bar (no done, skip or pause). Tapping opens the workout.
- No setting to turn it off.
- No swipe to open or dismiss.
- No fill, fade or tab bar slide driven from the workout board.
