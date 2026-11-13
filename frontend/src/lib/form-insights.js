// Daily form insights (v1.4.5, gm-insights): how the days you slept well, felt full of beans or
// woke up sore compare with how the workout went. Patterns, not proof: the card says how many
// workouts are on each side, says when a gap could just be chance, and shows nothing until there is
// enough to compare (MIN_GROUP workouts on each side, MIN_TOTAL in all, which is about three weeks
// of training with the check-in on).
//
// How a workout "went", three ways, each against your own recent normal so that a light day and a
// heavy day of a different routine can be compared:
//   strength  each exercise's best estimated 1RM in the session (lib/onerm.js bestSetOf) over the
//             median of its last five sessions before it, averaged over the session's exercises
//             (one with fewer than two sessions before it is left out);
//   volume    the session's volume over the median of the last five sessions of the same routine;
//   effort    the mean reps in reserve of the rated work sets (lib/effort.js rirOf).
//
// What a day "was": the check-in's answers (lib/daily-form.js) and the hours slept from the phone's
// health store (lib/vitals.js). A day the check-in made lighter is left out of every comparison: it
// was easier on purpose. Pure, and nothing here is sent anywhere.
import { workoutDay, sessionVolume } from './history.js'
import { bestSetOf, formulaOf } from './onerm.js'
import { isCardio } from './exercises.js'
import { isWarmupRow } from './workout-model.js'
import { rirOf } from './effort.js'
import { formOf, formScore } from './daily-form.js'
import { sleepHoursOn } from './vitals.js'

export const MIN_GROUP = 5
export const MIN_TOTAL = 14
const LOOKBACK = 5
// Gaps smaller than these read as "about the same".
const FLAT_PCT = 2
const FLAT_RIR = 0.3

const median = xs => {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length
const variance = xs => { const m = mean(xs); return xs.length > 1 ? xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1) : 0 }

const sorted = S => (Array.isArray(S?.workouts) ? S.workouts : [])
  .filter(w => w && workoutDay(w))
  .sort((a, b) => (workoutDay(a) < workoutDay(b) ? -1 : workoutDay(a) > workoutDay(b) ? 1 : (Number(a.start) || 0) - (Number(b.start) || 0)))

/** Per workout, oldest first: { id, d, strength, volume, effort }, each null when it cannot be told. */
export function workoutPerformance(S) {
  const formula = formulaOf(S)
  const exHist = new Map()     // exercise id -> recent best estimates
  const volHist = new Map()    // routine key -> recent volumes
  const out = []
  for (const w of sorted(S)) {
    const ratios = []
    const seen = new Set()
    for (const e of Array.isArray(w.entries) ? w.entries : []) {
      if (!e || typeof e.id !== 'string' || seen.has(e.id) || isCardio(e.id)) continue
      const best = bestSetOf(e, formula)
      if (!best) continue
      seen.add(e.id)
      const prev = exHist.get(e.id) || []
      if (prev.length >= 2) ratios.push(best.est / median(prev))
      exHist.set(e.id, [...prev, best.est].slice(-LOOKBACK))
    }
    const key = [].concat(w.routineIds || w.routineId || []).filter(Boolean).sort().join('+') || 'free'
    const vol = sessionVolume(w, S)
    const prevVol = volHist.get(key) || []
    const volume = vol > 0 && prevVol.length >= 2 ? vol / median(prevVol) : null
    if (vol > 0) volHist.set(key, [...prevVol, vol].slice(-LOOKBACK))
    const rirs = (w.entries || []).flatMap(e => (e?.sets || []).filter(s => s && s.done && !isWarmupRow(s)).map(rirOf)).filter(r => r != null)
    out.push({
      id: w.id, d: workoutDay(w),
      strength: ratios.length ? mean(ratios) : null,
      volume,
      effort: rirs.length ? mean(rirs) : null,
    })
  }
  return out
}

// The factors, each with the side of it that counts as the good one.
export const FACTORS = {
  sleepHours: { good: v => v >= 7 },
  sleep: { good: v => v >= 4 },
  energy: { good: v => v >= 4 },
  sore: { good: v => v <= 2 },
  stress: { good: v => v <= 2 },
  form: { good: v => v >= 3.5 },
}
export const METRICS = ['strength', 'volume', 'effort']

function factorValue(name, f, vitals, d) {
  if (name === 'sleepHours') return sleepHoursOn(vitals, d)
  if (!f) return null
  if (name === 'form') return formScore(f)
  return f[name] ?? null
}

/**
 * The comparisons there is enough data for, most telling first:
 *   [{ factor, metric, good: { n, mean }, other: { n, mean }, diff, flat, confidence }]
 * `diff` is in percent for strength and volume (good side over the other, minus one) and in reps
 * in reserve for effort (good side minus the other: more means the sets felt easier). `confidence`
 * is 'chance' (the gap is within the day-to-day noise), 'maybe' or 'consistent', from a plain
 * two-sample t statistic; `flat` is a gap too small to mention as one.
 */
export function formInsights(S, { vitals = null, perf = workoutPerformance(S) } = {}) {
  const out = []
  for (const factor of Object.keys(FACTORS)) {
    for (const metric of METRICS) {
      const good = [], other = []
      for (const p of perf) {
        const v = p[metric]
        if (v == null) continue
        const f = formOf(S, p.d)
        if (f?.lighter) continue
        const x = factorValue(factor, f, vitals, p.d)
        if (x == null) continue
        ;(FACTORS[factor].good(x) ? good : other).push(v)
      }
      if (good.length < MIN_GROUP || other.length < MIN_GROUP || good.length + other.length < MIN_TOTAL) continue
      const mg = mean(good), mo = mean(other)
      const se = Math.sqrt(variance(good) / good.length + variance(other) / other.length)
      const tStat = se > 0 ? Math.abs(mg - mo) / se : (mg === mo ? 0 : Infinity)
      const diff = metric === 'effort' ? Math.round((mg - mo) * 10) / 10 : Math.round((mg / mo - 1) * 1000) / 10
      out.push({
        factor, metric, diff,
        good: { n: good.length, mean: mg }, other: { n: other.length, mean: mo },
        flat: Math.abs(diff) < (metric === 'effort' ? FLAT_RIR : FLAT_PCT),
        confidence: tStat >= 2 ? 'consistent' : tStat >= 1 ? 'maybe' : 'chance',
        t: tStat,
      })
    }
  }
  return out.sort((a, b) => Number(a.flat) - Number(b.flat) || b.t - a.t)
}

/**
 * How far the data is from the first insight: { have, need } workouts with both a check-in (or a
 * night's sleep) and a performance reading. For the card's "come back in a while" line.
 */
export function insightProgress(S, { vitals = null, perf = workoutPerformance(S) } = {}) {
  const have = perf.filter(p => (p.strength != null || p.volume != null) && (formOf(S, p.d) || sleepHoursOn(vitals, p.d) != null) && !formOf(S, p.d)?.lighter).length
  return { have, need: MIN_TOTAL }
}
