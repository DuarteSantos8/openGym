// What a teacher reads off a student's record in the Admin drill-down: the weight and body-fat
// trend and how the last 30 days of training compare with the 30 before. Pure: Admin.jsx hands
// over the drill-down document (`workouts`, `bodyweight`, `measurements`) and draws the result.
import { workoutVolume } from './history.js'
import { bestSetOf } from './onerm.js'

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

// The workouts that count: well-formed ones the teacher has not put aside (archived).
const counted = d => (Array.isArray(d?.workouts) ? d.workouts : []).filter(w => w && !w.archived && /^\d{4}-\d{2}-\d{2}$/.test(w.d) && Array.isArray(w.entries) && w.entries.every(e => e && Array.isArray(e.sets)))

export function studentProgress(d, now = Date.now()) {
  const workouts = counted(d)
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

// How the student is doing, in numbers a teacher can act on: sessions a week against the plan,
// volume week by week, and how each lift's estimated one-rep max moved. Archived workouts are
// left out, which is what archiving is for: a finished block stops weighing on the new one.
export const WEEKS_SHOWN = 8
export function studentPerformance(d, now = Date.now()) {
  const workouts = counted(d)
  const weeks = []
  for (let i = WEEKS_SHOWN - 1; i >= 0; i--) {
    const rows = workouts.filter(w => { const t = day(w.d); return t > now - (i + 1) * 7 * DAY && t <= now - i * 7 * DAY })
    weeks.push({ count: rows.length, volume: Math.round(rows.reduce((n, w) => n + (num(w.vol) ?? workoutVolume(w)), 0)) })
  }
  const planned = num(d?.plannedDays) > 0 ? num(d.plannedDays) : null
  const last4 = weeks.slice(-4).reduce((n, w) => n + w.count, 0)
  const series = {}
  for (const w of workouts) {
    if (day(w.d) <= now - 120 * DAY) continue
    for (const e of w.entries) {
      const best = e.id != null ? bestSetOf(e) : null
      if (best) (series[e.id] ||= []).push({ d: w.d, est: best.est })
    }
  }
  const strength = Object.entries(series)
    .map(([id, pts]) => {
      pts.sort((a, b) => (a.d < b.d ? -1 : 1))
      const first = pts[0].est, last = pts[pts.length - 1].est
      return { id, n: pts.length, first, last, delta: round(last - first), pct: first ? Math.round(((last - first) / first) * 100) : 0 }
    })
    .filter(x => x.n >= 2)
    .sort((a, b) => b.n - a.n || Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 5)
  return {
    weeks,
    perWeek: round(last4 / 4),
    planned,
    adherence: planned ? Math.min(100, Math.round((last4 / (planned * 4)) * 100)) : null,
    strength,
    archived: (Array.isArray(d?.workouts) ? d.workouts : []).filter(w => w && w.archived).length
  }
}
