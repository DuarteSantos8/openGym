# Cloud handoff 10: sheets migration batches (UI kit, stage 5b)

Repo: `steradrian/gains` (fork of openGym; React 19 JSX in `frontend/`, no TypeScript). Each prompt names ONE batch from the table below. Do that batch only, on branch `refactor/sheets-<batch id>` off the latest `main`, as one PR into `main`. Stop when the PR is open and CI is green. The owner's main session runs the tests locally, reviews and merges.

## Context
The UI foundation is merged:
- primitives in `frontend/src/components/layout.jsx`, `blocks.jsx` and `sheet-layout.jsx`;
- tokens and utilities in `src/ui-kit.css`;
- guard tests in `src/ui-guards.test.js`, with the ratchet `src/ui-guards.baseline.json`.

Read `frontend/src/components/README-ui-kit.md` first, then `docs/tickets/plan-ui-foundation.md`.

`sheets.jsx` was split into `frontend/src/sheets/*.jsx` and is now a facade of named re-exports. 68 test files mock `../sheets.jsx`, so keep every export name and the facade unchanged.

This is a mechanical refactor: **nothing a user sees may change.** Same DOM classes, same spacing in px, same behaviour, same text. The previous page migrations (handoff 9) are the model.

## Batches
| ID | Files in `frontend/src/sheets/` |
|---|---|
| s1 | confirm-menu.jsx, starter.jsx, body-weight.jsx, import.jsx |
| s2 | equipment.jsx, exercise.jsx, exercise-picker.jsx |
| s3 | exercise-config.jsx, plan.jsx |
| s4 | workout-detail.jsx, workout-flow.jsx |

Don't touch any file outside your batch, except its co-located tests and its own entries in the baseline.

## What to do in your batch's files
1. Replace hand-built markup with the primitives that emit the same DOM:
   - sheet `h3` and close header → SheetHeader
   - spacer + primary buttons → SheetActions
   - `.item` rows → ItemRow
   - `.card` → Card
   - `.tiles`/`.tile` → Tiles/StatTile
   - `.empty` → EmptyState
   - `h4.sec` → SectionTitle
   - `.tag` → Tag
   - `.chip(s)` → Chip/ChipRow
   Hand-built `.item` rows that have their own `onClick` and no button role stay as they are, so they don't gain a role.
2. Replace static inline styles:
   - spacing → the `mb-N`/`mt-N`/`g-N` utilities, or Stack/Inline/Spacer with the token of the **identical px value**;
   - colour → `.ink-*` or Card `tone`;
   - type → the `--fs-*`/`--fw-*` utilities.

   Keep dynamic values inline. If a px value has no exact token, leave it inline and list it in the PR body. Never round. The `.x.x.x` utilities lose to id rules (`#app …`, `#modal-root …`), so check index.css before replacing anything inside those.
3. Lower the baseline for your files only. Run `node scripts/ui-guards-baseline.mjs` from `frontend/`, keep only your files' entries changed, and revert any other entry it touched.
4. Tests that read source or select by structure keep their contract. Rewrite source checks as DOM assertions; never weaken one.

## Rules
- Make file changes only with your editor tools, never sed/awk/python/heredocs.
- If you can run them, run `npx vitest run --maxWorkers=4` and `npx vite build` in `frontend/`, plus `node scripts/check-locales.mjs` and `node scripts/check-source-strings.mjs --strict`. If you can't run them, say so in the PR body; they will be run locally before merge.
- Every user-facing string stays in `t()`.
- No screenshots. Commit trailer `Co-Authored-By: Claude <noreply@anthropic.com>`. Stage specific paths. No version bumps.
- PR body:
  - files changed, with before and after G1/G3 counts for each;
  - any px left inline, and why;
  - any place where the DOM differs (there should be none).
