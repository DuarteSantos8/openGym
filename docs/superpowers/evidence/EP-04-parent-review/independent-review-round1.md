# EP-04 independent source review

Reviewed frozen `4d87fc3274b795d1be41e522be9f4f8c251ccac7` in `/code/openGym-fork/.worktrees/review-ep04`, against `be8fc9bf`. Review date: 2026-11-14.

**Spec compliance: CHANGES REQUIRED.** The principal feature and existing sync integration follow the approved design, but malformed-row handling and one delayed-adoption branch remain incomplete.

**Task quality: CHANGES REQUIRED.** Three Important findings and one Minor finding below. No Critical finding. Small, separated domain helpers, thin store wiring and scoped integration are good foundations; the outstanding issues are concrete edge cases, not a request to redesign the architecture.

Final full-suite/build/browser-evidence acceptance remains parent-owned and pending. This report is not release approval.

## Findings

### Important I1 — A retained null row blocks adding and editing valid foods

**Location:** `frontend/src/lib/nutrition/diary.js:6`, `:11` (also `:19` for undo).

**Trigger:** A loaded local profile contains `nutritionEntries: [null, validEntry]`. The existing load path overlays saved JSON without sanitizing this collection (`store/useStore.js:355`); EP-01 deliberately makes `visibleOptionalEntries` tolerate/ignore invalid raw elements. Thus the valid entry displays normally. Adding a new food or editing that displayed entry then scans the raw collection and dereferences `e.id` on null.

**Observed:** A direct Node 22 invocation of the real domain helpers produced `Cannot read properties of null (reading 'id')` for both add and edit. EntrySheet catches this as its generic save error, so the user cannot save valid work. The invalid null element itself has no visible row to delete. Undo has the same unchecked raw scan.

**Required correction:** Make identity scans and replacement over retained storage tolerate malformed elements while preserving them according to the existing contract. Continue to use the visible projection for eligibility; do not solve this by deleting unrelated retained data. Add a regression with a valid row alongside null/other malformed elements covering add, edit, delete and undo through the store.

### Important I2 — Invalid serving metadata is accepted as supported and counted as known

**Location:** `frontend/src/lib/nutrition/entry.js:68` and `:72`, interacting with the early return at `:27`.

**Trigger:** A v1 row has valid identity/day/zone/label and numeric nutrients, no saved amount, and `serving: { label: 'portion', size: -10, unit: 'oz' }` with count absent. `normalizeEntry` delegates to the input helper; missing count makes that helper return `{}` before validating size, unit or label. The resulting comparison is `undefined === undefined`, so validation succeeds.

**Observed:** The actual helper returned `supported: true`; `dailyTotals` counted the row's protein as `{ value: 0.024, unknown: 0 }`. The UI therefore offers Edit and presents invalid serving information rather than the required unsupported/read-only treatment. This is especially relevant to restored, old-client or externally supplied profile data, which must be validated on read without rewriting.

**Required correction:** Validate the persisted serving object's shape, required count/positive size, numeric types, unit, label and matching canonical amount explicitly. Optional blank input and malformed persisted serving objects must not share an early-success path. Keep invalid rows opaque/read-only, excluded from suggestions and counted as unknown on their saved day. Add missing/null count, invalid unit/size and missing/mismatched amount cases. The read validator also currently omits validation of creation/provenance metadata; decide explicitly which canonical fields are required and cover that policy rather than silently accepting malformed metadata.

### Important I3 — Declining delayed adoption into an empty account discards new account foods from the active copy

**Location:** `frontend/src/store/useStore.js:1258`–`:1265`; compare the corrected nonempty-server branch at `:1295`–`:1329`.

**Trigger:** A diary-only guest joins an account through the device-link flow (`components/Passkeys.jsx:349`, `:354`, which uses `alwaysAsk: true`). The server returns `{ state: null, rev: 0 }`. While adoption is delayed, food is logged after sign-in. On “Keep profile as is”, the empty-server branch stashes the entire current copy and calls `takeServer`; it never splits out the post-sign-in UUIDs. This can also follow an initially unreachable adoption and subsequent resume.

**Observed:** Executing the exact frozen `runAdopt` function with a stubbed null-state GET/persistence and a deferred-decision equivalent yielded `activeLabels: []`, `keptLabels: ['Guest food', 'Account food']`, `puts: 0`. The account food is recoverable in the kept-device copy, so this is not irreversible erasure, but it disappears from the active diary and never syncs to the account despite belonging to it.

**Scope qualification:** This empty-server branch predates EP-04. The task's new diary-only `hasData`/adoption integration reaches it; the task's new pending-adoption regression tests only a non-null server document. The non-null path is corrected and should remain so. This finding is not a claim that EP-04 introduced the general legacy adoption algorithm bug.

**Required correction:** Apply the same pre-sign-in inventory/post-sign-in preservation rule to the no-document branch. Declining guest data must retain and push post-sign-in foods and their deletion evidence. Ensure a deferred decision uses current server state consistently. Add focused real-store cases for null server state, both choices, and post-sign-in live/deleted foods; retain the existing non-null regression.

**Probe limit:** The reproduction executed the source function with lightweight stubs, not the entire Zustand/network/browser stack. The caller, branch and inventory bypass were independently traced in source; parent/author should verify the correction through the real store.

### Minor M1 — Diary precision accidentally follows the workout weight setting

**Location:** `frontend/src/components/nutrition/DiarySummary.jsx:9`; `frontend/src/views/Nutrition.jsx:44`–`:45`.

**Trigger/impact:** Both components call `fmtNum(value, 3)`, but the actual `lib/format.js:73` helper accepts only one argument and uses global weight decimals (one or two). A valid saved serving of `0.024 × 100 g = 2.4 g` displays `0 × 100 g = 2.4 g` at the default setting. A known nutrient total `0.024` displays `0`; changing a workout display preference changes it to `0.02`. Storage and summation remain correct, but the serving explanation no longer reconciles and the requested precision argument has no effect.

**Required correction:** Use a locale-aware nutrition formatter supporting the contract's three decimal places independently of workout weight settings. Test a fractional serving and small nonzero nutrient under both weight settings. Avoid changing workout formatting globally.

## Independently assessed contract coverage

- **Opt-in and surfaces:** Nutrition declares `optIn: true`, with no DEF collection/default insertion. Home tile, Modules Body-group link, route and view are gated through `isOn`. The only search addition describes the module switch, consistent with existing module-discovery patterns. Off does not delete data. Lazy route import is present; measured bundle acceptance is still pending.
- **Diary-only guest adoption, both choices:** `hasData` recognizes rows and deletion-only evidence; `localExtras` offers only visible guest-only UUIDs. The real question names nutrition. For an existing server document, Add uses account-preferred merge; Keep takes server data and saves the guest copy aside. Both choices have real-sheet/store regressions. Pending non-null adoption preserves new food UUIDs; `splitByPre` also carries their tombstones. I3 is the remaining empty-document exception.
- **Global EntrySheet ownership/module changes:** Opening captures account id. The sheet subscribes to account/module access, renders nothing and closes when access changes, and independently rechecks both at submit. Edits apply only dirty fields against current store rows; a concurrently deleted/unsupported row cannot be silently overwritten. Tests cover module off, account switch and sign-out. No remaining source defect found in those guards.
- **Unsupported dates and schemas:** Valid-day future versions stay on their saved day, show unsupported, have no Edit action, and count as unknown. Missing/malformed days appear separately under Undated entries; they do not inflate any selected valid day's totals. Deletion uses retained tombstones, including unsupported rows. The generic projection excludes records lacking safe ids, as EP-01 specifies. I1/I2 concern malformed storage/serving cases beyond those covered date corrections.
- **Amounts, provenance and clocks:** Creation distinguishes g and mL; servings carry count/size/unit; no density or nutrient scaling is introduced. Blank nutrients are omitted, zero is retained, and totals separately count unknowns. Edits whitelist mutable food fields, preserving saved day, zone, occurrence/creation times and provenance. Reducers use existing store.update/stampChange. Delete retains rows; undo writes a higher negative deletion stamp without deliberately restamping unchanged fields.
- **Sync/backups:** Reviewed real-store test sources for add/add, different/same-field edits, edit/delete, undo after joined concurrent edit, both merge orders, offline/409 retry, reset/prefer and JSON/ZIP read/import. EP-01 contracts/parity/compatibility tests remain relevant. The only sync-merge runtime diff is three lines in client-only `localExtras`; shared merge/stamp algorithms and the API counterpart are unchanged.
- **Scope:** 47 changed files, 1,671 insertions/19 deletions. No API route, dependency/lockfile, Stats, workout logic, generated exercise data, lookup request or advice addition. Approved modules-copy/settings-pages/sheets additions are minimal. All 19 locale files receive the Nutrition block; sampled translations are actual localized text, not merely copied English.
- **UI structure:** Thin view, domain helpers, MetricCard/ErrorState/Skeleton reuse, labelled controls, explicit 44px minimums/focus rules and flexible layout are present. No diary-specific motion or network service was added. Actual visual/keyboard/reduced-motion acceptance is an evidence gate, not established by static CSS inspection.

## History and whitespace

Plan commit `23e0c248` precedes implementation. RED/GREEN order is recorded for domain (`81777172` → `314bb3f4`), diary-only adoption (`58797b0b` → `393c4bbc`), delayed adoption (`f646fa66` → `412f549a`, corrected by `41571761`), UI (`63579a41` → `e86321df`), ownership (`c3333034` → `19757ab9`), large text (`88af0d60` → `180773ba`) and undated rows (`4387f0d6` → `4d87fc32`). Commit bodies contain failure summaries and later focused counts. Initial new-module/UI REDs fail on missing imports; subsequent regressions describe behavioral assertion failures. `412f549a` alone was not the completed fix: the UUID correction and reported 16-test pass are at `41571761`.

`git diff --check be8fc9bf 4d87fc32` exited 0 with no output. Frozen checkout status was clean at the end of inspection. No implementation or Git changes were made by this review.

## Verification gaps and acceptance limits — separate from runtime findings

1. No suite, build, install, browser or server was run by this reviewer. Two tiny sequential offline probes used Node **v22.23.5**, one process each: direct real domain/format functions; extracted exact adoption function with stubs. All probe output is summarized above. No subagents, Claude or media were used.
2. Full frontend/API/required MCP, production build, parity, locale/source-string and generator results for final runtime remain the parent's evidence gate. The interrupted frontend run ending 143 is not a pass. Later evidence changes must be checked for unchanged runtime, or reviewed again if source changes.
3. Read the author's `browser-results.json` from the allowed evidence directory. It records real 409→200, two profiles, CRUD/reload/offline, JSON reset/restore, workout on/off, 320/390/1280 themes, RTL/200% and basic keyboard/focus checks. It also explicitly records a runtime `Uncaught`, stale Tour-chunk 404s and aborted requests on profile A, plus inspector-blocked requests on B. Final evidence must explain these and distinguish earlier/transient observations from final checks. This reviewer did not launch browsers or independently certify screenshots/contrast/full keyboard flow.
4. The new `nutrition-volume-entry.json` fixture is not consumed by the existing `contracts-fixtures.test.js`; the new JSON/ZIP test uses the gram-only fixture. Generic field preservation is plausible and inherited tests cover unknown fields, but an actual mL/serving backup/older-client round-trip assertion would strengthen evidence for the new contract. This is a coverage gap, not an observed data-loss defect.
5. New test source covers a representative two-device matrix; browser artifact reports the different-field/409 path. Full matrix execution, current parity result, native/device limits, and entry-chunk delta against BASELINE_REPORT must be accepted from final evidence, not inferred from commit messages or this review.

The report is the only file written: `/tmp/opengym-review/ep04-verdict.md`.
