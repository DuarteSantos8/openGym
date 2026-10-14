---
test: ../starter_plan_test.md
status: passed
started: 2026-10-14T07:10:17.207Z
duration_s: 91
session_id: 1e86fd25-91e3-4e8e-b6bc-a54c7a194051
---

# Load a starter plan — Result

## Continue as a guest ✓ passed (26.6s)
md5: 2fdf71f083d32166a02f7ef0a071a1ce
Open http://localhost:8080/.
Click "Continue without account".
Verify the home screen shows a "Load starter plan" button and the notice "Guest mode: your data lives only in this browser."

## Load the Full Body starter plan ✓ passed (30s)
md5: fa04142be2c563dd2473bd9ce418b88b
Click "Load starter plan".
In the "Choose starter plan" sheet, click "Full Body".
Verify the "Load starter plan" button is no longer shown on the home screen.

## Check the weekly plan ✓ passed (29s)
md5: efaf0dd5646bf39cbded187359c226f1
Click "Plan" in the bottom navigation bar.
Verify the weekly schedule lists "Full Body A", "Full Body B" and "Full Body C", each with "6 exercises".
