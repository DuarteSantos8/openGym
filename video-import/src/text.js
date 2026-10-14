// Text helpers shared by the OCR reader, the chapter parser and the segmenter. Pure, no I/O.

/** Lowercase letters and single spaces only: what two readings of the same caption share. */
export function normName(s) {
  return String(s || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Levenshtein distance, two rows. Captions are short, so the quadratic cost never shows. */
export function editDistance(a, b) {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  let cur = new Array(b.length + 1)
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    ;[prev, cur] = [cur, prev]
  }
  return prev[b.length]
}

/** 1 for the same text, 0 for nothing in common. One misread letter in "burpees" is 0.86. */
export function similarity(a, b) {
  const x = normName(a), y = normName(b)
  if (!x && !y) return 1
  const n = Math.max(x.length, y.length)
  return n ? 1 - editDistance(x, y) / n : 0
}

export const SAME_NAME = 0.75

// What a rest screen says, in the languages the app ships most. A word on its own line or in
// front of the next exercise ("REST — next: burpees"); never part of a longer name, which is why
// these are matched as whole words.
const REST_WORDS = [
  'rest', 'break', 'recover', 'recovery', 'relax', 'pause', 'pausa', 'przerwa', 'odpoczynek',
  'descanso', 'repos', 'ruhe', 'erholung', 'riposo', 'rust', 'get ready', 'prepare', 'ready',
  'przygotuj sie', 'transition'
]
const REST_RE = new RegExp('(^|\\s)(' + REST_WORDS.join('|') + ')(\\s|$)')
// "next: burpees", "up next burpees", "next up - burpees", "nastepne: …", "als nachstes …"
const NEXT_RE = /(?:^|\s)(?:up next|next up|next|coming up|nastepne|nastepnie|dalej|als nachstes|naechste|siguiente|suivant|prossimo|a seguir)\s+(.+)$/

/** { rest: boolean, next: string|null } for one normalised caption. */
export function restOf(key) {
  const k = normName(key)
  const m = NEXT_RE.exec(k)
  const next = m ? m[1].trim() || null : null
  return { rest: REST_RE.test(k) || !!m, next }
}

// Words a section header uses. Matched on the whole normalised title.
const WARMUP_RE = /\b(warm ?up|warming up|rozgrzewka|aufwarmen|calentamiento|echauffement|riscaldamento)\b/
const STRETCH_RE = /\b(stretch|stretching|cool ?down|cooldown|rozciaganie|dehnen|estiramiento|etirement|stretching|allungamento|mobility)\b/

/** 'warmup' | 'stretch' | null, for a caption or a chapter title that names a section. */
export function sectionWord(text) {
  const k = normName(text)
  if (WARMUP_RE.test(k)) return 'warmup'
  if (STRETCH_RE.test(k)) return 'stretch'
  return null
}

// The side words a per-side stretch or hold puts after its name.
const SIDE_WORDS = {
  left: 'L', right: 'R', lewa: 'L', prawa: 'R', links: 'L', rechts: 'R', izquierda: 'L', derecha: 'R',
  gauche: 'L', droite: 'R', sinistra: 'L', destra: 'R'
}
// OCR turns "RIGHT" into "RIGH1" or "RIGHI" and "LEFT" into "1EFT": the English pair is matched
// one edit away (on the raw word, digits and all), the rest exactly.
const FUZZY_SIDE = { left: 'L', right: 'R' }
// Real words one edit from "left" or "right" that name moves: never a side.
const NOT_SIDE = new Set(['lift', 'lifts', 'loft', 'leaf', 'lent', 'lefty', 'eight', 'light', 'fight', 'night', 'sight', 'tight', 'might', 'rigid', 'bright', 'freight', 'height', 'weight', 'wright', 'rights'])
function sideWord(raw) {
  const w = String(raw).toLowerCase().replace(/[^a-z0-9]/g, '')
  if (!w) return null
  const plain = w.replace(/[0-9]/g, '')
  if (SIDE_WORDS[plain] && plain === w) return SIDE_WORDS[plain]
  if (w.length >= 4 && !NOT_SIDE.has(w)) for (const [word, side] of Object.entries(FUZZY_SIDE)) if (editDistance(w, word) <= 1) return side
  return null
}

/** { base, side } — the name without its side word ("left side" too), and 'L' / 'R' / null. */
export function sideOf(text) {
  const words = String(text || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').split(/[^\p{L}0-9]+/u).filter(Boolean)
  let side = null
  const keep = []
  for (const w of words) {
    const s = side ? null : sideWord(w)
    if (s) { side = s; continue }
    if (side && /^(side|strona|seite|lado|cote|lato)$/i.test(w) && keep.length === words.indexOf(w) - 1) continue
    keep.push(w)
  }
  const base = normName(keep.join(' '))
  return { base: base || normName(text), side }
}

/** Seconds from what a timer shows: "0:35", "00:35", "1:05", "35", "35s", "35.0". */
export function parseTimer(raw) {
  const s = String(raw || '').replace(/[oO]/g, '0').replace(/[^0-9:.]/g, '')
  let m = /^(\d{1,2})[:.](\d{2})$/.exec(s)
  if (m) return +m[1] * 60 + +m[2]
  // "0:40" whose colon was too small to keep reads "040"; "1:30" reads "130".
  m = /^(\d{1,2})(\d{2})$/.exec(s)
  if (m) return +m[2] < 60 ? +m[1] * 60 + +m[2] : null
  m = /^(\d{1,2})(?:\.0)?$/.exec(s)
  if (m) return +m[1]
  return null
}

/** Title Case for display: what the review table shows before a match is picked. */
export function displayName(s) {
  return String(s || '').trim().replace(/\s+/g, ' ').toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase())
}

/** The most frequent value of a list, ties to the first seen. */
export function mode(list) {
  const counts = new Map()
  let best = null, n = 0
  for (const v of list) {
    const c = (counts.get(v) || 0) + 1
    counts.set(v, c)
    if (c > n) { best = v; n = c }
  }
  return { value: best, count: n }
}

export const median = list => {
  const xs = list.filter(x => Number.isFinite(x)).sort((a, b) => a - b)
  if (!xs.length) return 0
  const mid = xs.length >> 1
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2
}

/** A duration the way a video's author meant it: 39 and 41 are 40; 33 stays 33. */
export function snapSec(x) {
  const r = Math.round(x)
  // Short intervals are exact on screen (a Tabata's 20/10, a 5-second switch); only the
  // longer ones drift a second or two either way with where a cut falls.
  if (r < 15) return r
  const five = Math.round(r / 5) * 5
  return Math.abs(r - five) <= 2 ? five : r
}

/**
 * Whether two captions name the same thing: close enough as text, and not the two sides of one
 * move — "quad stretch left" and "quad stretch right" are one edit apart in spirit and must stay
 * two blocks, or a per-side stretch reads as one long hold.
 */
export function sameName(a, b) {
  // Two blocks nobody could read are not the same exercise; they are two unknowns.
  if (!normName(a) || !normName(b)) return false
  const x = sideOf(a), y = sideOf(b)
  if (x.side && y.side && x.side !== y.side) return false
  return similarity(a, b) >= SAME_NAME
}

/**
 * A caption without the OCR debris at its edges: the corner of a frame read as ")", a progress
 * arrow as "!", a stray "l" or "E". Edge words with fewer than two letters go; a real short word
 * ("UP" in "PUSH UP") has two and stays.
 */
export function cleanCaption(raw) {
  const words = String(raw || '').trim().split(/\s+/).filter(Boolean)
  const letters = w => (w.match(/\p{L}/gu) || []).length
  while (words.length && letters(words[0]) < 2) words.shift()
  while (words.length && letters(words[words.length - 1]) < 2) words.pop()
  return words.join(' ')
}
