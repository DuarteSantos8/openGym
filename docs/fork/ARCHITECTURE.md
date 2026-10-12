# Architecture: what the fork adds

Upstream's `CLAUDE.md` describes the app. This file describes only the seams the fork introduces.
Every entry names the new file and the single upstream touch point it hangs off.

## Anatoly import (Phase 1)

```
photos  ->  lib/anatoly-import.js  ->  Gemini vision (pinned model, key from secure storage)
        ->  { sourceText, sets, reps, targetWeight }[]
        ->  lib/anatoly-match.js   ->  upstream matchExercise() + fuzzy score
        ->  exact | fuzzy | unmatched per row, user confirms fuzzy and unmatched
        ->  one routine, pinned to the chosen date via S.dayPlan[iso]
```

- The exercise library is 5,600 entries, too many for the prompt. Gemini returns names; matching
  happens on the phone against `lib/exercises.js`. This is the one deliberate departure from
  fit-app's `workoutImageImport.ts`, which put its 80-entry library in the prompt.
- Match states and the confirmation step are fit-app's FIT-120 design, carried over.
- Output is an ordinary routine so the upstream workout flow, progression and 1RM all apply.

## Health Connect read (Phase 2)

Upstream's `HealthConnectPlugin.java` is write-only (sessions and weigh-ins out). The fork adds
reads in a separate plugin class so the two never conflict:

```
HealthReadPlugin.java  ->  lib/health-read.js  ->  pure scorers in lib/
  aggregate: Steps, TotalCaloriesBurned, Nutrition      (dedupes Fitbit + phone sensor)
  raw:       SleepSession stages, RestingHeartRate, HeartRate, ExerciseSession
```

- `lib/sleep-score.js`, `lib/vo2max.js`: ports of fit-app's `utils/sleepScore.ts` and the VO2
  calculation, tests translated with them.
- Aggregate, not raw reads, for steps, calories and nutrition. Same reason as fit-app: raw reads
  double-count when Fitbit and the phone both report.

## History migration (Phase 3)

A one-off script reads fit-app's `workout_set_logs` from Firestore and writes openGym's custom
CSV (`workout name,exercise,date,weight kg,reps`, one row per set), loaded through the existing
importer. Lives in `scripts/fork/`, runs once, is not part of the app.
