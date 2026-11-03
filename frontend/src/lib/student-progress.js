// What a teacher reads off a student's record in the Admin drill-down: the weight and body-fat
// trend and how the last 30 days of training compare with the 30 before. Pure: Admin.jsx hands
// over the drill-down document (`workouts`, `bodyweight`, `measurements`) and draws the result.
import { workoutVolume } from './history.js'

const DAY = 86400000
const day = iso => Date.parse(iso + 'T00:00:00Z')
const num = v => (v != null && v !== '' && Number.isFinite(+v) ? +v : null)
const round = n => Math.round(n * 10) / 10
const sorted = (list, pick) => (Array.isArray(list) ? list : [])
  .filter(e => e && /^\d{4}-\d{2}-\d{2}$/.test(e.d) && pick(e) != null)
  .sort((a, b) => (a.d < b.d ? -1 : 1))

// First and latest reading of a series, with the change between them (null with fewer than two).
function trend(list, pick) {
  const rows = sorted(list, pick)
  if (!rows.length) return null
  const first = pick(rows[0]), last = pick(rows[rows.length - 1])
  return { first, last, delta: rows.length > 1 ? round(last - first) : null, since: rows[0].d, n: rows.length }
}

export function studentProgress(d, now = Date.now()) {
  const workouts = (Array.isArray(d?.workouts) ? d.workouts : []).filter(w => w && /^\d{4}-\d{2}-\d{2}$/.test(w.d) && Array.isArray(w.entries) && w.entries.every(e => e && Array.isArray(e.sets)))
  const window = (from, to) => {
    const rows = workouts.filter(w => { const t = day(w.d); return t > now - to * DAY && t <= now - from * DAY })
    return { count: rows.length, volume: Math.round(rows.reduce((n, w) => n + (num(w.vol) ?? workoutVolume(w)), 0)), prs: rows.reduce((n, w) => n + (Array.isArray(w.prs) ? w.prs.length : 0), 0) }
  }
  return {
    weight: trend(d?.bodyweight, e => num(e.w)),
    bodyFat: trend(d?.measurements, e => num(e.bodyFat)),
    last30: window(0, 30),
    prev30: window(30, 60),
    lastWorkout: workouts.reduce((m, w) => (w.d > m ? w.d : m), '') || null
  }
}
