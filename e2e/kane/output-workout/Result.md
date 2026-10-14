---
test: ../workout_test.md
status: passed
started: 2026-10-14T07:19:12.034Z
duration_s: 151
session_id: a4c22122-63b0-4937-8137-f0f88b906e18
---

# Log and save a workout — Result

## Continue as a guest and load a plan ✓ passed (2.79s)
md5: 279e896d8a185f82765c2aefe796fab8
Open http://localhost:8080/.
Click "Continue without account".
Click "Load starter plan", then click "Full Body" in the "Choose starter plan" sheet.
Verify the home screen shows "0 workouts total".

## Start a workout ✓ passed (16.53s)
md5: 0e6e662092cc1443dccb8f80c1ce155a
Click "Start" in the bottom navigation bar. If asked to choose a workout, choose "Full Body A".
Verify the workout screen shows a "Finish" button and the set counter starts at "0/".

## Log the first set ✓ passed (5.55s)
md5: 53de02d314e8fda2b2b96822a593f3b3
In the first set of the first exercise, replace the weight value with "40", then click the "Set 1 done" check button.
Verify the set counter at the top shows "1/".

## Finish and save the workout ✓ passed (72.8s)
md5: 0eef9573c22650fa5cca0142dd17c429
Click "Finish" at the top of the workout screen.
In the "Finish early?" dialog, click "Finish and save".
If a workout summary is shown, close it or click "Done".
Click "Home" in the bottom navigation bar.
Verify the home screen shows "1 workout total" or "1 workouts total".
