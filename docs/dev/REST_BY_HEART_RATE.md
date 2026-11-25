# Ready by heart rate

During a rest between sets, once the heart rate has come back down, the watch says the lifter is
ready. Advice only: the rest countdown keeps running as the upper limit, −15 s, +15 s and Skip work
as before, and nothing ends a rest by itself. This note is the rule, written so the next watch can
do the same. Two apps run it today, tested case for case:

| Watch | Code | Tests |
|---|---|---|
| Apple Watch | `frontend/ios/App/WatchCore/Sources/WatchCore/RestReadiness.swift` | `Tests/WatchCoreTests/RestReadinessTests.swift` |
| Wear OS | `RestReadiness` in `frontend/android/wear/.../WatchLogic.kt` | the readiness cases in `WatchLogicTest.kt` |

Garmin and Zepp OS do not have it yet: Garmin's settings are a whitelist (`lib/garmin-snapshot.js`)
and its heart-rate sampling is its own, Zepp has its own link. Both can follow this note later.

## The setting

Settings → Watches → Apple Watch or Wear OS watch on the phone (`frontend/src/lib/watch-settings.js`,
per device like the other watch choices), sent with every snapshot as `settings.hrRest`:

```json
{ "on": false, "bpm": null }
```

- `on`: off by default. An older phone sends no `hrRest`: off.
- `bpm`: a fixed target, a whole number from 60 to 180 (the page offers 100, 110, 120, 130 and
  140), or `null` for the automatic target. A watch takes any positive number as a fixed target.

Nothing happens when it is off, when the watch measures no heart rate (Apple Health off on the
phone, no sensor permission on Wear OS), or when no target can be made.

## Inputs

A rest that follows a set, done on the watch or ticked on the phone while the watch measures:

- `setStart`: when the set began (the end of the rest before it, or the start of the workout).
- `setEnd` = `restStart`: when the set was ticked.
- The workout's heart-rate readings, each with its own time. A reading of 0 is no reading.

## The target

- Fixed: `bpm`.
- Automatic, from the set's own readings:
  - `startHr` = the average of the readings in the 60 s before `setStart`;
  - `peak` = the highest reading from `setStart` to `setEnd` (`startHr` when there is none);
  - `target = startHr + max(5, 0.25 * max(0, peak - startHr))`.

  No `startHr` (nothing measured in that minute): no target, nothing is watched.

So after a set that took the pulse from 90 to 150, the target is 105; after one that hardly moved
it, 5 bpm above where it started.

## The rule

Constants: `floor = 30 s`, `hold = 5 s`, `stale = 10 s`.

Checked once a second while the rest runs (not while the phone has it paused), from the readings
taken since `restStart`:

1. The latest reading is at most `stale` old, and at or under the target. Otherwise: not ready.
2. The run: walking back from the latest reading, the readings at or under the target without one
   above it in between. `since` is the time of the first of them.
3. Ready when `now - restStart >= floor` and `latest.time - since >= hold`.

One reading under the target is not ready (the run must span `hold`, which takes two readings at
least); a reading above the target starts the run again. The first time it is ready, the rest is
marked ready and the rule is not checked again for that rest. A new rest starts unmarked; a ±15
on the same rest keeps the mark.

## What the lifter sees

On the watch, for the rest of that rest:

- "Ready" with a heart over the countdown, in the heart rate's red, so it reads whatever the accent
  is. The countdown, its bar and the buttons stay as they are.
- One tap on the wrist, only when "Tap the wrist when a rest is over" is on.
- The usual rest-over alarm still comes at the end.

Nothing goes to the phone and nothing is logged: the rest's heart rate reaches the set as before
(`setHr` with `restHr`, docs/WATCH_SYNC.md).

## Battery

The once-a-second check runs only while a rest after a set runs and the setting is on, and stops
at the first "Ready". It reads the readings the workout session already collects; it never starts
the sensor or keeps it from resting (`SensorPlan`). On Wear OS it rides on the rest's own wake lock.
