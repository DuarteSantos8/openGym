# Live workout bar

A small capsule of accent-coloured glass that floats above the tab bar while a workout is running
and the lifter is on another screen. It shows the routine, the exercise and set to do next, the
clock, the heart rate and the watch link. Tapping it goes back to the workout.

Status: built on `feat/live-workout-bar`. It is stacked on `feat/device-link-status` (PR #1160)
and cannot merge before it. Spec: `.claude/live-bar/DESIGN.md`.

## When it shows

One rule, `liveBarShows(S, pathname)` in `lib/live-bar.js`: a workout is running (`S.active.start`
is set), the route is not `/workout`, and it is not an edit or a backfill. `App.jsx` uses it to
mount the bar and to unmount the rest timer.

## What it reads

`liveBarState(S, { timer, live, rows, checking })` in `lib/live-bar.js` is pure and has a test
beside it. It adds no workout maths. It reuses `upcomingSets` (`live-activity.js`, the Lock Screen
source), `heartNow` (`live-tiles.js`) and the watch row from the device link status. `components/
LiveBar.jsx` only draws it. A paused workout or rest stands still. An empty or unnamed workout
shows "Workout". Every set done shows "All sets done".

## The rest bar

`RestTimer` is not mounted where the bar shows. The bar's rest line is the only countdown there.
The timer's work (count, end tone, haptics, notifications) lives in `store/useUI.js`, so
unmounting only hides it. The cost: the count-in announcement and the timed-hold controls are
only on the workout screen.

## The glass

The fill is the accent at `--livebar-a`, over a blur. `liveBarAlpha` in `lib/accent.js` picks the
most see-through value that keeps the text at 4.5:1 over a black and a white backdrop. Sky,
violet, pink and red are solid, so are the deeper light colours, and so is high contrast. Without
`backdrop-filter` the fill is solid too. A test checks every preset in both themes.

## The rise

The bar grows into the workout screen as one view transition, and the chevron folds it back
(`lib/rise.js`). It is done by hand with `document.startViewTransition`, because the router's own
`viewTransition` option only works with data routers and the app uses HashRouter. No support or
reduced motion: a plain route change.

## Left out on purpose

- No buttons on the bar (no done, skip or pause). Tapping opens the workout.
- No setting to turn it off.
- No swipe to open or dismiss.
- No haptic on iPhone: `navigator.vibrate` does nothing there.
- No fill, fade or tab bar slide driven from the workout board.
