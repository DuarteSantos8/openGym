// Blocks → sections → the rows the review table shows.
//
// Pure. A follow-along video is nearly always the same three parts: a warm-up of continuous
// moves, one or more blocks of intervals (work, short rest, work, short rest …, several rounds),
// and a stretch of timed holds at the end. So:
//
//  - An interval is a work block of at most MAX_WORK seconds followed by a rest (a REST screen,
//    or a stretch of seconds with no caption) of at most MAX_REST. Three or more of them in a row
//    are an interval section. A longer rest ends the section.
//  - Work before the first interval section is the warm-up, work after the last is the stretch,
//    unless a caption or a chapter title says which section a block is in (a `hint`).
//  - Rows: one per exercise per section. In an interval section an exercise done once per round
//    is one row with `rounds` = how many times it was done, `sec` its work time and `rest` the
//    break after it — the routine the app builds does it as that many timed sets with that rest
//    between them. In a warm-up or a stretch a left and a right block of the same move are one
//    per-side row.

import { detectRounds } from './rounds.js'
import { similarity, sameName, sideOf, sectionWord, displayName, median, snapSec, mode, SAME_NAME } from './text.js'

export const MAX_WORK = 120
export const MAX_REST = 60
export const SECTION_BREAK = 120   // a rest this long ends an interval section
const MIN_INTERVALS = 3

const isRestish = b => b && (b.kind === 'rest' || b.kind === 'gap')

/** The kind a hint range or the block's own caption gives it, or null. */
function hintFor(b, hints) {
  const own = sectionWord(b.text || b.key)
  if (own) return own
  const mid = b.start + b.dur / 2
  const h = (hints || []).find(x => mid >= x.start && mid < x.end)
  return h ? h.kind : null
}

/**
 * The "NEXT" layout: a creator who shows the name only on the short screen before an exercise
 * ("NEXT · SIDE SQUATS", with a preview), and nothing at all while it is done. Read as captions,
 * that is a short named block followed by a longer stretch with no caption, over and over. When
 * most named blocks look like that, the name moves onto the stretch that follows it, and the named
 * block becomes the rest it really is.
 */
export function previewLayout(bs) {
  const work = bs.filter(b => b.kind === 'work')
  const pairs = []
  for (let i = 0; i + 1 < bs.length; i++) {
    const a = bs[i], g = bs[i + 1]
    if (a.kind === 'work' && g.kind === 'gap' && a.dur <= MAX_PREVIEW && g.dur >= a.dur) pairs.push(i)
  }
  if (pairs.length < MIN_INTERVALS || pairs.length < work.length * 0.6) return false
  for (const i of pairs) {
    const a = bs[i], g = bs[i + 1]
    Object.assign(g, { kind: 'work', key: a.key, text: a.text, conf: a.conf, variants: a.variants, fromPreview: true })
    Object.assign(a, { kind: 'rest', next: a.key })
  }
  return true
}
const MAX_PREVIEW = 30

/** Neighbouring blocks of one name, split by a misread or a flicker, back into one. */
function joinNeighbours(blocks) {
  const out = []
  for (const b of blocks) {
    const prev = out[out.length - 1]
    // A timer restart keeps two blocks of one name apart (the same exercise twice in a row), but
    // not when a piece is only seconds long: that is one announcement the timer misread chopped up.
    const chopped = Math.min(prev?.dur ?? 0, b.dur) < 10
    if (prev && prev.kind === 'work' && b.kind === 'work' && (!b.resets || chopped) && sameName(prev.key, b.key)) {
      prev.end = b.end; prev.dur = prev.end - prev.start
      for (const [k, c] of Object.entries(b.variants || {})) prev.variants[k] = (prev.variants[k] || 0) + c
      prev.conf = Math.max(prev.conf || 0, b.conf || 0)
      continue
    }
    out.push({ ...b, variants: { ...(b.variants || {}) } })
  }
  return out
}

export function classify(blocks, { hints = [] } = {}) {
  const bs = joinNeighbours((blocks || []).filter(b => b && b.dur > 0))
  const preview = previewLayout(bs)
  // A rest screen that names the next exercise speaks for a work block OCR could not read.
  for (let i = 0; i < bs.length; i++) {
    const b = bs[i], nx = bs[i + 1]
    if (isRestish(b) && b.next && nx && nx.kind === 'gap') { nx.kind = 'work'; nx.key = b.next; nx.text = b.next; nx.conf = 0.4; nx.fromHint = true }
    if (isRestish(b) && b.next && nx && nx.kind === 'work' && nx.conf < 0.5 && similarity(nx.key, b.next) < SAME_NAME) {
      nx.alt = b.next
    }
  }

  // Interval flags: work, short, followed by a short rest.
  const flag = bs.map((b, i) => b.kind === 'work' && b.dur <= MAX_WORK && isRestish(bs[i + 1]) && bs[i + 1].dur <= MAX_REST && hintFor(b, hints) == null)

  // Interval sections: index ranges [from, to] over bs.
  const ranges = []
  let i = 0
  while (i < bs.length) {
    if (!flag[i]) { i++; continue }
    let j = i, count = 0, last = i
    while (j < bs.length) {
      if (bs[j].kind === 'work') {
        // A longer rest between two rounds (60–120 s) keeps the section going when intervals
        // follow it; the work before it is an interval like the others.
        const bridged = !flag[j] && bs[j].dur <= MAX_WORK && isRestish(bs[j + 1]) && bs[j + 1].dur <= SECTION_BREAK && flag[j + 2] && hintFor(bs[j], hints) == null
        if (!flag[j] && !bridged) break
        count++; last = j
      } else if (isRestish(bs[j]) && bs[j].dur > SECTION_BREAK) break
      j++
    }
    // The last interval of a section usually runs straight into the next part, with no rest
    // after it: it belongs here when it is as long as the others.
    const works = bs.slice(i, last + 1).filter(b => b.kind === 'work')
    const med = median(works.map(b => b.dur))
    let k = last + 1
    while (k < bs.length && isRestish(bs[k]) && bs[k].dur <= MAX_REST) k++
    if (bs[k] && bs[k].kind === 'work' && !flag[k] && hintFor(bs[k], hints) == null && Math.abs(bs[k].dur - med) <= Math.max(3, med * 0.25)) {
      last = k; count++
    }
    if (count >= MIN_INTERVALS) { ranges.push([i, last]); i = last + 1 } else i = j + 1
  }

  const sections = []
  const firstIv = ranges.length ? ranges[0][0] : bs.length
  const lastIv = ranges.length ? ranges[ranges.length - 1][1] : -1
  let r = 0
  let loose = null   // the warm-up / stretch / other section being filled
  for (let x = 0; x < bs.length; x++) {
    if (r < ranges.length && x === ranges[r][0]) {
      loose = null
      sections.push(intervalSection(bs.slice(ranges[r][0], ranges[r][1] + 1)))
      x = ranges[r][1]
      r++
      continue
    }
    const b = bs[x]
    if (b.kind !== 'work') continue
    const kind = hintFor(b, hints) || (!ranges.length ? 'other' : x < firstIv ? 'warmup' : x > lastIv ? 'stretch' : 'other')
    if (!loose || loose.kind !== kind) { loose = { kind, blocks: [] }; sections.push(loose) }
    loose.blocks.push(b)
  }
  const out = mergeIntervals(sections.map(s => (s.rows ? s : looseSection(s.kind, s.blocks))))
  let n = 0
  for (const s of out) for (const row of s.rows) row.id = 'v' + (++n)
  return { sections: out.filter(s => s.rows.length), ...(preview ? { layout: 'preview' } : {}) }
}

function occurrence(b) { return { start: b.start, dur: b.dur } }

function rowFrom(blocks, extra) {
  const variants = {}
  for (const b of blocks) for (const [k, c] of Object.entries(b.variants || { [b.key]: 1 })) variants[k] = (variants[k] || 0) + c
  const key = mode(Object.entries(variants).flatMap(([k, c]) => Array(c).fill(k))).value || blocks[0].key
  const shown = blocks.find(b => b.key === key) || blocks[0]
  return {
    name: displayName(shown.text || key), key,
    variants: Object.keys(variants),
    alt: blocks.map(b => b.alt).find(Boolean) || null,
    conf: Math.round(blocks.reduce((s, b) => s + (b.conf || 0), 0) / blocks.length * 100) / 100,
    occurrences: blocks.map(occurrence),
    thumbT: blocks[0].start + Math.floor(blocks[0].dur / 2),
    ...extra
  }
}

function intervalSection(slice) {
  const works = []
  for (let i = 0; i < slice.length; i++) {
    if (slice[i].kind !== 'work') continue
    const nx = slice[i + 1]
    works.push({ b: slice[i], rest: isRestish(nx) ? nx.dur : 0 })
  }
  const { rounds, period } = detectRounds(works.map(w => w.b.key))
  // One row per exercise, in the order the video first does them.
  const groups = []
  for (const w of works) {
    const g = groups.find(x => sameName(x.key, w.b.key))
    if (g) g.items.push(w); else groups.push({ key: w.b.key, items: [w] })
  }
  // A short rest is the break between intervals; a longer one (after the last exercise of a
  // round) is the break between rounds, which the routine has no place for — the row takes the
  // short one, and the section reports the long one for the review screen to show.
  const short = x => x > 0 && x <= MAX_REST
  const restAll = works.map(w => w.rest).filter(short)
  const roundRest = works.map(w => w.rest).filter(x => x > MAX_REST)
  const rows = groups.map(g => rowFrom(g.items.map(w => w.b), {
    sec: snapSec(median(g.items.map(w => w.b.dur))),
    // The last interval has no rest after it; the section's usual rest is what it would have had.
    rest: snapSec(median(g.items.map(w => w.rest).filter(short)) || median(restAll)),
    rounds: g.items.length,
    side: false
  }))
  return {
    kind: 'interval',
    start: slice[0].start, end: slice[slice.length - 1].end,
    rounds: period ? rounds : 1,
    work: snapSec(median(works.map(w => w.b.dur))),
    rest: snapSec(median(restAll)),
    roundRest: roundRest.length ? snapSec(median(roundRest)) : 0,
    rows
  }
}

function looseSection(kind, blocks) {
  const rows = []
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]
    const s = sideOf(b.key)
    const nx = blocks[i + 1]
    const ns = nx ? sideOf(nx.key) : null
    // A left and a right of the same move, one after the other: one per-side row.
    if (s.side && ns && ns.side && ns.side !== s.side && similarity(s.base, ns.base) >= SAME_NAME) {
      const row = rowFrom([b, nx], { sec: snapSec(median([b.dur, nx.dur])), rest: 0, rounds: 1, side: true })
      row.name = displayName(s.base); row.key = s.base
      rows.push(row)
      i++
      continue
    }
    const prev = rows[rows.length - 1]
    // The same move again straight after (a caption that changed style mid-way): one longer row.
    if (prev && !prev.side && sameName(prev.key, b.key)) {
      prev.occurrences.push(occurrence(b))
      prev.sec = snapSec(prev.occurrences.reduce((t, o) => t + o.dur, 0))
      continue
    }
    rows.push(rowFrom([b], { sec: snapSec(b.dur), rest: 0, rounds: 1, side: false }))
  }
  return { kind, start: blocks[0]?.start ?? 0, end: blocks.length ? blocks[blocks.length - 1].end : 0, rounds: 1, rows }
}

/** Something OCR made up between two parts of a block: a few seconds of low-confidence readings. */
const isJunk = s => s.kind === 'other' && s.rows.every(r => (r.conf || 0) < 0.5) && s.rows.reduce((t, r) => t + (r.sec || 0), 0) <= 60

function combineRows(a, b) {
  const n = a.rounds + b.rounds
  const avg = (x, y) => snapSec((x * a.rounds + y * b.rounds) / n)
  return {
    ...a,
    variants: [...new Set([...(a.variants || []), ...(b.variants || [])])],
    conf: Math.max(a.conf || 0, b.conf || 0),
    occurrences: [...a.occurrences, ...b.occurrences],
    sec: avg(a.sec, b.sec),
    rest: avg(a.rest, b.rest),
    rounds: n
  }
}

/**
 * Two interval sections that do the same exercises are one block read in two pieces: a misread,
 * a longer break, a few seconds of nonsense between them cut it. They become one section whose
 * rows count every round, with whatever OCR invented in between kept as rows of its own for the
 * review screen (never dropped, the user deletes them). Sections with different exercises stay
 * apart: a lower-body block and an upper-body block are two blocks.
 */
export function mergeIntervals(sections) {
  const res = []
  for (const s of sections) {
    if (s.kind !== 'interval') { res.push(s); continue }
    let k = res.length - 1
    while (k >= 0 && isJunk(res[k])) k--
    const prev = k >= 0 && res[k].kind === 'interval' ? res[k] : null
    const shared = prev ? s.rows.filter(r => prev.rows.some(p => sameName(p.key, r.key))).length : 0
    if (!prev || shared < Math.min(prev.rows.length, s.rows.length) * 0.5) { res.push(s); continue }
    const junk = res.splice(k + 1)
    for (const j of junk) prev.rows.push(...j.rows)
    for (const r of s.rows) {
      const i = prev.rows.findIndex(p => sameName(p.key, r.key))
      if (i >= 0) prev.rows[i] = combineRows(prev.rows[i], r)
      else prev.rows.push(r)
    }
    prev.end = s.end
    prev.rounds = Math.max(prev.rounds || 1, ...prev.rows.map(r => r.rounds))
    if (s.roundRest && !prev.roundRest) prev.roundRest = s.roundRest
  }
  return res
}
