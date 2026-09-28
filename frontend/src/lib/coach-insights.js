// The numbers behind a Coach card, computed on the device from the same training log the
// Coach read — so the chart under a suggestion shows exactly the window the suggestion cites,
// and nothing the model wrote is ever taken as a statistic.
//
// Pure functions over S. Nothing here is persisted: a card recomputes its insights from the
// window it names, which is why an old proposal in the thread still draws its chart months
// later, against the data as it was then.
import { EXIDX } from './exercises.js'
import { workoutVolume } from './history.js'
import { isWarmupRow } from './workout-model.js'
import { bestSetOf } from './onerm.js'

const median = arr => {
  const a = arr.filter(n => Number.isFinite(n)).sort((x, y) => x - y)
  return a.length ? a[Math.floor(a.length / 2)] : null
}
const bpOf = (S, id) => EXIDX[id]?.bp || (S.customEx || []).find(c => c.id === id)?.bp || null
const nameOf = (S, id) => EXIDX[id]?.n || (S.customEx || []).find(c => c.id === id)?.n || id
const tsOf = w => w.start || new Date(w.d + 'T12:00:00').getTime()

/** Workouts inside an inclusive ISO-date window; either bound may be missing. */
export function windowWorkouts(S, { from, to } = {}) {
  return (S.workouts || []).filter(w => w && w.d && (!from || w.d >= from) && (!to || w.d <= to))
}

/**
 * What a review looked at, in numbers: how much, how long, which body parts, where the body
 * weight went and which lifts moved. `strength` holds up to `topN` exercises with at least two
 * estimable sessions in the window, most-trained first, with the first→last e1RM change.
 */
export function insightsFor(S, win = {}, { topN = 3 } = {}) {
  const ws = windowWorkouts(S, win)
  const minutes = ws.map(w => (w.end && w.start ? Math.round((w.end - w.start) / 60000) : null)).filter(n => n > 0)
  const volume = ws.reduce((n, w) => n + (Number.isFinite(w.vol) ? w.vol : workoutVolume(w)), 0)

  const byBp = {}
  let setsTotal = 0
  ws.forEach(w => (w.entries || []).forEach(en => {
    const n = (en.sets || []).filter(s => s.done && !isWarmupRow(s)).length
    if (!n) return
    setsTotal += n
    const bp = bpOf(S, en.id) || 'other'
    byBp[bp] = (byBp[bp] || 0) + n
  }))
  const bodyParts = Object.entries(byBp).map(([bp, sets]) => ({ bp, sets, share: setsTotal ? sets / setsTotal : 0 }))
    .sort((a, b) => b.sets - a.sets)

  const from = win.from || ws[0]?.d || null
  const to = win.to || ws[ws.length - 1]?.d || null
  const bw = (S.bodyweight || []).filter(b => b && b.d && (!from || b.d >= from) && (!to || b.d <= to))
    .map(b => ({ t: b.t || new Date(b.d + 'T12:00:00').getTime(), y: b.w, d: b.d }))
  const bodyweight = {
    points: bw,
    delta: bw.length > 1 ? Math.round((bw[bw.length - 1].y - bw[0].y) * 10) / 10 : null,
    last: bw.length ? bw[bw.length - 1].y : null,
    goal: Number.isFinite(S.targetW) ? S.targetW : null
  }

  const series = new Map()
  ws.forEach(w => (w.entries || []).forEach(en => {
    const best = bestSetOf(en)
    if (!best) return
    if (!series.has(en.id)) series.set(en.id, [])
    series.get(en.id).push({ t: tsOf(w), d: w.d, y: Math.round(best.est * 10) / 10 })
  }))
  const strength = [...series.entries()]
    .filter(([, pts]) => pts.length >= 2)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, topN)
    .map(([id, pts]) => {
      const first = pts[0].y, last = pts[pts.length - 1].y
      return { id, name: nameOf(S, id), sessions: pts.length, first, last, delta: Math.round((last - first) * 10) / 10, pct: first ? Math.round((last - first) / first * 100) : 0, points: pts }
    })

  return {
    from, to, sessions: ws.length, minutes: median(minutes), volume: Math.round(volume), sets: setsTotal,
    bodyParts, bodyweight, strength
  }
}

/**
 * One workout against the last time the same routine was trained: the numbers a debrief
 * card puts above the Coach's words.
 */
export function sessionInsights(S, workout) {
  if (!workout) return null
  const all = (S.workouts || []).filter(w => w && w.d)
  const idx = all.findIndex(w => (workout.id && w.id === workout.id) || (w.d === workout.d && w.start === workout.start))
  const before = (idx >= 0 ? all.slice(0, idx) : all).filter(w => w.name && w.name === workout.name)
  const prev = before[before.length - 1] || null
  const stat = w => ({
    volume: Math.round(Number.isFinite(w.vol) ? w.vol : workoutVolume(w)),
    sets: (w.entries || []).reduce((n, en) => n + (en.sets || []).filter(s => s.done && !isWarmupRow(s)).length, 0),
    minutes: w.end && w.start ? Math.round((w.end - w.start) / 60000) : null,
    prs: (w.prs || []).length
  })
  const now = stat(workout)
  const then = prev ? stat(prev) : null
  const lifts = (workout.entries || []).map(en => {
    const best = bestSetOf(en)
    const pe = prev?.entries?.find(x => x.id === en.id)
    const pb = pe ? bestSetOf(pe) : null
    return best ? { id: en.id, name: nameOf(S, en.id), est: Math.round(best.est * 10) / 10, w: best.w, r: best.r, prev: pb ? Math.round(pb.est * 10) / 10 : null } : null
  }).filter(Boolean)
  return { now, then, prevDate: prev?.d || null, lifts }
}
