# ADR-0002 EP08: FitTrackee connector
Timebox: 1 session (used: 0.2) · Decision: **NO-GO (conditional)**
Date: 2026-11-14 · Base: `next/ready-20261114`

## Evidence
- Upstream 1.4.5 already has: runs and matches as `S.activities` (`lib/activities.js`, `live-activity.js`), FIT export (`fit-export.js`), Health Connect / Apple Health sport reads (`health-sync.js`), and a **Strava** integration (`api/integrations/providers/strava.js`, OAuth, off unless `INTEGRATIONS=strava`).
- The fork has a private activity-file preview (`lib/addon-activity.js`) that parses a file locally and writes nothing.
- No evidence that a FitTrackee instance is in use.

## Decision
Do not build a FitTrackee connector now. Revisit only if you run a FitTrackee instance and Strava/Health do not cover it.

## If revisited (GO-WITH-CONSTRAINTS)
- Write into upstream `S.activities` only; never a parallel store (see `importedActivities` rename in PR #18).
- Same shape as the Strava provider (`api/integrations/providers/*`), base-URL allowlist, server-side token, preview before apply.
- Precise GPS routes excluded by default.

## Cheaper alternative worth an S task later
Let the fork's local activity-file preview **save** into upstream `S.activities` after confirmation (GPX/TCX/FIT → `{ sport, durationS, distanceM, startedAt }`), no account needed.
