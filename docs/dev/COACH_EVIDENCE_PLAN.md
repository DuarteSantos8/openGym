# The Coach and the research behind it: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The app checks the plan against research-backed ranges, the Coach's review cites a source tag from a fixed list, and the review card shows the app's own numbers and the short references.

**Architecture:** Counting moves into `api/coach/core/` (shared by server and phones) as a copy of the frontend's muscle weighting, pinned by parity tests. A pure `planChecks` lists what falls outside a range; the review payload carries it as `checks`. The validator keeps a change's `ref` only when it is a known tag or one of this payload's check ids, and copies the check's numbers onto the change so the card renders from stored data.

**Tech Stack:** Plain JS ES modules, node:test (`api/test`), vitest (`frontend/src`), React 19.

**Spec:** `docs/dev/COACH_EVIDENCE.md`

## Global Constraints

- The model never computes a number: every count it sees or the person sees comes from app code with a test.
- Counting matches the Stats card: 1.0 per primary muscle, 0.4 (`SECONDARY`) per supporting one, `muscles.js` slugs, the person's ranges (`targetOf(S, slug)`, falling back to `DEFAULT_TARGETS`).
- `api/` never imports `frontend/`. Copies are pinned by parity tests that run under vitest (`frontend/src/lib/coach-parity.test.js` pattern).
- `mg`/`sm` go into `library-data.js` but never into the library slice sent to the model.
- Only `review` gets `checks` and `ref`. `create`, `refine`, `adapt`, `ask`, `debrief` are unchanged except for Task 2's `muscles` numbers.
- An unknown `ref` is dropped silently, never a validation error.
- The new prompt section is 400 words at most. Measure tokens before and after.
- User-facing strings in all 25 locale packs, no em dashes. Study names stay as published.
- Tests one at a time through `/private/tmp/claude-501/-Users-adrianfernandezgil-Dev-opengym/8214c086-b6e9-4259-9ef6-5562b4832eae/scratchpad/testlock.sh`; vitest `--maxWorkers=2`, touched files only. API tests: `cd api && node --test test/<file>`.

## Review Focus

1. A plan with no routines, or a week with no days → `planChecks` returns `[]`, no throw. Test in Task 3.
2. A custom exercise with only a body part → counted through the body-part fallback, like Stats. Parity fixture in Task 1.
3. A person who edited a range (including a legacy slug key in `S.muscleTargets`) → the check uses their range. Test in Task 3.
4. `ref` naming a check id from another payload, an author name, or a tag in the wrong case → dropped, the change kept. Test in Task 4.
5. A proposal shown days later, after the plan changed → the card's numbers come from the stored `refCheck`, not recomputed. Test in Task 5.

---

### Task 1: Muscle weighting in the Coach's core

**Files:**
- Modify: `scripts/build-coach-assets.mjs` (index entry adds `mg`, `sm` when present; update the header comment's "secondary muscles stay out" line); regenerate `api/coach/core/library-data.js`
- Modify: `api/coach/core/library.js` `librarySlice` / `swapSlice` so slice entries never carry `mg`/`sm`
- Create: `api/coach/core/muscle-weights.js`
- Test: `frontend/src/lib/coach-parity.test.js` (add a describe), `api/test/coach-limits.test.js` or `payload-bounds.test.js` (slice has no `mg`/`sm`)

**Interfaces:**
- Produces: `weightsOf(ex) -> { [slug]: number }`. Same answer as frontend `muscleWeightsOf(ex)` for catalogue entries (looked up by id in `LIB_BY_ID`) and for `S.customEx` entries.
- Produces: `weeklyPlanSets(S) -> { [slug]: number }`. Same answer as frontend `loadOfWeeklyPlan(S)`: week days, combined days, the queue, and a rotation scaled by its weekly target.
- Produces: `sessionsOf(S) -> Array<{ [slug]: number }>`, one weights-by-sets map per planned weekday session. Returns `null` for a rotation plan.

- [ ] **Step 1: Write the failing parity tests** in `coach-parity.test.js`, `describe('muscle weights')`:
  - For every id in `EXDB`: `srvWeightsOf(LIB_BY_ID.get(id))` deep-equals `muscleWeightsOf(exOr(id))`.
  - Custom fixtures: `{ id: 'c1', n: 'My row', bp: 'back' }`, one with `muscleWeights: { chest: 1, triceps: 0.5 }`, one with `bp: 'nonsense'` → equal both sides.
  - `weeklyPlanSets(S)` deep-equals `loadOfWeeklyPlan(S)` for: a 3-day week; a combined day (`week[1] = ['a', 'b']`); a queue; a rotation with a weekly target (6 sessions, 4 a week); a rotation without a target.
- [ ] **Step 2: Run** `npx vitest run --maxWorkers=2 src/lib/coach-parity.test.js`. Expect FAIL (no module).
- [ ] **Step 3: Implement.** Copy only what these answers need from `muscles.js` (`GENERIC`, `LEGACY`, `canonicalMuscle`, `BY_BODYPART`, `SECONDARY`, the explicit-parts path) and the minimum of `queue.js` / `rotation.js` / `week-left.js` for `weeklyPlanSets`. Each copied block gets a one-line comment naming its original. Regenerate with `node scripts/build-coach-assets.mjs`.
- [ ] **Step 4: Run** the parity file, `node scripts/build-coach-assets.mjs --check`, and the slice test. All PASS. Note the size of `library-data.js` before and after in the commit message.
- [ ] **Step 5: Commit** `Coach: the app's muscle weighting in the shared core, pinned to the Stats card`.

### Task 2: The payload's `muscles` block counts like Stats

**Files:**
- Modify: `api/coach/core/context.js` `muscleLoad`
- Modify: `api/coach/prompts/common.md` (the `muscles` reading note), `review.md` line ~20 if it names catalogue muscles; regenerate `api/coach/core/prompts.js`
- Test: `api/test/coach-context-146.test.js` (and any test asserting catalogue names such as `pectorals`)

**Interfaces:**
- Consumes: `weightsOf` (Task 1).
- Produces: `muscleLoad(S, now)` keeps its shape `{ muscle, sets7d, weeklyAvg, sets72h, daysSince }`. `muscle` is now a `muscles.js` slug, and set counts are weighted, rounded to 0.1. A muscle counts as trained on a day when it gets any weight > 0.

- [ ] **Step 1: Failing test:** one workout today with 3 done work sets of `0025` (bench press) → `chest` `sets7d: 3`, `triceps` `sets7d: 1.2`, and no entry named `pectorals`. A warm-up set adds nothing.
- [ ] **Step 2: Run** `cd api && node --test test/coach-context-146.test.js`. FAIL.
- [ ] **Step 3: Implement**, then rewrite the reading note in one line: weighted work sets per muscle, supporting muscles at 0.4, the same numbers as the person's Stats card. Run `node scripts/build-coach-assets.mjs`.
- [ ] **Step 4: Run** the context test, `payload.test.js`, `payload-parity.test.js`, `node scripts/build-coach-assets.mjs --check`. PASS. Fix older assertions that expected catalogue names, and say which in the commit.
- [ ] **Step 5: Commit** `Coach: weekly sets per muscle read the way the Stats card counts them`.

### Task 3: The source list and the plan checks

**Files:**
- Create: `api/coach/core/evidence.js`, `api/coach/core/checks.js`
- Modify: `api/coach/core/payload.js` (review only: `p.checks` when non-empty)
- Copy into core with a parity case: `DEFAULT_TARGETS` and `targetOf` (frontend `muscle-targets.js`, legacy slug lookup included)
- Test: `api/test/coach-checks.test.js` (new), `frontend/src/lib/coach-parity.test.js` (targets parity), `api/test/payload.test.js`

**Interfaces:**
- Produces: `EVIDENCE: { [tag]: { use: string, sources: Array<{ cite: string, grade: 'SR/MA'|'RCT'|'OBS'|'P'|'our rule', finding: string, pmid?: string, doi?: string }> } }` with the 13 tags of the spec, copied from coAIch `plugin/references/evidence.md` (PMIDs and DOIs verbatim).
- Produces: `TAGS = Object.keys(EVIDENCE)`.
- Produces: `planChecks(S, profile) -> Check[]`, where Check is one of:
  - `{ id: 'volume-low:<slug>', tag: 'volume', muscle, sets, low, high }`
  - `{ id: 'volume-high:<slug>', tag: 'volume-cap', muscle, sets, low, high }`
  - `{ id: 'frequency:<slug>', tag: 'frequency', muscle, sessions: 1 }`
  - `{ id: 'sets-per-exercise:<routineId>:<exId>', tag: 'sets-per-exercise', routine, exercise, sets, cap }`
- Produces: `tagOfRef(ref, checks) -> string|null`.

- [ ] **Step 1: Failing tests** (`coach-checks.test.js`):
  - Lats planned at 6 with the default range [10, 20] → a `volume-low:lats` check `{ sets: 6, low: 10, high: 20 }`.
  - `S.muscleTargets = { lats: [4, 8] }` → no `volume-low:lats`. Chest planned 24 with [10, 20] → `volume-high:chest`.
  - Goal `strength`, chest in one weekday session → `frequency:chest`. The same plan with goal `muscle` → none. A rotation plan → no frequency checks.
  - 5 sets on one exercise → `sets-per-exercise` with `cap: 4`. `profile.experience: 'new'` with 4 sets → `cap: 3`.
  - Empty `S` and a week with no days → `[]` (Review Focus 1).
  - A muscle with no range (not in `TARGET_MUSCLES`) is never checked.
  - Every `EVIDENCE` source has a `cite` and a `grade`; every non-`our rule` source has a `pmid` matching `/^\d{7,9}$/`.
  - A review payload has `checks`. A create, ask or adapt payload does not.
- [ ] **Step 2: Run** `cd api && node --test test/coach-checks.test.js test/payload.test.js`. FAIL.
- [ ] **Step 3: Implement.** Volume uses `weeklyPlanSets` rounded to 0.1. Frequency counts weekday sessions in which the muscle has weight 1 (primary). Checks are sorted volume-low, frequency, sets-per-exercise, volume-high, then by muscle order (`MUSCLES`).
- [ ] **Step 4: Run** those files and the targets parity under vitest. PASS.
- [ ] **Step 5: Commit** `Coach: the app checks the plan against the research ranges (review payload)`.

### Task 4: The prompt, the schema and the validator

**Files:**
- Modify: `api/coach/prompts/common.md` (new section "What the research says"), `api/coach/prompts/review.md` (one line: cite `ref`); regenerate `prompts.js`
- Modify: `api/coach/core/schemas.js` (`REVIEW_SCHEMA` change items: optional `ref: STR`)
- Modify: `api/coach/core/validate.js` `validateReview` (reads `ctx.checks`), `api/coach/core/pipeline.js:83` (passes `checks: payload.checks || []`)
- Test: `api/test/validate.test.js`, `api/test/coach-schemas.test.js`

**Interfaces:**
- Consumes: `TAGS`, `tagOfRef` (Task 3).
- Produces: a validated review change may carry `ref: string` (a tag) and `refCheck: Check` (a copy of the matched check). When `ref` was a check id, `ref` becomes that check's tag.

- [ ] **Step 1: Failing tests:**
  - `ref: 'progression'` → kept as `'progression'`, no `refCheck`.
  - `ref: 'volume-low:lats'` with that check in `ctx.checks` → `ref: 'volume'`, `refCheck` deep-equals the check.
  - `ref: 'volume-low:lats'` without that check, `ref: 'Schoenfeld 2017'`, `ref: 'Volume'`, `ref: 42` → `ref` absent, change kept, no error (Review Focus 4).
  - The schema test accepts a change with and without `ref`.
  - The prompt section: `PROMPTS.common` names every tag in `TAGS`, and contains no `PMID`, no `doi` and no four-digit year.
- [ ] **Step 2: Run** `cd api && node --test test/validate.test.js test/coach-schemas.test.js`. FAIL.
- [ ] **Step 3: Implement.** The prompt section holds the tag list (one `use` line each, from `EVIDENCE`), the rule "You never work out a number: copy counts from `checks`, `muscles`, `records` and `aggregates`", and the rule "A change may carry `ref`: one tag or one `checks` id; leave it out when none fits; never write an author, year or study yourself". Measure the review prompt's size before and after (`wc -w` on the composed prompt, and the token estimate in the PR body).
- [ ] **Step 4: Run** the same files plus `node scripts/build-coach-assets.mjs --check`. PASS.
- [ ] **Step 5: Commit** `Coach: a review change can cite a source from a fixed list`.

### Task 5: The line on the review card

**Files:**
- Create: `frontend/src/components/EvidenceLine.jsx`
- Modify: `frontend/src/views/CoachChat.jsx:520` (render it after `pcard-chg-w`), `frontend/src/index.css` (one class, reusing `small dim`)
- Modify: all 25 `frontend/src/locales/*.js`; `src/lib/pt-br-locale.test.js` fingerprint if needed
- Test: `frontend/src/components/EvidenceLine.test.jsx`

**Interfaces:**
- Consumes: `EVIDENCE` (Task 3), the validated change's `ref` / `refCheck` (Task 4), `MUSCLE_NAME` (`lib/muscles.js`).
- Produces: `<EvidenceLine change={c} />`, which renders nothing without a known `ref`.

- [ ] **Step 1: Failing tests:**
  - `ref: 'volume'`, `refCheck: { id: 'volume-low:lats', muscle: 'lats', sets: 6, low: 10, high: 20 }` → text contains `Lats: 6 sets a week, your range 10 to 20` and `Schoenfeld 2017`. The link's href ends with `docs/COACH_EVIDENCE.md#volume`.
  - `refCheck` for `frequency` → `Chest: trained in one session a week`; for `sets-per-exercise` → `5 sets on this exercise`.
  - `ref: 'progression'` and no `refCheck` → only `Based on Plotkin 2022, Chaves 2024`.
  - Unknown `ref` → renders nothing.
  - Stored `refCheck` numbers render even when the current `S` would count differently (Review Focus 5).
- [ ] **Step 2: Run** `npx vitest run --maxWorkers=2 src/components/EvidenceLine.test.jsx`. FAIL.
- [ ] **Step 3: Implement.** Strings: `'{0}: {1} sets a week, your range {2} to {3}'`, `'{0}: trained in one session a week'`, `'{0} sets on this exercise'`, `'Based on {0}'`. The link points to `https://github.com/DuarteSantos8/openGym/blob/main/docs/COACH_EVIDENCE.md#<tag>`, opened the way `CalendarFeed.jsx` opens its GitHub link. Add the strings to all 25 packs.
- [ ] **Step 4: Run** the test, `npx vitest run --maxWorkers=2 src/views/CoachChat*.test.jsx src/lib/pt-br-locale.test.js`, `node scripts/check-locales.mjs`, `node scripts/check-source-strings.mjs --strict`. PASS.
- [ ] **Step 5: Commit** `Coach review: each change shows the app's numbers and its sources`.

### Task 6: The docs page

**Files:**
- Create: `docs/COACH_EVIDENCE.md` (a heading per tag, `## volume` and so on, so `#<tag>` anchors work; a table of sources with grade, finding and PubMed link; what the Coach does with it; a closing "Our rules" list)
- Modify: `docs/AI_COACH.md` (a short paragraph and the link), `docs/README.md` (one index row)
- Test: `api/test/coach-checks.test.js` (add a case)

**Interfaces:**
- Consumes: `EVIDENCE` (Task 3).

- [ ] **Step 1: Failing test:** every tag in `TAGS` has a `## <tag>` heading in `docs/COACH_EVIDENCE.md`, and every `pmid` in `EVIDENCE` appears on the page.
- [ ] **Step 2: Run** `cd api && node --test test/coach-checks.test.js`. FAIL.
- [ ] **Step 3: Write the page** by hand from `EVIDENCE` and coAIch's `evidence.md`, crediting the coAIch evidence review in one line.
- [ ] **Step 4: Run** the test. PASS.
- [ ] **Step 5: Commit** `Docs: the research behind the Coach`.
