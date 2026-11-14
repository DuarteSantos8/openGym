# EP-04 implementation and verification

Initial runtime: `4d87fc32`. Corrected runtime: `fe22da11`; scoped source review **PASS** at
`a1639383` (before rebase), branch `feat/ep-04-codex-diary`, originally based on `be8fc9bf`.
All project commands ran in `/code/openGym-fork/.worktrees/ep-04-codex` using Node **v22.23.5**
(`/home/cloudroom-agent/tools/node-v22.23.5-linux-x64/bin` first on PATH). Existing root,
frontend, API and MCP lockfiles were installed with `npm ci`; no dependencies or lockfiles changed.

## What changed

- Opt-in Nutrition module, gated lazy route, compact Home tile and Body-group Modules link.
  There is no Stats, workout-logic, API-route, bottom-tab, library or external-provider change.
- Pure entry/diary helpers: UUID creation, bounded numbers, omitted unknown nutrients, honest
  known totals and unknown counts, saved day/timezone, meal slots, recent/frequent suggestions,
  field-preserving edits, retained deletion and deliberate undo through existing store stamping.
- Grams and millilitres stay distinct. A serving saves label/count/size/unit; no density is
  assumed. Inputs explicitly say **Totals for this entry**. Changing amount alone cannot scale
  nutrient totals. Future or invalid records remain opaque, read-only and deletable.
- Entries with missing or invalid calendar days appear under **Undated entries**. This is a
  read projection, never a rewrite of their day. They do not contribute to every selected-day
  total. Unsupported records with valid days stay on those days and count as unknown.
- Minimal guest-adoption repair: retained rows or deletion-only evidence make a profile data;
  visible guest-only foods make the user-facing extras count. Both real sheet choices are tested.
  Pending-adoption account entries are split by UUID so Keep profile as is preserves new work.
- Global Add/Edit sheets capture the account at opening, subscribe to module/account changes,
  dismiss when access changes and independently check ownership on Save.
- Contract additions, mL fixture, module documentation and 41 strings in every locale pack.

The authorized supporting paths beyond the brief's literal list are `lib/modules-copy.js`,
`views/settings-pages.js`, and the minimal adoption wording in `sheets.jsx`; parent approved
these integration changes. `sync-merge.js` changes only the **client-only `localExtras`** helper.
There is no API equivalent to mirror for `localExtras`. Its original unchanged parity test passed.
Review then exposed a separate stamping retention gap: a minimal identical change in client/API
`stampOptionalCollections` preserves unidentifiable raw elements during unrelated edits. Generic
id merge semantics are unchanged; malformed elements never become visible/supported records.
Focused parity/API regressions verify retained elements, unchanged clocks and legacy absence.
No `progress.md`, protected branch or deployment was touched.

## RED / GREEN history

| Behaviour | RED commit and observed result | GREEN commit and observed result |
| --- | --- | --- |
| Entry validation, servings, day/totals/reducers | `81777172`: two missing-module suites fail, no tests | `314bb3f4`: 26 pass |
| Diary-only adoption and actual sheet buttons | `58797b0b`: 5 fail / 5 pass | `393c4bbc`: 39 pass including parity |
| Account food added while guest decision is pending | `f646fa66`: 1 fail / 11 pass | `41571761`: 16 pass |
| Module, route, Home/Modules links and diary UI | `63579a41`: missing Nutrition suite fails | `e86321df`: 69 pass across 10 files |
| Open global sheet after disable/switch/signout | `c3333034`: 3 fail / 3 pass | `19757ab9`: 6 pass |
| 320 px RTL 200% text total wraps into two lines | `88af0d60`: real-browser assertion fails | `180773ba`: all four ordinary totals stay on one line |
| Missing/malformed days invisible | `4387f0d6`: 2 fail / 10 pass | `4d87fc32`: 46 pass across 4 files |
| Review I1/I2/I3: null elements, serving/provenance, empty-account delayed adoption | `12b6df1e`: 33 fail / 45 pass | `4bb2dbd7`: 112 pass / 6 frontend files; 26 API tests |
| Mirrored optional stamping discards malformed raw elements | `5eff5a5c`: 1 fail / 10 pass | `4bb2dbd7`: covered by the same GREEN |
| M1: nutrition precision follows workout weight decimals | `fb1fe1b1`: 2 fail / 7 pass | `fe22da11`: 10 pass / 2 files |

Plan `23e0c248` preceded source changes. Commit `412f549a` was an incomplete attempted fix
between the pending-adoption RED and actual GREEN: adding the collection alone did not fix the
legacy key function. Its follow-up uses nutrition UUIDs. Do not treat that intermediate commit
as passing. Complete targeted logs are adjacent (`domain-*`, `adopt-*`, `held-*`, `ui-*`,
`owner-*`, `undated-*`, `text-red.log`); npm command headers are in the test logs. The initial
undated run includes domain, store adoption and component tests. No earlier failing log has
been relabelled as a pass. `review-important-attempt.log` retains the intermediate 4 failures
that proved the stamping gap after the reducer guard alone. `a1639383` adds actual mL fixture
JSON/ZIP and older-writer assertions and corrects the Tour test's all-modules-default-on assumption;
Tour runtime is unchanged. See `review-initial.md` and `review-correction.md` for independent
findings and scoped approval. Review found no remaining Critical/Important issue in the corrections.

## Final checks

One heavy suite ran at a time with at most two workers, in retained TTY sessions. The parent
explicitly overrode duplicate full runs for the correction round: **final-head full frontend,
full API and full MCP acceptance is conditional on the parent's combined Node 22 gate** after
integration with EP-05b. No corrected-head full pass is claimed here.

| Command (from worktree root) | Exit / result | Evidence |
| --- | --- | --- |
| `npm --prefix frontend test -- --maxWorkers=2` at `4d87fc32` | **1; 7962 pass / 1 fail**, 665 files, 400.46 s; obsolete Tour default assertion | `frontend-full.log` |
| Covering frontend command below at `a1639383` | **0; 218 pass / 0 fail**, 14 files, 26.14 s | `review-covering.log` |
| `node --test --test-concurrency=2 api/test/sync-optional.test.js api/test/sync-stamps.test.js` | **0; 47 pass / 0 fail / 0 skip**, 1.85 s | `review-api-covering.log` |
| `npm --prefix frontend run build` at `a1639383` | 0; Vite built in 1.80 s | `review-build.log` |
| `node frontend/scripts/check-locales.mjs` | 0; 19 locales, 3656 keys | `review-static-checks.log` |
| `node frontend/scripts/check-source-strings.mjs --strict` | 0; 3002 source strings | `review-static-checks.log` |
| `node scripts/catalogue/build.mjs --check` | 0; 5632 exercises in sync | `review-static-checks.log` |
| `node scripts/build-coach-assets.mjs --check` | 0; 5632 exercises, 8 prompts in sync | `review-static-checks.log` |
| `node scripts/build-api-docs.mjs --check` | 0; 92 endpoints, 32 schemas in sync | `review-static-checks.log` |
| `git diff --check` (authored changes) | 0; evidence EOF blanks subsequently trimmed as requested by review | `review-static-checks.log` |

```sh
npm --prefix frontend test -- --maxWorkers=2 src/lib/nutrition src/store/useStore.nutrition.test.jsx src/store/useStore.adopt.test.jsx src/store/useStore.adopt-hold.test.jsx src/views/Nutrition.test.jsx src/components/Tour.test.jsx src/lib/modules.test.js src/lib/modules.opt-in.test.js src/views/Modules.test.jsx src/lib/sync-stamps-parity.test.js src/lib/sync-optional.test.js src/lib/contracts-fixtures.test.js
```

Build warnings are the existing oversized chunks and ineffective dynamic imports (Capacitor
and scan-web). The first non-TTY full frontend attempt ended with SIGTERM/143 before any final
counts; `frontend-interrupted.log` is retained as an **incomplete attempt**, not a passing run.
Subsequent long runs use retained foreground TTY sessions. No global process cleanup was used.

## Browser evidence

Real Chromium via browser-harness, production Vite preview on port 5144 and local API on 3144,
throwaway DATA_DIR and two isolated user-data-dir profiles (CDP 9344/9345). Synthetic data only.
Exercise-media requests were blocked before navigation/screenshots. Browser helpers and the
large-text regression are checked in; `browser-results.json` contains sanitized observations.

Observed paths:

1. Module off: no Home tile, diary route or unused `nutritionEntries` key. Enable through actual
   Modules switch, follow Body-group link, then enter from Home.
2. Add oats 60 g / 228 kcal; edit to 80 g keeps 228 kcal; delete retains payload; Undo and reload
   restore the row. Add 1.5 cups at 200 mL each: 300 mL and no grams. Zero energy remains zero;
   absent protein/carbohydrate/fat are unknown, not zeroed records.
3. Offline add “Offline pear” 50 kcal persists. A second browser loads it from the real API.
   Separate edits merge protein 12 g and fat 7 g. To force an actual conflict, hold B's outgoing
   PUT with CDP Fetch, advance the server through A's UI, then release B: observed HTTP **409**
   and **200** retry, three unique rows, protein 16 g and fat 11 g both retained.
4. B opens an Add sheet; A disables Nutrition. B's real polling dismisses the global sheet and
   does not save its pending food. Component tests additionally cover account switch/signout.
5. Actual JSON download with three live rows; delete, then download with two visible / three
   retained. Reset everything to zero, skip onboarding, import deleted backup: two visible.
   Restore the earlier live backup: three visible. ZIP export/read/import is tested through
   the real reader/store in Node; no ZIP browser claim (its control needs media).
6. Complete a real workout with Nutrition on (4 to 5 workouts), then off (5 to 6), using Set 1
   and Finish/save. Workout logic is unchanged.
7. At 320, 390 and 1280 px in both dark/light, no horizontal overflow. Arabic RTL, 200% text
   at 320 px and reduced-motion media verified. A browser RED caught 278 breaking into two
   lines; the rem-responsive grid fixes it. Tab reaches Add, Enter opens the sheet, focus
   moves to Food name, visible solid focus outline, Escape dismisses. Diary form controls
   measure at least 44 by 44 CSS px.
8. Final-build API fixture includes schema 2 rows with malformed `2026-99-99` and missing day.
   Both appear read-only with Delete in Undated entries; raw dates unchanged, selected-day
   totals remain 278 kcal / 16 g protein / 40 g carbohydrate / 11 g fat. Unit coverage also
   deletes an unsupported undated row; ordinary entry undo is covered separately.

Screenshots: `diary-{dark,light}-{320,390,1280}.png`, `diary-rtl-390.png`,
`diary-rtl-200percent-320.png`, `entry-rtl-390.png`, and `undated-390.png`.

Diagnostics: the fresh final-build browser had no runtime exceptions. Profile B recorded four
intentional media failures (`blockedReason: inspector`). Profile A, retained across rebuilds,
recorded two 404s for its obsolete `Tour-CtfzFV9h.js`, two `ERR_ABORTED` requests and one
“Uncaught” runtime exception; rebuilding the served dist left that old tab with a stale chunk
reference. This is not claimed as a globally clean console. Offline failures and the deliberate
409 were expected. Full request bodies/cookies and session credentials are excluded from evidence.

All owned API/preview/Chromium main PIDs (8544, 8545, 8546, 11312) were stopped individually and
confirmed absent before final suites. No other process was stopped. Temporary data/profiles are
removed before handoff; they are not part of the commit.

Correction-round narrow browser at `a1639383`: fresh profile/CDP 9346, same isolated local
API/preview ports. Seeded null + valid fractional serving + invalid serving. Actual Add, Edit,
Delete and Undo preserve null and the invalid serving; invalid serving is read-only, unknown
in totals and absent from suggestions. Saved `0.024 × portion (100 g)` remains visible at the
default precision and after actually selecting Settings → Weight decimals → 0.25 (`wdec: 2`).
Reload preserves null and shows 1.024 kcal / 0.024 g protein. Screenshot at 320 px has no
horizontal overflow. See `review-fractional-and-unsupported-390.png` and
`review-fractional-weight2-320.png`. Final drained diagnostics had no observed exceptions or
failed requests. Only this round's owned PIDs 28969/28970/28971 were stopped; tabs were closed.

## Bundle

See `bundle.json` for every emitted JS/CSS asset and level-9 gzip measurement, including sw.js.
Baseline is the prescribed `docs/product/BASELINE_REPORT.md` (Node 26/Windows, EP-00); current
build is Node 22/Linux and includes already-merged EP-01/EP-02 changes. This is not a same-toolchain
EP-04-only attribution.

| Asset | Baseline raw / gzip bytes | Current raw / gzip bytes | Delta raw / gzip |
| --- | ---: | ---: | ---: |
| Entry `index-*.js` | 586454 / 183316 | 587720 / 183740 | +1266 / +424 (gzip +0.23%) |
| Lazy `Nutrition-*.js` | absent | 13944 / 4892 | +13944 / +4892 |
| Lazy `Nutrition-*.css` | absent | 1917 / 647 | +1917 / +647 |
| All emitted JS/CSS, summed per file | 29262336 / 5884077 (155 files) | 29336194 / 5910442 (158 files) | +73858 / +26365 |

These are corrected-build measurements at `a1639383`. `bundle-initial.json` retains the earlier
`4d87fc32` measurement. Neither claims a measurement of the later combined integration build.

## EP-05b integration seam

`frontend/src/lib/nutrition/entry.js` exports `createEntry(input, context)`. After the user confirms
a lookup snapshot, pass `label`, `day`, `meal`, `amount`, `unit` (`g`, `mL` or `serving`), and
nutrient fields as **totals for the whole entry**. For servings, `amount` is the serving count,
with `servingLabel`, `servingSize` and `servingUnit`. Context accepts
`{ now, timeZone, source, externalId, contentFingerprint }`.
It creates UUID/schema/day/zone/creation metadata, then persist via:

```js
const record = createEntry(input, context)
useStore.getState().update(s => addEntry(s, record))
```

`EntrySheet` already accepts a canonical `prefill` and passes its source/externalId/fingerprint
only on creation. `editEntry` preserves provenance and identity. This seam is not an importer or
idempotency API; EP-05b owns confirmed provider-to-canonical mapping. Never convert mL to g
without explicit density data. No lookup or request is added by EP-04.

## Licence, limitations and handoff

Original implementation under the repository's AGPL-3.0-or-later terms; no new code dependency,
provider dataset, model, media, telemetry or outbound lookup. All evidence is synthetic. Human
linguistic review of all 19 translations is unverified. Browser coverage is desktop Chromium,
not physical phones, native apps, sensors or Docker. Historical older-client retention is
covered by existing compatibility fixtures/tests, not a separately launched historical binary.
GitHub Actions are disabled on this fork; local Node 22 results are the evidence. Independent
review passed the correction scope at `a1639383`; final combined full-suite acceptance belongs
to parent and remains conditional. No further full suites were run after the explicit override.

Shared integration paths: 41 Nutrition locale keys appended after module keys (Stats ownership
untouched), modules registry/copy/settings/Modules, one App route, one Home tile, useStore,
client-only localExtras and adoption copy. Merge these carefully alongside EP-03/EP-05a.
Disable Nutrition to hide it without deleting data. Reverting UI commits leaves the registered
optional collection retained by EP-01. No deployment or data migration was performed.
