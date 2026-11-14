# Workout card on the lock screen (Live Activity / Android notification)

While a workout runs, both phone apps show it outside the app: the set to do now, a **Log set**
button that ticks it without opening the app, and the rest countdown after it. iPhone uses a Live
Activity (Lock Screen and Dynamic Island), Android one ongoing notification (#760).

## One page side for both

`frontend/src/lib/live-activity.js` builds the card (`buildLiveActivity`: the current set, the
next few, the rest, how far along the session is) and sends it whenever it changes through a
`LiveActivity` plugin with the same methods on both phones:

| Method | Does |
|---|---|
| `status` | `{ supported }`. iOS: Live Activities allowed. Android: always true. |
| `update({ wid, attributes, state })` | Shows or changes the card (JSON strings). |
| `end()` | Takes it down: no workout running any more. |
| `drain()` | `{ events }`: the taps the page has not applied yet, oldest first. |
| `ack({ ids })` | Takes those out of the queue, once the page has saved them. |

The native side queues each tap as a small event, moves the card on by itself, and tells the page
(`liveActivityEvent`). The page applies each event once, through the workout screen's own actions,
saves, then acknowledges it. Until then the queue is the tap's only copy, so a tap made while the
page is frozen or the process is gone is never lost.

| Event | From | The page |
|---|---|---|
| `setDone { exId, entryIdx, setIdx, at }` | Log set | ticks that set, rest counted from `at` |
| `next { fromEntryIdx }` | Next exercise (iOS) | moves to the next exercise |
| `restSkip { at }` | Skip rest | ends the rest, if it is still the one tapped |
| `open` | a tap on the card (Android) | opens the workout screen |

## Log set while the page sleeps

The tap ticks the set the card shows (a second quick tap is about a set already done and does
nothing), the card moves to the next set it carries, and the rest after the ticked set starts
there and then. The same rule twice, kept in step by hand: `LiveActivityTick.tick` (Swift) and
`WorkoutCard.java`. When the page applies the tap it sends its own state, which replaces the
card's guess.

## Android

- `RestTimerService` owns notification 41 for the whole workout: the card between rests, the
  rest countdown during one. A rest that ends (or is skipped) goes back to the card; without a
  card the service stops as before.
- A rest started by Log set uses the settings of the page's last one (sound, vibrate, labels),
  which `RestAlertPlugin` keeps in SharedPreferences for that.
- Android 16+: both are Live Updates. The card is a standard notification (elapsed time as a
  chronometer, the session as a progress bar); the rest is a `ProgressStyle` with a count-down
  chronometer, since promoted notifications cannot use the custom layout older versions keep.
  The system shows three actions at most, so the rest has −15s (Resume while paused), +15s and
  Skip there.
- The service and the rest-over receiver need a signature permission
  (`<applicationId>.permission.WORKOUT_NOTIFICATION`), so no other app can start Log set or the
  rest controls.
