# Upstream files the fork modifies (plan §3.2)

One row per upstream file changed by an openGym Next / Ironvane PR, with the reason. New files the
fork adds (its own components, libs, tests, CSS) are not listed. Keep each feature PR at about 30
changed lines per upstream file or fewer; larger changes need a design note first.

Started 2026-11-20 with the body picker; earlier PRs (#18–#51) did not keep this file.

| File | PR / branch | Lines | Why |
|---|---|---|---|
| `frontend/src/views/Home.jsx` | `next/today-body-focus` | +4 | Renders the body picker card under today's workout, behind `isOn(S, 'bodyfocus')`. |
| `frontend/src/lib/modules.js` | `next/today-body-focus` | +3 −1 | Registers the `bodyfocus` module (on by default) and adds it to the Just training preset, so every preset keeps it. |
| `frontend/src/lib/modules-copy.js` | `next/today-body-focus` | +1 | The module's title and description inside `t()`, as `modules-copy.test.js` requires. |
| `frontend/src/views/Muscles.jsx` | `next/today-body-focus` | +7 −5 | `?m=` takes several muscles (opens with "Any of them"); back from it goes to Today when opened from there. One muscle behaves as before. |
| `frontend/src/components/MuscleExplorer.jsx` | `next/today-body-focus` | +4 −3 | `initial` may be a list, and `initialMatch` sets All/Any; defaults unchanged. |
| `frontend/src/locales/*.js` (25 packs) | `next/today-body-focus` | +18 each | The picker's 18 new strings. Machine-written; add them to the native-speaker review (NEXT-STEPS task 7). pt-BR gets explicit overrides, so the pt-PT inheritance fingerprint is unchanged. |
| `frontend/src/views/Modules.test.jsx` | `next/today-body-focus` | +1 −1 | One more module on: "12 of 14 modules on." |
| `docs/MODULES.md` | `next/today-body-focus` | +1 | The Body picker row. |
