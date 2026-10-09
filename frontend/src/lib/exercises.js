import { EXDB, EXALIAS } from './exercises-data.js'
import MUSCLE_MAP from './exercise-muscle-map.json' with { type: 'json' }
import V13_IDS from './catalogue-v13-ids.json' with { type: 'json' }
import { t, getVersion, exerciseNameSearchText } from './i18n-core.js'

export { EXDB }

// EXDB carries each exercise as the catalogue describes it in words (target, secondary muscles).
// Where someone has drawn the muscles more precisely (catalogue "muscleMap": the compound lifts,
// machines and Olympic lifts, ExRx-informed and owner-approved), that layer is applied here, so
// the pickers and every muscle map see the corrected model while EXDB stays the plain list.
const catalogueExercise = ex => {
  const metadata = MUSCLE_MAP[ex?.id]
  if (!metadata) return ex
  const out = { ...ex, ...metadata }
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
// The id of a drawing that is no exercise of its own (the female figure of a male exercise) looks
// up the exercise it draws. Never stored by the app, but a plan file or an import may carry one.
// Not enumerable, so anything that walks the index still sees every exercise once.
for (const [id, to] of Object.entries(EXALIAS)) {
  if (EXIDX[to]) Object.defineProperty(EXIDX, id, { value: EXIDX[to], enumerable: false, configurable: true })
}
// The exercise a drawing's id stands for; any other id as it is. For ids on their way in (a plan
// file, an import, the Coach's output), so the app goes on storing only exercise ids. An id
// already in state is left alone: rewriting it would move history behind the user's back.
export const canonicalExId = id => (typeof id === 'string' && Object.hasOwn(EXALIAS, id) && EXIDX[EXALIAS[id]] ? EXALIAS[id] : id)
export const BODYPARTS = [...new Set(CATALOGUE.map(e => e.bp))].sort()

// Equipment options present in a given list of exercises, most common first (issue #6).
// Deriving them from the *already filtered* list keeps the chip row short and means
// every body-part × equipment combination on screen has results behind it.
export function equipmentOf(list) {
  const c = {}
  list.forEach(e => { if (e.eq) c[e.eq] = (c[e.eq] || 0) + 1 })
  return Object.keys(c).sort((a, b) => c[b] - c[a] || (a < b ? -1 : 1))
}

// Kinds of exercise (catalogue "category") present in a list, in a fixed order that reads from
// lifting to everything around it. Custom exercises carry none and only show under "Any type".
export const CATEGORIES = ['strength', 'calisthenics', 'olympic', 'plyometrics', 'isometric', 'cardio', 'stretching', 'mobility', 'yoga', 'pilates', 'combat', 'rehab']
export function categoriesOf(list) {
  const have = new Set(list.map(e => e.cat).filter(Boolean))
  return CATEGORIES.filter(c => have.has(c))
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
export const allExercises = st => [...(st.customEx || []).filter(e => !e.serverRetired), ...CATALOGUE]

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

// Media normally sits next to the app (img/ and gif/, mounted into the web container).
// A build can point them somewhere else — the demo build pulls them off a CDN instead of
// shipping ~140 MB of images into the deployment. `import.meta.env` is undefined in plain
// Node; the guard keeps this module loadable without Vite.
const ENV = import.meta.env || {}
// Under their own folder since v1.4.0: a docker-compose.yml from before then still mounts the old
// dataset's media over img/ and gif/, and would hide the catalogue's files if they lived there.
const IMG_BASE = ENV.VITE_IMG_BASE || 'exercise-media/still/'
const GIF_BASE = ENV.VITE_GIF_BASE || 'exercise-media/clip/'
// About 940 exercises are drawn twice, on a male and on a female figure: `fv` names the female
// drawing of a male exercise, `mv` the male drawing of a female one. Which figure shows is a
// setting (figureOf); the exercise, its id and everything logged against it stay the same either
// way, so switching back and forth is only ever a different picture. An exercise drawn once shows
// that drawing whatever the setting.
export const figureOf = S => (S?.exFigure === 'female' || S?.exFigure === 'male')
  ? S.exFigure
  : (S?.body === 'female' ? 'female' : 'male')
const drawing = (ex, figure) => (figure === 'female' ? ex.fv : figure === 'male' ? ex.mv : null) || null
export const imgSrc = (ex, figure) => IMG_BASE + (drawing(ex, figure) ? drawing(ex, figure) + '.webp' : ex.img)
export const gifSrc = (ex, figure) => GIF_BASE + (drawing(ex, figure) ? drawing(ex, figure) + '.mp4' : ex.gif)
// The catalogue's animations are short MP4 loops; a fork's or an older build's may still be GIFs.
export const isVideoSrc = src => /\.(mp4|webm)(\?|$)/i.test(src || '')

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
const LOADED_EQ = new Set(['barbell', 'ez barbell', 'olympic barbell', 'trap bar', 'dumbbell', 'kettlebell', 'clubbell', 'macebell', 'cable', 'leverage machine', 'smith machine', 'sled machine', 'weighted'])
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

// Body parts where a 5 kg jump is normal rather than brutal.
const HEAVY_BP = ['upper legs', 'lower legs', 'back', 'hips', 'glutes']

// Default load step. Lower-body lifts take the bigger jump — that is the "lift-specific
// increment" a linear program lives on; an exercise can override it with cfg.inc.
// (progression.js re-exports this; it lives here so history.js can reach it without a cycle.)
export function defaultIncrement(exId, unit) {
  const ex = EXIDX[exId]
  const heavy = ex && HEAVY_BP.includes(ex.bp)
  if (unit === 'lb') return heavy ? 10 : 5
  return heavy ? 5 : 2.5
}

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
// Every distinct word of every name the search has seen (a few thousand for the whole catalogue).
const VOCAB = new Set()

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
  // The joined form only counts from the start of a name word, or "thigh" would find "sumo
  // deadlift high pull" through "deadlifthighpull".
  const entry = { v, s, name, ...joinedOf(name), nameWords: name.split(/[\s\-‐-―()/,]+/).filter(Boolean) }
  for (const w of entry.nameWords) VOCAB.add(w)
  corpusCache.set(e, entry)
  return entry
}

// How many single-character edits (insert, delete, substitute, swap two neighbours) apart two
// words are, or `max + 1` as soon as it is clear they are further apart than `max`.
function editDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev2 = null, prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1)
      cur.push(v)
      if (v < rowMin) rowMin = v
    }
    if (rowMin > max) return max + 1
    prev2 = prev
    prev = cur
  }
  return prev[b.length]
}

// Typos allowed in a query word against a name word: none below four letters ("row" and "curl"
// are too common for a neighbour to mean anything), one up to six, two from seven.
const typosFor = word => (word.length < 4 ? 0 : word.length < 7 ? 1 : 2)

// Allow typos (typosFor) in a query token against one name word, or against its first letters
// once the token is long enough to be a word in progress ("dumbel" for "dumbbell").
//
// Only the exercise's own name words are ever compared this way. Body part, target and
// equipment words are shared by a whole slice of the catalogue, so one accidental neighbour
// ("wrist" ~ "waist", "power" ~ "lower arms", "drucken" ~ "rucken") would list hundreds of
// unrelated exercises ahead of the real hits (QA C26).
function nearWordUncached(a, b) {
  const max = typosFor(a)
  if (!max) return false
  if (editDistance(a, b, max) <= max) return true
  return a.length >= 5 && b.length > a.length && editDistance(a, b.slice(0, a.length), max) <= max
}

// One search compares the same few query words against the same few thousand distinct name
// words over and over (5,600 exercises share most of their words). Each pair is worked out once
// per search: without this a three-word query took over half a second on a desktop.
let nearCache = new Map()
const resetNearCache = () => { if (nearCache.size) nearCache = new Map() }
function cached(kind, a, b, fn) {
  const key = kind + a + '\u0000' + b
  let v = nearCache.get(key)
  if (v === undefined) { v = fn(); nearCache.set(key, v) }
  return v
}
const nearWord = (a, b) => cached('n', a, b, () => nearWordUncached(a, b))

// Gym shorthand and spellings people type, each read as the words the catalogue uses. A query
// token matches when it or any of its expansions does; the expansions are phrases (all words).
const SYNONYMS = {
  db: ['dumbbell'], dbs: ['dumbbell'], bb: ['barbell'], kb: ['kettlebell'], kbs: ['kettlebell'],
  ez: ['ez barbell'], sm: ['smith'], bw: ['body weight'], bodyweight: ['body weight'],
  ohp: ['overhead press', 'shoulder press', 'military press'], rdl: ['romanian deadlift'],
  sldl: ['stiff leg deadlift'], dl: ['deadlift'], bp: ['bench press'], skullcrusher: ['lying triceps extension', 'skull crusher'],
  skullcrushers: ['lying triceps extension', 'skull crusher'], pulldown: ['pull down', 'pulldown'],
  pullup: ['pull up', 'pull-up'], chinup: ['chin up', 'chin-up'], pushup: ['push up', 'push-up'],
  pressup: ['push up', 'push-up'], situp: ['sit up', 'sit-up'], flye: ['fly'], flyes: ['fly'], flies: ['fly'],
  machine: ['lever', 'machine', 'sled'], lever: ['lever', 'machine'], abs: ['crunch', 'abs'],
  hammy: ['hamstring'], hammies: ['hamstring'], quad: ['quads', 'quadriceps'], tricep: ['triceps'], bicep: ['biceps'],
  delt: ['delts', 'shoulder'], lat: ['lats', 'latissimus', 'pulldown'], trap: ['traps', 'shrug'],
  glute: ['glutes', 'gluteus'], calf: ['calf', 'calves'], hip: ['hip'], rope: ['rope'], trx: ['suspension'],
  ring: ['ring', 'suspension'], rings: ['ring', 'suspension'], kettle: ['kettlebell'], dumbel: ['dumbbell'],
}

// The forms a token may take: as typed, the shorthand it stands for, and the singular of a plural
// ("curls" finds "curl", "raises" finds "raise", "presses" finds "press").
const formsCache = new Map()
function formsOf(tok) {
  const hit = formsCache.get(tok)
  if (hit) return hit
  const forms = formsOfUncached(tok)
  if (formsCache.size > 500) formsCache.clear()
  formsCache.set(tok, forms)
  return forms
}
function formsOfUncached(tok) {
  const out = [tok]
  for (const s of SYNONYMS[tok] || []) out.push(s)
  if (tok.length >= 4 && tok.endsWith('es') && !tok.endsWith('ses')) out.push(tok.slice(0, -2), tok.slice(0, -1))
  else if (tok.length >= 4 && tok.endsWith('ses')) out.push(tok.slice(0, -2))
  // Three letters is enough for "ups" ("pull ups" is "pull-up"); "abs" is a word of its own.
  else if (tok.length >= 3 && tok.endsWith('s') && !tok.endsWith('ss') && tok !== 'abs') out.push(tok.slice(0, -1))
  return [...new Set(out)]
}

const queryTokens = query => normalizeStr(query || '').split(/\s+/).filter(Boolean)
const SEPARATOR = /[\s\-‐-―]/
const WORD_CHAR = /[\p{L}\p{N}]/u
const joinWords = str => str.replace(/[\s\-‐-―]+/g, '')

// The name with its spaces and hyphens left out, and where each of its words starts in that.
function joinedOf(name) {
  let joined = ''
  const starts = new Set()
  for (let i = 0; i < name.length; i++) {
    if (SEPARATOR.test(name[i])) continue
    if (i === 0 || !WORD_CHAR.test(name[i - 1])) starts.add(joined.length)
    joined += name[i]
  }
  return { joined, starts }
}

function joinedHit(entry, tok) {
  const needle = joinWords(tok)
  for (let at = entry.joined.indexOf(needle); at !== -1; at = entry.joined.indexOf(needle, at + 1)) {
    if (entry.starts.has(at)) return true
  }
  return false
}

// A token appears in the corpus as typed, or in the name with its spaces and hyphens left out,
// starting at a word.
const literalHit = (entry, tok) => entry.s.includes(tok) || (tok.length >= 4 && joinedHit(entry, tok))
const hits = (entry, tok) => formsOf(tok).some(form => literalHit(entry, form))

// Every token has to appear in the corpus; a token listed in `fuzzy` may instead be one edit
// away from a name word.
const matchTokens = (e, tokens, fuzzy) => {
  const entry = corpusOf(e)
  return tokens.every(tok => hits(entry, tok) || (fuzzy.has(tok) && formsOf(tok).some(f => entry.nameWords.some(word => nearWord(f, word)))))
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
  resetNearCache()
  const fuzzy = new Set(tokens.filter(tok => !list.some(e => hits(corpusOf(e), tok))))
  return rankByRelevance(list.filter(e => matchTokens(e, tokens, fuzzy)), tokens)
}

// Per search, for each form of each query word: the vocabulary words it starts, the ones within
// the allowed typos, and the ones one typo further (for the similar list). Worked out once over
// the vocabulary, so scoring an exercise is a handful of set lookups instead of string distance
// against each of its words: 5,600 exercises took a quarter of a second the other way.
function queryContext(tokens) {
  const ctx = new Map()
  for (const tok of tokens) {
    for (const form of formsOf(tok)) {
      if (ctx.has(form) || form.includes(' ')) continue
      // One typo more than the exact search allows, but only for words of six letters and up:
      // "pull" is two letters from "curl", and that is a different exercise, not a typo.
      const extraMax = tok.length >= 6 ? typosFor(tok) + 1 : typosFor(tok)
      const prefix = new Set(), near = new Set(), extra = new Set()
      for (const w of VOCAB) {
        if (w.startsWith(form)) prefix.add(w)
        if (nearWordUncached(form, w)) near.add(w)
        else if (tok.length >= 4 && editDistance(form, w, extraMax) <= extraMax) extra.add(w)
      }
      ctx.set(form, { prefix, near, extra })
    }
  }
  return ctx
}

// How well one query token sits in an exercise: a whole word of the name beats the start of one,
// which beats anywhere in the name, the name run together, a typo in the name, and last of all
// another field (target, equipment, body part, muscles). Zero when it is not there at all.
function tokenScore(entry, tok, ctx) {
  let best = 0
  for (const form of formsOf(tok)) {
    const c = ctx && ctx.get(form)
    // A singular or a spelling variant counts a little less than what was typed; the meaning of
    // a short abbreviation ("rdl", "ohp", "db") is exactly what was meant and counts in full.
    const exact = form === tok || (tok.length <= 4 && SYNONYMS[tok]?.includes(form)) ? 0 : 5
    const words = form.split(' ')
    if (words.length > 1) {
      if (entry.name.includes(form)) best = Math.max(best, 100 - exact)
      else if (entry.s.includes(form)) best = Math.max(best, 20 - exact)
      continue
    }
    if (entry.nameWords.includes(form)) best = Math.max(best, 100 - exact)
    else if (c ? entry.nameWords.some(w => c.prefix.has(w)) : entry.nameWords.some(w => w.startsWith(form))) best = Math.max(best, 80 - exact)
    else if (entry.name.includes(form)) best = Math.max(best, 60 - exact)
    else if (form.length >= 4 && joinedHit(entry, form)) best = Math.max(best, 55 - exact)
    else if (c ? entry.nameWords.some(w => c.near.has(w)) : entry.nameWords.some(w => nearWord(form, w))) best = Math.max(best, 40 - exact)
    else if (entry.s.includes(form)) best = Math.max(best, 20 - exact)
  }
  return best
}

// Among equally good matches, the one people most likely mean: the familiar core of the
// catalogue (the exercises openGym shipped before v1.4.0), the common equipment, and a lift
// before a stretch. Small on purpose: it orders ties, it never beats a better match.
const CLASSIC = new Set(V13_IDS)
const EQ_PRIOR = { barbell: 4, dumbbell: 4, cable: 3, 'leverage machine': 3, 'body weight': 3, 'smith machine': 2, kettlebell: 2, 'ez barbell': 2, 'sled machine': 2 }
const CAT_PRIOR = { strength: 3, calisthenics: 3, olympic: 2, plyometrics: 1, isometric: 1, stretching: -3, mobility: -3, rehab: -4, yoga: -2, pilates: -2 }
const priorOf = e => (CLASSIC.has(e.id) ? 3 : 0) + (EQ_PRIOR[e.eq] || 0) + (CAT_PRIOR[e.cat] || 0)

// A name that is the query itself wins outright: as typed or in the singular 50, with the typos
// the search allows for its length 40 ("sqat" is the exercise called "squat", not "dumbbell squat").
function wholeNameScore(plain, typedForms) {
  if (typedForms.includes(plain)) return 50
  return typedForms.some(q => { const max = typosFor(q); return max && editDistance(q, plain, max) <= max }) ? 40 : 0
}

// The matches in order of how well they match, shorter names first among equals (the plain
// "barbell squat" before its six variations), and the list's own order after that: custom
// exercises, which callers put first, stay first among equal matches.
function rankByRelevance(found, tokens) {
  const ctx = queryContext(tokens)
  // The query as typed, and with each word in its singular: "pull ups" is the name "pull-up".
  const typedForms = [...new Set([tokens, tokens.map(tok => formsOf(tok).find(f => f !== tok && !f.includes(' ')) || tok)]
    .map(list => list.join(' ').replace(/[-‐-―]/g, ' ')))]
  const scored = found.map((e, i) => {
    const entry = corpusOf(e)
    // The name exactly as typed wins outright ("burpee" before "dumbbell burpee"), and every
    // word the name has beyond the query costs a little, more than the equipment preference.
    const plain = entry.name.split(' (')[0].replace(/[-‐-―]/g, ' ')
    const whole = wholeNameScore(plain, typedForms)
    const extra = Math.max(0, entry.nameWords.length - tokens.length) * 3
    return { e, i, score: tokens.reduce((sum, tok) => sum + tokenScore(entry, tok, ctx), 0) + priorOf(e) + whole - extra, len: entry.nameWords.length }
  })
  scored.sort((a, b) => b.score - a.score || a.len - b.len || a.i - b.i)
  return scored.map(x => x.e)
}

// Exercises that come close to a query without matching all of it: most of the words found, or
// the words found with more typos than the exact search allows, or the name of something
// similar. For the "Similar exercises" section under the results, so a search almost never ends
// on "No match". `exclude` holds what the exact search already listed. Best first, at most `limit`.
export function similarExercises(list, query, exclude = [], limit = 30) {
  const tokens = queryTokens(query)
  if (!tokens.length) return []
  resetNearCache()
  const skip = new Set(exclude)
  // What the exact hits train most: "similar" leans towards the same muscle, so a curl search
  // offers other biceps work rather than anything else that happens to say "dumbbell".
  const tgCount = {}
  for (const e of exclude.slice(0, 8)) if (e?.tg) tgCount[e.tg] = (tgCount[e.tg] || 0) + 1
  const mainTg = Object.keys(tgCount).sort((a, b) => tgCount[b] - tgCount[a])[0]
  for (const e of list) corpusOf(e)   // fills the vocabulary before it is searched
  const ctx = queryContext(tokens)
  const out = []
  for (let i = 0; i < list.length; i++) {
    const e = list[i]
    if (skip.has(e)) continue
    const entry = corpusOf(e)
    let score = 0, found = 0
    for (const tok of tokens) {
      let best = tokenScore(entry, tok, ctx)
      // One more typo than the exact search allows, name words only.
      if (!best && formsOf(tok).some(f => { const c = ctx.get(f); return c && entry.nameWords.some(w => c.extra.has(w)) })) best = 25
      if (best) { found++; score += best }
    }
    // Half the words at least (one of one, one of two, two of three...), and for a one-word query
    // a hit in the name, not just a shared body part.
    if (found * 2 < tokens.length || !found || (tokens.length === 1 && score < 25)) continue
    out.push({ e, i, score: score + found * 30 + priorOf(e) + (mainTg && e.tg === mainTg ? 40 : 0), len: entry.nameWords.length })
  }
  out.sort((a, b) => b.score - a.score || a.len - b.len || a.i - b.i)
  return out.slice(0, limit).map(x => x.e)
}