# Watch gestures: Double Tap and the Action Button

What a lifter can make the Apple Watch do with a finger pinch (Double Tap) or the Action Button
(Ultra). The shared contract lives in `frontend/src/lib/watch-settings.js` (phone) and
`WatchCore/Sources/WatchCore/Gestures.swift` (watch).

## The settings

Two phone settings, sent to the watch with the others: `doubleTap` and `actionButton`.
Both default to `smart`. An unknown value, from an older or newer phone, reads as `smart`.

## The actions

| id | What it does | Double Tap | Action Button |
|---|---|---|---|
| `smart` | The main safe button of the screen (below) | yes | yes |
| `logSet` | Log the open set | yes | yes |
| `skipRest` | Skip the rest | yes | yes |
| `addRest` | Add 15 s to the rest | yes | yes |
| `hold` | Start or stop a timed hold | yes | yes |
| `nextExercise` | Go to the next exercise | yes | yes |
| `showMetrics` | Open the Metrics page | no | yes |
| `none` | Do nothing | yes | yes |

Never Finish, Discard or anything that deletes. `showMetrics` is Action Button only: Double Tap
can only press a button that is on screen.

## The rule

The same for both inputs. Use the chosen action if it fits what the watch shows right now.
If not, use Smart. If Smart has nothing safe to do, do nothing.

Smart, by moment:

- Open set: log the set.
- Rest running: skip the rest.
- Timed hold ready: start it. Hold running: stop it.
- "Still training?": keep going.
- Exercise done: next exercise. All sets done: go to the Overview.
- Summary: close it.
- 3-2-1 countdown: start now (Double Tap only).
- Start screen, weigh-in, cardio, fixing a set, Overview, Metrics, Music: nothing.

Apple says to avoid a primary action in scrolling views, and the Overview holds Finish, which is a
deliberate one-second press. So those pages get nothing.

## Test ping

The phone can send a `gestureTest` stamp in the watch settings. A new stamp shows a test button on
the watch. The watch answers with `gestureTestOk` when the lifter double-taps it. Any Action Button
press that reaches openGym sends `actionButtonSeen`.

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
  the choice resolves to (watchOS 11+, off while dimmed), and the test sheet. "Next exercise" has no visible button, so it
  has an undrawn one (`NextExerciseTarget`).
- `Watch/ActionButton.swift`: `StartWorkoutIntent`, the next-action intent, Pause and Resume, and the donation. Donated
  when a workout starts (watch, intent or phone) and when the setting changes.
- Pause and Resume map to the Apple Health workout session (`WorkoutManager.pause/resume`); the next set resumes it.
