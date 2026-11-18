# Waist and Apple Health Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Body measurements waist goes to Apple Health with each check-in, and waists other apps saved there fill that field.

**Architecture:** Writing is one more record kind in the existing pipeline (`healthRecords` → `planSync` → native `write` / `remove`), behind the existing "Write to Apple Health" switch. Reading is one more read kind (`enableRead('waist')`, `readOnce`), merged into `S.measurements` by a pure helper. iPhone only; on Android no waist record is ever made.

**Tech Stack:** React 19 + Zustand (frontend/src), vitest, Capacitor plugin in Swift (HealthKit).

**Spec:** `docs/dev/HEALTH_WAIST.md`

## Global Constraints

- iPhone only. Android (Health Connect) produces no waist record and shows no waist switch.
- Stored value stays cm (`entry.waist`), one decimal. HealthKit sample: `.waistCircumference`, unit `HKUnit.meterUnit(with: .centi)`.
- Own records carry sync id `opengym-waist-<YYYY-MM-DD>` (+ `HKMetadataKeySyncVersion`), as weights do.
- What is typed in openGym wins over Health.
- New UI text in all 25 locale packs (pt-BR inherits unless overridden; update the fingerprint in `src/lib/pt-br-locale.test.js` if inherited keys change). No em dashes. One short line per subtitle.
- Tests: vitest `--maxWorkers=2`, touched files only, through `scratchpad/testlock.sh`. Swift is compiled by CI only.

## Review Focus

1. A check-in whose `t` (its edit stamp) lies on another day than `d` → the sample still lands on day `d` (local noon), never on the edit day. Test in Task 1.
2. Waist cleared on a check-in that stays → the Health sample is removed, not left behind. Test in Task 1.
3. A sample read from Health for a day the user later clears → not brought back on the next read (seen memo). Test in Task 3.
4. Lengths in inches profile (`measureUnit: 'in'`) → still stored and written as cm. Test in Task 3.
5. Two samples on one day from Health → only the latest fills the empty day. Test in Task 3.

---

### Task 1: Waist records in the write pipeline

**Files:**
- Modify: `frontend/src/lib/health-connect.js` (`healthRecords`, `goneIds`, `planSync`, `writtenIds`, new `waistRecord`)
- Test: `frontend/src/lib/health-connect.test.js`

**Interfaces:**
- Produces: `waistRecord(entry, now = Date.now()) -> { id: 'opengym-waist-<d>', time: ms, cm: number } | null`
- Produces: `healthRecords(S, { …, waist = false })` returns `{ sessions, weights, waists }` (`waists` is `[]` unless `waist`).
- Produces: `planSync({ sessions, weights, waists = [] }, written, gone)` returns `{ sessions, weights, waists, remove: { sessions, weights, waists }, written }`; written kind `'waist'`.
- Produces: `goneIds(S)` also holds `opengym-waist-<d>` for every `S.deleted.measurements[d] > 0` and every check-in in `S.measurements` whose `waist` is null.

- [ ] **Step 1: Write the failing tests** in `health-connect.test.js`, `describe('waist records')`:
  - `healthRecords(S, { …, waist: true }).waists` for `S.measurements = [{ d: '2026-11-10', t: <noon 2026-11-10>, waist: 82.4 }, { d: '2026-11-11', t: …, waist: null }]` equals `[{ id: 'opengym-waist-2026-11-10', time: <noon 2026-11-10>, cm: 82.4 }]`.
  - Without `waist: true`: `waists` is `[]`.
  - A check-in with `d: '2026-11-10'` and `t` on 2026-11-15 → `time` is local noon of 2026-11-10 (Review Focus 1).
  - `planSync` writes a new waist, skips an unchanged one, rewrites a changed one (same id).
  - Waist cleared (entry stays, `waist: null`) with `gone = goneIds(S)` → `remove.waists` holds its id (Review Focus 2).
  - Check-in deleted (`S.deleted.measurements['2026-11-10'] = 500`) → removed; merely missing (no deletion on record) → kept written.
  - `writtenIds` returns `waists` too.
- [ ] **Step 2: Run** `npx vitest run --maxWorkers=2 src/lib/health-connect.test.js` — expect the new tests to FAIL.
- [ ] **Step 3: Implement.** `waistRecord`: null without `d` or a waist out of `inMeasurementRange('waist', …)`; time = `entry.t` when it is on day `d`, else local noon of `d`; skipped by `healthTime(time, now)` like weights.
- [ ] **Step 4: Run** the same command — PASS, and the file's older tests still pass.
- [ ] **Step 5: Commit** `Apple Health: waist records next to weigh-ins (write pipeline)`.

### Task 2: Writing on the iPhone (Swift + sync wiring)

**Files:**
- Modify: `frontend/ios/App/App/AppleHealthPlugin.swift` (`status`, `requestPermissions`, `write`, `remove`, the write type set at line ~53)
- Modify: `frontend/src/lib/health-sync.js` (`OFF`, new `waistAllowed`, `syncOnce`, `enableHealth`'s write list)
- Test: `frontend/src/lib/health-sync.test.js`

**Interfaces:**
- Consumes: Task 1's `healthRecords(…, { waist })`, `planSync` output with `waists`.
- Produces: native `status()` adds `waist: Bool` (sharing authorized for `.waistCircumference`); `requestPermissions({ write: ['waist'] })` asks it; `write({ sessions, weights, waists: [{ id, time, cm }] })`; `remove({ sessions, weights, waists: [id] })`.
- Produces: health file flag `waistAsked: false` in `OFF`.

- [ ] **Step 1: Write the failing tests** (mock plugin as the file's other tests do):
  - iOS, Health on, `status().waist === true`: a check-in with a waist → `write` is called with `waists: [{ id: 'opengym-waist-<d>', … }]`.
  - iOS, `status().waist === false`, `waistAsked` false, page visible → `requestPermissions({ read: [], write: ['waist'] })` once; `waistAsked` saved true; not asked again on the next sync.
  - Android platform → `write` never gets a non-empty `waists`, and `requestPermissions` is never asked for `'waist'`.
- [ ] **Step 2: Run** `npx vitest run --maxWorkers=2 src/lib/health-sync.test.js` — FAIL.
- [ ] **Step 3: Implement.** `waistAllowed(p, h)` mirrors `kcalAllowed` (iOS only). `syncOnce` passes `waist: allowed` to `healthRecords`, and `waists` / `remove.waists` to `write` / `remove`; `nothing` checks them too. Swift: `.waistCircumference` in the write type set; in `write`, samples saved when that type is sharing-authorized, with the sync id metadata, same batch-then-one-by-one fallback as weights; in `remove`, `delete(waistType, ids:)`.
- [ ] **Step 4: Run** the same command — PASS.
- [ ] **Step 5: Commit** `Apple Health: the waist is written with each check-in (iPhone)`.

### Task 3: Reading waists into Body measurements

**Files:**
- Modify: `frontend/src/lib/health-read.js` (new `mergeWaists`)
- Modify: `frontend/src/lib/health-sync.js` (`OFF`: `readWaist: false, waCursor: 0, waSeen: {}`; `readKey`, `anyRead`, `enableRead` perm `'waist'`, `readOnce`)
- Modify: `frontend/ios/App/App/AppleHealthPlugin.swift` (`requestPermissions` read `'waist'`; new `readWaist({ since })` → `{ records: [{ t, cm, id, origin, clientId }] }`)
- Test: `frontend/src/lib/health-read.test.js`

**Interfaces:**
- Produces: `mergeWaists(S, records, { seen = {} } = {}) -> string[]` (days changed; mutates `S.measurements`, fills `seen` by `hubReadingId(r)`).

- [ ] **Step 1: Write the failing tests**, `describe('mergeWaists')`:
  - Own record (`clientId: 'opengym-waist-…'`) → nothing changes.
  - `cm: 400` (out of range) → skipped.
  - Day with a check-in, `waist: null` → filled with `82.4`, entry `t` stamped (> old `t`).
  - Day with no check-in → new entry from `emptyMeasurement(d, S.customMeasurements)` holding only the waist.
  - Day with `waist: 85` → stays 85.
  - `S.deleted.measurements[d]` later than the sample → skipped.
  - Same records merged twice with the same `seen` → second returns `[]`; after the user clears the waist, a third merge does not bring it back (Review Focus 3).
  - Profile `measureUnit: 'in'` → stored `82.4` (cm) (Review Focus 4).
  - Two samples on one empty day → the later one's value (Review Focus 5).
- [ ] **Step 2: Run** `npx vitest run --maxWorkers=2 src/lib/health-read.test.js` — FAIL.
- [ ] **Step 3: Implement** `mergeWaists`, then the read pass in `readOnce` after the weigh-ins block: same `RESUME_EVERY_MS` / `READ_EVERY_MS` rhythm, `since` = `waCursor` minus `WEIGHT_MARGIN_MS`, or 30 days back the first time; `apply(probe => mergeWaists(probe, records, { seen }).length > 0, s => { mergeWaists(s, records, { seen: { ...before } }) })`; prune `waSeen` as `seen` is. Swift `readWaist` mirrors `readWeights` with `.waistCircumference` in cm.
- [ ] **Step 4: Run** the same command plus `src/lib/health-sync.test.js` — PASS.
- [ ] **Step 5: Commit** `Apple Health: waists from other apps fill the day's check-in (iPhone)`.

### Task 4: The switch, the words, the docs

**Files:**
- Modify: `frontend/src/views/Settings.jsx` (Apple Health section, after "Body composition from your scale"; the write row's subtitle on iOS)
- Modify: every `frontend/src/locales/*.js`; `frontend/src/lib/pt-br-locale.test.js` fingerprint if needed
- Modify: `docs/APPLE_HEALTH.md` or whichever doc lists the Health reads (find with `grep -ril "Body composition from your scale" docs`)
- Test: `frontend/src/views/Settings.health.test.jsx`

**Interfaces:**
- Consumes: `enableRead('waist')`, `disableRead('waist')`, `h.readWaist` from Task 3.

- [ ] **Step 1: Write the failing tests:** on iOS the row "Waist from other apps" shows and toggling it calls `enableRead('waist', …)`; on Android it is absent. The write row's iOS subtitle reads "Finished workouts, weigh-ins and your waist, from this phone only."
- [ ] **Step 2: Run** `npx vitest run --maxWorkers=2 src/views/Settings.health.test.jsx` — FAIL.
- [ ] **Step 3: Implement.** Row: icon `scale`, tint `var(--teal)`, title `t('Waist from other apps')`, subtitle `t('A waist saved in Apple Health fills an empty day. One you type in yourself always wins.')`, `ios &&` only. Add `h.readWaist` to `reading` and to the "Permission withdrawn" fallback chain. New strings in all 25 packs.
- [ ] **Step 4: Run** the Settings test, `node scripts/check-locales.mjs`, `node scripts/check-source-strings.mjs --strict`, and `src/lib/pt-br-locale.test.js` — all pass.
- [ ] **Step 5: Commit** `Settings → Apple Health: waist from other apps`.
