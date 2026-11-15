# EP-04 correction round 1 — scoped independent review

Reviewed frozen `a1639383d13a7e65a72994d8a1f5b67a3c7ccc64` in `/code/openGym-fork/.worktrees/review-ep04`, against prior reviewed `4d87fc32`. Runtime changes end at `fe22da112b10400fed14846435968504706de390`; the remaining commit changes tests/evidence only. Date: 2026-11-14.

**Spec compliance: PASS for this correction scope.** I1, I2, I3 and M1 are addressed. The provenance implementation follows the parent's ruling: missing legacy metadata stays unknown; present metadata must have valid types/formats. The previously noted mL/serving backup and older-writer coverage gap is addressed.

**Task quality: PASS with one nonblocking Minor evidence-file whitespace issue.** No Critical or Important finding remains from the original review, and no new runtime defect was found in the fix diff. This is source/correction approval, not final full acceptance.

## Original findings

### I1 — Addressed

`frontend/src/lib/nutrition/diary.js:6`, `:11`, `:19` now use null-safe identity reads. Invalid retained elements no longer prevent adding/editing/undoing a separate valid row. Delete continues to use the visible projection.

The author also demonstrated why reducer changes alone were insufficient: the existing stamping hook discarded malformed elements. The parent-approved correction in `frontend/src/lib/sync-merge.js:811` and `api/sync-stamps.js:161` is identical: identify safe records, map the raw list, and retain other elements without assigning clocks/identity or making them visible. The existing valid-record stamping, removal-to-tombstone behavior and generic merge algorithm are unchanged. This preserves malformed elements during unrelated local edits; it does not redefine unidentified-element reconciliation during a merge.

`store/useStore.nutrition.test.jsx:155` covers all four real-store actions with null, boolean, number, array and opaque-object elements. The new parity test checks both sides, unchanged clocks and legacy absence/bytes; the API test additionally exercises all three registered optional collections. This is stronger coverage than the original helper-only reproduction.

### I2 — Addressed

`frontend/src/lib/nutrition/entry.js:74` now rejects a present serving unless it is a non-null, non-array object with numeric count and positive numeric size. The bounded arithmetic helper then rejects non-finite/out-of-range values, invalid units and labels; the canonical amount comparison rejects missing/mismatched saved amounts. A missing count can no longer reach the prior `undefined === undefined` success case.

New domain tests cover absent/null/string counts, string/zero sizes, empty labels, invalid units, missing/mismatched amounts and invalid serving shapes. The diary regression proves malformed serving rows remain unchanged, contribute unknowns, and stay out of suggestions.

Lines 64–67 validate present UTC instants, creation kind, source/id fields and fingerprint. Missing creation/provenance fields are intentionally allowed and remain absent after read/edit, with an explicit regression. The contract documentation records this policy and preserves unknown extension fields. This matches the parent's ruling rather than inventing legacy provenance.

### I3 — Addressed

`frontend/src/store/useStore.js:1258`–`:1261` restricts the empty-document shortcut to unasked/new-account or same-account adoption. An empty account requiring an explicit device-link decision now reaches the existing pre-sign-in inventory split, question, reread and Add/Keep handling. `:1248` accepts an explicit null state on reread instead of retaining an older document solely because null is falsy.

The eight real-store regressions at `store/useStore.nutrition.test.jsx:170` cover both choices, live/deleted post-sign-in food, and a server remaining empty or gaining remote food while the question is pending. They assert active and pushed UUID sets, fresh base revision, retained deleted payload and positive deletion evidence. Existing nonempty adoption and adoption-hold suites are included in the covering run. Guest adoption still asks only about pre-sign-in data, while post-sign-in foods survive either answer.

### M1 — Addressed

`frontend/src/lib/nutrition/format.js:4` supplies a cached locale-aware formatter with up to three decimals. DiarySummary and all amount/serving display calls now use it. The global workout formatter is untouched.

The real Nutrition component regression checks `0.024` in both serving explanation and nutrient summary at both weight display settings. The helper test also checks English/German decimal separators and unpadded whole amounts. This removes the accidental dependency on workout weight precision.

## Other correction-diff checks

- JSON and ZIP coverage at `store/useStore.nutrition.test.jsx:126` now includes the actual mL/serving fixture, deleted and live restore paths, and equality of every data field excluding deliberately restamped metadata.
- The older-writer cases at `:138` invoke the real API `stampPut` for both carrying and omitting the collection, checking unchanged volume/serving data and absent amountG/proteinG. These simulate old-writer request shapes against the current API; they do not certify arbitrary historical binaries.
- The Tour change is test-only and matches the authorized opt-in default correction. It now expects no selected preset before an explicit choice, asserts Everything enables nutrition, and asserts Just training disables it. No Tour runtime change or removal of the remaining preset assertions.
- No added dependency, service, route, outbound lookup, workout formatting or Stats change in this diff. The mirrored stamping change is narrowly scoped and RED-proven as authorized.
- `git diff --name-only fe22da11 a1639383` confirms only two evidence logs and two test files after the runtime commit. Frozen checkout status was clean.

## New finding

**Minor E1 — Evidence logs introduce trailing blank lines.** `git diff --check 4d87fc32 a1639383` reports new blank lines at EOF in:

- `docs/superpowers/evidence/EP-04/frontend-full.log:74`
- `docs/superpowers/evidence/EP-04/review-covering.log:13`
- `docs/superpowers/evidence/EP-04/review-important-attempt.log:212`
- `docs/superpowers/evidence/EP-04/review-important-green.log:13`
- `docs/superpowers/evidence/EP-04/review-important-red.log:648`
- `docs/superpowers/evidence/EP-04/review-precision-green.log:13`
- `docs/superpowers/evidence/EP-04/review-precision-red.log:51`
- `docs/superpowers/evidence/EP-04/review-stamp-red.log:50`

Impact is limited to whitespace hygiene; no runtime effect. Remove the extra blank EOF lines during final evidence cleanup, retaining the log content. Source/API/contract-only `git diff --check` is clean. This does not block source approval.

## Evidence reviewed and limits

Read committed logs and test source; did not rerun their commands:

| Evidence | Recorded result |
| --- | --- |
| `review-important-red.log` | 33 failed / 45 passed, covering I1/I2/I3 before correction |
| `review-stamp-red.log` | 1 failed / 10 passed, demonstrating the retention gap |
| `review-important-green.log` | 112 passed / 6 frontend files |
| `review-precision-red.log` | 2 failed / 7 passed |
| `review-precision-green.log` | 10 passed / 2 files |
| `review-covering.log` | 218 passed / 14 frontend files, including parity, optional sync, adoption/hold, Tour, module and diary cases |
| `review-api-stamp.log` | 26 passed / 0 failed API optional tests |

Git history preserves RED before implementation: `12b6df1e` and `5eff5a5c` → `4bb2dbd7`; `fb1fe1b1` → `fe22da11`. `a1639383` adds the volume/older-writer coverage and authorized Tour expectation correction. The full pre-correction frontend log honestly records **7,962 passed / 1 failed** (the Tour default assertion); it is not a final full-suite pass.

No runtime probe was needed in this round: source paths and the expanded targeted regressions resolved the concrete questions. This reviewer ran only read-only source/history/status/whitespace inspection, with no tests, build, install, browser, service, subagent or media use. The only file written is this report.

Final browser/build/static evidence and the consolidated full acceptance gate remain parent-owned. Later rebase/evidence commits must preserve the reviewed runtime source or expose any source differences for review. Parent should verify source identity, resolve the artifact whitespace note, and accept final combined results before declaring EP-04 complete.
