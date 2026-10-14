---
mode: testing
url: http://localhost:8080/
max_steps: 30
tags: [smoke, workout]
---

# Log and save a workout

## Continue as a guest and load a plan
Open http://localhost:8080/.
Click "Continue without account".
Click "Load starter plan", then click "Full Body" in the "Choose starter plan" sheet.
Verify the home screen shows "0 workouts total".

## Start a workout
Click "Start" in the bottom navigation bar. If asked to choose a workout, choose "Full Body A".
Verify the workout screen shows a "Finish" button and the set counter starts at "0/".

## Log the first set
In the first set of the first exercise, replace the weight value with "40", then click the "Set 1 done" check button.
Verify the set counter at the top shows "1/".

## Finish and save the workout
Click "Finish" at the top of the workout screen.
In the "Finish early?" dialog, click "Finish and save".
If a workout summary is shown, close it or click "Done".
Click "Home" in the bottom navigation bar.
Verify the home screen shows "1 workout total" or "1 workouts total".
