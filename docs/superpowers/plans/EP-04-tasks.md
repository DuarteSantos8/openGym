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
