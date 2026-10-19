// Text helpers shared by the OCR reader, the chapter parser and the segmenter. Pure, no I/O.

/** Lowercase letters and single spaces only: what two readings of the same caption share. */
import fs from 'node:fs'
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
  'przygotuj sie', 'transition',
  // The pause between the two sides of a move. Never "switch" alone: "switch lunges" is a move.
  'switch sides', 'switch side', 'change sides', 'change side', 'other side', 'zmiana strony',
  'zmien strone', 'seitenwechsel', 'cambio de lado', 'changez de cote'
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
const STRETCH_RE = /\b(stretch|stretches|stretching|cool ?down|cooldown|rozciaganie|dehnen|estiramiento|etirement|stretching|allungamento|mobility)\b/

/** 'warmup' | 'stretch' | null, for a caption or a chapter title that names a section. */
/**
 * The section a caption announces when the caption is nothing but a section's title ("WARM UP",
 * "Cool down & stretch"), or null. A move named after what it does ("Dynamic chest stretch",
 * "Quad stretch") is a move, not a section.
 */
export function sectionTitle(text) {
  const kind = sectionWord(text)
  if (!kind) return null
  const rest = normName(text).replace(/\b(warm ?up|warming up|cool ?down|cooldown|stretch|stretches|stretching|mobility|and|the|time|session|intro|introduction|final|wrap up|rozgrzewka|rozciaganie)\b/g, ' ').trim()
  return rest ? null : kind
}

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
  // "Side plank hold (R)", "Glute bridge (L)": a lone R or L in brackets is a side too.
  const short = /[([{]\s*([rlRL])\s*[)\]}]/.exec(String(text || ''))
  if (short) return { base: normName(String(text).replace(short[0], ' ')), side: short[1].toUpperCase() }
  // The same once a caption is a key and its brackets are gone: "sl glute bridge r".
  const tail = /^(.{3,}\S)\s+([rl])$/i.exec(String(text || '').trim())
  if (tail && !/[()]/.test(text)) return { base: normName(tail[1]), side: tail[2].toUpperCase() }
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
const KIT_WORDS = new Set(['dumbbell', 'dumbbells', 'kettlebell', 'kettlebells', 'barbell', 'band', 'alternating', 'alternate', 'alt', 'single', 'arm', 'with'])

export function sameName(a, b) {
  // Two blocks nobody could read are not the same exercise; they are two unknowns.
  if (!normName(a) || !normName(b)) return false
  const x = sideOf(a), y = sideOf(b)
  if (x.side && y.side && x.side !== y.side) return false
  // A caption caught while it was still being typed out: "sumo sq" is "sumo squat".
  const [s1, s2] = [normName(a), normName(b)].sort((p, q) => p.length - q.length)
  if (s1.length >= 5 && s1.length >= s2.length * 0.5 && s2.startsWith(s1)) return true
  // "Neck stretch (alternate both sides)" and "Elbow stretch (alternate both sides)" share most of
  // their words, but a move is named by its first one.
  const w1 = normName(a).split(' ')[0], w2 = normName(b).split(' ')[0]
  if (w1.length >= 3 && w2.length >= 3 && similarity(w1, w2) < 0.5) return false
  // Names that share their equipment and little else ("dumbbell floor press", "dumbbell push
  // press"; "bent over row", "bent over underhand row") are two moves: most of the words that say
  // what the move is must match, an OCR slip or two allowed in a long word.
  const moveWords = t => normName(t).split(' ').filter(w => w.length >= 3 && !KIT_WORDS.has(w))
  const m1 = moveWords(a), m2 = moveWords(b)
  if (m1.length && m2.length) {
    const used = new Set()
    let hit = 0
    for (const x of m1) {
      const k = m2.findIndex((y, i) => !used.has(i) && (x === y || x.replace(/s$/, '') === y.replace(/s$/, '') || (Math.min(x.length, y.length) >= 5 && editDistance(x, y) <= (Math.max(x.length, y.length) >= 7 ? 2 : 1))))
      if (k >= 0) { hit++; used.add(k) }
    }
    if (hit / Math.max(m1.length, m2.length) < 0.8) return false
  }
  return similarity(a, b) >= SAME_NAME
}

/**
 * A caption without the OCR debris at its edges: the corner of a frame read as ")", a progress
 * arrow as "!", a stray "l" or "E". Edge words with fewer than two letters go; a real short word
 * ("UP" in "PUSH UP") has two and stays.
 */
// "(R)", "(left)": a side in brackets, as the caption shows it or as segment.js spells it out.
const SIDE_TOKEN = /^[([{]\s*(r|l|right|left)\s*[)\]}]/i

export function cleanCaption(raw) {
  const words = String(raw || '').trim().split(/\s+/).filter(Boolean)
  const letters = w => (w.match(/\p{L}/gu) || []).length
  // A capital on its own in front of a caption in capitals is a word of it ("V UPS", "X JUMPS"),
  // except the I and O that the edge of a frame reads as.
  const keepsLead = words.length > 1 && /^[A-HJ-NP-Z]$/.test(words[0]) && /^[^a-z]*$/.test(words.slice(1).join(' ')) && letters(words[1]) >= 2
  while (!keepsLead && words.length && letters(words[0]) < 2) words.shift()
  // A side in brackets ends the caption, and a set counter ("(1/2)", "(20SEC …") too, counter and
  // all: what OCR reads after them is the picture ("GLUTE BRIDGE (1,2) g Iy").
  const end = words.findIndex((w, i) => i > 0 && (SIDE_TOKEN.test(w) || /^\(\s*\d/.test(w)))
  if (end > 0) words.splice(/^\(\s*\d/.test(words[end]) ? end : end + 1)
  // A caption in capitals ("ROW to PUSH" counts: a joining word may be small) that ends in short
  // words with small letters ("SUMO SQUAT Ll", "PUSH ur", "RAISE (L) ww v"): debris too.
  const capsish = w => !/[a-z]/.test(w) || /^(to|and|with|on|of|in|x)$/.test(w)
  for (;;) {
    const last = words[words.length - 1]
    if (!last) break
    if (letters(last) < 2 && !SIDE_TOKEN.test(last)) { words.pop(); continue }
    const caps = words.length > 1 && words.slice(0, -1).every(capsish) && words.slice(0, -1).some(w => letters(w) >= 3)
    if (caps && last.length <= 3 && /[a-z]/.test(last) && !capsish(last)) { words.pop(); continue }
    break
  }
  return words.join(' ')
}


/* ------------------------------------------------------------ word repair */

let VOCAB = null
const vocab = () => {
  if (VOCAB) return VOCAB
  try { VOCAB = fs.readFileSync(new URL('./vocab.json', import.meta.url), 'utf8') } catch { VOCAB = '[]' }
  VOCAB = JSON.parse(VOCAB)
  return VOCAB
}
const VOCAB_SET = () => (vocab().set ??= new Set(vocab()))
const nearest = new Map()

/**
 * The vocabulary word within `max` edits of `w`, nearer than any other (or the longest of a few
 * that are forms of one another: "bicep", "biceps"); null when none or unsure.
 */
function nearWord(w, max, minLen = 0) {
  const key = w + '|' + max + '|' + minLen
  if (nearest.has(key)) return nearest.get(key)
  let bestD = max + 1, tied = []
  for (const v of vocab()) {
    if (v.length < minLen || Math.abs(v.length - w.length) > max) continue
    const d = editDistance(w, v)
    if (d < bestD) { bestD = d; tied = [v] } else if (d === bestD) tied.push(v)
  }
  tied.sort((a, b) => b.length - a.length)
  const kin = tied.length > 0 && tied.every(v => tied[0].startsWith(v))
  const out = bestD <= max && tied.length && (tied.length === 1 || kin) ? tied[0] : null
  nearest.set(key, out)
  return out
}

// The words of the screens around a workout: not exercise names, and not the library's to mend.
const PROTECTED = new Set(['rest', 'next', 'warm', 'cool', 'down', 'round', 'rounds', 'work', 'switch', 'sides', 'get', 'ready', 'start', 'finish', 'break', 'water', 'cooldown', 'warmup', 'stretch', 'stretches', 'workout', 'seconds', 'minute', 'minutes', 'first', 'repeat'])

const FUNCTION_WORDS = new Set(['in', 'to', 'on', 'of', 'up', 'at', 'by', 'or', 'and', 'the', 'with', 'for', 'off', 'out', 'over'])

/** The vocabulary word that `letters` are an ordered part of (starting and ending as they do), when one is clearly meant. */
function completeAll(letters, minLen, maxExtra) {
  return vocab().filter(v => v.length >= minLen && v.length <= letters.length + maxExtra && v[0] === letters[0] && v[v.length - 1] === letters[letters.length - 1] && isSubsequence(letters, v))
}
function completes(letters, minLen, maxExtra) {
  const found = vocab().filter(v => v.length >= minLen && v.length <= letters.length + maxExtra && v[0] === letters[0] && v[v.length - 1] === letters[letters.length - 1] && isSubsequence(letters, v))
  if (!found.length) return null
  found.sort((a, b) => a.length - b.length)
  return found.every(v => v.startsWith(found[0]) || found[0].startsWith(v)) ? found[0] : null
}
const isSubsequence = (a, b) => { let i = 0; for (const c of b) if (c === a[i]) i++; return i === a.length }
/** The vocabulary word an unfinished one begins: "squ" → "squat". */
function startsWord(prefix, maxExtra) {
  const found = vocab().filter(v => v.length > prefix.length && v.length <= prefix.length + maxExtra && v.startsWith(prefix))
  if (!found.length) return null
  found.sort((a, b) => a.length - b.length)
  return found.every(v => v.startsWith(found[0])) ? found[0] : null
}

const asCase = (orig, w) => (orig === orig.toUpperCase() ? w.toUpperCase() : /^\p{Lu}/u.test(orig) ? w[0].toUpperCase() + w.slice(1) : w)

/**
 * Mends the words OCR broke in a caption, from the words the exercise library uses: "Squa" →
 * "Squat", "Bic S Curl" → "Biceps Curl". A word the library knows stays; one it does not is
 * replaced by the library word it is one or two edits from, when there is exactly one such nearest
 * word; two short pieces that join into such a word ("Lat Al") become it. Anything with a digit
 * or a bracket in it is left alone.
 */
export function repairCaption(text) {
  // A hyphen joins words that are mended one by one: "Single-Armirow" → "Single-Arm Irow"... each piece on its own.
  const parts = String(text || '').replace(/(?<=\p{L})V\/(?=\p{L})/gu, 'W').split(/(\s+)/).map(p => (/^\s*$/.test(p) || !/\p{L}-\p{L}/u.test(p) ? p : p.split('-').map(x => repairCaption(x)).join('-')))
  const idx = parts.map((p, i) => (/^\s*$/.test(p) ? -1 : i)).filter(i => i >= 0)
  const known = VOCAB_SET()
  const plain = w => /^\p{L}+$/u.test(w)
  const limit = n => (n >= 10 ? 2 : n >= 6 ? 1 : 0)
  // The library lists "burpee" and "curl": a plural or a singular of a word it knows is known.
  const knows = w => known.has(w) || known.has(w.replace(/s$/, '')) || known.has(w.replace(/es$/, '')) || known.has(w + 's') || known.has(w + 'es')
  for (let k = 0; k < idx.length; k++) {
    const i = idx[k], w = parts[i], lw = w.toLowerCase()
    if (!plain(w) || lw.length < 1) continue
    // Two pieces that are one word: "bic" + "s", "lat" + "al", "du" + "bell" (not two words the
    // library knows: "side" + "squat" are two).
    const j = idx[k + 1]
    const lj = j != null ? parts[j].toLowerCase() : ''
    // Two capitals on their own between words ("bent O R overhand"): the middle of a word the OCR
    // lost the rest of.
    if (lw.length === 1 && j != null && lj.length === 1 && plain(parts[j]) && !/^[ai]$/.test(lw)) {
      // Of the words these could be part of, the one the library puts next to its neighbours.
      const before = idx[k - 1] != null ? parts[idx[k - 1]].toLowerCase() : '', after = idx[k + 2] != null ? parts[idx[k + 2]].toLowerCase() : ''
      const cands = completeAll(lw + lj, 3, 3).filter(c => bigrams().has(before + ' ' + c) || bigrams().has(c + ' ' + after))
      const done = cands.length === 1 ? cands[0] : completes(lw + lj, 3, 3)
      if (done) { parts[i] = asCase(w, done); parts[j] = ''; if (parts[j - 1] != null && /^\s+$/.test(parts[j - 1])) parts[j - 1] = ''; k++; continue }
    }
    if (j != null && plain(parts[j]) && !(knows(lw) && knows(lj)) && !PROTECTED.has(lw) && !PROTECTED.has(lj) && !FUNCTION_WORDS.has(lj) &&
      !(lw.length >= 4 && knows(lw)) && lw.length + lj.length >= 4) {
      const joined = nearWord(lw + lj, 2, 6) || completes(lw + lj, 6, 3)
      // The piece in front is the start of the word it was cut from; a word that is just one of the
      // pieces again ("pronated" + "fl") is a piece of debris after a word, not half of one.
      if (joined && joined.startsWith(lw) && joined !== lw && joined !== lj) {
        parts[i] = asCase(w, joined); parts[j] = ''
        if (parts[j - 1] != null && /^\s+$/.test(parts[j - 1])) parts[j - 1] = ''
        k++
        continue
      }
    }
    if (lw.length < 3 || knows(lw) || PROTECTED.has(lw)) continue
    // Two words run together, with at most a stray letter between: "snowangels", "rackisplit".
    if (lw.length >= 7) {
      let glued = null
      for (let c = 3; c <= lw.length - 3 && !glued; c++) {
        for (const junk of [0, 1]) {
          const a = lw.slice(0, c), b = lw.slice(c + junk)
          if (b.length >= 3 && knows(a) && knows(b) && !PROTECTED.has(a) && !PROTECTED.has(b)) { glued = [a, b]; break }
        }
      }
      if (glued) { parts[i] = asCase(w, glued[0]) + ' ' + asCase(w, glued[1]); continue }
    }
    // An unfinished word ("squ") is finished only where the library puts the result next to its neighbours.
    const prefixed = () => {
      if (lw.length < 3 || lw.length > 4) return null
      const done = startsWord(lw, 3)
      const before = idx[k - 1] != null ? parts[idx[k - 1]].toLowerCase() : '', after = idx[k + 1] != null ? parts[idx[k + 1]].toLowerCase() : ''
      return done && (bigrams().has(before + ' ' + done) || bigrams().has(done + ' ' + after)) ? done : null
    }
    const fixed = (limit(lw.length) ? nearWord(lw, limit(lw.length)) : null) || prefixed()
    if (fixed) parts[i] = asCase(w, fixed)
  }
  return parts.join('').replace(/\s+/g, ' ').trim()
}

/**
 * Whether a caption could be an exercise's name: two or more words of three letters and not one of
 * them is a word the exercise library (or a screen) knows is OCR noise — "Wtm Cinnc Ctoctrwl".
 * One word is let through: a rare move has a rare name.
 */
export function plausibleCaption(text) {
  const words = (String(text || '').toLowerCase().match(/\p{L}{3,}/gu) || []).filter(w => !PROTECTED.has(w))
  if (words.length < 2) return true
  const known = libraryWords()
  // "next" and "rest" are screens' words, not evidence of a name.
  const knows = w => !PROTECTED.has(w) && !FUNCTION_WORDS.has(w) && (known.has(w) || known.has(w.replace(/s$/, '')) || known.has(w.replace(/es$/, '')) || known.has(w + 's'))
  // "pushups", "deadbugs": two words the library knows, run together.
  const compound = w => { for (let i = 2; i <= w.length - 2; i++) if (knows(w.slice(0, i)) && knows(w.slice(i))) return true; return false }
  return words.some(w => knows(w) || compound(w))
}


/* ------------------------------------------------ snap to a library name */

let NAMES = null
const library = () => {
  if (NAMES) return NAMES
  let list = []
  try { list = JSON.parse(fs.readFileSync(new URL('./names.json', import.meta.url), 'utf8')) } catch { /* no library: nothing to snap to */ }
  NAMES = { list, set: new Set(list), tri: list.map(trigrams) }
  return NAMES
}
let BIGRAMS = null
/** Pairs of neighbouring words in the library's names: "bent over", "split squat". */
const bigrams = () => {
  if (BIGRAMS) return BIGRAMS
  BIGRAMS = new Set()
  for (const n of library().list) { const w = n.split(' '); for (let i = 0; i + 1 < w.length; i++) BIGRAMS.add(w[i] + ' ' + w[i + 1]) }
  return BIGRAMS
}
let ALL_WORDS = null
/** Every word of every library name, rare ones too (the repair vocabulary leaves those out). */
const libraryWords = () => (ALL_WORDS ??= new Set(library().list.flatMap(n => n.split(' ')).filter(w => w.length >= 3)))
function trigrams(s) {
  const t = new Set(), p = ' ' + s + ' '
  for (let i = 0; i + 3 <= p.length; i++) t.add(p.slice(i, i + 3))
  return t
}
const snapped = new Map()

/**
 * A caption a couple of letters off an exercise the library lists ("Dumbbell Su Squat" for "Dumbbell
 * Sumo Squat") is that exercise: the library's own spelling, in the caption's case. Anything that is
 * already a library name, is short, or is not close to exactly one name is left as it is.
 */
export function snapToLibrary(text) {
  const norm = String(text || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (norm.length < 10 || /\d/.test(norm)) return text
  if (snapped.has(norm)) return snapped.get(norm) ?? text
  const lib = library()
  let result = null
  if (!lib.set.has(norm)) {
    const mine = trigrams(norm)
    let best = null, bestD = Infinity, tie = false
    for (let i = 0; i < lib.list.length; i++) {
      const n = lib.list[i]
      if (Math.abs(n.length - norm.length) > 3) continue
      let shared = 0
      for (const g of mine) if (lib.tri[i].has(g)) shared++
      if (shared < mine.size * 0.6) continue
      const d = editDistance(norm, n)
      if (d < bestD) { bestD = d; best = n; tie = false } else if (d === bestD) tie = true
    }
    // Only a word the OCR broke may change: every word of the caption that is a real one stays.
    const known = VOCAB_SET()
    const solid = norm.split(' ').filter(w => w.length >= 2 && (known.has(w) || known.has(w.replace(/s$/, '')) || FUNCTION_WORDS.has(w) || PROTECTED.has(w)))
    if (best && !tie && bestD >= 1 && bestD <= 2 && norm.length >= 14 && solid.every(w => best.split(' ').includes(w))) result = best
  }
  snapped.set(norm, result)
  if (!result) return text
  // The library's words, in the caption's own case.
  const upper = text === String(text).toUpperCase()
  return upper ? result.toUpperCase() : result.replace(/\b\w/g, c => c.toUpperCase())
}
