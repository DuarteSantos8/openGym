---
test: ../body_weight_test.md
status: passed
started: 2026-10-14T07:12:10.125Z
duration_s: 105
session_id: a8edc70a-d4f8-4d51-a70d-e71a1e712f97
---

# Log body weight — Result

## Continue as a guest ✓ passed (56s)
md5: e9dbae15cf589fed125019b27b1b57bb
Open http://localhost:8080/.
Click "Continue without account".
Verify the "Body weight" card shows "No weigh-ins yet."

## Log a weigh-in ✓ passed (45.2s)
md5: 0f75ebd134fdc94be3eaf717a0036922
In the "Body weight" card, click "Log".
In the "Log body weight" sheet, replace the value in the "Weight (kg)" field with "80", then click "Save".
Verify the "Body weight" card no longer shows "No weigh-ins yet." and shows a weight of 80 kg.
