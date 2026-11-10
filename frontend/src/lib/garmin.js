// Garmin Connect data, read by this server with the account's own Personal API key
// (contrib/cloudflare/garmin.js, /api/garmin). The server keeps the last 90 days and 100
// activities; this file reads them and works out what the screens show. Only on our own
// Cloudflare deploy: on a server without /api/garmin, load() answers null and nothing shows.
import { api } from './api.js'
import { dailyGoal, workoutKcal } from './nutrition.js'
import { dayOf, meanBefore, fmtDuration, sickSigns } from './garmin-core.js'
export { dayOf, meanBefore, readiness, READY_TITLE, fmtDuration, sickSigns } from './garmin-core.js'

export const loadGarmin = () => api('/api/garmin').catch(e => (e.status === 404 || e.code === 'bad-response' ? null : Promise.reject(e)))
export const connectGarmin = (key, days) => api('/api/garmin', { method: 'PUT', body: JSON.stringify({ key, days }), timeout: 90000 })
export const syncGarmin = () => api('/api/garmin/sync', { method: 'POST', timeout: 60000 })
export const probeGarmin = () => api('/api/garmin/probe', { timeout: 90000 })
export const disconnectGarmin = () => api('/api/garmin', { method: 'DELETE' })
export const saveGarminPrefs = prefs => api('/api/garmin/prefs', { method: 'PUT', body: JSON.stringify(prefs) })

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

/* ---------- batch 1: consistency, zones, real burn, early warning ---------- */

const before = (g, iso, n) => (g?.days || []).filter(d => d.date <= iso).slice(-n)
const avg = v => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null)
const sd = v => { const m = avg(v); return v.length > 1 ? Math.sqrt(avg(v.map(x => (x - m) ** 2))) : null }

/** 1410 -> "23:30", 1500 -> "01:00". */
export const fmtClock = min => { const m = ((Math.round(min) % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}` }

/**
 * Bed and wake times over the last `n` nights up to `iso`: means, spread (standard deviation in
 * minutes) and the bedtime that gives `needMin` of sleep before the usual wake-up (plus the
 * usual time awake in bed). Bedtimes after midnight count as late, not early (00:30 is 24:30).
 * Null with fewer than 5 nights.
 */
export function bedtimes(g, iso, n = 14, needMin = 450) {
  const nights = before(g, iso, n).filter(d => d.bed != null && d.wake != null)
  if (nights.length < 5) return null
  const beds = nights.map(d => (d.bed < 12 * 60 ? d.bed + 1440 : d.bed))
  const wakes = nights.map(d => d.wake)
  const awake = avg(nights.map(d => (d.awakeSec || 0) / 60))
  const wake = avg(wakes)
  return { n: nights.length, bed: avg(beds), bedSpread: sd(beds), wake, wakeSpread: sd(wakes), aim: wake + 1440 - needMin - awake }
}

/** Minutes in each heart rate zone over the 7 days ending `iso`, from every activity. */
export function zoneWeek(g, iso) {
  const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() - 6)
  const from = d.toISOString().slice(0, 10)
  const out = [0, 0, 0, 0, 0]
  for (const a of g?.acts || []) {
    const day = activityDay(a)
    if (day >= from && day <= iso) (a.zones || []).forEach((sec, i) => { out[i] += sec / 60 })
  }
  return out.map(Math.round)
}

/**
 * What you really burn a day: the mean of Garmin's total calories over the 28 full days before
 * `iso` (today is never full). Days under 1200 kcal are a watch left on the charger, not a day.
 * Null with fewer than 7 such days.
 */
export function realTdee(g, iso) {
  const days = (g?.days || []).filter(d => d.date < iso && d.kcal >= 1200).slice(-28)
  return days.length >= 7 ? Math.round(avg(days.map(d => d.kcal))) : null
}

/** The fitness age levers worth showing, most promising first: [{ key, label, value, target, age }]. */
export function fitnessLevers(fa) {
  const L = { vigMin: ['Vigorous minutes a week', ''], vigDays: ['Vigorous days a week', ''], rhr: ['Resting heart rate', ' bpm'], bmi: ['BMI', ''] }
  return Object.entries(fa?.levers || {}).filter(([k]) => L[k]).map(([k, x]) => ({ key: k, label: L[k][0], unit: L[k][1], ...x }))
    .sort((a, b) => (a.priority ?? 9) - (b.priority ?? 9))
}

/**
 * The food diary's goal for day `iso` with Garmin in it: with S.foodGarminTdee on, the calculated
 * goal starts from your measured burn (realTdee) instead of the activity level; then workouts are
 * not eaten back again, since that burn already holds them. Otherwise eat-back (S.foodEatBack)
 * uses Garmin's measured activity calories when there are any, else the estimate.
 * Returns { goal, burn (the measured burn used, or null), burned (eaten back), measured }.
 */
export function foodGoal(S, g, iso) {
  const want = S?.foodGarminTdee ? realTdee(g, iso) : null
  const base = dailyGoal(S, { burn: want })
  const burn = base?.auto ? want : null
  const measured = activityKcal(g, iso)
  const burned = S?.foodEatBack && !burn ? measured ?? workoutKcal(S, iso) : 0
  return { goal: base && burned ? { ...base, kcal: base.kcal + burned } : base, burn, burned, measured }
}
