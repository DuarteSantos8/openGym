// Recovery sessions (#313): a sauna, an ice bath, a massage, a stretch or a walk, logged in two
// taps with how long it took. They are not workouts: no sets, no volume, no PRs, and they stay out
// of everything that reads S.workouts. They show in History and the month calendar beside the
// workouts, in the journal when they carry a note, and they count for the week streak only when
// the profile asks for it (`S.recoveryStreak`, Settings → Look & Home; the walk is
// api/coach/core/streak.js, shared with the server so a trainer sees the same number).
//
// Stored one entry per session, keyed by its id, the way day photos are (lib/day-photos.js):
//
//   S.recoverySessions = { '<id>': { d: '2026-11-06', kind: 'sauna', min: 20, note: '…', _ts }, … }
//
// Two devices that each logged one keep both, an edit keeps its later version (lib/sync-merge.js
// mergeStampedMap, STAMPED_MAPS), and a removal is a stamped empty entry (`{ _ts }`), never a
// deleted key, which the other device's copy would bring straight back.
import { NOTE_MAX } from './history.js'
import { isOwnRecord, overlapsWorkout } from './activities.js'

export const RECOVERY_KINDS = ['sauna', 'cold', 'massage', 'stretch', 'walk', 'other']
export const RECOVERY_LABEL = { sauna: 'Sauna', cold: 'Ice bath', massage: 'Massage', stretch: 'Mobility', walk: 'Easy walk', other: 'Other recovery' }
export const RECOVERY_ICON = { sauna: 'flame', cold: 'snowflake', massage: 'heart', stretch: 'stretch', walk: 'steps', other: 'sparkles' }
// The durations the sheet offers in one tap, in minutes, per kind (a typed one is fine too).
export const RECOVERY_PRESETS = { sauna: [10, 15, 20], cold: [2, 3, 5], massage: [30, 45, 60], stretch: [10, 20, 30], walk: [20, 30, 45], other: [10, 20, 30] }
export const RECOVERY_MIN_MAX = 600
// Kinds that may match sessions recorded in Health Connect or Apple Health on the same day.
export const HEALTH_RECOVERY_KINDS = new Set(['walk', 'stretch'])
// All recorded session metrics shown by default; users can disable individual metrics in S.recoveryMetrics.
export const RECOVERY_METRIC_KEYS = ['km', 'pace', 'speed', 'steps', 'cadence', 'hr', 'kcal', 'elev', 'floors', 'laps']
export const RECOVERY_METRIC_LABEL = {
  km: 'Distance',
  pace: 'Pace',
  speed: 'Speed',
  steps: 'Steps',
  cadence: 'Cadence',
  hr: 'Heart rate',
  kcal: 'Calories',
  elev: 'Elevation',
  floors: 'Floors',
  laps: 'Splits',
}

/** Whether a recovery session metric is enabled for display (all on by default). */
export const isRecoveryMetricOn = (S, key) => S?.recoveryMetrics?.[key] !== false

/** Update S.recoveryMetrics for one metric key; stores `false` only when disabled. */
export function withRecoveryMetric(map, key, on) {
  const next = isMap(map) ? { ...map } : {}
  if (on) delete next[key]
  else next[key] = false
  return next
}

const HEALTH_SOURCES = ['hc', 'ah']
const SRC_ID_MAX = 120
const TITLE_MAX = 80
const APP_MAX = 60
const BPM_MIN = 25
const BPM_MAX = 250
const MI = 1.609344
const FT_PER_M = 3.28084
const roundKm = v => Math.round(v * 100) / 100
const round1 = v => Math.round(v * 10) / 10
const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v)
const ISO = /^\d{4}-\d{2}-\d{2}$/
const isoLocal = t => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

// Known Health Connect package names and Apple Health bundle IDs to clean brand names.
// Falls back to the OS-reported app name (`sourceName`) for anything else.
const ORIGIN_APP = [
  [/^com\.garmin\./i, 'Garmin Connect'],
  [/^com\.strava(\.|$)/i, 'Strava'],
  [/^com\.fitbit\./i, 'Fitbit'],
  [/^com\.sec\.android\.app\.shealth$/i, 'Samsung Health'],
  [/^com\.google\.android\.apps\.fitness$/i, 'Google Fit'],
  [/^fi\.polar\./i, 'Polar Flow'],
  [/^com\.coros\./i, 'COROS'],
  [/^com\.suunto\./i, 'Suunto'],
  [/^com\.whoop\./i, 'WHOOP'],
  [/^com\.ouraring\./i, 'Oura'],
  [/^com\.withings\./i, 'Withings'],
  [/^com\.peloton\./i, 'Peloton'],
  [/^com\.nike\.(plusgps|omega)/i, 'Nike Run Club'],
  [/^com\.alltrails\./i, 'AllTrails'],
  [/^com\.runtastic\./i, 'adidas Running'],
  [/^com\.wahoofitness\./i, 'Wahoo'],
  [/^com\.runna\./i, 'Runna'],
]

/** Human-readable source app name from a Health Connect package or Apple Health bundle id + label. */
export function appNameForOrigin(origin, sourceName = '') {
  const pkg = String(origin || '').trim()
  for (const [re, name] of ORIGIN_APP) if (re.test(pkg)) return name
  const fallback = typeof sourceName === 'string' ? sourceName.trim().slice(0, APP_MAX) : ''
  if (fallback) return fallback
  if (/^com\.apple\.health(\.|$)/i.test(pkg)) return 'Apple Watch'
  return ''
}

function readRecoveryHr(raw) {
  if (!isMap(raw)) return null
  const avg = Math.round(Number(raw.avg))
  if (!Number.isFinite(avg) || avg < BPM_MIN || avg > BPM_MAX) return null
  const min = Math.round(Number(raw.min))
  const max = Math.round(Number(raw.max))
  const validMin = Number.isFinite(min) && min >= BPM_MIN && min <= avg
  const validMax = Number.isFinite(max) && max >= avg && max <= BPM_MAX
  return { avg, ...(validMin ? { min } : {}), ...(validMax ? { max } : {}) }
}

function readRecoverySpeed(raw) {
  if (!isMap(raw)) return null
  const avg = Number(raw.avg)
  if (!Number.isFinite(avg) || avg < 0.1 || avg > 120) return null
  const max = Number(raw.max)
  const validMax = Number.isFinite(max) && max >= avg && max <= 120
  return { avg: round1(avg), ...(validMax ? { max: round1(max) } : {}) }
}

function readRecoveryLaps(raw) {
  if (!Array.isArray(raw) || !raw.length) return null
  const out = []
  for (const lap of raw.slice(0, 50)) {
    if (!isMap(lap)) continue
    const sec = Math.round(Number(lap.sec))
    if (!Number.isFinite(sec) || sec < 1 || sec > 86400) continue
    const km = Number(lap.km)
    out.push({ sec, ...(Number.isFinite(km) && km > 0 && km < 1000 ? { km: roundKm(km) } : {}) })
  }
  return out.length ? out : null
}

/** One stored entry read back: { d, kind, min, note?, at?, src?, srcId?, app?, title?, km?, kcal?, steps?, hr?, elev?, speed?, cadence?, floors?, laps? } or null. */
export function readRecovery(entry) {
  if (!isMap(entry) || !ISO.test(String(entry.d || ''))) return null
  const kind = RECOVERY_KINDS.includes(entry.kind) ? entry.kind : 'other'
  const min = Math.round(Number(entry.min))
  if (!Number.isFinite(min) || min < 1) return null
  const note = typeof entry.note === 'string' ? entry.note.trim().slice(0, NOTE_MAX) : ''
  const at = Number(entry.at)
  const src = HEALTH_SOURCES.includes(entry.src) ? entry.src : ''
  const srcId = typeof entry.srcId === 'string' ? entry.srcId.trim().slice(0, SRC_ID_MAX) : ''
  const app = typeof entry.app === 'string' ? entry.app.trim().slice(0, APP_MAX) : ''
  const title = typeof entry.title === 'string' ? entry.title.trim().slice(0, TITLE_MAX) : ''
  const km = Number(entry.km)
  const kcal = Math.round(Number(entry.kcal))
  const steps = Math.round(Number(entry.steps))
  const hr = readRecoveryHr(entry.hr)
  const elev = Math.round(Number(entry.elev))
  const speed = readRecoverySpeed(entry.speed)
  const cadence = Math.round(Number(entry.cadence))
  const floors = Number(entry.floors)
  const laps = readRecoveryLaps(entry.laps)
  return {
    d: entry.d, kind, min: Math.min(RECOVERY_MIN_MAX, min),
    ...(note ? { note } : {}),
    ...(Number.isFinite(at) && at > 0 ? { at } : {}),
    ...(src ? { src } : {}),
    ...(srcId ? { srcId } : {}),
    ...(app ? { app } : {}),
    ...(title ? { title } : {}),
    ...(Number.isFinite(km) && km > 0 && km < 1000 ? { km: roundKm(km) } : {}),
    ...(Number.isFinite(kcal) && kcal >= 1 && kcal <= 20000 ? { kcal } : {}),
    ...(Number.isFinite(steps) && steps >= 1 && steps <= 500000 ? { steps } : {}),
    ...(hr ? { hr } : {}),
    ...(Number.isFinite(elev) && elev >= 1 && elev <= 20000 ? { elev } : {}),
    ...(speed ? { speed } : {}),
    ...(Number.isFinite(cadence) && cadence >= 20 && cadence <= 260 ? { cadence } : {}),
    ...(Number.isFinite(floors) && floors >= 0.5 && floors <= 2000 ? { floors: round1(floors) } : {}),
    ...(laps ? { laps } : {}),
  }
}

/** Pace string from minutes and km ("10:15 /km" or "16:30 /mi"), or null when unavailable/implausible. */
export function recoveryPace(min, km, unit = 'kg') {
  const m = Number(min), dKm = Number(km)
  if (!(m > 0) || !(dKm > 0)) return null
  const dist = unit === 'lb' ? dKm / MI : dKm
  const paceMin = m / dist
  if (!Number.isFinite(paceMin) || paceMin < 1 || paceMin >= 120) return null
  const totalSec = Math.round(paceMin * 60)
  return `${Math.floor(totalSec / 60)}:${String(totalSec % 60).padStart(2, '0')} /${unit === 'lb' ? 'mi' : 'km'}`
}

/** Speed string from km/h ("4.8 km/h" or "3.0 mph"), or null when unavailable. */
export function recoverySpeedText(kmh, unit = 'kg') {
  const v = Number(kmh)
  if (!Number.isFinite(v) || v < 0.1 || v > 120) return null
  return unit === 'lb' ? `${round1(v / MI)} mph` : `${round1(v)} km/h`
}

/** Average speed in km/h from recorded speed or derived from km and minutes. */
export function recoveryAvgSpeedKmh(spec, min) {
  if (spec?.speed?.avg > 0) return spec.speed.avg
  const m = Number(min), dKm = Number(spec?.km)
  if (!(m > 0) || !(dKm > 0)) return null
  const kmh = dKm / (m / 60)
  return Number.isFinite(kmh) && kmh >= 0.1 && kmh <= 120 ? round1(kmh) : null
}

/** Elevation string from meters ("42 m" or "138 ft"), or null. */
export function recoveryElevText(meters, unit = 'kg') {
  const m = Number(meters)
  if (!Number.isFinite(m) || m < 1) return null
  return unit === 'lb' ? `${Math.round(m * FT_PER_M)} ft` : `${Math.round(m)} m`
}

/** Cadence (steps/min) from recorded cadence or derived from steps and minutes. */
export function recoveryCadenceVal(spec, min) {
  if (spec?.cadence >= 20 && spec.cadence <= 260) return spec.cadence
  const m = Number(min), st = Number(spec?.steps)
  if (!(m > 0) || !(st > 0)) return null
  const c = Math.round(st / m)
  return c >= 20 && c <= 260 ? c : null
}

/** Format a split duration in seconds as "m:ss" or "h:mm:ss". */
export function formatLapSec(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`
}

/** Whether a recovery session carries recorded health metrics or source metadata worth displaying. */
export const hasRecoverySpecs = r => !!(r && (
  r.km > 0 || r.steps > 0 || r.hr?.avg > 0 || r.kcal > 0 || r.elev > 0 ||
  r.speed?.avg > 0 || r.cadence > 0 || r.floors > 0 || (Array.isArray(r.laps) && r.laps.length > 0) ||
  r.app || (r.at > 0 && r.src)
))

/** Every recovery session, newest day first, as { id, d, kind, min, note? }. */
export function recoverySessionsOf(S) {
  const map = isMap(S?.recoverySessions) ? S.recoverySessions : {}
  const out = []
  for (const [id, e] of Object.entries(map)) {
    const r = readRecovery(e)
    if (r) out.push({ id, ...r, _ts: Number(e._ts) || 0 })
  }
  return out.sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : b._ts - a._ts))
}

/** The sessions on `iso`. */
export const recoveryOn = (S, iso) => recoverySessionsOf(S).filter(r => r.d === iso)

/** The days that hold one, as a Set of ISO dates. */
export const recoveryDays = S => new Set(recoverySessionsOf(S).map(r => r.d))

/** Whether the week streak counts these days too (off unless asked for). */
export const recoveryCountsStreak = S => S?.recoveryStreak === true

/**
 * S.recoverySessions with `id` set to `session`, stamped `now`. Null (or an unusable session) clears
 * it with a stamped empty entry, so the removal syncs.
 */
export function withRecovery(map, id, session, now = Date.now()) {
  const clean = session ? readRecovery(session) : null
  return { ...(isMap(map) ? map : {}), [id]: clean ? { ...clean, _ts: now } : { _ts: now } }
}

/** "Sauna · 20 min" (no note). */
export function recoveryLine(r, tr = s => s) {
  if (!r) return ''
  return `${tr(RECOVERY_LABEL[r.kind] || RECOVERY_LABEL.other)} · ${tr('{0} min', r.min)}`
}

/** Minutes per kind in the days [from, to], for a week or a month line. */
export function recoveryTotals(S, from, to) {
  const out = {}
  for (const r of recoverySessionsOf(S)) if (r.d >= from && r.d <= to) out[r.kind] = (out[r.kind] || 0) + r.min
  return out
}

function alreadyLoggedRecovery(existing, { d, kind, start, srcId }) {
  for (const r of existing) {
    if (srcId && r.srcId && r.srcId === srcId) return true
    if (r.d === d && r.kind === kind && r.at > 0 && Math.abs(r.at - start) < 60e3) return true
  }
  return false
}

/**
 * One health-store workout record (`{ id, sport, start, end, title?, origin?, clientId? }`) as a
 * selectable recovery candidate for date `d` and recovery `kind` ('walk' or 'stretch'), or null
 * when it does not match: openGym's own, wrong sport/date, under 5 minutes, in the future,
 * overlapping an openGym workout, or already logged as recovery.
 */
export function recoveryFromHealth(rec, S, { d, kind, src = null, now = Date.now() } = {}, existing = null) {
  if (!rec || isOwnRecord(rec)) return null
  if (!HEALTH_RECOVERY_KINDS.has(kind) || !ISO.test(String(d || ''))) return null
  if (String(rec.sport || '') !== kind) return null
  const start = Number(rec.start), end = Number(rec.end)
  if (!(start > 0) || !(end > start) || end > now + 60e3) return null
  if (isoLocal(start) !== d) return null
  const min = Math.round((end - start) / 60e3)
  if (!Number.isFinite(min) || min < 5) return null
  if (overlapsWorkout(S, start, end)) return null
  const srcId = typeof rec.id === 'string' ? rec.id.trim().slice(0, SRC_ID_MAX) : ''
  const logged = existing || recoverySessionsOf(S)
  if (alreadyLoggedRecovery(logged, { d, kind, start, srcId })) return null
  const cleanSrc = HEALTH_SOURCES.includes(src) ? src : ''
  const app = appNameForOrigin(rec.origin, rec.sourceName)
  const title = typeof rec.title === 'string' ? rec.title.trim().slice(0, TITLE_MAX) : ''
  const notes = typeof rec.notes === 'string' ? rec.notes.trim().slice(0, NOTE_MAX) : ''
  const km = Number(rec.km)
  const kcal = Math.round(Number(rec.kcal))
  const steps = Math.round(Number(rec.steps))
  const hr = readRecoveryHr(isMap(rec.hr) ? rec.hr : { avg: rec.hrAvg, min: rec.hrMin, max: rec.hrMax })
  const elev = Math.round(Number(rec.elev))
  const speed = readRecoverySpeed(isMap(rec.speed) ? rec.speed : { avg: rec.speedAvg, max: rec.speedMax })
  const cadence = Math.round(Number(rec.cadence))
  const floors = Number(rec.floors)
  const laps = readRecoveryLaps(rec.laps)
  return {
    id: srcId || `${cleanSrc || 'h'}:${start}:${end}`,
    ...(srcId ? { srcId } : {}),
    ...(cleanSrc ? { src: cleanSrc } : {}),
    ...(app ? { app } : {}),
    d, kind, start, end,
    min: Math.min(RECOVERY_MIN_MAX, min),
    ...(title ? { title } : {}),
    ...(notes ? { notes } : {}),
    ...(Number.isFinite(km) && km > 0 && km < 1000 ? { km: roundKm(km) } : {}),
    ...(Number.isFinite(kcal) && kcal >= 1 && kcal <= 20000 ? { kcal } : {}),
    ...(Number.isFinite(steps) && steps >= 1 && steps <= 500000 ? { steps } : {}),
    ...(hr ? { hr } : {}),
    ...(Number.isFinite(elev) && elev >= 1 && elev <= 20000 ? { elev } : {}),
    ...(speed ? { speed } : {}),
    ...(Number.isFinite(cadence) && cadence >= 20 && cadence <= 260 ? { cadence } : {}),
    ...(Number.isFinite(floors) && floors >= 0.5 && floors <= 2000 ? { floors: round1(floors) } : {}),
    ...(laps ? { laps } : {}),
  }
}

/**
 * Matching health-store sessions for date `d` and recovery `kind` ('walk' | 'stretch'), deduped
 * and sorted newest start first.
 */
export function matchingRecoverySessions(records, S, opts = {}) {
  if (!Array.isArray(records) || !records.length) return []
  if (!HEALTH_RECOVERY_KINDS.has(opts.kind) || !ISO.test(String(opts.d || ''))) return []
  const existing = recoverySessionsOf(S)
  const seenIds = new Set()
  const seenSpans = new Set()
  const out = []
  for (const rec of records) {
    const item = recoveryFromHealth(rec, S, opts, existing)
    if (!item) continue
    const span = `${item.start}|${item.end}`
    if (seenIds.has(item.id) || seenSpans.has(span)) continue
    seenIds.add(item.id)
    seenSpans.add(span)
    out.push(item)
  }
  return out.sort((a, b) => b.start - a.start)
}
