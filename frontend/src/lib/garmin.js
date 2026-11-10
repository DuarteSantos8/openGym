// Garmin Connect data, read by this server with the account's own Personal API key
// (contrib/cloudflare/garmin.js, /api/garmin). The server keeps the last 90 days and 100
// activities; this file reads them and works out what the screens show. Only on our own
// Cloudflare deploy: on a server without /api/garmin, load() answers null and nothing shows.
import { api } from './api.js'

export const loadGarmin = () => api('/api/garmin').catch(e => (e.status === 404 || e.code === 'bad-response' ? null : Promise.reject(e)))
export const connectGarmin = (key, days) => api('/api/garmin', { method: 'PUT', body: JSON.stringify({ key, days }), timeout: 90000 })
export const syncGarmin = () => api('/api/garmin/sync', { method: 'POST', timeout: 60000 })
export const probeGarmin = () => api('/api/garmin/probe', { timeout: 90000 })
export const disconnectGarmin = () => api('/api/garmin', { method: 'DELETE' })

/** The day `iso` of a loaded record, or null. */
export const dayOf = (g, iso) => g?.days?.find(d => d.date === iso) || null

/** The mean of `field` over the `n` days before `iso` that have it, or null. */
export function meanBefore(g, field, iso, n = 7) {
  const vals = (g?.days || []).filter(d => d.date < iso && d[field] != null).slice(-n).map(d => d[field])
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
}

/**
 * How ready the body looks today, from what the watch measured overnight: sleep score, the
 * morning's body battery (the day's highest), HRV status against its own baseline, and the
 * resting heart rate against the week before. Two bad signs make it an easy day, none bad and
 * two good a day to push. ponytail: fixed thresholds, Garmin's own "training readiness" is not
 * in the Personal API; tune them here if they feel off.
 * Returns { level: 'push' | 'normal' | 'easy', good: [..], bad: [..] } or null without data.
 */
export function readiness(g, iso) {
  const d = dayOf(g, iso)
  if (!d) return null
  const good = [], bad = []
  if (d.sleepScore != null) (d.sleepScore >= 80 ? good : d.sleepScore < 60 ? bad : []).push(`Sleep score ${d.sleepScore}`)
  else if (d.sleepSec != null) (d.sleepSec >= 7.5 * 3600 ? good : d.sleepSec < 6 * 3600 ? bad : []).push(`Slept ${fmtDuration(d.sleepSec)}`)
  if (d.bbMax != null) (d.bbMax >= 75 ? good : d.bbMax < 40 ? bad : []).push(`Body battery up to ${d.bbMax}`)
  if (d.hrvStatus) {
    const s = d.hrvStatus.toUpperCase()
    if (s === 'BALANCED') good.push('HRV balanced')
    else if (s === 'UNBALANCED' || s === 'LOW' || s === 'POOR') bad.push(`HRV ${s.toLowerCase()}`)
  }
  const usual = meanBefore(g, 'restHr', iso)
  if (d.restHr != null && usual != null) {
    if (d.restHr >= usual + 5) bad.push(`Resting heart rate ${d.restHr}, usually ${Math.round(usual)}`)
    else if (d.restHr <= usual - 2) good.push(`Resting heart rate ${d.restHr}, below usual`)
  }
  if (!good.length && !bad.length) return null
  const level = bad.length >= 2 ? 'easy' : !bad.length && good.length >= 2 ? 'push' : 'normal'
  return { level, good, bad }
}

export const READY_TITLE = { push: 'Ready to push', normal: 'Train as planned', easy: 'Take it easy today' }

/** 27000 -> "7 h 30 min", 300 -> "5 min". */
export function fmtDuration(sec) {
  const m = Math.round((Number(sec) || 0) / 60)
  const h = Math.floor(m / 60)
  return h ? `${h} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`
}

/** Speed in m/s -> pace "5:12 /km". */
export function fmtPace(speed) {
  if (!(speed > 0)) return ''
  const s = Math.round(1000 / speed)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} /km`
}

const RUNS = /running|walking|hiking|cycling|biking|swim|rowing/
/** What to show of an activity in one line: time, distance and pace where they mean something. */
export function activityLine(a) {
  const parts = []
  if (a.dur) parts.push(fmtDuration(a.dur))
  if (a.dist >= 100) parts.push((a.dist / 1000).toFixed(2) + ' km')
  if (a.speed && /running|walking|hiking/.test(a.type || '')) parts.push(fmtPace(a.speed))
  if (a.hr) parts.push(`${Math.round(a.hr)} bpm`)
  if (!RUNS.test(a.type || '') && a.sets) parts.push(`${a.sets} sets`)
  return parts.join(' · ')
}

/** "trail_running" -> "Trail running". */
export const activityType = key => (key ? key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ') : 'Activity')

/** The local day of an activity's "2026-11-10 07:12:00". */
export const activityDay = a => String(a?.start || '').slice(0, 10)

/**
 * What the watch measured as burned by activities on day `iso`, on top of resting (each activity's
 * calories minus its resting share), or null when Garmin has no activity that day. The food diary
 * eats this back instead of its own estimate (nutrition.js workoutKcal): same meaning, measured.
 */
export function activityKcal(g, iso) {
  const acts = (g?.acts || []).filter(a => activityDay(a) === iso && a.kcal > 0)
  return acts.length ? Math.round(acts.reduce((sum, a) => sum + Math.max(0, a.kcal - (a.bmr || 0)), 0)) : null
}

/** Days left on the key, or null when its expiry is unknown. */
export const keyDaysLeft = (g, now = Date.now()) => (g?.keyExp ? Math.ceil((g.keyExp - now) / 86400e3) : null)

/** The local time of an activity's "2026-11-10 07:12:00" as ms (the device's own clock). */
export const activityStart = a => (a?.start ? new Date(String(a.start).replace(' ', 'T')).getTime() : NaN)

/**
 * The Garmin activity recorded during workout `w` (its start and end, ms or ISO), the one that
 * overlaps it most, or null. Ten minutes of slack each side: the watch is often started in the
 * changing room or stopped on the way out.
 */
export function matchWorkout(g, w) {
  const ws = new Date(w?.start).getTime(), we = new Date(w?.end).getTime()
  if (!Number.isFinite(ws) || !Number.isFinite(we) || we <= ws) return null
  const slack = 10 * 60e3
  let best = null, most = 0
  for (const a of g?.acts || []) {
    const as = activityStart(a), ae = as + (a.dur || 0) * 1000
    const overlap = Math.min(we + slack, ae) - Math.max(ws - slack, as)
    if (Number.isFinite(overlap) && overlap > most) { most = overlap; best = a }
  }
  return best
}

const STRENGTH = /strength|fitness_equipment|indoor_cardio|hiit/
/**
 * The seven days ending `iso`: workouts logged here, Garmin activities that are not one of them
 * (runs, rides, walks), intensity minutes (vigorous count double, as WHO and Garmin count them)
 * against 150, and the mean sleep, HRV and resting heart rate, each with the week before.
 */
export function weekSummary(g, workouts, iso) {
  const day = n => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10) }
  const from = day(6), prevFrom = day(13)
  const inWeek = x => x >= from && x <= iso
  const days = (g?.days || []).filter(d => inWeek(d.date))
  const prev = (g?.days || []).filter(d => d.date >= prevFrom && d.date < from)
  const mean = (list, f) => { const v = list.map(f).filter(x => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null }
  const gym = (workouts || []).filter(w => inWeek(String(w.d || '')))
  const other = (g?.acts || []).filter(a => inWeek(activityDay(a)) && !STRENGTH.test(a.type || ''))
  return {
    gym: gym.length,
    other: other.length,
    km: other.reduce((n, a) => n + (a.dist || 0), 0) / 1000,
    otherKcal: other.reduce((n, a) => n + (a.kcal || 0), 0),
    im: days.length ? days.reduce((n, d) => n + (d.imMod || 0) + 2 * (d.imVig || 0), 0) : null,
    sleep: mean(days, d => d.sleepSec), sleepPrev: mean(prev, d => d.sleepSec),
    hrv: mean(days, d => d.hrv), hrvPrev: mean(prev, d => d.hrv),
    rhr: mean(days, d => d.restHr), rhrPrev: mean(prev, d => d.restHr),
    steps: mean(days, d => d.steps),
  }
}
