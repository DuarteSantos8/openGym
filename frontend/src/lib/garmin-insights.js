// Garmin data set against the gym log: body battery over a day, what a session costs, sleep
// against strength, running efficiency, training load and tonight's sleep target. Pure helpers.
import { bestSetOf, formulaOf } from './onerm.js'
import { matchWorkout, dayOf, meanBefore, activityStart, activityDay } from './garmin.js'

const avg = v => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null)
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const minOf = ms => { const d = new Date(ms); return d.getHours() * 60 + d.getMinutes() }
const dayStr = ms => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

/** Body battery through day `iso` with the sessions on it: { points: [{ m, y }], marks: [{ from, to, label, kind, cost }] } or null. */
export function bbCurve(g, iso, workouts) {
  const bb = dayOf(g, iso)?.bb15
  if (!bb?.length) return null
  const points = bb.map(([m, y]) => ({ m, y }))
  const marks = [], used = new Set()
  for (const w of workouts || []) {
    const s = new Date(w.start).getTime(), e = new Date(w.end).getTime()
    if (!Number.isFinite(s) || dayStr(s) !== iso) continue
    const a = matchWorkout(g, w)
    if (a) used.add(a)
    marks.push({ from: minOf(s), to: Number.isFinite(e) ? minOf(e) : minOf(s), label: w.name || 'Workout', kind: 'gym', cost: a?.bb ?? null })
  }
  for (const a of g.acts || []) {
    if (activityDay(a) !== iso || used.has(a)) continue
    const from = minOf(activityStart(a))
    if (Number.isFinite(from)) marks.push({ from, to: from + Math.round((a.dur || 0) / 60), label: a.name || 'Activity', kind: 'activity', cost: a.bb ?? null })
  }
  return { points, marks }
}

/** Per routine, what its sessions drained and how HRV and resting HR looked next morning (groups of 2+, most drained first). */
export function sessionCost(g, workouts, routines) {
  const groups = new Map()
  for (const w of workouts || []) {
    const a = matchWorkout(g, w)
    if (!a) continue
    const rid = w.routineId || 'free'
    if (!groups.has(rid)) groups.set(rid, [])
    groups.get(rid).push({ w, a })
  }
  const out = []
  for (const [rid, list] of groups) {
    if (list.length < 2) continue
    const hrv = [], rhr = []
    for (const { w } of list) {
      const next = addDays(w.d, 1), day = dayOf(g, next)
      const h = meanBefore(g, 'hrv', w.d, 7), r = meanBefore(g, 'restHr', next, 7)
      if (day?.hrv != null && h) hrv.push(day.hrv / h - 1)
      if (day?.restHr != null && r != null) rhr.push(day.restHr - r)
    }
    const bbs = list.map(x => x.a.bb).filter(v => v != null)
    out.push({ rid, name: rid === 'free' ? 'Freestyle' : (routines || []).find(r => r.id === rid)?.name || 'Routine', n: list.length, bb: avg(bbs), hrvNext: avg(hrv), rhrNext: avg(rhr) })
  }
  return out.sort((a, b) => (a.bb ?? 0) - (b.bb ?? 0))
}

/** Strength change on good vs poor sleep days: { good: { n, pct }, poor: { n, pct } } or null. */
export function sleepVsStrength(S, g) {
  const f = formulaOf(S), prev = new Map()
  const buckets = { good: [], poor: [] }
  for (const w of S?.workouts || []) {
    const pcts = []
    for (const e of w.entries || []) {
      const est = bestSetOf(e, f)?.est
      if (!est) continue
      const p = prev.get(e.id)
      if (p) pcts.push((est / p - 1) * 100)
      prev.set(e.id, est)
    }
    const d = dayOf(g, w.d)
    if (!pcts.length || !d) continue
    const good = d.sleepScore != null ? d.sleepScore >= 80 : d.sleepSec != null && d.sleepSec >= 7 * 3600
    const poor = d.sleepScore != null ? d.sleepScore < 65 : d.sleepSec != null && d.sleepSec < 6 * 3600
    if (good) buckets.good.push(avg(pcts))
    else if (poor) buckets.poor.push(avg(pcts))
  }
  if (buckets.good.length < 3 || buckets.poor.length < 3) return null
  const sum = v => ({ n: v.length, pct: avg(v) })
  return { good: sum(buckets.good), poor: sum(buckets.poor) }
}

/** Metres per heartbeat on runs, oldest first, and the change from the oldest to the newest third. */
export function runEfficiency(g) {
  const points = (g?.acts || []).filter(a => /running/.test(a.type || '') && a.speed > 0 && a.hr > 0 && a.dur >= 600)
    .map(a => ({ d: activityDay(a), y: Math.round(a.speed * 60 / a.hr * 100) / 100 }))
    .sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0))
  if (points.length < 2) return null
  if (points.length < 6) return { points, change: null }
  const k = Math.floor(points.length / 3)
  const old = avg(points.slice(0, k).map(p => p.y)), now = avg(points.slice(-k).map(p => p.y))
  return { points, change: Math.round((now / old - 1) * 1000) / 10 }
}

/** Weekly Garmin load against gym volume (kg), plus acute (7 d) over chronic (28 d / 4) load. */
export function trainingLoad(g, workouts, iso, weeks = 8) {
  const dow = (new Date(iso + 'T12:00:00Z').getUTCDay() + 6) % 7
  const start = addDays(iso, -dow - 7 * (weeks - 1))
  const acts = g?.acts || []
  const load = (from, to) => acts.filter(a => activityDay(a) >= from && activityDay(a) <= to).reduce((n, a) => n + (a.load || 0), 0)
  const rows = Array.from({ length: weeks }, (_, i) => {
    const from = addDays(start, 7 * i), to = addDays(from, 6)
    let gym = 0
    for (const w of workouts || []) {
      if (!(w.d >= from && w.d <= to)) continue
      for (const e of w.entries || []) for (const s of e.sets || []) if (s.done === true && Number.isFinite(+s.w) && Number.isFinite(+s.r) && s.w != null && s.r != null) gym += s.w * s.r
    }
    return { from, garmin: Math.round(load(from, to)), gym: Math.round(gym) }
  })
  const acute = load(addDays(iso, -6), iso), chronic = load(addDays(iso, -27), iso) / 4
  return { weeks: rows, acute, chronic, ratio: chronic ? Math.round(acute / chronic * 100) / 100 : null }
}

/** Minutes of sleep to aim for tonight and where that came from. */
export function sleepTarget(g, iso, manualMin) {
  const n = g?.needTonight
  if (n?.min) return { min: n.min, source: 'garmin', bedFrom: n.bedFrom, bedTo: n.bedTo }
  const need = dayOf(g, iso)?.sleepNeed
  if (need) return { min: need, source: 'garmin', bedFrom: undefined, bedTo: undefined }
  if (manualMin > 0) return { min: manualMin, source: 'manual', bedFrom: undefined, bedTo: undefined }
  return { min: 450, source: 'default', bedFrom: undefined, bedTo: undefined }
}
