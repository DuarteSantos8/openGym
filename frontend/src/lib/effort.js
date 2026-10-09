// Effort as a statistic: one internal scale, both display scales.
//
// A set carries either `rir` or `rpe` and is never rewritten — switching the setting changes
// what new sets ask for, nothing else (see history.js). For a *chart* that is a problem: a
// history that mixes the two (own logs in RIR, an imported file in RPE) would draw two
// half-empty series. So everything aggregates in RIR and is converted back for display.
// RIR is the internal unit because it has a real zero — a set taken to failure — where RPE's
// floor of 6 is only a convention about which sets are worth rating. RPE 8 == RIR 2.
import { EFFORT, effortOf, workoutAt } from './history.js'
import { weekKey, weekStartOf, startOfWeek } from './format.js'
import { isWarmupRow, isFailureSet } from './workout-model.js'
import { isAssisted } from './exercises.js'

// At or below this a set is close enough to failure to be the kind that drives adaptation.
// 3 rather than 2: the line is a convention, and drawn one rep too generously it still
// separates working sets from the ones left in the warm-up range.
export const HARD_RIR = 3
// Below this many rated sets an average is noise. Showing "RIR 1.0" off a single set reads
// like a finding when it is one tap, so the callers show a dash instead.
export const MIN_RATED = 5

/**
 * A set's effort in RIR, or null when it was never rated. 0 is a rating, not "empty". A set
 * marked as taken to failure (workout-model isFailureSet) is RIR 0 by definition, so it reads as
 * one when nothing was rated; a rating typed in by hand still wins, it is the more exact of the two.
 */
export const rirOf = s =>
  !s ? null : s.rir != null ? s.rir : s.rpe != null ? 10 - s.rpe : isFailureSet(s) ? 0 : null

/** RIR → the scale being displayed. The reverse of rirOf, for one number. */
export const toScale = (kind, rir) =>
  rir == null ? null : Math.round((kind === 'rpe' ? 10 - rir : rir) * 10) / 10

/**
 * Which scale to *label* aggregates with. The profile's own setting wins; a profile that
 * logs nothing itself but carries rated history (the imported-from-Hevy case) is shown the
 * scale that history is actually written in, rather than an RIR it has never seen.
 */
export function displayScale(S) {
  const k = effortOf(S)
  if (EFFORT[k]) return k
  let rir = 0, rpe = 0
  eachDoneSet(S, s => { if (s.rir != null) rir++; else if (s.rpe != null) rpe++ })
  return rpe > rir ? 'rpe' : 'rir'
}
export const scaleName = kind => EFFORT[kind].hd

// Every finished set in the profile, oldest first. `fn` gets the set plus the workout it
// belongs to, which is what the windowed and per-week views need.
function eachDoneSet(S, fn) {
  ;(S.workouts || []).forEach(w =>
    (w.entries || []).forEach(e =>
      (e.sets || []).forEach(s => { if (s.done && !isWarmupRow(s)) fn(s, w, e) })))
}

// A window in days, counted back from now. 0 = everything, which is also what an empty
// history means for every caller here.
const inWindow = (w, days) =>
  !days || workoutAt(w) > Date.now() - days * 86400000

// A set's RIR plus where it came from. The default resolver is logged effort only
// (historical behaviour, unchanged); pass a resolver built on
// recovery.js:resolveSetRir for the estimated fallback, which keeps stats and the
// fatigue map in agreement about every set.
const normRir = r => {
  if (r == null) return null
  if (typeof r === 'number') return { rir: r, estimated: false }
  return { rir: r.rir, estimated: r.source ? r.source !== 'logged' : !!r.estimated }
}

export const avgRir = sets => {
  const vs = (sets || []).map(rirOf).filter(v => v != null)
  return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null
}

/**
 * The headline numbers for a window: how hard, how much of it was hard, and — the part that
 * keeps the rest honest — how much of the training was rated at all. Effort is optional and
 * off by default, so partial coverage is the normal case; an average without its denominator
 * would quietly speak for sets that were never rated. `resolve` maps (set, workout, entry)
 * to RIR; estimates flow through it flagged, so the caller can label them honestly.
 */
export function effortSummary(S, days, resolve = rirOf) {
  let done = 0, rated = 0, est = 0, sum = 0, hard = 0
  eachDoneSet(S, (s, w, e) => {
    if (!inWindow(w, days)) return
    done++
    const r = normRir(resolve(s, w, e))
    if (r == null || r.rir == null) return
    if (r.estimated) est++
    else rated++
    sum += r.rir
    if (r.rir <= HARD_RIR) hard++
  })
  const covered = rated + est
  return {
    done, rated, est, covered, hard,
    avg: covered >= MIN_RATED ? sum / covered : null,
    hardPct: covered >= MIN_RATED ? hard / covered : null
  }
}

/** Does this profile hold any rated set at all? Decides whether the effort UI exists. */
export function hasEffort(S) {
  let any = false
  eachDoneSet(S, s => { if (!any && rirOf(s) != null) any = true })
  return any
}

/**
 * Could any set be RIR-estimated (load, reps in estimator range, non-assisted)?
 * Decides whether the estimated-fallback UI exists for histories nobody rated -
 * Jefit/Hevy imports carry loads but no ratings. Warm-ups don't count: estimating
 * them would fill the card with discounted ramp rows instead of training.
 */
export function hasEstimableEffort(S) {
  let any = false
  eachDoneSet(S, (s, w, e) => {
    if (any) return
    const wgt = Number(s?.w)
    const reps = Number(s?.r)
    if (!(wgt > 0) || !(reps >= 1) || reps > 12) return
    if (isAssisted(e?.id ? { id: e.id } : e)) return
    any = true
  })
  return any
}

/**
 * Average effort per calendar week, with the week's set count alongside: the pair is the
 * point. Volume up with effort up is fatigue accumulating; volume up with effort flat is the
 * adaptation you were training for. Weeks with a single rated set are dropped rather than
 * drawn — one tap should not become a peak in the curve.
 */
export function effortWeeks(S, days, resolve = rirOf) {
  const ws = weekStartOf(S)
  const wk = new Map()
  eachDoneSet(S, (s, w, entry) => {
    if (!inWindow(w, days)) return
    const k = weekKey(w.d, ws)
    let b = wk.get(k)
    if (!b) wk.set(k, b = { k, t: startOfWeek(w.d, ws).getTime(), sum: 0, n: 0, est: 0, sets: 0 })
    b.sets++
    const r = normRir(resolve(s, w, entry))
    if (r != null && r.rir != null) { b.sum += r.rir; b.n++; if (r.estimated) b.est++ }
  })
  return [...wk.values()].filter(e => e.n >= 2).sort((a, b) => a.t - b.t)
    .map(e => ({ t: e.t, rir: e.sum / e.n, n: e.n, est: e.est, sets: e.sets }))
}

/**
 * How the rated sets spread across the scale, in whole steps with everything past the top
 * bucket collapsed into it. This is the chart that answers "am I training too far from
 * failure, or leaving nothing for the next session" — an average alone hides both, because
 * half the sets at 0 and half at 4 average to a healthy-looking 2.
 */
export const BUCKETS = 4        // 0,1,2,3 and a "4+" tail
export function effortHistogram(S, days, resolve = rirOf) {
  const bins = new Array(BUCKETS + 1).fill(0)
  let rated = 0
  eachDoneSet(S, (s, w, e) => {
    if (!inWindow(w, days)) return
    const r = normRir(resolve(s, w, e))
    if (r == null || r.rir == null) return
    rated++
    bins[Math.min(BUCKETS, Math.max(0, Math.floor(r.rir)))]++
  })
  return bins.map((n, i) => ({ rir: i, tail: i === BUCKETS, n, pct: rated ? n / rated : 0 }))
}

/** A set that counts as hard — the filter behind the muscle map's "hard sets" mode. */
export const isHardSet = s => { const r = rirOf(s); return r != null && r <= HARD_RIR }

// ---------------------------------------------------------------- colour bands --
//
// A set's effort read as a colour, so a glance down a workout tells you how hard it ran
// without reading every number. Bands are defined once, in RIR (the internal scale), and
// apply unchanged whether the profile logs RIR or RPE — RPE 8 and RIR 2 are the same set and
// get the same colour. The scale runs from "nothing left" (purple, past red — the far end,
// not just "very hard") through to "easy, warm-up range" (green).
//
// The named buckets are also the quick-pick presets: one tap logs the middle of a band. They
// are deliberately coarse where estimation is coarse — nobody reliably tells 5 RIR from 7, so
// everything from 4 up shares one bucket — and fine near failure, where the difference between
// 0, 0.5 and 1 actually changes the training. A typed value between presets still colours by
// the band it falls in, so the flexibility of a free number is never lost.
export const EFFORT_BANDS = [
  { rir: 0, max: 0.25, color: 'var(--purple)', feel: 'Nothing left, went to failure' },
  { rir: 0.5, max: 0.75, color: 'var(--red)', feel: 'Maybe half a rep left' },
  { rir: 1, max: 1.5, color: 'var(--orange)', feel: 'One more rep in the tank' },
  { rir: 2, max: 2.5, color: 'var(--yellow)', feel: 'Two more reps' },
  { rir: 3, max: 3.5, color: 'var(--green)', feel: 'Three more reps' },
  { rir: 4, max: Infinity, color: 'var(--acc-2)', feel: 'Easy, warm-up territory' }
]
// The presets shown in the picker, hardest first — the order they read on the scale and the
// order the colours run. `tail` is the collapsed top bucket ("4+"): its value is the floor it
// stands for, so a tap logs a concrete 4, not a range nothing downstream could average.
export const EFFORT_PRESETS = EFFORT_BANDS.map((b, i) => ({
  rir: b.rir, color: b.color, feel: b.feel, tail: i === EFFORT_BANDS.length - 1
}))

/**
 * The colour for one effort value, given in RIR (use rirOf to convert a set first). Picks the
 * band the value falls into: an exact preset lands on its own band, a typed in-between value
 * (RIR 1.5) takes the band it sits within so it is never left uncoloured. null (unrated) has
 * no colour — the caller shows a neutral control, not a green one.
 */
export const effortColor = rir => {
  if (rir == null) return null
  for (const b of EFFORT_BANDS) if (rir <= b.max) return b.color
  return EFFORT_BANDS[EFFORT_BANDS.length - 1].color
}
