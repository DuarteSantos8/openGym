import { EXDB } from './exercises-data.js'
import { USER_EXERCISE_MUSCLE_OVERRIDES, exerciseMuscleMetadataFor } from './exercise-muscle-batch-1.js'
import { t, getVersion, exerciseNameSearchText } from './i18n-core.js'

export { EXDB }

// The generated dataset remains the compatibility/raw export. The runtime catalogue applies
// owner-approved muscle metadata as a narrow overlay, so imports and historical tests that rely
// on the upstream shape keep working while EXIDX and pickers see the corrected model.
const catalogueExercise = ex => {
  const metadata = exerciseMuscleMetadataFor(ex?.id)
  if (!Object.keys(metadata).length) return ex
  const out = { ...ex, ...metadata }
  const user = USER_EXERCISE_MUSCLE_OVERRIDES[ex?.id] || {}
  // A future dataset row may carry explicit arrays of its own; preserve those over generated
  // defaults unless the owner has deliberately supplied a correction for the same field.
  for (const key of ['primaries', 'secondaries']) {
    if (Object.prototype.hasOwnProperty.call(ex, key) && !Object.prototype.hasOwnProperty.call(user, key)) out[key] = ex[key]
  }
  if (Array.isArray(out.primaries)) out.primaries = [...out.primaries]
  if (Array.isArray(out.secondaries)) out.secondaries = [...out.secondaries]
  return out
}

export const CATALOGUE = EXDB.map(catalogueExercise)

// The generated dataset already supplies secondary muscles for most exercises. Keep the
// handful of conservative catalogue additions that are useful to the muscle map here so a
// dataset refresh does not erase them. Values follow the dataset's existing alias vocabulary.
const SECONDARY_ADDITIONS = {
  '0027': ['rear deltoids'], // barbell bent over row
  '0293': ['rear deltoids'], // dumbbell bent over row
  '0499': ['rear deltoids'], // inverted row
  '0861': ['rear deltoids'], // cable seated row
}

// Secondary muscles for an exercise, with the small conservative additions applied as an
// overlay. The raw dataset is never mutated - consumers that want the pristine catalogue
// (export, print, import) keep reading EXDB untouched, while the muscle map sees the
// enriched list. Values follow the dataset's existing alias vocabulary.
export const smOf = ex => {
  const base = Array.isArray(ex?.sm) ? ex.sm : (ex?.sm ? [ex.sm] : [])
  return [...new Set([...base, ...(SECONDARY_ADDITIONS[ex?.id] || [])])]
}

export const EXIDX = {}
CATALOGUE.forEach(e => { EXIDX[e.id] = e })
export const BODYPARTS = [...new Set(CATALOGUE.map(e => e.bp))].sort()

// Equipment options present in a given list of exercises, most common first (issue #6).
// Deriving them from the *already filtered* list keeps the chip row short and means
// every body-part × equipment combination on screen has results behind it.
export function equipmentOf(list) {
  const c = {}
  list.forEach(e => { if (e.eq) c[e.eq] = (c[e.eq] || 0) + 1 })
  return Object.keys(c).sort((a, b) => c[b] - c[a] || (a < b ? -1 : 1))
}

// The built-in catalogue overlaid with user overrides (renamed/edited fields) — CATALOGUE/EXDB
// stay pristine (export/print/import keep reading them untouched), while everything that lists
// or looks up an exercise resolves through this so an edit shows up everywhere at once.
// `_ov` carries the raw override object alongside the merged fields — it's the marker i18n-core
// needs to tell "this field is the user's deliberate edit" apart from "this field is just the
// pristine catalogue's own (always-present, English) value", since both look identical once
// merged onto the exercise object (see instrFor/exerciseNameFor).
export const effectiveCatalogue = st => CATALOGUE.map(e => {
  const ov = st?.exOverrides?.[e.id]
  return ov ? { ...e, ...ov, _ov: ov } : e
})
export const isHidden = (id, st) => (st?.deletedEx || []).includes(id)
export const allows = (ex, st) => !isHidden(ex.id, st)
// Full searchable catalogue — customs first so your own exercises are easy to find; hidden
// built-ins are dropped everywhere (library, pickers, search) so there's one place that decides
// what's visible, not one gate per screen.
export const allExercises = st => [...(st.customEx || []), ...effectiveCatalogue(st).filter(ex => allows(ex, st))]

// Custom (user-created) exercises and built-in overrides/hides both live in synced state (issue
// #11, exercise parity) and are folded into the id index here so every EXIDX[id] lookup keeps
// resolving to the effective exercise. Replaces the old customEx-only registerCustom: called
// with the whole state object after every persisted, initialized, or restored S so overrides and
// hidden ids converge into the index immediately.
let customIds = []
export function registerExerciseState(st) {
  // Drop ids from a custom exercise that was renamed/removed since the last call, then reset
  // every built-in id back to pristine CATALOGUE and clear hidden ids entirely, so a removed
  // override or restored hide converges even if this call never touched that id before.
  customIds.forEach(id => { delete EXIDX[id] })
  CATALOGUE.forEach(e => { EXIDX[e.id] = e })
  // Hidden built-ins (deletedEx) are deliberately NOT removed from EXIDX: hiding only affects
  // library/picker/search listing (decided solely by allExercises' allows() filter below, which
  // never consults EXIDX membership) — historical workouts that logged a since-hidden exercise
  // still need EXIDX[id] to resolve to the real exercise for name/type/recovery/stats lookups.
  // Overlay overrides on the (still pristine-keyed) built-ins left standing. A custom exercise
  // is applied after, last write wins, so a custom id that happens to collide with a built-in
  // id (only ever done in tests exercising this precedence) still takes over the slot.
  effectiveCatalogue(st || {}).forEach(e => { if (EXIDX[e.id] !== undefined) EXIDX[e.id] = e })
  const customList = st?.customEx || []
  customIds = customList.map(e => e.id)
  customList.forEach(e => { EXIDX[e.id] = e })
}

// Back-compat shim for existing test suites written against the old customEx-only API
// (registerCustom(list)) — not part of this task's interface, kept so unrelated specs that
// stub a custom exercise directly don't need touching.
export const registerCustom = list => registerExerciseState({ customEx: list })

function searchableText(value) {
  if (Array.isArray(value)) return value.map(searchableText).join(' ')
  if (value == null) return ''
  try { return String(value) } catch { return '' }
}

/** Case-insensitive search over built-in and legacy custom exercise metadata. */
function isSubsequence(needle, hay) {
  let i = 0
  for (const ch of hay) {
    if (ch === needle[i]) i++
    if (i === needle.length) return true
  }
  return false
}

// Fuzzy match score for one exercise against a query. Best hits: exact field match, then
// field prefix, then word-boundary starts, then substrings (closer to the start scores
// better), and finally typo-tolerant ordered subsequences. Fields are weighted - the name
// dominates, target/equipment matter, muscles and description are supporting evidence.
// 0 means no match, so matchesExerciseSearch stays a boolean filter while the picker can
// rank results by score.
export function searchScore(exercise, query) {
  const needle = searchableText(query).toLowerCase().trim()
  if (!needle) return 1
  const source = exercise && typeof exercise === 'object' ? exercise : {}
  const fields = [['n', 100], ['tg', 40], ['eq', 40], ['sm', 30], ['muscleGroups', 30], ['primaries', 30], ['secondaries', 30], ['desc', 10], ['cues', 10], ['st', 20]]
  // Token-level matching: every query word must match somewhere (any order), so
  // "press bench" finds "Bench Press". The score sums each token's best hit.
  const tokens = needle.split(/[^a-z0-9]+/).filter(Boolean)
  if (!tokens.length) return 0
  let total = 0
  for (const token of tokens) {
    let best = 0
    for (const [field, weight] of fields) {
      const hay = searchableText(source[field]).toLowerCase()
      if (!hay) continue
      if (hay === token) best = Math.max(best, weight * 4)
      else if (hay.startsWith(token)) best = Math.max(best, weight * 3)
      const idx = hay.indexOf(token)
      if (idx > 0) best = Math.max(best, weight * 2 - Math.min(idx, 20) * 0.5)
      if (hay.split(/[^a-z0-9]+/).some(w => w.startsWith(token))) best = Math.max(best, weight * 2.5)
      if (isSubsequence(token, hay)) best = Math.max(best, weight + Math.max(0, 10 - (hay.length - token.length)))
    }
    if (!best) return 0 // every token must match
    total += best
  }
  return total
}

export function matchesExerciseSearch(exercise, query) {
  return searchScore(exercise, query) > 0
}

// Media normally sits next to the app (img/ and gif/, mounted into the web container).
// A build can point them somewhere else — the demo build pulls them off a CDN instead of
// shipping ~140 MB of images into the deployment. `import.meta.env` is undefined in plain
// Node; the guard keeps this module loadable without Vite.
const ENV = import.meta.env || {}
const IMG_BASE = ENV.VITE_IMG_BASE || 'img/'
const GIF_BASE = ENV.VITE_GIF_BASE || 'gif/'
// Custom exercises (and built-in overrides) may hold a full URL instead of a dataset-relative
// filename — pass those through unchanged, otherwise prefix with the existing base as before.
const isAbsoluteUrl = s => /^https?:\/\//.test(s || '')
export const imgSrc = ex => isAbsoluteUrl(ex?.img) ? ex.img : IMG_BASE + ex?.img
export const gifSrc = ex => isAbsoluteUrl(ex?.gif) ? ex.gif : GIF_BASE + ex?.gif

// Cardio exercises log time + speed instead of weight × reps.
export const isCardio = idOrEx => (typeof idOrEx === 'string' ? EXIDX[idOrEx] : idOrEx)?.bp === 'cardio'

// Exercises the dataset already knows carry no external load (issue #32) — a quarter of the
// catalogue. This seeds the `bw` flag on a fresh config so a push-up never asks for a weight
// nobody was going to enter. It is only the default: the flag lives on the config, so a dip
// done with a belt can turn it off and a custom exercise can turn it on.
// Equipment with no meaningful load in kg: your own body, or a band whose "weight" is a colour.
// Both default to the bodyweight model (one reps stepper, progression in reps then sets); the
// per-exercise Bodyweight switch still overrides it either way (issue #39).
const BODYWEIGHT_EQ = new Set(['body weight', 'band', 'resistance band'])
export const isBodyweightEq = idOrEx =>
  BODYWEIGHT_EQ.has((typeof idOrEx === 'string' ? EXIDX[idOrEx] : idOrEx)?.eq)

// An id that resolves to nothing — a plan file built against a different exercise dataset,
// a custom exercise deleted on another device before the sync arrived — still has to
// render. A placeholder keeps it visible (and removable) instead of taking the whole view
// down on the first `ex.n`.
// A hidden built-in is deliberately absent from EXIDX (registerExerciseState drops every
// `deletedEx` id so it disappears from the library/pickers/search), but its pristine row is
// still sitting in CATALOGUE untouched — historical workouts that logged it should keep
// showing its real name, not fall all the way through to the placeholder.
export const exOr = id => EXIDX[id] || CATALOGUE.find(e => e.id === id) ||
  { id, n: t('Unknown exercise'), bp: '', tg: '', eq: '', sm: [], st: [], missing: true }

// Normalizes text by lowercasing and stripping diacritics/accents (e.g. "elevação" -> "elevacao")
export const normalizeStr = s => (s || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()

// Multi-token, accent-insensitive and multilingual exercise search.
// Matches when all whitespace-separated words in the query appear anywhere in the exercise's
// name, equipment, target muscle, body part (both in English and translated to active language),
// secondary muscles or description.
//
// The haystack is built once per exercise and cached: NFD-normalising ~1300 catalogue entries
// on every keystroke costs ~8ms on a desktop and several times that on a phone. The cache key
// is the i18n version (bumped by every setLang), so switching language rebuilds the translated
// terms. Custom exercises are re-cached automatically — the store clones state on update, so an
// edited exercise arrives as a new object the WeakMap has never seen.
const corpusCache = new WeakMap()

function corpusOf(e) {
  const v = getVersion()
  const hit = corpusCache.get(e)
  if (hit && hit.v === v) return hit.s
  const sm = Array.isArray(e?.sm) ? e.sm : []
  const s = normalizeStr([
    exerciseNameSearchText(e),
    e?.tg || '', t(e?.tg || ''),
    e?.eq || '', t(e?.eq || ''),
    e?.bp || '', t(e?.bp || ''),
    ...sm, ...sm.map(m => t(m)),
    e?.desc || '',
    Array.isArray(e?.st) ? e.st.join(' ') : ''
  ].join(' '))
  corpusCache.set(e, { v, s })
  return s
}

export function matchExercise(e, query) {
  if (!query) return true
  const tokens = normalizeStr(query).split(/\s+/).filter(Boolean)
  if (!tokens.length) return true
  if (!e || typeof e !== 'object') return false
  const corpus = corpusOf(e)
  return tokens.every(tok => corpus.includes(tok))
}
