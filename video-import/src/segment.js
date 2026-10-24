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

import { normName, restOf, parseTimer, mode, sameName, cleanCaption, repairCaption, snapToLibrary, plausibleCaption, knownShare, editDistance, median } from './text.js'

export const MIN_BLOCK = 3       // seconds: anything shorter is a transition, not an exercise
const BRIDGE = 2                 // seconds without a reading that a run may span
const MIN_CHARS = 3              // shorter readings are OCR dust ("|", "ii")
export const MIN_CONF = 40       // Tesseract's own confidence (0–100) below which a reading is noise

function labelOf(f) {
  // "(R)" and "(L)" would be lost as single letters once the caption is a key: spelled out.
  // A closing bracket the OCR lost at the end of a caption does not make "(R" any less a side, and a
  // small white "R" is read as "P" now and then.
  const raw = snapToLibrary(repairCaption(cleanCaption(String(f.name || '').replace(/[([{]\s*([rlpRLP])\s*(?:[)\]}]|$)/g, (_, x) => (/[rp]/i.test(x) ? '(right)' : '(left)')))))
  const key = normName(raw)
  const timer = parseTimer(f.timer)
  // A reading Tesseract itself doubts is noise more often than a name: a shadow, the edge of the
  // instructor's arm, a logo half in the box. Below MIN_CONF it counts as nothing on screen.
  // A name has a word: three letters in a row at least. "Al-Ul", "V;;ﬁ", "Ey Ww" are the edge of a
  // frame or a shadow read as text, not a name.
  // A hashtag, a handle or an ask to subscribe is the channel talking, not a move.
  const hasWord = /\p{L}{3,}/u.test(raw) && !/[#@]|\.com\b|subscribe|follow us|like\s*&|juice\s*and\s*toya/i.test(raw)
  if (!hasWord || !plausibleCaption(raw) || key.replace(/\s/g, '').length < MIN_CHARS || (f.nameConf != null && Number(f.nameConf) < MIN_CONF)) return { kind: 'none', key: '', raw: '', timer, conf: 0 }
  // "NEXT" on its own (the name it announces read elsewhere, or not at all) names nothing.
  if (/^(n|m)e[xk]t?$|^up next$|^next up$|^nex$/.test(key) || (key.length === 4 && editDistance(key, 'next') <= 1)) return { kind: 'none', key: '', raw: '', timer, conf: 0 }
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
  const both = (frames || []).map(readingsOf)
  const v = both.map(c => (c.length ? c[0] : null))
  const runs = []
  let cur = null
  // A reading fits the run when it is the count it should be — or that count with a stray "1" in
  // front (a piece of the ring round the digits read as a one: 8 as 18).
  // Or with its tens digit lost (a heavy "3" the OCR skipped: 35 read as 5). Not once the count
  // is down to zero: a "10" then is the next countdown (a Tabata's 10 s rest), not a stray 1 and 0.
  const matches = (e, x) => Math.abs(e - x) <= 1 || (x >= 10 && x < 20 && e >= 1 && e < 10 && Math.abs(e - (x - 10)) <= 1) || (x < 10 && e >= 10 && e % 10 === x)
  const fitsOne = (t, x) => cur && matches(cur.top - (t - cur.start), x)
  // How well the next seconds carry a reading on as a countdown: ok - bad, or null when they do
  // not (fewer than two seconds agree, or more disagree than agree).
  const confirmation = (t, x) => {
    let ok = 0, bad = 0
    for (let k = 1; k <= 4 && t + k < both.length; k++) {
      const c = both[t + k]
      if (!c.length) continue
      if (c.some(y => matches(x - k, y))) ok++; else bad++
    }
    if (ok >= 2 && ok > bad) return ok - bad
    // Over a ring and a busy floor the first seconds read badly (37 as 31, 36 as 33). Four seconds
    // that mostly agree and a few more that do too make a countdown, though a poor one at its start.
    if (ok >= 2 && ok === bad) {
      let more = 0
      for (let k = 5; k <= 8 && t + k < both.length; k++) if (both[t + k].some(y => matches(x - k, y))) more++
      if (more >= 3) return 1
    }
    return null
  }
  const confirmedAs = (t, x) => confirmation(t, x) != null
  const exactSeconds = (t, x, span = 4) => {
    let n = 0
    for (let k = 1; k <= span && t + k < both.length; k++) if (both[t + k].some(y => Math.abs(x - k - y) <= 1)) n++
    return n
  }
  for (let t = 0; t < both.length; t++) {
    const cands = both[t]
    if (!cands.length) continue
    if (cands.some(x => fitsOne(t, x))) { cur.last = t; continue }
    // No countdown in these videos starts above 99: "141" is a "41" with a piece of the ring in front.
    let x = cands.find(y => y <= 99 && (y >= 3 || (cur && y >= 0)) && confirmedAs(t, y))
    // A reading confirmed only by the lenient matches (a lost tens digit, a stray 1) can be a few
    // misreads that happen to chain: 29 for 40. A reading in the same second that the next four
    // seconds follow exactly is the count.
    if (x != null && exactSeconds(t, x) < 3) x = cands.find(y => y !== x && y >= 3 && confirmedAs(t, y) && exactSeconds(t, y) >= 3) ?? x
    // A heavy tens digit the OCR keeps skipping turns 38, 37, 36… into 8, 7, 6…: a nine-second
    // countdown. Where the tens come back now and then (34, then 3, 2, then 31) it was one forty
    // seconds long. A "3, 2, 1" before the next countdown has no single digits after its first
    // two-digit reading, and stays what it is.
    if (x != null && x < 10) {
      for (const a of [x + 10, x + 20, x + 30, x + 40]) {
        const full = [], bare = []
        for (let k = 1; k <= 9 && t + k < both.length; k++) {
          if (both[t + k].some(y => y >= 10 && Math.abs(a - k - y) <= 1)) full.push(k)
          else if (both[t + k].some(y => y < 10 && y === (a - k) % 10)) bare.push(k)
        }
        if (full.length >= 2 && bare.length >= 3 && bare.some(k => k > full[0])) { x = a; break }
      }
    }
    if (x == null) continue
    // A confirmed reading a little off the count (OCR caught the first seconds late, or misread
    // a few): the same countdown, re-anchored. A new countdown is a jump up, or one that starts
    // after the current one is over.
    const e = cur ? cur.top - (t - cur.start) : -1
    // A run only a few seconds old whose start was a stray reading (39 read as 29) is moved up to
    // the count the confirmed reading gives, as far as a countdown of the usual length allows.
    const young = cur && t - cur.start <= 8 && cur.last - cur.start >= 1
    if (cur && e >= 3 && ((x <= e + 3 && e - x <= 5 && (e - x <= 1 || exactSeconds(t, x) >= 3)) || (young && x > e && x + (t - cur.start) <= 60 && x >= 20))) { cur.top = x + (t - cur.start); cur.last = t; continue }
    // A countdown does not jump down: a lower reading while one is still running is a misread
    // ("3" for 23) — unless the next three seconds carry it on exactly, which a run whose start
    // was misread high (58 for 48) and the real next countdown do, and stray digits do not.
    const strict = () => [1, 2, 3].every(k => (both[t + k] || []).includes(x - k))
    if (cur && e >= 3 && x < e && !strict()) continue
    if (x >= 3) { if (cur) runs.push(cur); cur = { start: t, top: x, last: t } }
  }
  if (cur) runs.push(cur)
  // The countdowns on either side of one, past a few seconds of "5, 4, 3" noise.
  const around = r => {
    const i = runs.indexOf(r)
    let a = i - 1, z = i + 1
    while (a >= 0 && runs[a].top < 12) a--
    while (z < runs.length && runs[z].top < 12) z++
    return { pr: runs[a], nx: runs[z] }
  }
  const backToBack = r => {
    const { pr, nx } = around(r)
    return !!pr && !!nx && r.start - (pr.start + pr.top + 1) <= 4 && nx.start - (r.start + r.top + 1) <= 4 && pr.top + 1 >= 25 && nx.top + 1 >= 25
  }
  // A countdown first caught at 23 when its neighbours start at 29 began a few seconds earlier,
  // as far as the quiet seconds before it allow: OCR missed its first readings, not the video.
  runs.forEach((r, i) => {
    const near = runs.slice(Math.max(0, i - 5), i + 6).filter(x => x !== r && x.top > r.top && x.top <= r.top * 1.5).map(x => x.top)
    // Moves back to back with no rest (a warm-up of 30 s holds beside 40 s works) are not the neighbours' length.
    if (backToBack(r)) return
    if (near.length < 2) return
    const usual = mode(near).value
    const room = r.start - (i ? runs[i - 1].start + runs[i - 1].top + 1 : 0)
    const back = Math.min(usual - r.top, room)
    if (back > 0) { r.start -= back; r.top += back }
  })
  // A countdown caught late by ten seconds or more (the first digits of a number on a floor ring
  // are the ones the OCR loses) is longer than it looks if the seconds before it, which read as
  // noise, agree with the count it would have had: the last digit, or the whole number, again and
  // again. The lengths to try are the ones the video's other countdowns have.
  const lengths = {}
  for (const r of runs) { const L = r.top + 1; if (L >= 20) lengths[L] = (lengths[L] || 0) + 1 }
  const usual = Object.keys(lengths).map(Number).filter(L => lengths[L] >= 3).sort((a, b) => a - b)
  const agrees = (t, p) => both[t].some(y => y === p || (y < 10 && y === p % 10) || (y >= 10 && Math.abs(y - p) <= 1))
  runs.forEach((r, i) => {
    const len = r.top + 1
    // A countdown that is already one of the lengths this video uses (the 50 s works of a 50/10
    // workout) is whole: the ten seconds in front of it are the rest's own countdown, whose last
    // digits happen to be the ones the longer count would show.
    if (lengths[len] >= 3) return
    let p = i - 1
    while (p >= 0 && runs[p].top < 12 && r.start - (runs[p].start + runs[p].top + 1) < 40) p--
    const floor = p >= 0 ? runs[p].start + runs[p].top + 1 : 0
    let best = null
    for (const L of usual) {
      const d = L - len
      if (d < 6 || r.start - d < floor) continue
      let seen = 0, hit = 0
      for (let t = r.start - d; t < r.start; t++) {
        if (!both[t].length) continue
        seen++
        if (agrees(t, r.top + (r.start - t))) hit++
      }
      if (hit >= 4 && hit >= seen * 0.45 && (!best || hit / d > best.score)) best = { d, score: hit / d }
    }
    if (best) { r.start -= best.d; r.top += best.d }
  })
  // A long countdown shows a round number the author set (60, 45, 40): one first read at 56 began at
  // 59, when the ring still hid its digits (they fade in over the first seconds). It starts as far
  // back as the quiet seconds before it allow, no further than the next round number. Only the
  // long ones, and a shortfall of two or three seconds: shorter countdowns and a second's shortfall
  // are rounding the other rules already settle, and moving them costs the starts they got right.
  runs.forEach((r, i) => {
    const len = r.top + 1
    if (len < 40) return
    const up = Math.ceil(len / 5) * 5 - len
    if (up < 2 || up > 3) return
    const room = r.start - (i ? runs[i - 1].start + runs[i - 1].top + 1 : 0)
    const back = Math.min(up, room)
    if (back > 0) { r.start -= back; r.top += back }
  })
  // Workouts keep a beat: each move starts a whole period after the one before (40 s on and 20 s
  // off, every 60 s). Where most of a part's work countdowns sit on one beat, the others — caught
  // late, or with a misread number — are on it too: they end where the beat puts them (within a few
  // seconds of where they were read to end) and are as long as the whole ones. A long rest (a
  // minute and more) starts a new part and may shift the beat.
  // Moves back to back with no rest between (a warm-up, a cool-down of holds) keep their own beat.
  const workLike = r => r.top + 1 >= 25 && r.top + 1 <= 55 && !backToBack(r)
  const partsOf = []
  {
    let cur = []
    for (const r of runs) {
      if (r.top + 1 >= 50 && cur.length) { partsOf.push(cur); cur = [] }
      if (workLike(r)) cur.push(r)
    }
    if (cur.length) partsOf.push(cur)
  }
  const beats = []
  for (const part of partsOf) {
    if (part.length < 6) continue
    const ends = part.map(r => r.start + r.top + 1)
    const diffs = ends.slice(1).map((e, k) => e - ends[k]).filter(d => d >= 40 && d <= 200)
    if (diffs.length < 5) continue
    // The period: a whole number of seconds a person would set (60, not 61).
    const beat = Math.round(median(diffs) / 5) * 5
    if (beat < 40 || beat > 100) continue
    const within = diffs.filter(d => { const k = Math.max(1, Math.round(d / beat)); return Math.abs(d - k * beat) <= 6 }).length
    if (within < diffs.length * 0.6) continue
    // The beat's phase: the most common remainder (a few seconds either side count as one).
    const rem = ends.map(e => e % beat)
    let phase = 0, most = -1
    for (const c of rem) {
      const n = rem.filter(x => Math.min(Math.abs(x - c), beat - Math.abs(x - c)) <= 4).length
      if (n > most) { most = n; phase = c }
    }
    if (most < part.length * 0.5) continue
    // The beat's phase, centred on the ends that sit near it; whole is the long end of what ends there.
    const near = part.map(r => r.start + r.top + 1).filter(e => { const o = ((e - phase) % beat + beat) % beat; return Math.min(o, beat - o) <= 5 })
    const toOff = e => { const o = ((e - phase) % beat + beat) % beat; return o > beat / 2 ? o - beat : o }
    // Countdowns read whole end where the beat does; the ones read short end a little early.
    const full = part.filter(r => r.top + 1 >= 38 && Math.abs(toOff(r.start + r.top + 1)) <= 6).map(r => r.start + r.top + 1)
    // With none read whole, the ones read least short are the best guess: the late end of the spread.
    const upper = list => list.slice().sort((a, b) => a - b)[Math.min(list.length - 1, Math.floor(list.length * 0.8))]
    const centre = phase + Math.round(full.length >= 2 ? median(full.map(toOff)) : upper(near.map(toOff)))
    const whole = part.filter(r => { const o = (((r.start + r.top + 1) - centre) % beat + beat) % beat; return Math.min(o, beat - o) <= 5 && r.top + 1 >= 35 }).map(r => r.top + 1)
    if (whole.length < 2) continue
    // The longest of them, as a length a person would set (40, not 41 or 39).
    const L = Math.round(Math.max(...whole.filter(x => x <= 62)) / 5) * 5
    beats.push({ part, beat, phase: centre, L })
  }
  // One workout, one work length: a part whose countdowns were all read short takes the longest
  // length the other parts found, when it is within a few seconds of its own.
  const globalL = beats.length ? Math.max(...beats.map(b => b.L)) : 0
  for (const { part, beat, phase, L: own } of beats) {
    const L = own >= globalL - 6 ? globalL : own
    // The ends are read well (a countdown is read best as it runs out); the starts are what a floor
    // ring loses. A run shorter than the whole ones, ending on the beat, began a whole length before.
    for (const r of part) {
      const e0 = r.start + r.top + 1
      const g = phase + beat * Math.round((e0 - phase) / beat)
      if (Math.abs(g - e0) > 7 || e0 - r.start >= L - 2) continue
      const start = g - L
      // A few seconds of "5, 4, 3" in front of it is noise it swallows, not a countdown in the way.
      const at = runs.indexOf(r)
      let p = at - 1
      while (p >= 0 && runs[p].top < 12 && runs[p].start >= start - 3) p--
      const prev = runs[p]
      if (prev && start < prev.start + prev.top + 1 - 2) continue
      for (let k = at - 1; k > p; k--) runs[k].drop = true
      // ...and the same noise at its tail, where the countdown it was cut short by now runs on.
      for (let k = at + 1; k < runs.length && runs[k].start < g + 3; k++) if (runs[k].top < 12) runs[k].drop = true
      r.start = start; r.top = L - 1
    }
  }
  for (let k = runs.length - 1; k >= 0; k--) if (runs[k].drop) runs.splice(k, 1)
  // A slot on the beat, between ones whose countdowns were read, where only scraps of a countdown were
  // (a few seconds here, a few there, counting the right numbers): the move was there all the same.
  for (const { part, beat, phase, L: own } of beats) {
    const L = own >= globalL - 6 ? globalL : own
    const wholeEnds = part.filter(r => runs.includes(r) && r.top + 1 >= L - 3).map(r => r.start + r.top + 1)
    if (wholeEnds.length < 3) continue
    const lo = Math.min(...wholeEnds), hi = Math.max(...wholeEnds)
    for (let g = phase + beat * Math.round((lo - phase) / beat); g <= hi; g += beat) {
      if (runs.some(r => Math.abs(r.start + r.top + 1 - g) <= 3 && r.top + 1 >= L - 3)) continue
      const inside = runs.filter(r => r.start < g - 2 && r.start + r.top + 1 > g - L + 2)
      if (!inside.length || inside.some(r => r.top + 1 >= L - 3 || r.start < g - L - 3)) continue
      let hit = 0
      for (let t = g - L; t < g; t++) if (both[t]?.length && agrees(t, g - t - 1)) hit++
      if (hit < 8) continue
      for (const r of inside) r.drop = true
      runs.push({ start: g - L, top: L - 1, last: g - 1, filled: true })
    }
  }
  for (let k = runs.length - 1; k >= 0; k--) if (runs[k].drop) runs.splice(k, 1)
  runs.sort((a, b) => a.start - b.start)
  // A chain of moves back to back (a warm-up, a cool-down of holds) is a grid of one length: the
  // ones off it by a couple of seconds are caught early or late, not shorter or longer.
  {
    const real = runs.filter(r => r.top >= 12)
    let from = 0
    while (from < real.length) {
      let to = from
      while (to + 1 < real.length && Math.abs(real[to + 1].start - (real[to].start + real[to].top + 1)) <= 3) to++
      let chain = real.slice(from, to + 1)
      from = to + 1
      if (chain.length < 4) continue
      const L = Math.round(median(chain.map(r => r.top + 1)) / 5) * 5
      // A rest or a get-ready at either end is not part of the grid.
      while (chain.length && Math.abs(chain[0].top + 1 - L) > 5) chain = chain.slice(1)
      while (chain.length && Math.abs(chain[chain.length - 1].top + 1 - L) > 5) chain = chain.slice(0, -1)
      if (chain.length < 4 || L < 20 || L > 60 || chain.some(r => Math.abs(r.top + 1 - L) > 5)) continue
      const rem = chain.map(r => ((r.start % L) + L) % L)
      // The remainder most of them share exactly (a first move caught a second early is the odd one out).
      let phase = rem[0], most = 0, exact = 0
      for (const c of rem) {
        const n = rem.filter(x => Math.min(Math.abs(x - c), L - Math.abs(x - c)) <= 1).length
        const e = rem.filter(x => x === c).length
        if (n > most || (n === most && e > exact)) { most = n; phase = c; exact = e }
      }
      if (most < chain.length * 0.6) continue
      for (const r of chain) {
        const g = phase + L * Math.round((r.start - phase) / L)
        if (Math.abs(g - r.start) > 4 || g === r.start && r.top + 1 === L) continue
        r.start = g; r.top = L - 1
      }
    }
  }
  return runs.map((r, i) => {
    const next = runs[i + 1]?.start ?? both.length
    // It reaches zero `top` seconds after it showed `top`, and is gone a second later.
    return { start: r.start, end: Math.min(next, r.start + r.top + 1), top: r.top }
    // A few seconds that "counted down from 97" are a misread, not a countdown cut short.
  }).filter(r => r.end - r.start >= MIN_RUN && !(r.end - r.start < 15 && r.top > (r.end - r.start) * 2 + 5))
}
const MIN_RUN = 5
const MIN_CAPTION_SECONDS = 8, MIN_CAPTION_COVER = 0.25
const MIN_EXERCISE = 10

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
    // The caption that speaks loudest: seen most, read surest, longest — not merely the most
    // frequent, which a few seconds of noise read as "hfli" can be.
    const weight = {}
    // Words the library knows count for more: a reading seen less often but made of real words beats a garble seen more.
    for (const n of named) weight[n.l.key] = (weight[n.l.key] || 0) + (n.l.conf || 0.5) * Math.min(1, n.l.key.length / 12) * (0.35 + knownShare(n.l.key))
    const first = Object.entries(weight).sort((x, y) => y[1] - x[1])[0][0]
    const mine = named.filter(n => sameName(n.l.key, first) || n.l.key === first)
    // Over a bare floor the box now and then reads a word out of the picture: a handful of seconds
    // in a countdown of forty. A caption is on screen for a good part of its countdown.
    if (mine.length < MIN_CAPTION_SECONDS && mine.length / (b - a) < MIN_CAPTION_COVER) {
      const sure = mine.reduce((s, n) => s + (n.l.conf || 0), 0) / mine.length
      // A few seconds of a caption made only of words the library knows is a blurred NEXT screen, not noise.
      if (mine.length < 3 || (sure < 75 && !(sure >= 45 && knownShare(first) >= 0.99))) return null
    }
    // The fullest reading: a caption that types itself out is read short at first.
    const longest = Math.max(...mine.map(n => n.l.key.length))
    const full = mine.filter(n => n.l.key.length >= longest * 0.9)
    const key = mode(full.map(n => n.l.key)).value || first
    const raw = mode(full.filter(n => n.l.key === key).map(n => n.l.raw)).value || key
    return {
      key, raw, first: mine[0].t, cover: mine.length / (b - a),
      // How much of the countdown says "REST", whatever else it shows.
      restShare: named.filter(n => n.l.kind === 'rest').length / (b - a),
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
    const r = runs[i]
    // The neighbours that count are moves: past any few seconds of "3, 2, 1" either side.
    let a = i - 1, z = i + 1
    while (runs[a] && len(runs[a]) < MIN_EXERCISE && runs[a + 1].start - runs[a].end <= 2) a--
    while (runs[z] && len(runs[z]) < MIN_EXERCISE && runs[z].start - runs[z - 1].end <= 2) z++
    const p = runs[a], n = runs[z]
    const pl = p && r.start - p.end <= 6 + (i - 1 - a) * MIN_EXERCISE ? len(p) : null
    const nl = n && n.start - r.end <= 6 + (z - i - 1) * MIN_EXERCISE ? len(n) : null
    if (pl == null && nl == null) return false
    return (pl == null || len(r) <= pl * 0.8) && (nl == null || len(r) <= nl * 0.8)
  }
  const blocks = []
  let pending = null    // a name announced for the run that comes next
  const block = (r, extra) => ({ start: r.start, end: r.end, dur: len(r), resets: true, timerMax: r.top, ...extra })
  const asNext = c => c && { key: c.key, raw: c.raw, conf: c.conf, variants: c.variants, first: c.first }
  // Bare: nothing at all on screen in a countdown's first half — any caption, not only the one chosen.
  const bare = j => {
    const q = runs[j]
    if (!q) return false
    // A word or two read out of the picture now and then (a few seconds, not a caption) is nothing.
    let named = 0
    for (let t = q.start; t < q.start + len(q) / 2; t++) if (labels[t]?.key) named++
    return named <= Math.max(2, len(q) * 0.1)
  }
  // Which of named-then-bare it is, when lengths can't say (30 s on, 30 s off): a workout ends
  // on a move, not on a rest. When the last countdown has its name on screen from its start,
  // follows a bare one of its length and nothing counts down after it, the named countdowns are
  // the moves and the bare ones the rests.
  const named = j => caps[j] && caps[j].cover >= 0.6 && (caps[j].first - runs[j].start) / len(runs[j]) < 0.3
  const L = runs.length - 1
  const endsNamed = L > 0 && named(L) && bare(L - 1) && Math.abs(len(runs[L]) - len(runs[L - 1])) <= len(runs[L]) * 0.1
  let at = 0
  runs.forEach((r, i) => {
    // Seconds with no countdown between two runs: read the old way, caption by caption. What was
    // announced before them is not carried across.
    if (r.start - at >= MIN_RUN) {
      const gc = captionOf(at, r.start)
      const gap = r.start - at
      // The countdown that follows, past any few seconds of "3, 2, 1".
      let j = i
      while (runs[j + 1] && len(runs[j]) < MIN_EXERCISE && runs[j + 1].start - runs[j].end <= 2) j++
      if (gap <= 45) {
        // Up to three quarters of a minute with no countdown between two countdowns: the rest, on
        // a screen of its own (its timer somewhere else). Whatever it shows names what comes next.
        const named = !gc ? null : gc.kind === 'rest' ? (gc.next ? { key: normName(gc.next), raw: gc.next, conf: gc.conf, variants: { [normName(gc.next)]: 1 }, first: gc.first } : null) : asNext(gc)
        blocks.push({ start: at, end: r.start, dur: gap, resets: true, kind: 'rest', key: 'rest', text: gc ? 'NEXT' : '', conf: gc?.conf || 0, variants: {}, next: named?.key || null })
        pending = named
      } else {
        const read = segment(frames.slice(at, r.start))
        pending = null
        // An "up first" or "next" screen at the very end of a long stretch with no countdown, right
        // before a countdown with nothing on it: it announces that countdown's move.
        const lastNamed = [...read].reverse().find(b => b.key && b.kind !== 'gap')
        if (lastNamed && runs[j].start - lastNamed.end <= 6 + (runs[j].start - r.start) && bare(j)) {
          const key = lastNamed.next || lastNamed.key
          pending = { key, raw: lastNamed.next || lastNamed.text || key, conf: lastNamed.conf || 0.5, variants: { [key]: 1 }, first: lastNamed.start }
          Object.assign(lastNamed, { kind: 'rest', next: key })
        }
        blocks.push(...read)
      }
    }
    at = r.end
    const c = caps[i]
    const lateIn = c && (c.first - r.start) / len(r) >= 0.4
    // "REST" over a good part of a countdown makes it a rest, even when the name it announces
    // was read more surely: that name is what comes next.
    if (c && c.kind !== 'rest' && c.restShare >= 0.4) {
      blocks.push(block(r, { kind: 'rest', key: 'rest', text: 'REST', conf: c.conf, variants: {}, next: c.key }))
      pending = asNext(c)
      return
    }
    // A long countdown (the minute between two blocks) with a name that only comes up in its last
    // stretch, and a countdown with nothing on it after: the rest, announcing that countdown's move.
    if (c && c.kind !== 'rest' && len(r) >= 45 && (c.first - r.start) / len(r) >= 0.6 && bare(i + 1)) {
      blocks.push(block(r, { kind: 'rest', key: 'rest', text: 'REST', conf: c.conf, variants: {}, next: c.key }))
      pending = asNext(c)
      return
    }
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

    // An announcement is no longer than what it announces; a countdown much longer than the bare
    // ones round it is the exercise itself, with its name on screen (and the bare ones the rests).
    const announces = !endsNamed && c && c.cover >= 0.5 && (c.first - r.start) / len(r) < 0.3 && bare(i + 1) && (i === 0 || bare(i - 1)) &&
      len(r) <= len(runs[i + 1]) * 1.1
    // Short between two longer ones, but named from its start by a caption of its own that the
    // next countdown, named too, does not repeat: a move of its own (a 30 s warm-up move between
    // a 60 s and a 45 s one), not a rest announcing the next. A rest that announces shows the
    // next move's name, or comes before a countdown with nothing on it.
    const ownMove = c && c.cover >= 0.6 && (c.first - r.start) / len(r) < 0.3 && caps[i + 1] && !bare(i + 1) &&
      !sameName(caps[i + 1].key, c.key) && !(caps[i - 1] && sameName(caps[i - 1].key, c.key))
    // Named moves with bare countdowns between them: those are the rests.
    const bareRest = endsNamed && !c && named(i - 1) && named(i + 1)
    // A countdown of a few seconds is a "get ready" or the last seconds of a rest shown where the
    // work timer will be, never an exercise.
    if ((restAt(i) && !ownMove) || announces || bareRest || len(r) < MIN_EXERCISE) {
      blocks.push(block(r, { kind: 'rest', key: 'rest', text: 'NEXT', conf: c?.conf || 0, variants: {}, next: c?.key || null }))
      pending = asNext(c) || pending
      return
    }
    const late = lateIn
    // A name announced for this move wins over a later or a doubtful reading in it.
    const doubtful = c && pending && !sameName(pending.key, c.key) && (c.first - r.start > 3 || c.conf < 0.55)
    const own = c && !late && !doubtful ? c : pending
    // Only a clear reading announces the next move: a few seconds of noise late in an exercise
    // ("- w i") must not name the one after it.
    pending = late && c.conf >= 0.6 && c.key.replace(/\s/g, '').length >= 4 ? asNext(c) : null
    if (own) blocks.push(block(r, { kind: 'work', key: own.key, text: own.raw, conf: own.conf, variants: own.variants, ...(own.first < r.start ? { captionAt: own.first } : {}) }))
    else blocks.push(block(r, { kind: 'gap', key: '', text: '', conf: 0, variants: {}, timed: true }))
  })
  if (frames.length - at >= MIN_RUN) blocks.push(...segment(frames.slice(at)))
  return fillFromRounds(joinRests(blocks))
}

/** Rests one after another (a rest screen, then the last "3, 2, 1" where the work timer goes) are one rest. */
function joinRests(blocks) {
  const out = []
  for (const b of blocks) {
    const prev = out[out.length - 1]
    if (prev && prev.kind === 'rest' && b.kind === 'rest' && b.start - prev.end <= 2) {
      Object.assign(prev, { end: b.end, dur: b.end - prev.start, next: b.next || prev.next, ...(b.next ? {} : {}) })
      continue
    }
    out.push(b)
  }
  return out
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
  // A round is a minute or more: anything shorter is one move read twice, not a lap.
  if (lap < 60 || gaps.filter(g => Math.abs(g - lap) <= 2).length < gaps.length * 0.5) return blocks
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
    const c = readingsOf(f)
    const pick = !c.length ? null : prev == null ? c[0] : c.reduce((a, b) => (Math.abs(b - (prev - 1)) < Math.abs(a - (prev - 1)) ? b : a))
    if (pick != null) prev = pick
    return pick
  })
}

/** Every timer reading a second carries (all boxes, both moments, both polarities), as numbers. */
function readingsOf(f) {
  const texts = f.timers || [f.timer, f.timerB, f.timerC, f.timerD]
  return texts.map(parseTimer).filter(x => x != null && x >= 0)
}
