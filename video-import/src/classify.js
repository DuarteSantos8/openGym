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
import { similarity, sameName, sideOf, sectionTitle, displayName, median, snapSec, mode, SAME_NAME } from './text.js'

export const MAX_WORK = 120
export const MAX_REST = 60
export const SECTION_BREAK = 120   // a rest this long ends an interval section
const MIN_INTERVALS = 3
const MIN_TIMED = 10   // seconds: a timed hold shorter than this is a countdown to the next thing

// A gap the countdown measured (a move nobody named) is a move, not a rest.
const isRestish = b => b && (b.kind === 'rest' || (b.kind === 'gap' && !b.timed))

/** The kind a hint range or the block's own caption gives it, or null. */
function hintFor(b, hints) {
  // The video's own chapter first: a "Quad stretch" in the middle of a chapter called "Mobility
  // warm-up" is part of the warm-up. The caption's word decides only where no chapter does.
  const mid = b.start + b.dur / 2
  const h = (hints || []).find(x => mid >= x.start && mid < x.end)
  if (h) return h.kind
  return sectionTitle(b.text || b.key)
}

/** A block that runs across a chapter boundary ends there: what follows is the next part. */
function cutAtParts(blocks, parts) {
  if (!parts?.length) return blocks
  const edges = parts.flatMap(p => [p.start, p.end])
  const out = []
  for (const b of blocks) {
    const cut = edges.find(e => e > b.start + MIN_TIMED && e < b.end - MIN_TIMED)
    if (b.kind !== 'work' || cut == null) { out.push(b); continue }
    out.push({ ...b, end: cut, dur: cut - b.start })
    out.push({ start: cut, end: b.end, dur: b.end - cut, kind: 'gap', key: '', text: '', conf: 0, variants: {}, next: null, resets: true, timerMax: null })
  }
  return out
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
    Object.assign(g, { kind: 'work', key: a.key, text: a.text, conf: a.conf, variants: a.variants, fromPreview: true, captionAt: a.start })
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

export function classify(blocks, { hints = [], parts = [], cuts = [], timed = false } = {}) {
  // The video's own parts, from its chapters ("Group 1: Lower body"): a block never runs across
  // two of them, and each section is named after the part it is in.
  const partOf = b => (parts || []).findIndex(p => b.start + b.dur / 2 >= p.start && b.start + b.dur / 2 < p.end)
  const joined = joinNeighbours((blocks || []).filter(b => b && b.dur > 0))
  // Blocks from the countdown already know which caption names which exercise.
  const preview = timed ? false : previewLayout(joined)
  const bs = cutAtParts(joined, parts)
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
  // A move that follows another with no rest between, and then a pause much longer than the
  // workout's rests (the minute to fetch the dumbbells), is the last of a warm-up, not the first
  // interval. The same for a stretch that a long pause leads into.
  const typicalRest = median(bs.filter((b, j) => flag[j - 1] && isRestish(b)).map(b => b.dur)) || 0
  const moves = b => b && (b.kind === 'work' || (b.kind === 'gap' && b.timed))
  const chained = (x, y) => moves(bs[x]) && moves(bs[y]) && Math.abs(bs[y].start - bs[x].end) <= 2
  const longPause = b => isRestish(b) && typicalRest > 0 && b.dur > typicalRest * 1.5
  while (i < bs.length) {
    if (!flag[i] || (chained(i - 1, i) && longPause(bs[i + 1]))) { i++; continue }
    let j = i, count = 0, last = i
    while (j < bs.length) {
      if (bs[j].kind === 'work' && parts.length && partOf(bs[j]) !== partOf(bs[i])) break
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
    if (bs[k] && bs[k].kind === 'work' && !flag[k] && hintFor(bs[k], hints) == null && Math.abs(bs[k].dur - med) <= Math.max(3, med * 0.25) && !(chained(k, k + 1) && longPause(bs[k - 1]))) {
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
    const kind = hintFor(b, hints) || (!ranges.length ? 'other' : x < firstIv ? 'warmup' : x > lastIv ? 'stretch' : 'other')
    // A hold the timer counts out but no caption names, in a warm-up or a cool-down of
    // 30-second stretches: an exercise all the same, with no name, for the review screen to
    // ask about. Between two blocks the same thing is a transition, and is left out.
    if (b.kind === 'gap' && b.timed && b.dur >= MIN_TIMED && b.dur <= MAX_WORK && (kind === 'warmup' || kind === 'stretch')) {
      Object.assign(b, { kind: 'work', key: '', text: '', conf: 0, variants: {}, unnamed: true })
    }
    if (b.kind !== 'work') continue
    if (!loose || loose.kind !== kind) { loose = { kind, blocks: [] }; sections.push(loose) }
    loose.blocks.push(b)
  }
  const built = sections.map(s => (s.rows ? s : looseSection(s.kind, s.blocks)))
  for (const s of built) {
    const i = (parts || []).findIndex(p => (s.start + s.end) / 2 >= p.start && (s.start + s.end) / 2 < p.end)
    if (i >= 0) { s.part = i; s.label = parts[i].label }
  }
  const out = harmonise(pairRounds(mergeIntervals(built)), { cuts, timed })
  // A section is as many rounds as its exercises were done.
  for (const s of out) if (s.kind === 'interval' && s.rows.length) s.rounds = Math.max(...s.rows.map(r => r.rounds))
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
    // When the caption was on screen, where that differs from when the move ran (a "NEXT" screen).
    ...(blocks[0].captionAt != null ? { captionAt: blocks[0].captionAt } : {}),
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
    const prev = k >= 0 && res[k].kind === 'interval' && res[k].part === s.part ? res[k] : null
    const shared = prev ? s.rows.filter(r => prev.rows.some(p => sameName(p.key, r.key))).length : 0
    // A block cut in two by a longer pause (a minute to set up the next exercises) is one block:
    // same part of the video, same work and rest, and no more than a minute and a half apart.
    const close = prev && k === res.length - 1 && s.start - prev.end <= 90 && near(s.work || 0, prev.work || 0) && near(s.rest || 0, prev.rest || 0, 0.4)
    if (prev && close && shared < Math.min(prev.rows.length, s.rows.length) * 0.5) {
      prev.rows.push(...s.rows); prev.end = s.end
      continue
    }
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

/* --------------------------------------------------------------- timing */

const near = (x, target, frac = 0.25) => target > 0 && Math.abs(x - target) <= Math.max(3, target * frac)
const onsets = rows => rows.flatMap(r => (r.occurrences || []).map(o => o.start)).sort((a, b) => a - b)
const steps = list => list.slice(1).map((t, i) => t - list[i]).filter(d => d > 0)

/**
 * The timing a follow-along actually uses, from the whole section instead of each caption.
 *
 * A caption's own length drifts with where OCR first and last caught it (35 s, 45 s for a 40 s
 * exercise). The video's beat does not: exercises start at a steady period (60 s = 40 on + 20
 * off), and every work and rest that is close to the section's typical value is that value.
 *
 * In a warm-up or a cool-down the beat is the hold (30 s a move). A row much longer than it — a
 * stretch of moves nobody could tell apart, with no names on screen — is cut into holds of that
 * length: the first keeps its name, the rest arrive with no name for the review screen to ask
 * about, each with its own moment in the video.
 */
export function harmonise(sections, { cuts = [], timed = false } = {}) {
  const holds = []
  for (const s of sections) {
    if (s.kind === 'interval') {
      const work = median(s.rows.flatMap(r => Array(r.rounds || 1).fill(r.sec)))
      const rest = median(s.rows.filter(r => r.rest > 0).map(r => r.rest))
      const period = median(steps(onsets(s.rows)))
      // The beat decides the work when the rest is known: 60 s apart with 20 s off is 40 s on.
      const beat = rest > 0 && period > rest ? snapSec(period - rest) : 0
      const W = beat && near(beat, work, 0.3) ? beat : snapSec(work)
      const R = rest > 0 ? snapSec(rest) : 0
      // An exercise ends a rest before the next one starts. The last of a round runs into whatever
      // comes next (the next group's intro, a longer break) and reads long without that limit;
      // with no next start at all it is as long as the others.
      const all = onsets(s.rows)
      const room = o => { const n = all.find(t => t > o.start); return n == null ? W : n - o.start - R }
      for (const r of s.rows) {
        const most = median((r.occurrences || []).map(room))
        if (most > 0 && r.sec > most) r.sec = snapSec(most)
        if (near(r.sec, W)) r.sec = W
        if (R && near(r.rest, R, 0.4)) r.rest = R
      }
      s.work = W
      if (R) s.rest = R
    } else if (s.kind === 'warmup' || s.kind === 'stretch') {
      // A beat only when the moves really keep one: most starts the same distance apart.
      delete s.beat
      const d = steps(onsets(s.rows)).filter(x => x >= MIN_TIMED && x <= MAX_WORK)
      const m = median(d)
      if (d.length >= 3 && d.filter(x => Math.abs(x - m) <= 3).length >= d.length * 0.7) { holds.push(m); s.beat = snapSec(m) }
    }
  }
  // The hold of the named moves, where some section keeps a beat: the fallback for a stretch
  // with neither names nor cuts to go by.
  const named = holds.length ? snapSec(median(holds)) : 0
  for (const s of sections) {
    if (s.kind !== 'warmup' && s.kind !== 'stretch') continue
    // Moves the countdown laid out are right as they are.
    // Moves the countdown laid out keep their lengths, up to the few seconds a countdown read late
    // or run into the next announcement costs: those take the section's usual length.
    if (timed) {
      // A few seconds of countdown at the very end of a part (the last "3, 2, 1" before the
      // outro) is not a move.
      s.rows = s.rows.filter(r => r.sec >= MIN_TIMED)
      const usual = mode(s.rows.map(r => snapSec(r.sec))).value
      if (usual) for (const r of s.rows) if (Math.abs(r.sec - usual) <= 5) r.sec = usual
      continue
    }
    const byCuts = movesByCuts(s, cuts)
    if (byCuts) { s.rows = byCuts; continue }
    const hold = s.beat || named
    // A move lasts until the next one starts: a caption shown for part of a hold says when the
    // hold began, not how long it was.
    if (s.beat) s.rows.forEach((r, i) => {
      const nx = s.rows[i + 1]
      if (r.side || !nx || (r.occurrences || []).length !== 1 || (nx.occurrences || []).length < 1) return
      const gap = nx.occurrences[0].start - r.occurrences[0].start
      if (gap >= MIN_TIMED && gap <= hold * 1.5) r.sec = snapSec(gap)
    })
    const rows = []
    for (const r of s.rows) {
      const o = (r.occurrences || [])[0]
      // A row much longer than a move: the picture's own cuts say where each move starts.
      const bounds = !r.side && (r.occurrences || []).length === 1 && r.sec >= MIN_SPLIT
        ? periodicSplit(o.start, o.start + r.sec, cuts) || (hold ? evenSplit(o.start, o.start + r.sec, hold) : null)
        : null
      if (!bounds) {
        if (s.beat && !r.side && near(r.sec, hold)) r.sec = hold
        rows.push(r)
        continue
      }
      bounds.slice(0, MAX_SPLIT).forEach(([a, b], k) => {
        const sec = snapSec(b - a)
        // The still from the first third: the move itself, before the next one is announced.
        const piece = { ...r, sec, rounds: 1, rest: 0, occurrences: [{ start: a, dur: b - a }], thumbT: a + Math.max(1, Math.floor((b - a) / 3)) }
        rows.push(k === 0 ? piece : { ...piece, name: '', key: '', variants: [], alt: null, conf: 0, unnamed: true })
      })
    }
    s.rows = rows
  }
  return sections
}

/** Seconds where the picture cuts: far bigger changes than the frames around them. */
export function cutsOf(scene) {
  const v = (scene || []).map(x => Number(x) || 0)
  const base = median(v.filter(x => x > 0)) || 1
  const level = Math.max(CUT_MIN, base * 4)
  const out = []
  v.forEach((x, t) => { if (x >= level && !(out.length && t - out[out.length - 1] <= 2)) out.push(t) })
  return out
}

/**
 * [a, b) cut into moves by the rhythm of its cuts, or null when they keep none. A follow-along
 * changes the picture at the same moments every move (the move starts, its "next" preview comes
 * up): the period is the distance that most cuts have another cut at. The pieces start at the
 * cut that opens the longest stretch of each period — the move itself, not its announcement.
 */
export function periodicSplit(a, b, cuts) {
  const cs = (cuts || []).filter(t => t > a - 2 && t < b + 2)
  if (cs.length < 4) return null
  const has = t => cs.some(c => Math.abs(c - t) <= 1)
  // A period is real when cuts keep coming at it: a cut, another one P later, and another one P
  // after that. Two cuts per move (the move, its preview) make half the move's length look as
  // good on single pairs; only the true period chains. Its multiples chain too, so the smallest
  // period that scores close to the best wins.
  const chains = P => cs.filter(c => has(c + P) && has(c + 2 * P)).length
  const scored = []
  for (let P = MIN_TIMED; P <= Math.min(MAX_WORK, (b - a) / 2); P++) scored.push({ P, score: chains(P) })
  const top = Math.max(0, ...scored.map(x => x.score))
  if (top < 3) return null
  const P = scored.find(x => x.score >= top * 0.8).P
  const opening = cs.filter(c => has(c + P) && has(c + 2 * P))
  const next = c => cs.find(x => x > c + 1) ?? b
  const anchor = opening.slice(0, 3).reduce((x, c) => (next(c) - c > next(x) - x ? c : x), opening[0])
  const starts = [anchor]
  for (let t = anchor - P; t >= a - 2; t -= P) starts.unshift(cs.find(x => Math.abs(x - t) <= 2) ?? t)
  for (let t = anchor + P; t < b - MIN_TIMED; t += P) {
    const c = cs.find(x => Math.abs(x - t) <= 2)
    starts.push(c ?? t)
  }
  const pieces = []
  if (starts[0] - a >= MIN_TIMED) pieces.push([a, starts[0]])
  starts.forEach((t, i) => pieces.push([Math.max(a, t), Math.min(b, starts[i + 1] ?? b)]))
  return pieces.filter(([x, y]) => y - x >= MIN_TIMED).map(([x, y]) => [Math.round(x), Math.round(y)])
}

/** [a, b) cut into pieces of `hold` seconds: the last resort, a beat the video kept elsewhere. */
function evenSplit(a, b, hold) {
  const out = []
  for (let t = a; t < b - MIN_TIMED; t += hold) out.push([t, Math.min(b, t + hold)])
  return out
}
const CUT_MIN = 20
const MAX_SPLIT = 20
const MIN_SPLIT = 90   // seconds: shorter rows are left whole

/**
 * A warm-up or cool-down laid out by the picture: its moves are the periods of its cuts, and each
 * caption is given to the move it names. With no rest between moves a follow-along announces the
 * next one while the current one is still going ("NEXT: T-spine opener" ten seconds before the
 * end): a caption that comes up in the second half of a move names the one after it. A caption
 * at the start of a move names that move. Moves no caption named arrive unnamed, each with its
 * own moment in the video. null when the cuts keep no rhythm, or the rows are not simple holds
 * (left/right pairs, repeats): the caption-by-caption rows stand then.
 */
export function movesByCuts(section, cuts) {
  const rows = section.rows || []
  if (!rows.length || rows.some(r => r.side || (r.occurrences || []).length !== 1)) return null
  const shown = r => r.captionAt ?? r.occurrences[0].start
  const a = Math.min(...rows.map(r => Math.min(shown(r), r.occurrences[0].start)))
  const b = Math.max(...rows.map(r => r.occurrences[0].start + r.occurrences[0].dur), section.end || 0)
  const moves = periodicSplit(a, b, cuts)
  if (!moves || moves.length < rows.length) return null
  const owner = new Array(moves.length).fill(null)
  for (const r of rows) {
    if (!r.key) continue
    const t = shown(r)
    let k = moves.findIndex(([x, y]) => t >= x && t < y)
    if (k < 0) k = t < moves[0][0] ? 0 : moves.length - 1
    const [x, y] = moves[k]
    if ((t - x) / (y - x) >= 0.5 && k + 1 < moves.length) k++
    if (!owner[k]) owner[k] = r
  }
  return moves.map(([x, y], k) => {
    const piece = { sec: snapSec(y - x), rounds: 1, rest: 0, side: false, occurrences: [{ start: x, dur: y - x }], thumbT: x + Math.max(1, Math.floor((y - x) / 3)) }
    const r = owner[k]
    if (r) { const { captionAt, ...rest } = r; return { ...rest, ...piece } }
    return { name: '', key: '', variants: [], alt: null, conf: 0, unnamed: true, ...piece }
  })
}

/**
 * One exercise read two ways in two rounds ("Drop Sit-Up" in round one, "Drop 81t-Te" in round
 * two) is one exercise: in a section done in rounds, two rows seen once each, exactly one round
 * apart, are joined. The round's length comes from the rows that were read the same both times.
 * The better-read name stays.
 */
export function pairRounds(sections) {
  for (const s of sections) {
    if (s.kind !== 'interval') continue
    const laps = s.rows.filter(r => (r.occurrences || []).length >= 2).map(r => r.occurrences[1].start - r.occurrences[0].start)
    if (laps.length < 2) continue
    const lap = median(laps)
    const single = s.rows.filter(r => (r.occurrences || []).length === 1)
    for (const a of single) {
      if (!s.rows.includes(a)) continue
      // Never the left and the right of one move: those are two exercises, not two readings.
      const sides = x => sideOf(x.key).side
      const b = single.find(x => x !== a && s.rows.includes(x) && Math.abs(x.occurrences[0].start - a.occurrences[0].start - lap) <= 3 &&
        !(sides(a) && sides(x) && sides(a) !== sides(x)))
      if (!b) continue
      const [keep, drop] = (b.conf || 0) > (a.conf || 0) ? [b, a] : [a, b]
      const joined = combineRows(a, b)
      Object.assign(joined, { name: keep.name, key: keep.key, conf: keep.conf, occurrences: [...a.occurrences, ...b.occurrences], thumbT: a.thumbT })
      s.rows[s.rows.indexOf(a)] = joined
      s.rows.splice(s.rows.indexOf(b), 1)
      void drop
    }
  }
  return sections
}
