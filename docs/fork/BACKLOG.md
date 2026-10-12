# Backlog

Item format: `### OG-NNN <title>` then `status:` ready | building | done | blocked, `depends on:`,
the spec, the acceptance gate. Phases in order; within a phase, by id.

## Phase 0: Set up

### OG-001 Fork, kit scaffold, gate
status: done
Fork to `hpeppitt/opengym`, add the kit profile via `docs/fork/`, pin Node 22 and `TZ=UTC`, own
application id. Gate: `bash scripts/fork/check.sh` exits 0.

### OG-002 First APK on the phone
status: ready
depends on: JDK 21 installed (`brew install --cask temurin@21`, needs sudo)
`npm run build:mobile`, `./gradlew assembleRelease`, create the fork's release keystore under
`config/` (gitignored, passwords in the password manager), zipalign, sign, `adb install`. Gate:
the unchanged app runs on the phone beside fit-app.

### OG-003 Disable the in-app updater
status: ready
`lib/update.js` polls `DuarteSantos8/openGym` releases and offers the APK. With our own id the
install would fail, but the prompt is noise. Make the check a no-op when the build is the fork
(a `VITE_FORK=1` flag or a repo constant), keeping the edit to upstream's file to a guard line.
Gate: unit test that the check resolves to "no update" under the flag.

### OG-004 Scheduled upstream sync check
status: ready
depends on: OG-003
A fork-only workflow (`.github/workflows/fork-upstream-sync.yml`), weekly cron plus manual
dispatch: fetch `upstream/main`, attempt a merge on a throwaway branch, and on a clean merge push
the branch and open a PR so upstream's `test.yml` runs the gate on it. On a conflict or a failing
suite, open or update an issue listing the conflicting files and failing suites. Never touches
`main`. Also disable or path-guard upstream's `mirror.yml` in the fork (it fails without GitLab
credentials), and enable scheduled workflows once in the fork's Actions tab (GitHub disables them
in forks by default and after 60 idle days). Gate: a manual dispatch opens a PR or an issue.

## Phase 1: Anatoly import (P0)

### OG-010 Gemini key in Settings, secure storage
status: ready
Reuse the AI Coach own-key path. Gate: key round-trips through secure storage on the phone.

### OG-011 Image to prescription: `lib/anatoly-import.js`
status: ready
depends on: OG-010
Port fit-app's `services/workoutImageImport.ts` prompt and JSON parse. Input: photos as base64.
Output: `{ sourceText, sets, reps, targetWeight }[]`. Pinned model `gemini-3.5-flash`,
`maxOutputTokens` 8192 (thinking tokens count against it; fit-app FIT-091). Gate: tests on the
parser with fixture responses, including a truncated one.

### OG-012 Library match with confirmation: `lib/anatoly-match.js`
status: ready
depends on: OG-011
`matchExercise` plus a similarity score; exact, fuzzy, unmatched per row; unmatched becomes a
custom exercise as the CSV importer does. Gate: tests for the three states and the threshold.

### OG-013 Import sheet and date pin
status: ready
depends on: OG-012
Settings or Plan entry: pick photos, review rows, choose a date, save as a routine pinned via
`dayPlan`. Gate: run-and-verify on device with a real Anatoly screenshot.

## Phase 2: Health Connect stats

### OG-020 `HealthReadPlugin.java` with read permissions
status: ready
Aggregate Steps, TotalCaloriesBurned, Nutrition; raw SleepSession, RestingHeartRate, HeartRate,
ExerciseSession. Manifest `READ_*` permissions. Gate: values on device match Health Connect's own.

### OG-021 Pure scorers: `lib/sleep-score.js`, `lib/vo2max.js`
status: ready
Port fit-app's `utils/sleepScore.ts` and the VO2 calculation with their tests. Gate: ported tests
pass.

### OG-022 Stats cards
status: ready
depends on: OG-020, OG-021
Sleep score, steps, calories, VO2 max on upstream's Stats view. Gate: run-and-verify on device.

## Phase 3: Migrate and retire fit-app

### OG-030 Firestore to CSV migration script
status: ready
`scripts/fork/export-fitapp-history.mjs`: read `workout_set_logs` from Firestore, write openGym's
CSV. Gate: row count matches Firestore, import on device shows the history.

### OG-031 Retire fit-app
status: blocked
depends on: OG-013, OG-022, OG-030, two weeks of daily use
Archive the fit-app repo, note in its CLAUDE.md.
