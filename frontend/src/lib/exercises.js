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

// Custom (user-created) exercises live in synced state S.customEx (issue #11) and are
// merged into the id index here so every EXIDX[id] lookup keeps working unchanged.
let customIds = new Set()
const BUILTIN = new Set(CATALOGUE)
export function registerCustom(list) {
  customIds.forEach(id => {
    delete EXIDX[id]
    const builtIn = CATALOGUE.find(ex => ex.id === id)
    if (builtIn) EXIDX[id] = builtIn
  })
  const xs = (Array.isArray(list) ? list : []).filter(e => e && e.id != null)
  customIds = new Set(xs.map(e => e.id))
  xs.forEach(e => { EXIDX[e.id] = e })
}

// Whether an exercise is one of the user's own (#378, #358). Where it lives decides, not the
// `custom` flag alone: a plan import before 1.3.8 (a shared plan file, a plan from the AI coach)
// stored its exercises without the flag, and those were left with no Edit, no Delete and a
// broken thumbnail. A built-in catalogue entry is never custom, even if a custom one shadows its id.
export const isCustomEx = ex => !!ex && typeof ex === 'object' && !BUILTIN.has(ex) &&
  (ex.custom === true || customIds.has(ex.id))

// The stored list with the flag put back on every entry that lost it — the same array when
// nothing is missing, so a copy that is already right is never rewritten. The entry keeps its own
// `_ts`: the heal is no edit, and a newer stamp would let it win a merge over a real rename made
// on another device that has not healed yet.
export function healCustomEx(list) {
  if (!Array.isArray(list)) return list
  let changed = false
  const out = list.map(c => {
    if (!c || typeof c !== 'object' || c.custom === true) return c
    changed = true
    return { ...c, custom: true, ...(c.eq == null ? { eq: '' } : {}) }
  })
  return changed ? out : list
}
// Full searchable catalogue — customs first so your own exercises are easy to find.
export const allExercises = st => [...(st.customEx || []), ...CATALOGUE]

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
  const fields = [['n', 100], ['tg', 40], ['eq', 40], ['sm', 30], ['muscleGroups', 30], ['primaries', 30], ['secondaries', 30], ['desc', 10], ['cues', 10]]
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

// Built-in media tries the local img/ and gif/ directories first. The build's VITE_IMG_BASE
// and VITE_GIF_BASE stay available as fallbacks, with the original pinned CDN by default.
// `import.meta.env` is undefined in plain Node; the guard keeps this module loadable without Vite.
const ENV = import.meta.env || {}
const IMG_CDN_BASE = ENV.VITE_IMG_BASE || 'https://cdn.jsdelivr.net/gh/hasaneyldrm/exercises-dataset@7455efae41b330c265e7cd4b78dfa848e7ce5ebd/images/'
const GIF_CDN_BASE = ENV.VITE_GIF_BASE || 'https://cdn.jsdelivr.net/gh/hasaneyldrm/exercises-dataset@7455efae41b330c265e7cd4b78dfa848e7ce5ebd/videos/'
export const imgSrc = ex => 'img/' + ex.img
export const imgCdnSrc = ex => IMG_CDN_BASE + ex.img
export const gifSrc = ex => 'gif/' + ex.gif
export const gifCdnSrc = ex => GIF_CDN_BASE + ex.gif

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

// Equipment that is a load in its own right: a bar, a bell, a stack, a sled, a weight. A set on
// one of these logged at 0 kg is a number nobody typed in. The rest of the catalogue that is not
// bodyweight — an ab wheel, a stability ball, a bosu, a rope, a roller, the "assisted" straps —
// often has no load to enter at all, so 0 there is the honest number and progression moves the
// reps instead (lib/progression.js).
const LOADED_EQ = new Set(['barbell', 'ez barbell', 'olympic barbell', 'trap bar', 'dumbbell', 'kettlebell', 'cable', 'leverage machine', 'smith machine', 'sled machine', 'weighted'])
export const isLoadedEq = idOrEx =>
  LOADED_EQ.has((typeof idOrEx === 'string' ? EXIDX[idOrEx] : idOrEx)?.eq)

/* Assistance machines run the other way round: the stack carries part of your body weight, so
 * a smaller number is the harder set and the record (issue #232). Getting the set wrong is
 * worse than not having the feature — inverting a normal lift would hide real progress — so the
 * rule is deliberately narrow: the machine that takes load off you is the leverage machine whose
 * name says "assisted". That is eight exercises in the catalogue (assisted pull-up, chin-up,
 * chest dip, triceps dip and their variants) and nothing else.
 *
 * The name alone is not enough. Twenty-nine catalogue entries say "assisted": partner-assisted
 * stretches, a medicine-ball twist, band and bodyweight leg curls. On those the weight is
 * ordinary load — heavier is harder — and inverting them would be the same bug pointed the
 * other way. Equipment is what separates the two.
 *
 * `assisted: true` (or `false`) on a custom exercise or on a routine's config overrides the
 * rule in either direction, which is how anything the catalogue does not know gets marked.
 */
const ASSISTED_EQ = 'leverage machine'
const assistedName = n => /\bassist(ed)?\b/i.test(String(n || ''))

// The catalogue entry itself carries an `id`, so this never recurses through it — one lookup,
// then the shape is read directly.
const assistedShape = ex => (typeof ex?.assisted === 'boolean' ? ex.assisted : ex?.eq === ASSISTED_EQ && assistedName(ex?.n))

export function isAssisted(idOrEx) {
  if (!idOrEx) return false
  if (typeof idOrEx === 'string') return !!assistedShape(EXIDX[idOrEx])
  if (typeof idOrEx.assisted === 'boolean') return idOrEx.assisted
  if (typeof idOrEx.target?.assisted === 'boolean') return idOrEx.target.assisted
  const known = idOrEx.id ? EXIDX[idOrEx.id] : null
  return !!assistedShape(known || idOrEx)
}

/** The better of two loads for this exercise: less assistance, or more weight. */
export const betterWeight = (idOrEx, a, b) => (isAssisted(idOrEx) ? Math.min(a, b) : Math.max(a, b))

/** Is `w` a better load than `prev`? `prev` of 0 means nothing logged yet. */
export const beatsWeight = (idOrEx, w, prev) =>
  w > 0 && (prev <= 0 || (isAssisted(idOrEx) ? w < prev : w > prev))

// An id that resolves to nothing — a plan file built against a different exercise dataset,
// a custom exercise deleted on another device before the sync arrived — still has to
// render. A placeholder keeps it visible (and removable) instead of taking the whole view
// down on the first `ex.n`.
export const exOr = id => EXIDX[id] ||
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
//
// Each entry keeps the full corpus for substring matching and, separately, the words of the
// name (English and localized) that the typo tolerance below is allowed to compare against.
const corpusCache = new WeakMap()

function corpusOf(e) {
  const v = getVersion()
  const hit = corpusCache.get(e)
  if (hit && hit.v === v) return hit
  const sm = Array.isArray(e?.sm) ? e.sm : []
  const name = normalizeStr(exerciseNameSearchText(e))
  const s = normalizeStr([
    name,
    e?.tg || '', t(e?.tg || ''),
    e?.eq || '', t(e?.eq || ''),
    e?.bp || '', t(e?.bp || ''),
    ...sm, ...sm.map(m => t(m)),
    e?.desc || ''
  ].join(' '))
  // The name run together, so "benchpress" or "bench-press" finds "bench press" the way "pullup"
  // already found the names that spell it that way (QA 1.3.9). Name only: joined across fields,
  // a body part and an equipment word would start matching as one.
  const entry = { v, s, joined: joinWords(name), nameWords: name.split(/\s+/).filter(Boolean) }
  corpusCache.set(e, entry)
  return entry
}

// Allow one missing, extra or substituted character, or an adjacent transposition, in long
// query tokens. Short tokens stay exact/substring-only: words such as "row" and "curl" are too
// common for fuzzy matching to be useful.
//
// Only the exercise's own name words are ever compared this way. Body part, target and
// equipment words are shared by a whole slice of the catalogue, so one accidental neighbour
// ("wrist" ~ "waist", "power" ~ "lower arms", "drucken" ~ "rucken") would list hundreds of
// unrelated exercises ahead of the real hits (QA C26).
function nearWord(a, b) {
  if (a.length < 5 || Math.abs(a.length - b.length) > 1) return false
  let i = 0
  while (i < a.length && a[i] === b[i]) i++
  if (i === a.length) return b.length - i <= 1
  if (a.length === b.length) {
    return a.slice(i + 1) === b.slice(i + 1) ||
      (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2))
  }
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1)
}

const queryTokens = query => normalizeStr(query || '').split(/\s+/).filter(Boolean)
const joinWords = str => str.replace(/[\s\-‐-―]+/g, '')

// A token appears in the corpus as typed, or in the name with its spaces and hyphens left out.
const hits = (entry, tok) => entry.s.includes(tok) || (tok.length >= 4 && entry.joined.includes(joinWords(tok)))

// Every token has to appear in the corpus; a token listed in `fuzzy` may instead be one edit
// away from a name word.
const matchTokens = (e, tokens, fuzzy) => {
  const entry = corpusOf(e)
  return tokens.every(tok => hits(entry, tok) || (fuzzy.has(tok) && entry.nameWords.some(word => nearWord(tok, word))))
}

// Single-exercise check, used where the list is filtered one option at a time (the exercise
// progress picker). Every token may fall back to the typo tolerance; lists go through
// searchExercises below, which knows whether a token needs it at all.
export function matchExercise(e, query) {
  const tokens = queryTokens(query)
  if (!tokens.length) return true
  if (!e || typeof e !== 'object') return false
  return matchTokens(e, tokens, new Set(tokens))
}

// Search a list, exact hits first: a token that appears literally in at least one exercise is
// taken at its word for the whole list, and only a token with no exact hit anywhere ("bnech",
// "dumbell", "wirst") is allowed the typo tolerance. Otherwise a correctly spelled query such
// as "squat" or "clean" would also drag in "squad" and "lean", and since the callers keep
// catalogue order those strays would land ahead of the real matches (QA C26).
export function searchExercises(list, query) {
  const tokens = queryTokens(query)
  if (!tokens.length) return list
  const fuzzy = new Set(tokens.filter(tok => !list.some(e => hits(corpusOf(e), tok))))
  return list.filter(e => matchTokens(e, tokens, fuzzy))
}
