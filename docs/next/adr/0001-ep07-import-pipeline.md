# ADR-0001 EP07: does a new import pipeline need building?
Timebox: 1 session (used: 0.2) · Decision: **NO-GO for a new pipeline · extend upstream's**
Date: 2026-11-14 · Base: `next/ready-20261114` (bd0ece62a)

## Evidence (code at the base SHA)
- `frontend/src/lib/import-csv.js` with Strong, GymMane, hostile-input, tags/notes and **import-twice** tests (`import-csv.twice.test.js`): dedupe on re-import already exists.
- `planImportSheet` in `frontend/src/sheets.jsx` (used by `CoachActions`, `LibraryLink`, tested in `sheets.plan-import-toast.test.jsx`): a preview → confirm step for importing a **plan** already exists.
- Upstream 1.4.5 owns `S.activities` (`lib/activities.js`, stamped map) and FIT export (`lib/fit-export.js`).

## Decision
- EP07-T01: done by this ADR.
- EP07-T02/T03: no parallel engine. Workout imports stay on `import-csv.js`; program imports (EP09) go through `planImportSheet`; activity imports (if ever) write upstream `S.activities`.
- EP07-T04 (nutrition export round-trip) stays open, tracked with the diary work.

## Follow-ups
EP09 uses `planImportSheet` as its preview surface (see ADR-0006 when written).
