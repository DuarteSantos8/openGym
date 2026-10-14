// One OCR reading per second → the blocks of the video: "burpees for 40 s", "rest for 20 s".
//
// Pure. The input is what the OCR step produced for every sampled frame, in time order:
//   { t, name, nameConf, timer }   t in seconds, name the caption as read (may be ''),
//                                   nameConf 0–100, timer the raw timer reading (may be '')
// and the output a list of blocks:
//   { start, end, dur, kind: 'work'|'rest'|'gap', key, text, conf, variants, next, resets }
//
// The rules, in the order they run:
//  1. Each frame gets a label: a caption that says rest ("REST", "next: burpees") is rest, any
//     other caption is work, no caption at all is nothing.
//  2. Consecutive frames whose captions read as the same name are one run. A frame or two with
//     no reading between two runs of the same name is bridged: a caption that flickers out for a
//     second does not cut an exercise in two.
//  3. A timer that restarts inside a run splits it — the same exercise done twice in a row
//     (a left side, then a right side) shows the same caption both times, and only the timer
//     says there were two.
//  4. Each run's name is the majority of its readings, so a single misread frame never names it.
//  5. Runs shorter than MIN_BLOCK seconds are noise: a caption caught mid-transition. They are
//     folded into the block before them.

import { normName, restOf, parseTimer, mode, sameName, cleanCaption } from './text.js'

export const MIN_BLOCK = 3       // seconds: anything shorter is a transition, not an exercise
const BRIDGE = 2                 // seconds without a reading that a run may span
const MIN_CHARS = 3              // shorter readings are OCR dust ("|", "ii")
export const MIN_CONF = 40       // Tesseract's own confidence (0–100) below which a reading is noise

function labelOf(f) {
  // "(R)" and "(L)" would be lost as single letters once the caption is a key: spelled out.
  const raw = cleanCaption(String(f.name || '').replace(/[([{]\s*([rlRL])\s*[)\]}]/g, (_, x) => (/r/i.test(x) ? '(right)' : '(left)')))
  const key = normName(raw)
  const timer = parseTimer(f.timer)
  // A reading Tesseract itself doubts is noise more often than a name: a shadow, the edge of the
  // instructor's arm, a logo half in the box. Below MIN_CONF it counts as nothing on screen.
  // A name has a word: three letters in a row at least. "Al-Ul", "V;;ﬁ", "Ey Ww" are the edge of a
  // frame or a shadow read as text, not a name.
  const hasWord = /\p{L}{3,}/u.test(raw)
  if (!hasWord || key.replace(/\s/g, '').length < MIN_CHARS || (f.nameConf != null && Number(f.nameConf) < MIN_CONF)) return { kind: 'none', key: '', raw: '', timer, conf: 0 }
  const r = restOf(key)
  return { kind: r.rest ? 'rest' : 'work', key, raw, timer, next: r.next, conf: Number(f.nameConf) || 0 }
}

/** Indices where a timer restarts: a countdown jumping up, or a count-up dropping back. */
export function timerResets(timers) {
  const diffs = []
  for (let i = 1; i < timers.length; i++) {
    if (timers[i] != null && timers[i - 1] != null) diffs.push(timers[i] - timers[i - 1])
  }
  const sorted = diffs.slice().sort((a, b) => a - b)
  const med = sorted.length ? sorted[sorted.length >> 1] : -1
  const trend = med > 0 ? 1 : -1      // most timers on these videos count down
  // A jump counts only when the seconds after it carry on from the new value: one misread
  // ("12" as "72") jumps too, and then the next reading is back where it was.
  const follows = (i, k) => {
    const v = timers[i + k]
    if (v == null) return null
    const d = (v - timers[i]) * trend
    return d >= 0 && d <= 2 * k
  }
  const out = []
  for (let i = 1; i < timers.length; i++) {
    if (timers[i] == null || timers[i - 1] == null) continue
    if ((timers[i] - timers[i - 1]) * trend >= -2) continue
    const checks = [follows(i, 1), follows(i, 2)].filter(x => x !== null)
    if (checks.length ? checks.every(Boolean) : i === timers.length - 1) out.push(i)
  }
  return out
}

function runKey(run) {
  return mode(run.labels.filter(l => l.kind === run.kind && l.key).map(l => l.key)).value || ''
}

function joins(run, lab) {
  if (!run || run.kind !== lab.kind) return false
  if (lab.kind !== 'work') return true
  return sameName(runKey(run), lab.key)
}

/**
 * How much the timer readings can be trusted: the share of neighbouring readings that step down
 * (or up) by exactly one second. A clean countdown is near 1; a timer drawn over a busy picture,
 * or in a font OCR cannot read, is near 0 — and its "restarts" are noise that would cut every
 * exercise into pieces. Below TIMER_TRUST the timer is not used at all.
 */
export function timerQuality(timers) {
  let pairs = 0, steps = 0
  for (let i = 1; i < timers.length; i++) {
    if (timers[i] == null || timers[i - 1] == null) continue
    pairs++
    if (Math.abs(timers[i] - timers[i - 1]) === 1) steps++
  }
  return pairs >= 10 ? steps / pairs : 0
}
export const TIMER_TRUST = 0.6

export function segment(frames) {
  const raw = (frames || []).map(f => ({ t: f.t, ...labelOf(f) }))
  const trusted = timerQuality(raw.map(l => l.timer)) >= TIMER_TRUST
  const labels = trusted ? raw : raw.map(l => ({ ...l, timer: null }))
  // 1–2: runs of one kind and one name, bridging short holes.
  const runs = []
  let cur = null
  let pending = []      // 'none' frames not yet given to anyone
  const flushPending = () => {
    if (!pending.length) return
    runs.push({ kind: 'gap', labels: pending })
    pending = []
  }
  for (const lab of labels) {
    if (lab.kind === 'none') { pending.push(lab); continue }
    if (cur && joins(cur, lab) && pending.length <= BRIDGE) {
      cur.labels.push(...pending, lab)
      pending = []
      continue
    }
    flushPending()
    cur = { kind: lab.kind, labels: [lab] }
    runs.push(cur)
  }
  flushPending()

  // 3: a timer restart inside a run is a second block of the same name. In a stretch with no
  // caption on screen (a warm-up or a cool-down of 30-second holds shown only by the timer) it is
  // the only thing that tells one hold from the next: those pieces are marked `timed`.
  const split = []
  for (const run of runs) {
    if (run.kind === 'rest') { split.push(run); continue }
    const cuts = timerResets(run.labels.map(l => l.timer)).filter(i => i >= MIN_BLOCK && run.labels.length - i >= MIN_BLOCK)
    let from = 0
    const timed = run.kind === 'gap' && cuts.length > 0
    for (const i of cuts) {
      split.push({ kind: run.kind, labels: run.labels.slice(from, i), reset: true, timed })
      from = i
    }
    split.push({ kind: run.kind, labels: run.labels.slice(from), reset: from > 0, timed })
  }

  // 4: name each run by majority.
  let blocks = split.map(toBlock)

  // 5: fold noise into its neighbour, then join neighbours that the fold made adjacent.
  const out = []
  for (const b of blocks) {
    const prev = out[out.length - 1]
    if (b.dur < MIN_BLOCK && prev) { absorb(prev, b); continue }
    if (prev && prev.kind === b.kind && b.kind !== 'work' && !b.resets) { absorb(prev, b, true); continue }
    if (prev && prev.kind === 'work' && b.kind === 'work' && !b.resets && sameName(prev.key, b.key)) { absorb(prev, b, true); continue }
    out.push(b)
  }
  // A short first block has nothing before it: it goes into the one after.
  if (out.length > 1 && out[0].dur < MIN_BLOCK) { const first = out.shift(); out[0].start = first.start; out[0].dur = out[0].end - out[0].start }
  return out
}

function toBlock(run) {
  const labs = run.labels
  const start = labs[0].t
  const end = labs[labs.length - 1].t + 1
  const named = labs.filter(l => l.kind === run.kind && l.key)
  const { value: key, count } = mode(named.map(l => l.key))
  // The text as shown: the most common raw reading among the frames that read as the winner.
  const text = mode(named.filter(l => l.key === key).map(l => l.raw)).value || ''
  const variants = {}
  for (const l of named) variants[l.key] = (variants[l.key] || 0) + 1
  const meanConf = named.length ? named.reduce((s, l) => s + l.conf, 0) / named.length : 0
  const next = mode(named.map(l => l.next).filter(Boolean)).value || null
  const timers = labs.map(l => l.timer).filter(x => x != null)
  return {
    start, end, dur: end - start, kind: run.kind, key: key || '', text,
    conf: named.length ? Math.round((count / named.length) * (meanConf / 100) * 100) / 100 : 0,
    variants, next, resets: !!run.reset, ...(run.timed ? { timed: true } : {}),
    timerMax: timers.length ? Math.max(...timers) : null
  }
}

function absorb(into, b, merge = false) {
  into.end = Math.max(into.end, b.end)
  into.start = Math.min(into.start, b.start)
  into.dur = into.end - into.start
  if (merge) {
    for (const [k, n] of Object.entries(b.variants || {})) into.variants[k] = (into.variants[k] || 0) + n
    const top = mode(Object.entries(into.variants).flatMap(([k, n]) => Array(n).fill(k))).value
    if (top && top !== into.key && into.kind === b.kind) { into.key = top; into.text = b.key === top ? b.text : into.text }
    if (!into.next && b.next) into.next = b.next
  }
}

/* ------------------------------------------------------------- timer first */

/**
 * The countdowns on screen, as runs: { start, end, top }. A countdown is the most reliable
 * clock a follow-along has — each work, each rest, each warm-up move counts down to zero on its
 * own. A run starts at a reading the next seconds confirm (29, then 28, 27…), keeps every
 * reading that fits its count, ignores the ones that do not (a "14" read as "4"), and ends when it
 * reaches zero or the next run starts.
 */
export function countdownRuns(frames) {
  // Each second can carry two readings (taken half a second apart): a run takes whichever fits.
  const both = (frames || []).map(f => [parseTimer(f.timer), parseTimer(f.timerB)].filter(x => x != null && x >= 0))
  const v = both.map(c => (c.length ? c[0] : null))
  const runs = []
  let cur = null
  // A reading fits the run when it is the count it should be — or that count with a stray "1" in
  // front (a piece of the ring round the digits read as a one: 8 as 18).
  const fitsOne = (t, x) => {
    if (!cur) return false
    const e = cur.top - (t - cur.start)
    return Math.abs(e - x) <= 1 || (x >= 10 && x < 20 && e < 10 && Math.abs(e - (x - 10)) <= 1)
  }
  const confirmedAs = (t, x) => {
    let ok = 0, bad = 0
    for (let k = 1; k <= 4 && t + k < both.length; k++) {
      const c = both[t + k]
      if (!c.length) continue
      if (c.some(y => Math.abs(x - k - y) <= 1)) ok++; else bad++
    }
    return ok >= 2 && ok > bad
  }
  for (let t = 0; t < both.length; t++) {
    const cands = both[t]
    if (!cands.length) continue
    if (cands.some(x => fitsOne(t, x))) { cur.last = t; continue }
    const x = cands.find(y => (y >= 3 || (cur && y >= 0)) && confirmedAs(t, y))
    if (x == null) continue
    // A confirmed reading a little off the count (OCR caught the first seconds late, or misread
    // a few): the same countdown, re-anchored. A new countdown is a jump up, or one that starts
    // after the current one is over.
    const e = cur ? cur.top - (t - cur.start) : -1
    if (cur && e >= 3 && x <= e + 3 && e - x <= 5) { cur.top = x + (t - cur.start); cur.last = t; continue }
    if (x >= 3) { if (cur) runs.push(cur); cur = { start: t, top: x, last: t } }
  }
  if (cur) runs.push(cur)
  // A countdown first caught at 23 when its neighbours start at 29 began a few seconds earlier,
  // as far as the quiet seconds before it allow: OCR missed its first readings, not the video.
  runs.forEach((r, i) => {
    const near = runs.slice(Math.max(0, i - 5), i + 6).filter(x => x !== r && x.top > r.top && x.top <= r.top * 1.5).map(x => x.top)
    if (near.length < 2) return
    const usual = mode(near).value
    const room = r.start - (i ? runs[i - 1].start + runs[i - 1].top + 1 : 0)
    const back = Math.min(usual - r.top, room)
    if (back > 0) { r.start -= back; r.top += back }
  })
  return runs.map((r, i) => {
    const next = runs[i + 1]?.start ?? both.length
    // It reaches zero `top` seconds after it showed `top`, and is gone a second later.
    return { start: r.start, end: Math.min(next, r.start + r.top + 1), top: r.top }
  }).filter(r => r.end - r.start >= MIN_RUN)
}
const MIN_RUN = 5

/**
 * Blocks built on the countdowns instead of the captions: one per run, named by the captions.
 * A caption that covers a short run before a longer run with none is a rest that announces the
 * next exercise ("NEXT · GOBLET SQUAT" over a 20 s countdown, then 40 s of work); one that first
 * comes up in the second half of a run announces the run after it (a warm-up with no rests); one
 * at the start of a run names that run. Runs no caption named are timed gaps — an exercise all
 * the same, for the review screen to name. Stretches with no countdown at all are read caption by
 * caption, as before. null when the video shows no usable countdown.
 */
export function timerPhases(frames) {
  if (!frames?.length) return null
  const runs = countdownRuns(frames)
  if (runs.length < 3 || runs.reduce((t, r) => t + r.end - r.start, 0) < frames.length * 0.3) return null
  const labels = frames.map(f => labelOf(f))
  const captionOf = (a, b) => {
    const named = []
    for (let t = a; t < b; t++) if (labels[t]?.key) named.push({ t, l: labels[t] })
    if (!named.length) return null
    const first = mode(named.map(n => n.l.key)).value
    const mine = named.filter(n => sameName(n.l.key, first) || n.l.key === first)
    // The fullest reading: a caption that types itself out is read short at first.
    const longest = Math.max(...mine.map(n => n.l.key.length))
    const full = mine.filter(n => n.l.key.length >= longest * 0.9)
    const key = mode(full.map(n => n.l.key)).value || first
    const raw = mode(full.filter(n => n.l.key === key).map(n => n.l.raw)).value || key
    return {
      key, raw, first: mine[0].t, cover: mine.length / (b - a),
      conf: Math.round(mine.reduce((s, n) => s + (n.l.conf || 0), 0) / mine.length) / 100,
      kind: (full.find(n => n.l.key === key) || mine[0]).l.kind, next: restOf(key).next || null,
      variants: Object.fromEntries(Object.entries(mine.reduce((m, n) => ({ ...m, [n.l.key]: (m[n.l.key] || 0) + 1 }), {})))
    }
  }
  const caps = runs.map(r => captionOf(r.start, r.end))
  const len = r => r.end - r.start
  // A rest is a short countdown between two longer ones (20 s between two 40 s works, or the
  // "get ready" before a warm-up's first move). Its caption, however long OCR caught it, names
  // what comes next.
  const restAt = i => {
    const r = runs[i], p = runs[i - 1], n = runs[i + 1]
    const pl = p && r.start - p.end <= 2 ? len(p) : null
    const nl = n && n.start - r.end <= 2 ? len(n) : null
    if (pl == null && nl == null) return false
    return (pl == null || len(r) <= pl * 0.7) && (nl == null || len(r) <= nl * 0.7)
  }
  const blocks = []
  let pending = null    // a name announced for the run that comes next
  const block = (r, extra) => ({ start: r.start, end: r.end, dur: len(r), resets: true, timerMax: r.top, ...extra })
  const asNext = c => c && { key: c.key, raw: c.raw, conf: c.conf, variants: c.variants, first: c.first }
  let at = 0
  runs.forEach((r, i) => {
    // Seconds with no countdown between two runs: read the old way, caption by caption. What was
    // announced before them is not carried across.
    if (r.start - at >= MIN_RUN) { blocks.push(...segment(frames.slice(at, r.start))); pending = null }
    at = r.end
    const c = caps[i]
    const lateIn = c && (c.first - r.start) / len(r) >= 0.5
    if (c && c.kind === 'rest') {
      const named = c.next ? { key: normName(c.next), raw: c.next, conf: c.conf, variants: { [normName(c.next)]: 1 }, first: c.first } : null
      // "REST", or a "Next: …" over the whole of a short countdown: a rest. A "Next: …" that comes
      // up late in a move with no rest after it is only the announcement; the move is a move.
      if (!c.next || restAt(i) || !lateIn) {
        blocks.push(block(r, { kind: 'rest', key: c.key, text: c.raw, conf: c.conf, variants: c.variants, next: c.next }))
        pending = named || pending
        return
      }
      const own = pending
      pending = named
      if (own) blocks.push(block(r, { kind: 'work', key: own.key, text: own.raw, conf: own.conf, variants: own.variants, ...(own.first < r.start ? { captionAt: own.first } : {}) }))
      else blocks.push(block(r, { kind: 'gap', key: '', text: '', conf: 0, variants: {}, timed: true }))
      return
    }
    // Equal lengths (30 s on, 30 s off) say nothing about which is the rest; the captions do. A
    // countdown with a caption over most of it, between two with none at their start, announces
    // the next exercise: the video names each exercise during the rest before it.
    const bare = j => runs[j] && (!caps[j] || (caps[j].first - runs[j].start) / len(runs[j]) >= 0.5)
    const announces = c && c.cover >= 0.6 && (c.first - r.start) / len(r) < 0.3 && bare(i + 1) && (i === 0 || bare(i - 1))
    if (restAt(i) || announces) {
      blocks.push(block(r, { kind: 'rest', key: 'rest', text: 'NEXT', conf: c?.conf || 0, variants: {}, next: c?.key || null }))
      pending = asNext(c) || pending
      return
    }
    const late = lateIn
    // A name announced for this move wins over a later or a doubtful reading in it.
    const doubtful = c && pending && !sameName(pending.key, c.key) && (c.first - r.start > 3 || c.conf < 0.55)
    const own = c && !late && !doubtful ? c : pending
    pending = late ? asNext(c) : null
    if (own) blocks.push(block(r, { kind: 'work', key: own.key, text: own.raw, conf: own.conf, variants: own.variants, ...(own.first < r.start ? { captionAt: own.first } : {}) }))
    else blocks.push(block(r, { kind: 'gap', key: '', text: '', conf: 0, variants: {}, timed: true }))
  })
  if (frames.length - at >= MIN_RUN) blocks.push(...segment(frames.slice(at)))
  return fillFromRounds(blocks)
}

/**
 * A move no caption named, one round after (or before) a named move of its length, is that move
 * again: a block done in rounds repeats itself at a steady lap. The lap is the distance most
 * named moves have to their next time. The name is marked as inferred (low confidence) for the
 * review screen.
 */
export function fillFromRounds(blocks) {
  const work = blocks.filter(b => b.kind === 'work' && b.key)
  const gaps = []
  work.forEach((b, i) => { const n = work.slice(i + 1).find(x => sameName(x.key, b.key)); if (n) gaps.push(n.start - b.start) })
  if (gaps.length < 3) return blocks
  const lap = mode(gaps).value
  if (gaps.filter(g => Math.abs(g - lap) <= 2).length < gaps.length * 0.5) return blocks
  for (const b of blocks) {
    if (b.kind !== 'gap' || !b.timed) continue
    const twin = work.find(w => Math.abs(Math.abs(w.start - b.start) - lap) <= 2 && Math.abs(w.dur - b.dur) <= 5)
    if (twin) Object.assign(b, { kind: 'work', key: twin.key, text: twin.text, conf: 0.3, variants: twin.variants, inferred: true })
  }
  return blocks
}

/** One reading per second from the two taken: the one that carries on the count from the second before. */
export function timerTrack(frames) {
  let prev = null
  return (frames || []).map(f => {
    const c = [parseTimer(f.timer), parseTimer(f.timerB)].filter(x => x != null && x >= 0)
    const pick = !c.length ? null : prev == null ? c[0] : c.reduce((a, b) => (Math.abs(b - (prev - 1)) < Math.abs(a - (prev - 1)) ? b : a))
    if (pick != null) prev = pick
    return pick
  })
}
