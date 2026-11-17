# EP-04 confirmed implementation tasks

Base: be8fc9bf. Worktree: `.worktrees/ep-04-codex`; branch: `feat/ep-04-codex-diary`.
Node: v22.23.5. Existing root/frontend/api/mcp lockfiles installed with npm ci.

## Interfaces and file plan

- `frontend/src/lib/nutrition/entry.js` and adjacent tests: strict bounded manual input,
  UUID v4 creation, schema handling, grams/mL/serving arithmetic and immutable provenance.
- `frontend/src/lib/nutrition/diary.js` and adjacent tests: visible projection only, day/meal
  grouping, known sums and unknown counts, recent/frequent suggestions, draft reducers.
  Reducers run through existing store `update`, never a second persistence or merge engine.
- `frontend/src/store/useStore.nutrition.test.jsx`: real update, persistence, 409 retry,
  two-device merges, reset/prefer, JSON/ZIP reader and import, older-client retention.
- `frontend/src/store/useStore.js`: minimal guest-adoption recognition and pending-adoption
  inventory handling. Test both decisions with a diary-only guest before changing it.
- `frontend/src/lib/sync-merge.js` and `api/sync-stamps.js`: only a RED-proven gap;
  localExtras may need a visible nutrition count. Keep any mirrored code in parity.
- `frontend/src/views/Nutrition.jsx`, `components/nutrition/{EntrySheet,DiarySummary}.jsx`
  and scoped CSS/tests: date, meals, honest totals, recent/frequent selection, validated form,
  tombstone delete and deliberate undo. Unknown schema rows remain visible as unsupported.
- `frontend/src/lib/modules.js`, `lib/modules-copy.js`, `views/Modules.jsx`,
  `views/settings-pages.js`, `App.jsx`, `Home.jsx`, related tests and all locale packs:
  opt-in nutrition module; lazy gated route; one Home tile; Body and health group link in
  Modules. Measurements is currently reached in Stats, which is explicitly protected;
  use the existing Body group in Modules instead of editing Stats.
- `frontend/src/sheets.jsx` only if RED proves the adoption question cannot describe diary
  extras; minimal count/copy addition. This and module-copy/settings-pages are necessary
  integration paths beyond the brief's literal list, not general sheet/settings changes.
- Contract additions and fixtures, `docs/MODULES.md`, evidence under
  `docs/superpowers/evidence/EP-04/`.

## Ordered milestones

1. Commit this plan before source changes. RED/GREEN entry validation, servings and reducers.
2. RED/GREEN diary-only adoption, including actual question wording and both choices.
   Prove sync matrix and real backups before UI. Preserve legacy bytes and absent collection.
3. RED/GREEN UI and gates. Use MetricCard/ErrorState/Skeleton and existing modal focus handling.
4. Browser QA: isolated profiles, ports and throwaway API DATA_DIR; block exercise media.
   Module off/on, CRUD/undo/reload, offline/reconnect/409, two profiles, backup/wipe/import,
   workout on/off, 320/390/1280 dark/light, RTL/200% text/reduced motion/keyboard.
5. One full suite at a time: frontend maxWorkers=2; API concurrency=2; MCP maxWorkers=2;
   production build, locale/source checks, three generator checks. Record actual results,
   chunk sizes and console/request evidence. Inspect diff, commit, pull/rebase integration,
   push assigned branch and draft PR. Parent owns independent review.

## Design rulings

- mL remains volume (`amountMl`), never `amountG`; no density assumption. A serving records
  `{ label, count, unit: 'g' | 'mL', size }`. Nutrients are saved-entry totals, not scaled
  automatically when an amount is edited. Non-gram explanation survives export.
- Date-only entries omit occurredAt rather than inventing an instant. Today's creation may
  carry its real instant. Day and IANA zone are saved once; editing nutrients cannot refile them.
- Unknown/newer schema rows are retained and read-only, counted as unknown in totals.
- No dependencies, outbound lookup, target/advice, library, API route, progress ledger edit,
  subagent or protected-branch action. This plan doubles as the task ledger because the user
  explicitly forbids progress.md edits. Parent handles final independent review.

## Evidence ledger

- Inspection complete; no source changes at plan commit. Required briefs, contracts and
  inherited architecture/product/licence documents read. Executing-plans and TDD applied.
- Confirmed plan committed as `23e0c248` and approved by parent. Implemented in the assigned
  worktree only; no subagents, parent-checkout changes or progress.md edits.
- Domain RED `81777172`, GREEN `314bb3f4`: 26 tests. Diary adoption RED `58797b0b`, GREEN
  `393c4bbc`: 39 tests including unchanged shared-algorithm parity. Both actual adoption
  buttons are rendered and clicked. Tombstone-only state counts as sync evidence even when
  the user-facing extras count is zero.
- `localExtras` is client-only, so its visible nutrition count has no invented API counterpart.
  Shared merge/stamp functions are unchanged and their existing parity test passes.
- Pending-adoption RED `f646fa66`: 1 failed / 11 passed. `412f549a` added the collection to
  the inventory but did not fix UUID splitting; `41571761` is the actual GREEN (16 tests).
- UI RED `63579a41`, GREEN `e86321df`: 69 targeted tests across 10 files, locale/source checks.
  Nutrition uses the Home tile and Body-group Modules link. All 19 locale packs have the
  Nutrition block. Amount edits never scale the explicitly labelled entry totals.
- Parent's global-sheet finding reproduced: RED `c3333034` (3 failures), GREEN `19757ab9`
  (6 passed). Add/Edit sheets subscribe to module/account ownership, dismiss on changes and
  independently guard Save. Real two-profile sync also dismisses an open Add sheet.
- Browser 200% RTL text RED `88af0d60`, GREEN `180773ba`: rem-based grid prevents ordinary
  totals wrapping into separate digits at 320 px. Screenshot and browser assertion retained.
- Parent's missing/malformed-day finding reproduced: RED `4387f0d6` (2 failed / 10 passed),
  GREEN `4d87fc32` (46 passed). Explicit Undated entries remain read-only/deletable without
  changing stored days or entering selected-day totals. Valid-day future schema stays filed
  on that day. Unsupported rows never become suggestions or known nutrient values.
- Stable runtime `4d87fc32` sent to parent for independent frozen-worktree review. Evidence
  and final suite results are recorded in `docs/superpowers/evidence/EP-04/README.md`.
- Full frontend at `4d87fc32` completed in TTY: 7962 passed / 1 obsolete Tour default-preset
  assertion failed. Preserved as pre-correction evidence. Parent explicitly waived duplicate
  full frontend/API/MCP runs for the correction round; their combined integration gate owns
  final full-suite acceptance. Do not label corrected-head full checks green.
- Review I1/I2/I3 RED `12b6df1e` (33 failed / 45 passed), stamping RED `5eff5a5c`
  (1 failed / 10 passed), GREEN `4bb2dbd7` (112 frontend + 26 API tests). Null-safe identity
  scans plus the RED-proven mirrored stamp hook preserve malformed elements during unrelated
  local edits. Generic id merge is unchanged. This supersedes the earlier unchanged-stamping
  note; localExtras still has no API counterpart. Present serving/provenance metadata is
  validated, missing legacy metadata stays unknown, and delayed empty-account decisions
  preserve new live/deleted account foods with a fresh server read.
- M1 RED `fb1fe1b1` (2 failed / 7 passed), GREEN `fe22da11` (10 passed): scoped locale-aware
  three-place nutrition formatter; global workout formatting unchanged.
- Covering test HEAD `a1639383`: 218 frontend tests / 14 files; 47 focused API stamping tests;
  production build, locale/source and generators passed. Actual mL fixture now goes through
  JSON/ZIP read/import and older-writer copy/omit roundtrips. Tour test default expectation is
  updated with parent approval; runtime untouched.
- Scoped correction review PASS at `a1639383`. Narrow real-browser CRUD/reload with retained
  null and invalid serving passed; 0.024 stays visible under both weight precision settings.
  Final diagnostics observed no exceptions/failed requests. Review evidence EOF whitespace
  trimmed, with substantive output retained. Owned services stopped and throwaway data removed.
