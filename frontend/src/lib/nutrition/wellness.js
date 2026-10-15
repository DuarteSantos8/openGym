// Progress › Recovery: what a wearable reports, from NutriTrace's wellness data (server/routes/
// fitbit.js and garmin.js GET /data, shown by src/routes/Wellness.svelte: Activity B28, Sleep B29,
// Heart B30). Pure. The answer of each source is { 'YYYY-MM-DD': { metric_type: value } }; the
// Fitbit one also carries Google Health and Health Connect rows (the server merges them).
import { t } from '../i18n.js'
import { daysBetween, summaryOf } from './trends.js'

const DAY = 86400000

/** How far back the page can look: the longest range on the control is a year. */
export const FETCH_DAYS = 365

/** What the page can chart, by NutriTrace's metric_type. `scale` turns the stored value into the
 *  shown one (sleep is stored in minutes). The labels are read at call time so they follow the
 *  language. */
export const recoveryMetrics = () => [
  { value: 'sleep_duration_min', label: t('Sleep'), unit: t('h'), scale: 1 / 60 },
  { value: 'sleep_score', label: t('Sleep score'), unit: '', scale: 1 },
  { value: 'readiness_score', label: t('Readiness'), unit: '', scale: 1 },
  { value: 'resting_hr', label: t('Resting heart rate'), unit: t('bpm'), scale: 1 },
  { value: 'hrv_daily_rmssd', label: t('HRV'), unit: t('ms'), scale: 1 },
  { value: 'spo2_avg', label: t('Blood oxygen'), unit: '%', scale: 1 },
  { value: 'steps', label: t('Steps'), unit: '', scale: 1 },
  { value: 'active_minutes', label: t('Active minutes'), unit: t('min'), scale: 1 },
]

/** A metric from the address, or null when it is not one of ours. */
export const recoveryMetricFrom = value => recoveryMetrics().find(m => m.value === value)?.value ?? null

const MAX_SOURCE_ROWS = FETCH_DAYS + 2

// Seeded actual values from the wearable's own app win over the ones NutriTrace calculated, as
// Wellness.svelte reads them (the *_actual keys).
const ACTUAL = { sleep_score: 'sleep_score_actual', readiness_score: 'readiness_score_actual', sleep_duration_min: 'sleep_duration_min_actual' }
const KEPT = [...recoveryMetrics().map(m => m.value), ...Object.values(ACTUAL)]

/** Both sources in one map. Garmin wins a metric both report for a day, as Statistics reads them
 *  (garmin, then Fitbit); an `_actual` value then wins over the calculated one. Anything that is
 *  not a number is dropped. */
export function mergeSources(fitbit, garmin) {
  const out = {}
  for (const source of [fitbit, garmin]) {
    if (!source || typeof source !== 'object') continue
    for (const [date, row] of Object.entries(source).slice(0, MAX_SOURCE_ROWS)) {
      if (!row || typeof row !== 'object') continue
      for (const key of KEPT) {
        const v = Number(row[key])
        if (row[key] != null && Number.isFinite(v)) (out[date] ??= {})[key] = v
      }
    }
  }
  for (const row of Object.values(out)) {
    for (const [metric, actual] of Object.entries(ACTUAL)) {
      if (row[actual] != null) row[metric] = row[actual]
      delete row[actual]
    }
  }
  return out
}

const dayKey = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')

/** The days a range covers, ending today (0 = everything that was fetched). */
export function recoveryWindow(range, today) {
  const days = range > 0 ? Math.min(range, FETCH_DAYS) : FETCH_DAYS
  const from = dayKey(new Date(new Date(today + 'T12:00:00').getTime() - (days - 1) * DAY))
  return { from, to: today }
}

// Counted up through the day, so the day in progress reads as a dip: NutriTrace's Statistics leaves
// today out of these two (Statistics.svelte isCumulative) and keeps it for the point-in-time ones.
const CUMULATIVE = new Set(['steps', 'active_minutes'])

/** The per-day series of one metric over a window, in shown units: [{ date, value|null }]. */
export function recoverySeries(byDate, metric, window) {
  const def = recoveryMetrics().find(m => m.value === metric)
  if (!def || !window) return []
  const to = CUMULATIVE.has(metric) ? dayKey(new Date(new Date(window.to + 'T12:00:00').getTime() - DAY)) : window.to
  return daysBetween(window.from, to).map(date => {
    const raw = byDate[date]?.[metric]
    return { date, value: raw == null ? null : Math.round(raw * def.scale * 10) / 10 }
  })
}

const HEADLINE_ORDER = ['sleep_duration_min', 'resting_hr', 'readiness_score', 'hrv_daily_rmssd', 'steps', 'active_minutes']

/** Up to `n` metrics with data in the window, the ones that say most about recovery first, each
 *  with its average: [{ value, label, unit, avg }]. For the hub's card. */
export function headlines(byDate, window, n = 2) {
  const defs = recoveryMetrics()
  const out = []
  for (const id of HEADLINE_ORDER) {
    const s = summaryOf(recoverySeries(byDate, id, window))
    const def = defs.find(m => m.value === id)
    if (s && def) out.push({ value: id, label: def.label, unit: def.unit, avg: s.avg })
    if (out.length === n) break
  }
  return out
}

/** The metrics that have a value anywhere in what was fetched. */
export function presentMetrics(byDate) {
  const seen = new Set()
  for (const row of Object.values(byDate)) for (const k of Object.keys(row)) seen.add(k)
  return recoveryMetrics().filter(m => seen.has(m.value))
}
