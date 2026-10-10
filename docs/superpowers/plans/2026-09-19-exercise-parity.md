# Exercise Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let built-in and custom exercises share editable metadata, media, steps, and safe hide/delete controls without duplicating the built-in catalogue in user state.

**Architecture:** Keep `CATALOGUE` and `EXDB` pristine. Derive the visible built-in catalogue from `S.exOverrides` and `S.deletedEx`, then rebuild `EXIDX` from that resolved catalogue plus `S.customEx` at the same store lifecycle points that currently register customs. Extend the existing exercise editor and sheets rather than adding a second editing surface.

**Tech Stack:** React 19, Zustand, Vite, Vitest, happy-dom.

**Spec:** `docs/superpowers/specs/2026-09-19-exercise-parity-design.md`

## Global Constraints

- Do not mutate `EXDB` or `CATALOGUE`; overrides remain user-state overlays.
- Persist only touched built-in fields in `exOverrides`; remove an override when it equals the catalogue value.
- Preserve logged workouts and block hide/delete while the exercise is in the active workout.
- Custom `img` and `gif` accept only `http:` or `https:` URLs; bare dataset names still use the configured media base.
- Keep the existing `Object.assign(clone(DEF), saved)` compatibility path; add no migration or dependency.

## Review Focus

- An old saved state lacking both new keys resolves and persists without an exception (Task 1).
- A hidden built-in is absent from the library/picker index but an old workout still gets the existing `exOr` fallback (Task 1).
- A built-in edit that is changed back to its catalogue value removes its override rather than leaving a modified marker (Task 2).
- Blank or whitespace-only steps and overlong descriptions cannot be saved (Task 2).
- Restoring one hidden item and restoring all items leave custom exercises and their overrides untouched (Task 3).

### Task 1: Resolve exercise state centrally

**Files:**
- Modify: `frontend/src/store/useStore.js`
- Modify: `frontend/src/lib/exercises.js`
- Modify: `frontend/src/lib/exercises.test.js`

**Interfaces:**
- Produces: `effectiveCatalogue(st)`, `allExercises(st)`, `isHidden(id, st)`, `allows(exercise, st)`, and `registerExerciseState(st)` from `lib/exercises.js`.
- Produces: state fields `exOverrides: {}` and `deletedEx: []` in `DEF`.
- Consumes: the existing `registerCustom` callers in store initialization, persistence, and restore; replace each with `registerExerciseState(S)`.

- [ ] **Step 1: Write failing resolver tests**

```js
import { EXDB, EXIDX, effectiveCatalogue, allExercises, imgSrc, gifSrc, registerExerciseState } from './exercises.js'

it('overlays and hides built-ins without changing EXDB', () => {
  const base = EXDB[0]
  const st = { customEx: [], exOverrides: { [base.id]: { n: 'My press', st: ['Set up'] } }, deletedEx: [] }
  expect(effectiveCatalogue(st).find(e => e.id === base.id)).toMatchObject({ n: 'My press', st: ['Set up'] })
  expect(base.n).not.toBe('My press')
  expect(allExercises({ ...st, deletedEx: [base.id] }).some(e => e.id === base.id)).toBe(false)
})

it('rebuilds EXIDX from resolved state and preserves absolute media URLs', () => {
  const base = EXDB[0]
  registerExerciseState({ customEx: [], exOverrides: { [base.id]: { n: 'Renamed' } }, deletedEx: [] })
  expect(EXIDX[base.id].n).toBe('Renamed')
  expect(imgSrc({ img: 'https://example.test/image.jpg' })).toBe('https://example.test/image.jpg')
  expect(gifSrc({ gif: 'clip.gif' })).toContain('clip.gif')
})
```

- [ ] **Step 2: Run the test file to verify it fails**

Run: `cd frontend && npm test -- src/lib/exercises.test.js`

Expected: FAIL because the resolver exports and URL pass-through behavior do not exist.

- [ ] **Step 3: Add the two backward-compatible store fields and the single resolver path**

```js
// useStore.js: add immediately after the existing customEx: [] entry in DEF
customEx: [], exOverrides: {}, deletedEx: []

// exercises.js
export const effectiveCatalogue = st => CATALOGUE.map(e => ({ ...e, ...(st?.exOverrides?.[e.id] || {}) }))
export const isHidden = (id, st) => (st?.deletedEx || []).includes(id)
export const allows = (ex, st) => !isHidden(ex.id, st)
export const allExercises = st => [...(st.customEx || []), ...effectiveCatalogue(st).filter(ex => allows(ex, st))]
```

Replace the `registerCustom(list)` implementation with `registerExerciseState(st)`: reset former custom ids to pristine `CATALOGUE`, clear hidden built-in ids from `EXIDX`, then index `allExercises(st)`. Call it after every persisted, initialized, or restored `S` value, so sync convergence changes the index immediately. Extend `searchScore` with `['st', 20]`, include `st` in `corpusOf`, and make `imgSrc`/`gifSrc` return full HTTP(S) URLs unchanged.

- [ ] **Step 4: Run focused and complete checks**

Run: `cd frontend && npm test -- src/lib/exercises.test.js && npm test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/store/useStore.js frontend/src/lib/exercises.js frontend/src/lib/exercises.test.js
git commit -m "feat: resolve overridden and hidden exercises centrally"
```

### Task 2: Make the existing editor and delete flow handle both exercise kinds

**Files:**
- Modify: `frontend/src/sheets.jsx`
- Create: `frontend/src/sheets.exercise-parity.test.jsx`

**Interfaces:**
- Consumes: `registerExerciseState(st)`, `effectiveCatalogue(st)`, `deletedEx`, and `exOverrides` from Task 1.
- Produces: `customExSheet(existing, onDone, prefill)` that edits either a custom or a resolved built-in, and a shared hide/delete handler.

- [ ] **Step 1: Write UI tests for parity and validation**

```jsx
it('offers Edit and Hide for a built-in detail sheet', () => {
  exerciseDetailSheet(EXDB[0])
  const host = renderTop()
  expect(host.textContent).toContain('Edit')
  expect(host.textContent).toContain('Hide')
})

it('does not retain a built-in override when every field equals its catalogue row', () => {
  customExSheet(EXDB[0])
  const host = renderTop()
  act(() => [...host.querySelectorAll('button')].find(b => b.textContent === 'Save').click())
  expect(S().exOverrides?.[EXDB[0].id]).toBeUndefined()
})

it('stores only trimmed non-empty built-in steps', () => {
  customExSheet(EXDB[0])
  const host = renderTop()
  act(() => [...host.querySelectorAll('button')].find(b => b.textContent === 'Add step').click())
  act(() => { host.querySelector('[aria-label="Step 1"]').value = ' Set up '; host.querySelector('[aria-label="Step 1"]').dispatchEvent(new Event('input', { bubbles: true })) })
  act(() => [...host.querySelectorAll('button')].find(b => b.textContent === 'Save').click())
  expect(S().exOverrides[EXDB[0].id].st).toEqual(['Set up'])
})
```

Use the existing `sheets.favourites.test.jsx` sheet mounting/store reset pattern. Exercise the active-workout guard by placing `{ id: EXDB[0].id }` in `S().active.entries` and asserting that no confirm sheet opens.

- [ ] **Step 2: Run the new test file to verify it fails**

Run: `cd frontend && npm test -- src/sheets.exercise-parity.test.jsx`

Expected: FAIL because the detail actions, step inputs, and built-in save path do not exist.

- [ ] **Step 3: Extend `CustomExForm` instead of creating another form**

```js
const [steps, setSteps] = useState(() => [...(existing?.st || [])])
const cleanSteps = steps.map(s => s.trim()).filter(Boolean)
const media = (value, key) => /^https?:\/\//.test(value || '') ? { [key]: value } : {}
```

Keep its name/body part/equipment/muscle controls. Add add/edit/remove and up/down controls for `steps`, an `img`/`gif` URL selector/input, and save-time trimming. For customs, write the complete existing custom shape plus `st`, `img`, and `gif`. For built-ins, compare the editable fields (`n`, `bp`, `eq`, `tg`, `sm`, `muscleGroups`, `primaries`, `secondaries`, `st`, `desc`, `img`, `gif`) with the pristine catalogue row and retain only differences in `s.exOverrides[id]`; delete the map key when no differences remain.

Generalize `deleteCustomEx` by branching only at catalogue removal: customs keep history snapshotting then leave `customEx`; built-ins add the id to `deletedEx` and skip history mutation because the pristine catalogue still supports the fallback. Both paths retain the current active-workout guard, routine/superset cleanup, `exWeights`, and favourites cleanup. Remove both `ex.custom` gates in `ExerciseDetail` and `ExConfig`; label the built-in destructive action “Hide” and its confirmation accordingly. Render custom `st` through the existing `instrFor`/How-to rendering path.

- [ ] **Step 4: Run parity and regression tests**

Run: `cd frontend && npm test -- src/sheets.exercise-parity.test.jsx src/sheets.favourites.test.jsx && npm test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/sheets.jsx frontend/src/sheets.exercise-parity.test.jsx
git commit -m "feat: unify custom and built-in exercise editing"
```

### Task 3: Expose and restore hidden exercises from Settings

**Files:**
- Modify: `frontend/src/views/Settings.jsx`
- Create: `frontend/src/views/Settings.hidden-exercises.test.jsx`

**Interfaces:**
- Consumes: `S.deletedEx`, `EXDB`, `effectiveCatalogue(S)`, and the existing `update`/sheet UI patterns.
- Produces: a Settings sheet listing hidden built-ins with per-item Restore and Restore all actions.

- [ ] **Step 1: Write the Settings behavior test**

```jsx
it('lists hidden built-ins and restores one or all without touching custom exercises', () => {
  mocks.S = { ...mocks.S, customEx: [{ id: 'c1', n: 'Custom', custom: true }], deletedEx: [EXDB[0].id, EXDB[1].id] }
  mount()
  act(() => [...host.querySelectorAll('.lrow')].find(r => r.textContent.includes('Manage hidden exercises')).click())
  const sheet = renderTop()
  act(() => [...sheet.querySelectorAll('button')].find(b => b.textContent === 'Restore' && b.closest('.item').textContent.includes(EXDB[0].n)).click())
  expect(mocks.S.deletedEx).toEqual([EXDB[1].id])
  act(() => [...sheet.querySelectorAll('button')].find(b => b.textContent === 'Restore all').click())
  expect(mocks.S.deletedEx).toEqual([])
  expect(mocks.S.customEx).toEqual([{ id: 'c1', n: 'Custom', custom: true }])
})
```

Mirror `Settings.reset.test.jsx` for Zustand and sheet mocks; assert the management row is absent or disabled when `deletedEx` is empty.

- [ ] **Step 2: Run the test file to verify it fails**

Run: `cd frontend && npm test -- src/views/Settings.hidden-exercises.test.jsx`

Expected: FAIL because Settings has no hidden-exercise management row or restore action.

- [ ] **Step 3: Add the smallest Settings sheet**

Add one Settings row that opens a sheet. Its list resolves each id against pristine `EXDB` so a stale id remains visible as its id, and its actions mutate only `s.deletedEx`:

```js
const restore = id => update(s => { s.deletedEx = (s.deletedEx || []).filter(x => x !== id) })
const restoreAll = () => update(s => { s.deletedEx = [] })
```

After either mutation, the normal store persistence/reindex path from Task 1 updates the library and picker. Do not add another persistence mechanism or duplicate catalogue state in Settings.

- [ ] **Step 4: Run final verification**

Run: `cd frontend && npm test -- src/views/Settings.hidden-exercises.test.jsx && npm test && npm run build`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/views/Settings.jsx frontend/src/views/Settings.hidden-exercises.test.jsx
git commit -m "feat: restore hidden exercises from settings"
```

## Plan Self-Review

- Spec coverage: Tasks 1–3 cover state compatibility, central resolution/index rebuilding, search/media, form parity, safe hide/delete, history behavior, library/picker filtering, and hidden-exercise restoration.
- No new dependency, database, migration, or upload system is planned.
- The main risk is the existing `EXIDX` module singleton; Task 1 makes every state replacement rebuild it, which avoids consumer-by-consumer filtering.
