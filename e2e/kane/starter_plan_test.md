---
mode: testing
url: http://localhost:8080/
max_steps: 20
tags: [smoke, plan]
---

# Load a starter plan

## Continue as a guest
Open http://localhost:8080/.
Click "Continue without account".
Verify the home screen shows a "Load starter plan" button and the notice "Guest mode: your data lives only in this browser."

## Load the Full Body starter plan
Click "Load starter plan".
In the "Choose starter plan" sheet, click "Full Body".
Verify the "Load starter plan" button is no longer shown on the home screen.

## Check the weekly plan
Click "Plan" in the bottom navigation bar.
Verify the weekly schedule lists "Full Body A", "Full Body B" and "Full Body C", each with "6 exercises".
