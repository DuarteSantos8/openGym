---
mode: testing
url: http://localhost:8080/
max_steps: 20
tags: [smoke, body-weight]
---

# Log body weight

## Continue as a guest
Open http://localhost:8080/.
Click "Continue without account".
Verify the "Body weight" card shows "No weigh-ins yet."

## Log a weigh-in
In the "Body weight" card, click "Log".
In the "Log body weight" sheet, replace the value in the "Weight (kg)" field with "80", then click "Save".
Verify the "Body weight" card no longer shows "No weigh-ins yet." and shows a weight of 80 kg.
