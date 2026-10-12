// Import a routine from a follow-along video: the app's half (the reading itself runs in the
// optional video-import worker, docs/DATA_IMPORTS.md). Pure, like the other importers.
//
//   matchVideoName(name, S)       a caption → an exercise id, a confidence and the runners-up
//   draftRows(result, S)          the worker's draft → the rows the review table edits
//   buildVideoRoutine(rows, opts) the reviewed rows → a routine and the custom exercises it needs
//   mergeVideoRoutine(S, built)   into state: a second import of the same video replaces the
//                                 routine it made the first time, it never adds a second copy
//
// How a block becomes a routine (the owner's call, not a modelling accident): an interval
// exercise done once per round is ONE exercise of `rounds` timed sets, `sec` each, with its rest
// as the rest between sets — 3 rounds of burpees, 40 s on and 20 s off, is "Burpees 3 × 0:40,
// rest 0:20". The app has no rest between the members of a superset, so the video's A-B-C, A-B-C
// order is traded for A-A-A, B-B-B with the right work and rest times. A warm-up and a stretch
// are continuous, so each is one named group of single timed sets, done straight through.

import { CATALOGUE, EXIDX, canonicalExId, normalizeStr } from './exercises.js'
import { bpFromName, importId, matchExercise as matchImported } from './import-csv.js'
import { uid } from './format.js'

/* -------------------------------------------------------------------- matching */

const EQUIPMENT = /\b(barbell|dumbbell|dumbbells|band|banded|cable|machine|kettlebell|smith|medicine|ball|bosu|trx|sled|ez|plate|rope|ropes|bench|box|weighted|landmine|lever|suspension)\b/

// Each word of a caption in its singular, so "Burpees" and "burpee" are one exercise.
const KEEP_S = new Set(['abs', 'bus', 'its', 'plus', 'press', 'cross', 'lats', 'delts', 'obliques', 'hips', 'glutes', 'quads', 'calves'])
export function singular(w) {
  if (w.length <= 2 || KEEP_S.has(w)) return w
  if (/ies$/.test(w)) return w.slice(0, -3) + 'y'
  if (/(ches|shes|sses|xes|zes)$/.test(w)) return w.slice(0, -2)
  if (/s$/.test(w) && !/(ss|us|is)$/.test(w)) return w.slice(0, -1)
  return w
}
const wordsOf = s => normalizeStr(String(s || '')).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean)
const bagOf = s => wordsOf(s).map(singular).filter(w => w !== 'the' && w !== 'a').sort().join(' ')

// What follow-along videos call the moves the catalogue files under another name. Every id is
// pinned by a test (it must exist), and each one beat what plain search would have chosen.
export const FOLLOW_ALONG = {
  plank: '0463',            // 'front plank'; search ranks "jack plank" first
  'forearm plank': '0463',
  'high knee': '3556',      // 'high knee run'
  'quad stretch': '4300',   // 'quadriceps stretch'
  'arm circle': '3905',
  'wall sit': '0734',       // 'sit (wall)'
  'squat jump': '0514',     // 'jump squat'
  'jumping squat': '0514',
  'push up': '0662',
  pushup: '0662',
  'press up': '0662',
  'mountain climber': '0630',
  'jumping jack': '3094',
  'star jump': '3094',
  'butt kick': '3037',
  'child pose': '0945',
  'childs pose': '0945',
  'child s pose': '0945',
  burpee: '1160',
}

// Two indexes of the catalogue by name: the words in order ("plank jack" is not "jack plank",
// and the catalogue has both), then as a bag ("squat jump" finds "jump squat").
const seqOf = s => wordsOf(s).map(singular).filter(w => w !== 'the' && w !== 'a').join(' ')
let exactIdx = null
function exactIndex() {
  if (exactIdx) return exactIdx
  exactIdx = { seq: new Map(), bag: new Map() }
  // First one wins: the catalogue lists the plain movement before its variants.
  for (const e of CATALOGUE) {
    const q = seqOf(e.n), b = bagOf(e.n)
    if (q && !exactIdx.seq.has(q)) exactIdx.seq.set(q, e.id)
    if (b && !exactIdx.bag.has(b)) exactIdx.bag.set(b, e.id)
  }
  return exactIdx
}
const aliasIdx = new Map(Object.entries(FOLLOW_ALONG).map(([k, id]) => [bagOf(k), id]))

// The kit a video is done with, from its title ("60 Minute Full Body Dumbbell Workout"): the
// variant of a lift with that kit is the one the video means. One word per kind, as the
// catalogue spells it in names.
const KIT = [['dumbbell', /\bdumbbells?\b/], ['kettlebell', /\bkettlebells?\b/], ['band', /\b(resistance )?bands?\b/], ['barbell', /\bbarbells?\b/]]
export function equipmentHint(title) {
  const t = String(title || '').toLowerCase()
  return (KIT.find(([, re]) => re.test(t)) || [])[0] || null
}

// One letter off in a long word is OCR ("kicback", "deadlif"), never in a short one ("row"/"rot").
function sameWord(a, b) {
  if (a === b) return true
  if (a.length < 5 || b.length < 5 || Math.abs(a.length - b.length) > 1) return false
  let i = 0, j = 0, edits = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue }
    if (++edits > 1) return false
    if (a.length > b.length) i++
    else if (b.length > a.length) j++
    else { i++; j++ }
  }
  return edits + (a.length - i) + (b.length - j) <= 1
}

const FILLER = new Set(['the', 'a', 'an', 'and', 'with', 'to', 'on', 'of', 'in', 'at', 'feet', 'v'])
// "alternating" and "alternate", "pressing" and "press": one word to the fuzzy scan.
const stem = w => (w.length >= 7 ? w.replace(/(ating|ate|ing|ed)$/, '') : w)
const wordSet = s => [...new Set(wordsOf(s).map(singular).filter(w => !FILLER.has(w)).map(stem))]
let corpus = null
function catalogueWords(S) {
  const own = (S.customEx || []).filter(c => c && c.id && c.n)
  if (!corpus) corpus = CATALOGUE.map(e => ({ id: e.id, n: e.n, w: wordSet(e.n) }))
  return own.length ? [...own.map(c => ({ id: c.id, n: c.n, w: wordSet(c.n), own: true })), ...corpus] : corpus
}

/**
 * How well a catalogue name fits a caption, 0–1. Every caption word that the name has counts for
 * it (one OCR letter off allowed in long words), every word the name adds counts a little against
 * it, and equipment is judged against the video's kit: the kit itself is welcome, other kit the
 * caption never said is a different exercise.
 */
export function fitScore(qWords, nWords, kit) {
  if (!qWords.length || !nWords.length) return 0
  let hit = 0
  const used = new Set()
  for (const q of qWords) {
    const k = nWords.findIndex((n, i) => !used.has(i) && sameWord(q, n))
    if (k >= 0) { hit++; used.add(k) }
  }
  const cover = hit / qWords.length
  if (cover < 0.6) return 0
  let score = cover
  nWords.forEach((n, i) => {
    if (used.has(i)) return
    if (kit && n === stem(kit)) score += 0.1
    else if (EQUIPMENT.test(n)) score -= 0.25
    else score -= 0.12
  })
  return Math.max(0, Math.min(1, score))
}

/**
 * A caption → { id, conf, how, candidates }. `id` is null when nothing is close enough to take
 * without asking; `candidates` are always there for the picker (best first, at most five).
 * `how`: 'custom' | 'exact' | 'alias' | 'fuzzy' | null. `opts.kit`: the video's equipment
 * (equipmentHint), which picks "dumbbell sumo deadlift" over the barbell one for "Sumo Deadlift".
 */
export function matchVideoName(name, S = {}, { kit = null } = {}) {
  const bag = bagOf(name)
  const out = { id: null, conf: 0, how: null, candidates: [] }
  if (!bag) return out
  const own = (S.customEx || []).find(c => c && c.id && bagOf(c.n) === bag)
  if (own) return { id: own.id, conf: 1, how: 'custom', candidates: [own.id] }

  const q = wordSet(name)
  const ranked = catalogueWords(S)
    .map((e, i) => ({ id: e.id, c: fitScore(q, e.w, kit), i }))
    .filter(r => r.c > 0)
    .sort((a, b) => b.c - a.c || a.i - b.i)
  const top = ranked.slice(0, 5).map(r => r.id)
  const withFirst = id => ({ candidates: [...new Set([id, ...top])].slice(0, 5) })

  const idx = exactIndex()
  // The video's own kit first: "Sumo Deadlift" in a dumbbell workout is the dumbbell one.
  const kitted = kit && !q.includes(kit) ? idx.seq.get(seqOf(kit + ' ' + name)) || idx.bag.get(bagOf(kit + ' ' + name)) : null
  if (kitted) return { id: kitted, conf: 0.95, how: 'exact', ...withFirst(kitted) }
  const exact = idx.seq.get(seqOf(name)) || idx.bag.get(bag)
  if (exact) return { id: exact, conf: 0.95, how: 'exact', ...withFirst(exact) }
  const alias = aliasIdx.get(bag)
  if (alias && EXIDX[alias]) return { id: alias, conf: 0.9, how: 'alias', ...withFirst(alias) }
  // The other importers' curated aliases (import-csv.js): "goblet squat", "face pull", … already
  // pinned to the right catalogue entry for FitNotes, Strong and Hevy names. Unless the video's
  // kit says otherwise: the barbell lift an alias names is the wrong one in a dumbbell workout.
  const imported = matchImported(String(name || '')) || matchImported(seqOf(name))
  const importedFits = imported && EXIDX[imported] && (!kit || !EQUIPMENT.test(EXIDX[imported].n) || EXIDX[imported].n.includes(kit))
  if (importedFits) return { id: imported, conf: 0.9, how: 'alias', ...withFirst(imported) }
  const best = ranked[0]
  // Two words of three shared is a guess worth showing pre-selected; less is a question.
  if (best && best.c >= 0.6) return { id: best.id, conf: Math.round(best.c * 0.85 * 100) / 100, how: 'fuzzy', candidates: top }
  return { ...out, candidates: top }
}

/* ------------------------------------------------------------- review rows */

/**
 * The worker's result → rows the review table edits, each with its match filled in.
 *   { rid, section, sectionIdx, text, variants, ocrConf, exId, matchConf, how, candidates,
 *     create, sec, rest, rounds, side, start, dur, thumb, alt }
 * `create` is a pending custom exercise ({ n, bp }) for a row nothing matched — never dropped.
 */
/** A caption as a name: OCR debris off both ends ("Front Loaded Deadlif%'!" → "Front Loaded Deadlif"). */
export const tidyName = s => String(s || '').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N})]+$/gu, '').replace(/\s+/g, ' ').trim()

export function draftRows(result, S = {}) {
  const rows = []
  const sections = result?.draft?.sections || []
  const kit = equipmentHint(result?.source?.title)
  sections.forEach((s, si) => {
    for (const r of s.rows || []) {
      const shown = tidyName(r.name)
      let m = matchVideoName(shown, S, { kit })
      // A rest screen that named this exercise is a second reading worth trying.
      if (!m.id && r.alt) { const a = matchVideoName(r.alt, S, { kit }); if (a.id) m = a }
      const first = (r.occurrences || [])[0] || { start: 0, dur: r.sec }
      rows.push({
        rid: r.id || 'v' + rows.length,
        section: s.kind, sectionIdx: si,
        text: shown, variants: r.variants || [], alt: r.alt || null,
        ocrConf: typeof r.conf === 'number' ? r.conf : 0,
        exId: m.id, matchConf: m.conf, how: m.how, candidates: m.candidates,
        create: m.id ? null : { n: shown.toLowerCase(), bp: bpFromName(shown) || (s.kind === 'stretch' ? 'upper legs' : 'cardio') },
        sec: Math.max(1, Math.round(r.sec || 0)), rest: Math.max(0, Math.round(r.rest || 0)),
        rounds: Math.max(1, Math.round(r.rounds || 1)), side: !!r.side,
        start: first.start, dur: first.dur, occurrences: r.occurrences || [],
        thumb: typeof r.thumb === 'string' && r.thumb.startsWith('data:image/') ? r.thumb : null
      })
    }
  })
  return rows
}

/** The confidence the table shows: the weaker of how well it was read and how well it matched. */
export function rowConfidence(row) {
  if (!row) return 0
  const match = row.exId ? (row.matchConf || 0.5) : 0
  return Math.round(Math.min(row.ocrConf || 0, match || 0) * 100) / 100
}

/** Two rows that are one exercise read two ways: the first keeps its match, the times add up. */
export function mergeRows(rows, keepRid, dropRid) {
  const keep = rows.find(r => r.rid === keepRid), drop = rows.find(r => r.rid === dropRid)
  if (!keep || !drop || keep === drop) return rows
  const merged = {
    ...keep,
    variants: [...new Set([...keep.variants, ...drop.variants, drop.text])],
    occurrences: [...keep.occurrences, ...drop.occurrences].sort((a, b) => a.start - b.start),
    // An interval done in two readings is done more times; a warm-up move read twice ran longer.
    ...(keep.section === 'interval' ? { rounds: keep.rounds + drop.rounds } : { sec: keep.sec + drop.sec })
  }
  return rows.filter(r => r.rid !== dropRid).map(r => (r.rid === keepRid ? merged : r))
}

/* ------------------------------------------------------------ the routine */

const MAX_SETS = 20
const MAX_SEC = 3600

/**
 * Reviewed rows → { routine, customEx }.
 * opts: { name, source: { url, id, title, channel }, labels: { warmup, stretch, other } }
 * The labels are the group names in the reader's language; the caller passes them through t().
 */
export function buildVideoRoutine(rows, { name, source = {}, labels = {}, customEx = [] } = {}) {
  const created = []
  const idFor = row => {
    if (row.exId && (EXIDX[canonicalExId(row.exId)] || customEx.some(c => c.id === row.exId) || created.some(c => c.id === row.exId))) {
      return EXIDX[canonicalExId(row.exId)] ? canonicalExId(row.exId) : row.exId
    }
    const n = String(row.create?.n || row.text || '').trim().toLowerCase().slice(0, 80)
    if (!n) return null
    const id = importId('vi', 'video|' + n)
    if (!created.some(c => c.id === id) && !customEx.some(c => c.id === id)) {
      created.push({ id, n, custom: true, eq: 'body weight', tg: '', desc: '', bp: row.create?.bp || bpFromName(n) || 'cardio' })
    }
    return id
  }
  const ex = []
  // The video's own order: its sections as they came (a warm-up, two interval blocks with a
  // finisher between them, a stretch), and inside each the order it first did each exercise.
  const ordered = rows.slice().sort((a, b) => a.sectionIdx - b.sectionIdx || a.start - b.start)
  const groups = new Map()
  for (const row of ordered) {
    const id = idFor(row)
    if (!id) continue
    const sec = Math.min(MAX_SEC, Math.max(1, Math.round(row.sec) || 1))
    const cfg = { id, mode: 'time', sec, weight: 0 }
    if (row.section === 'interval') {
      cfg.sets = Math.min(MAX_SETS, Math.max(1, Math.round(row.rounds) || 1))
      const rest = Math.round(row.rest) || 0
      if (rest > 0) cfg.restSec = rest
    } else {
      cfg.sets = 1
      if (row.side) cfg.side = true
      const key = row.section + ':' + row.sectionIdx
      if (!groups.has(key)) groups.set(key, { sg: 'vs' + uid(), name: labels[row.section] || '' })
      const g = groups.get(key)
      cfg.sg = g.sg
      if (g.name) cfg.sgName = g.name
    }
    ex.push(cfg)
  }
  // A group of one is just an exercise: no superset around a lone stretch.
  ex.forEach((e, i) => {
    if (e.sg && !(ex[i - 1]?.sg === e.sg || ex[i + 1]?.sg === e.sg)) { delete e.sg; delete e.sgName }
  })
  const routine = {
    id: uid(),
    name: String(name || source.title || '').trim().slice(0, 80) || 'Video workout',
    emoji: 'timer',
    ...(source.url ? { sourceUrl: source.url } : {}),
    ...(source.id ? { videoId: source.id } : {}),
    ex
  }
  const used = new Set(ex.map(e => e.id))
  return { routine, customEx: created.filter(c => used.has(c.id)) }
}

/** Into state (inside store.update). { added } or { updated } — a re-import replaces in place. */
export function mergeVideoRoutine(S, built) {
  S.customEx = S.customEx || []
  S.routines = S.routines || []
  for (const c of built.customEx || []) if (!S.customEx.some(x => x.id === c.id)) S.customEx.push(c)
  const r = built.routine
  const existing = r.videoId ? S.routines.find(x => x && x.videoId === r.videoId) : null
  if (existing) {
    existing.name = r.name
    existing.ex = r.ex
    if (r.sourceUrl) existing.sourceUrl = r.sourceUrl
    return { updated: 1, id: existing.id }
  }
  S.routines.push(r)
  return { added: 1, id: r.id }
}

/** "1:23" → a YouTube link that starts there, for checking a row against the video. */
export function videoLinkAt(url, sec) {
  if (!url) return null
  try {
    const u = new URL(url)
    u.searchParams.set('t', Math.max(0, Math.floor(sec || 0)) + 's')
    return u.toString()
  } catch { return null }
}
