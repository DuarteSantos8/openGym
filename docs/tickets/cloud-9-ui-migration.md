# Cloud handoff 9: UI migration batches

Repo: `steradrian/gains` (fork of openGym; React 19 JSX in `frontend/`, no TypeScript). Each prompt names ONE batch from the table below. Do that batch only, on branch `refactor/ui-<batch id>` off the latest `main`, as one PR into `main`. Stop when the PR is open and CI is green. The owner's main session reviews and merges.

## Context
The UI foundation is merged:
- primitives in `frontend/src/components/layout.jsx`, `blocks.jsx` and `sheet-layout.jsx`;
- tokens and utilities in `src/ui-kit.css`;
- guard tests in `src/ui-guards.test.js` with `src/ui-guards.baseline.json`.

Read `frontend/src/components/README-ui-kit.md` first, then the plan at `docs/` (if not in the repo, the key rules are below). The project owns this UI now: upstream openGym UI changes are no longer merged. This is a mechanical refactor. **Nothing a user sees may change**: same DOM classes, same spacing in px, same behaviour.

## Batches
| ID | Files |
|---|---|
| a2 | views: Measurements, CheckIn, ProgressPhotos, StructuralBalance, Library |
| a3 | views: Login, MobileOnboarding; components: PasswordAuth, Passkeys, ErrorBoundary, CameraScan, QrCanvas |
| a4 | views: Admin, AdminCoach, CoachSetup, CoachIntake, CoachChat |
| b1 | views: Stats, Plan; components: LineChart, Heatmap |
| b2 | views: Settings; components: ServerSync, WorkoutSettingsSheet, plus the spacer divs inside `components/ui.jsx` |
| b3 | views: Workout, RoutineEdit; components: RestTimer, MuscleExplorer |

Don't touch these, which are other branches' work: Home, TodayCard, ProgressHub, TrainHub, FoodHub, PlusSheet, LiveDock, `lib/nutrition/*`, the `views/Nutrition*`/`MealCatalog` pages and `sheets.jsx`. If a batch file imports something from those, leave the import alone.

## What to do in your batch's files
1. Replace hand-built markup with the primitives that emit the same DOM:
   - `.card` → Card
   - `.item` rows → ItemRow
   - `.tiles/.tile` → Tiles/StatTile
   - `.empty` → EmptyState
   - `h4.sec` → SectionTitle
   - `.tag` → Tag
   - `.chip(s)` → Chip/ChipRow
   - sheet `h3` and footer → SheetHeader/SheetActions
   - route views → Page (with `root` only for tab roots)
2. Replace static inline styles:
   - spacing → the `mb-N`/`mt-N`/`g-N` utilities or Stack/Inline/Spacer with the token of the **identical px value**;
   - colour → `.ink-*` or Card `tone`;
   - type → the `--fs-*`/`--fw-*` utilities;
   - layout → Inline/Stack or utilities.

   Keep dynamic values (computed widths, CSS variables set from data) inline. If a px value has no exact token, leave it inline and list it in the PR body. Never round it.
3. Lower the baseline for your files only: run `node scripts/ui-guards-baseline.mjs` from `frontend/`, then keep only your files' entries changed in `src/ui-guards.baseline.json` and revert any other entry the script touched. Your files should reach 0 for G1 and G3, apart from the listed exceptions.
4. Tests that read source text or select by structure: keep their contract and rewrite source-reading checks as DOM assertions. Don't weaken any assertion.

## Rules
- Make file changes only with your editor tools, never sed, awk, python or heredocs.
- Run `npx vitest run` and `npx vite build` in `frontend/`, plus `node scripts/check-locales.mjs` and `node scripts/check-source-strings.mjs --strict` from `frontend/`. Report the real exit codes. Two `useStore` test files have a known import-timeout flake under full-suite load; if they fail, rerun them alone and report both runs.
- Every user-facing string stays in `t()`. Add no new strings unless needed, and if you do, add the keys to all locale files.
- No screenshots. Commit trailer `Co-Authored-By: Claude <noreply@anthropic.com>`. Stage specific paths. No version bumps.
- PR body:
  - files changed, with each one's before and after G1/G3 counts;
  - any px value left inline, and why;
  - any place where the DOM had to differ (there should be none; explain if there is).
