// The matcher every local source of the global search shares (pages, settings, routines, workouts,
// foods, days), held to the exercise search's rules (lib/exercises.js): accents and case folded,
// the same typo allowance per word length (typosFor) and the same edit distance. Exercises keep
// their own ranking (searchExercises), which knows the catalogue's synonyms and priors.
//
// Ranking, per query word (fitness-eval ux-search.md §3): a whole word of the title beats the
// start of one, which beats anywhere in it, then a typo of a title word, then an alias or keyword,
// then a secondary field. Every word has to land somewhere. Ranges index the title as written, so
// the row can set them in bold without ever building HTML.
import { editDistance, nearWordUncached, typosFor } from '../exercises.js'

const MARKS = /\p{M}/gu
const WORD_CHAR = /[\p{L}\p{N}]/u

/** Lower case, marks dropped: "Thème" and "theme" meet. */
export const fold = s => String(s ?? '').normalize('NFD').replace(MARKS, '').toLowerCase()

/** The words of a query, folded. */
export const queryWords = q => fold(q).split(/\s+/).filter(Boolean)

// A string folded one character at a time, with where each folded character came from, so a range
// found in the folded text maps back onto the text as shown.
const foldCache = new Map()
export function foldMap(text) {
  const s = String(text ?? '')
  const hit = foldCache.get(s)
  if (hit) return hit
  let folded = ''
  const at = []
  let i = 0
  for (const ch of s) {
    const f = ch.normalize('NFD').replace(MARKS, '').toLowerCase()
    for (let k = 0; k < f.length; k++) at.push(i)
    folded += f
    i += ch.length
  }
  at.push(s.length)
  const out = { text: s, folded, at, words: wordsOf(folded) }
  if (foldCache.size > 4000) foldCache.clear()
  foldCache.set(s, out)
  return out
}

// The words of a folded string with where each starts.
function wordsOf(folded) {
  const out = []
  let start = -1
  for (let i = 0; i <= folded.length; i++) {
    const word = i < folded.length && WORD_CHAR.test(folded[i])
    if (word && start < 0) start = i
    if (!word && start >= 0) { out.push({ w: folded.slice(start, i), at: start }); start = -1 }
  }
  return out
}

const range = (m, from, to) => [m.at[from], m.at[to]]

export const SCORE = { word: 100, prefix: 80, substring: 60, typo: 40, alias: 35, secondary: 20 }

// How one query word sits in a title: its score and the range it covers there.
function inTitle(m, w) {
  let best = null
  for (const word of m.words) {
    if (word.w === w) return { score: SCORE.word, range: range(m, word.at, word.at + w.length) }
    if (!best && word.w.startsWith(w)) best = { score: SCORE.prefix, range: range(m, word.at, word.at + w.length) }
  }
  if (best) return best
  const at = m.folded.indexOf(w)
  if (at >= 0) return { score: SCORE.substring, range: range(m, at, at + w.length) }
  for (const word of m.words) {
    if (nearWordUncached(w, word.w)) return { score: SCORE.typo, range: range(m, word.at, word.at + word.w.length) }
  }
  return null
}

const atWordStart = (folded, w) => {
  for (let i = folded.indexOf(w); i !== -1; i = folded.indexOf(w, i + 1)) if (i === 0 || !WORD_CHAR.test(folded[i - 1])) return true
  return false
}

/**
 * Matches query `words` (queryWords) against a record:
 *   title     what the row shows (ranges index it)
 *   aliases   words people search for that the title does not say: settings keywords, page
 *             keywords, shorthand (matched from the start of a word)
 *   secondary other fields that may answer a word: a brand, a page trail, a meal name
 * Null when a word lands nowhere; else { score, ranges, exact, wordPrefix } where `exact` is the
 * title being the query, and `wordPrefix` the title starting with the query on a word boundary.
 */
export function matchRecord(words, { title, aliases = [], secondary = [] }) {
  if (!words.length) return null
  const m = foldMap(title)
  const al = aliases.length ? fold(aliases.join(' ')) : ''
  const sec = secondary.length ? fold(secondary.filter(Boolean).join(' ')) : ''
  let score = 0
  const ranges = []
  for (const w of words) {
    const hit = inTitle(m, w)
    if (hit) { score += hit.score; ranges.push(hit.range); continue }
    if (al && (atWordStart(al, w) || (typosFor(w) && queryWordNear(al, w)))) { score += SCORE.alias; continue }
    if (sec && sec.includes(w)) { score += SCORE.secondary; continue }
    return null
  }
  const q = words.join(' ')
  const plain = m.words.map(x => x.w).join(' ')
  const exact = plain === q
  const wordPrefix = !exact && plain.startsWith(q) && plain[q.length] === ' '
  // A short title that is mostly the query beats a long one that merely contains it.
  const extra = Math.max(0, m.words.length - words.length)
  return { score: score + (exact ? 50 : wordPrefix ? 20 : 0) - extra * 2, ranges: merge(ranges), exact, wordPrefix }
}

// A query word one typo from a word of an alias list ("drak" for "dark").
const queryWordNear = (folded, w) => wordsOf(folded).some(x => nearWordUncached(w, x.w))

/** Overlapping or touching ranges joined, in order. */
export function merge(ranges) {
  const sorted = ranges.filter(r => r && r[1] > r[0]).sort((a, b) => a[0] - b[0])
  const out = []
  for (const r of sorted) {
    const last = out[out.length - 1]
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1])
    else out.push([r[0], r[1]])
  }
  return out
}

/** The ranges of `words` inside any text (a Day row's item name, a workout's exercise), for bold. */
export function rangesIn(text, words) {
  const m = foldMap(text)
  return merge(words.map(w => inTitle(m, w)?.range).filter(Boolean))
}

/** A "did you mean": the candidate one or two typos from the whole query, nearest first. */
export function nearest(query, candidates) {
  const q = fold(query).trim()
  if (q.length < 4) return null
  const max = typosFor(q) + 1
  let best = null
  for (const c of candidates) {
    const d = editDistance(q, fold(c), max)
    if (d > 0 && d <= max && (!best || d < best.d)) best = { d, text: c }
  }
  return best?.text ?? null
}

/** Text split into plain and matched segments by ranges: what the row renders, never HTML. */
export function segments(text, ranges = []) {
  const s = String(text ?? '')
  const out = []
  let last = 0
  for (const [a, b] of merge(ranges)) {
    if (a > last) out.push({ text: s.slice(last, a), match: false })
    if (b > a) out.push({ text: s.slice(a, b), match: true })
    last = Math.max(last, b)
  }
  if (last < s.length) out.push({ text: s.slice(last), match: false })
  return out
}
