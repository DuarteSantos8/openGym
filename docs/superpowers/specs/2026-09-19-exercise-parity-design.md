# Full parity between default and custom exercises — design

**Status:** draft — review required
**Date:** 2026-09-19
**Issue:** DuarteSantos8/openGym#199
**Scope:** one PR on `giulioleuci/openGym-contrib`, branch `feat/parity-exercises-issue-199`, base `main`.

## Goal

Every exercise in the runtime catalogue — built-in or custom — exposes the same
parameter structure and supports edit/delete/hide. Built-in (default) exercises
become user-overridable and hideable without copying the ~1,324-entry catalogue
into user state; custom exercises gain the structured fields built-ins already
have (`st` steps, media reference) and are edited/deleted through the same UI.

## Existing codebase facts

- `frontend/src/lib/exercises.js` builds `CATALOGUE = EXDB.map(catalogueExercise)`,
  then `EXIDX` at module load. `catalogueExercise()` already applies the
  owner-approved muscle-metadata overlay without mutating `EXDB` — the precedent
  for the user-override overlay in this design.
- `registerCustom(list)` merges `S.customEx` into `EXIDX` and is called from
  `useStore.js` (init and restore paths). `allExercises(st)` returns
  `[...(st.customEx || []), ...CATALOGUE]`.
- `searchScore(exercise, query)` weights fields (`n` 100, `tg`/`eq` 40, `sm`/
  `muscleGroups`/`primaries`/`secondaries` 30, `desc`/`cues` 10) and requires every
  query token to match. `matchExercise` builds a per-exercise search corpus and
  caches it in a `WeakMap` keyed by i18n version.
- `imgSrc = IMG_BASE + ex.img`, `gifSrc = GIF_BASE + ex.gif`; custom exercises
  currently have no media and render a static fallback icon.
- `store/useStore.js` `DEF` holds `customEx: []` among many fields. Persistence is
  a debounced `pushState` (server) plus `localStorage gym_state_v1`, loaded always
  via `Object.assign(clone(DEF), raw)` — new `DEF` fields are therefore
  backward-compatible merge-safely.
- `sheets.jsx` gates Edit/Delete behind `{ex.custom && ...}` in two places
  (detail sheet around line 665, and line 1372). `CustomExForm` (line 765) is the
  single create/edit form for customs: name, body part, equipment chips,
  primary/secondary `MultiSelectRow`, single `desc` textarea. `deleteCustomEx`
  (line 839) is the canonical safe deletion: guards an active workout, snapshots
  muscle metadata into historical `workouts` entries, removes the exercise from
  `routines` (with superset cleanup), `exWeights`, and `favEx`.
- There is no linter/formatter configured; `frontend` tests run with vitest
  (`npm test`). `docs/superpowers/specs/` is the established spec location.

## Decision 1 — central resolver (Approach A)

Introduce a single resolution point in `exercises.js` that folds user state over
the pristine catalogue:

```js
export const effectiveCatalogue = st => CATALOGUE.map(e => ({ ...e, ...(st?.exOverrides?.[e.id] || {}) }))
export const isHidden = (id, st) => (st?.deletedEx || []).includes(id)
export const allows = (e, st) => !isHidden(e.id, st)
```

- `EXIDX`, `allExercises`, library, pickers and search resolve through the
  effective catalogue; `CATALOGUE`/`EXDB` stay pristine for export/print/import
  (same rule as today's `catalogueExercise` comment).
- Deleted built-ins are excluded where they currently appear: `allExercises(st)`
  (library, pickers), library search, `EXIDX` lookups used by pickers.
  Historical `workouts` still resolve via `exOr(id)` fallback → placeholder, so a
  hidden exercise's logged sets keep rendering.
- `registerCustom` is extended (or a sibling `registerExerciseState(st)`) to also
  rebuild `EXIDX` with overrides applied and hidden ids removed — the same
  lifecycle points where `registerCustom` is already called, plus after any
  save/delete/restore action.

**Rejected (B):** per-consumer filtering. An exercise hidden in one picker but
searchable in another is exactly the bug this issue reports; a single resolver
has no such drift.

## Decision 2 — state shape

Two new `DEF` fields in `useStore.js`:

```js
exOverrides: {},   // id -> partial built-in override  { n?, bp?, eq?, tg?, sm?, st?, desc?, img?, gif? }
deletedEx: [],     // hidden built-in exercise ids
```

- `isModified` is **derived**, never stored: `id in st.exOverrides`.
- Custom exercises keep living in `customEx` unchanged; deleting a custom stays a
  permanent removal from `customEx` (today's `deleteCustomEx`).
- Deleting a built-in appends its id to `deletedEx` and applies the same
  safe-deletion steps as `deleteCustomEx` (routines cleanup, `exWeights`,
  `favEx`; historical workouts keep their `exerciseMuscleSnapshot`, so the
  generic `exOr` fallback in real views is enough — no snapshot stamping needed
  for built-ins because `EXDB` still contains them).
- Restoring a built-in removes the id from `deletedEx`; "Reset to default"
  removes the id from `exOverrides`.
- No migration: old profiles load via the existing `Object.assign(clone(DEF), raw)`;
  new fields default to safe values. `pushState`/`restoredStateFor`/backup
  export/import carry them automatically.

## Decision 3 — media

Custom exercises may hold a full URL in `img`/`gif`. Extend `imgSrc`/`gifSrc`:

```js
export const imgSrc = ex => /^https?:\/\//.test(ex?.img || '') ? ex.img : IMG_BASE + ex.img
export const gifSrc = ex => /^https?:\/\//.test(ex?.gif || '') ? ex.gif : GIF_BASE + ex.gif
```

Everything that renders `imgSrc`/`gifSrc` (detail sheet, library, pickers,
`Media.jsx`) picks this up with no per-site changes. No new dependency.

## Decision 4 — unified editor sheet

Keep `CustomExForm` as the single sheet, extended for both kinds of exercise:

- **Name / body part / equipment** — as today (chips + multi-selects).
- **Steps editor (`st`)** — add, reorder (up/down), edit, delete individual steps
  (array of strings; the "How to" section of the detail sheet renders it for both
  built-ins and customs).
- **`desc`** — existing textarea (kept for customs; used as an override field for
  built-ins).
- **Media** — optional URL input for `img`/`gif` (single field, `img` or `gif` on
  a toggle; defaults to none for customs).
- **Actions by kind:**
  - new custom → Create (as today, `id = 'c' + uid()`, `custom: true`)
  - existing custom → Save (mutates `customEx` entry) + Delete (`deleteCustomEx`)
  - built-in → Save (writes `exOverrides[id]`, stores only user-touched fields,
    leaves rest of the field on `EXDB`), Delete/Hide
    (`deletedEx.push(id)` + safe cleanup), Reset to default (only when
    `isModified`; removes `exOverrides[id]`).

Saving a built-in writes `{ ...exOverrides[id], <touched fields> }: UserPassed`
— the stub overlay is deleted when every field equals the catalogue value, so an
"unmodified" exercise leaves no footprint.

## Decision 5 — UI parity

- Remove the two `{ex.custom && ...}` gates in `sheets.jsx` so the detail sheet
  offers Edit/Delete for every exercise. Built-in Delete opens a confirm dialog
  that says the exercise is hidden from the library, not permanently removed.
- Detail sheet renders "How to" steps (`st`) and media for custom exercises when
  present (same markup as built-ins); graceful fallback remains when absent.
- Library view resolves through `allExercises` (which already applies
  hydrate-overlays + hide filter) and search weights add a `st` field entry.
- Settings gains a "Manage hidden exercises" screen: list of `deletedEx` built-ins
  with per-item and bulk Restore.

## Search parity

`searchScore` field list gains `['st', 20]` (steps are meaningful text, between
name and description weight). No other search behavior changes; the per-exercise
corpus in `matchExercise` already includes `desc` — add `st` there too via
overrides in the effective catalogue (a custom with `st` gets it into the corpus
through the existing cache keyed by object identity).

## Error handling / edge cases

- Deleting a built-in while it is in the active workout: reuse the existing guard
  (`Finish your current workout first`).
- Override payloads are validated by the form (name/body-part/equipment required,
  1,000-char cap on `desc`, steps each non-empty trimmed) before writing to
  `exOverrides`.
- A hidden exercise referenced by a routine/plan renders through `exOr` (as any
  unknown id does) and stays removable from the routine.
- Concurrent sync / restore always rebuilds `EXIDX` from `st`, so overrides and
  hidden ids converge to the synced copy.

## Testing

`frontend/src/lib/exercises.test.js` additions:

1. Overlay resolution: `effectiveCatalogue` applies `exOverrides` on a built-in.
2. Hide filter: `allExercises` / library resolution drop `deletedEx` ids.
3. Reset: removing `exOverrides[id]` restores pristine catalogue data.
4. Parity: a custom payload and a built-in catalogue object expose the same keys.
5. History preservation: deleting a built-in leaves historical workout entries
   intact (entries keep rendering via `exOr`).
6. `imgSrc`/`gifSrc`: absolute URL passes through, bare filename is prefixed.

Sparse sheet test if the build/CI gate needs one (`sheets.test.jsx` or a new
`sheets.parity.test.jsx`) for the edit/delete buttons on non-custom exercises.

## Explicitly out of scope

- Real "database" engine (roadmap v1.4.0) — resolution remains in-memory.
- Per-exercise image upload to a server; only URL references.
- Editing built-in muscle metadata structure beyond the fields above.
- Deleting/hiding exercises server-side or per-account admin.

## PR shape

Single commit series on `feat/parity-exercises-issue-199`: store fields →
resolver + helpers + tests → editor sheet + sheets UI → library/settings →
polish. Commits rebased and force-pushed to the fork, PR base `main` (this fork).