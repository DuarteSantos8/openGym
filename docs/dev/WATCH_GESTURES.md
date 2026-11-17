# Watch gestures: Double Tap and the Action Button

What a lifter can make the Apple Watch do with a finger pinch (Double Tap) or the Action Button
(Ultra). The shared contract lives in `frontend/src/lib/watch-settings.js` (phone) and
`WatchCore/Sources/WatchCore/Gestures.swift` (watch).

## The settings

Two phone settings, sent to the watch with the others: `doubleTap` and `actionButton`. The ids are
`GESTURE_ACTIONS` in `watch-settings.js` (the watch's `GestureAction` has the same ones; an unknown
id reads as the input's default on both sides).

Defaults: Double Tap is **Skip rest**, the Action Button is **Smart**. A pinch can come while the
lifter grips a bar, and the watch has no Undo, so a Double Tap that was not chosen on purpose never
logs a set. Choosing Smart or Complete set for Double Tap is the lifter's own call.

Never Finish, Discard or anything that deletes. `showMetrics` and `nextExercise` are Action Button
only: Double Tap can only press a button that is on screen, and neither has one.

## The rule

Use the chosen action if it fits what the watch shows right now. If not, use Smart, except that
Double Tap never falls back to logging a set. If Smart has nothing safe to do, do nothing. Nothing
runs while a keypad, a dialog or the test sheet is over the screen (`overlayUp`).

Smart, by moment:

- Open set: log the set.
- Rest running: skip the rest.
- Timed hold ready: start it. Hold running: stop it.
- "Still training?": keep going.
- Exercise done: next exercise (Action Button only). All sets done: go to the Overview.
- Summary: close it.
- 3-2-1 countdown: start now (Double Tap only).
- Start screen, weigh-in, cardio, fixing a set, Overview, Metrics, Music: nothing.

Apple says to avoid a primary action in scrolling views, and the Overview holds Finish, which is a
deliberate one-second press. So those pages get nothing.

Show metrics moves to the Metrics page and stays there: a second press does nothing (Smart has no
action on Metrics), so the lifter goes back by hand. It is not applied on cardio or "Still
training?", where the press falls through to Smart.

## Test ping

The phone can send a `gestureTest` stamp in the watch settings. A new stamp shows a test button on
the watch. The watch answers with `gestureTestOk` and the stamp it answers (the phone does not trust
the watch's clock) when the lifter double-taps it. Any Action Button
press that reaches openGym sends `actionButtonSeen`, once per launch.

## What Apple allows

- Double Tap presses a button marked `.handGestureShortcut(.primaryAction)` (watchOS 11 and later).
  Only one control fires, chosen by order on screen, so keep exactly one enabled.
- With no such button, Double Tap scrolls or does its system job. openGym cannot claim it there.
- The Action Button is set by the user in the Watch settings. An app cannot set it or open that page.
- The first press starts the workout (the system's start intent). Apple says later presses run the
  next action the app offers while a workout runs.
- Unverified: two forum posts say that on watchOS 26.5 later presses stop reaching the app. No Apple
  answer. Test on a real Ultra before promising it.
- The phone cannot tell which watch model it has. Show both choices and say what needs what.

## One-time setup on the watch

Watch app on the iPhone, or Settings on the watch: Action Button, Action = Workout, App = openGym,
then pick First Press. Double Tap needs a Series 9 or later, or Ultra 2, with Double Tap switched on
in the watch's Gestures settings.

## On the watch (code map)

- `WatchCore/Gestures.swift`: the rules, `Gestures.screen` (where the watch is), `Gestures.nextExercise`, `GestureTest`.
- `Watch/SessionStore.swift`, last section: `doubleTapEffect`, `gestureEffect`, `perform`, the test sheet, the Action Button entry points.
- `Watch/GestureViews.swift`: `.doubleTapTarget(effect)` puts `.handGestureShortcut(.primaryAction)` on the one control
  the choice resolves to (watchOS 11+, off while dimmed), `.gestureOverlay(up)` for the keypad and dialogs, and the test sheet.
- `Watch/ActionButton.swift`: `StartWorkoutIntent`, the next-action intent, Pause and Resume, and the donation. Donated
  when a workout starts (watch, intent or phone). The intent reads the setting when it runs.
- Pause and Resume map to the Apple Health workout session (`WorkoutManager.pause/resume`); the next set resumes it.
