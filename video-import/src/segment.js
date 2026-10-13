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
  const raw = cleanCaption(f.name)
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
