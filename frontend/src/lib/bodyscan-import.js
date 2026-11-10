// A scale's QR code saved into the day's check-in (lib/bodyscan.js reads the code).
//
// The scan rides on the day's body-measurement entry as `scan: { len, v }`: a day's check-in is
// already one entry that syncs and merges by day (lib/sync-merge.js), so the scan needs no list
// of its own. What the app already tracks is filled in as well, each where it lives: the body-fat
// percentage on the same entry, and — when asked — the weight as the day's weigh-in, in the
// profile's unit. A second scan on one day replaces the first, as a second weigh-in does.
import { cleanScan, scanValue } from './bodyscan.js'
import { emptyMeasurement, normalizeMeasurementsState } from './measurements.js'
import { convertBodyWeight } from './units.js'

/** What saving `values` on `date` would change: `{ scan, weightKg, fatPct, hadScan, hadWeight }`. */
export function scanImportPreview(S, values, date) {
  const scan = cleanScan({ v: values })
  return {
    scan,
    weightKg: scanValue(scan, 'weight'),
    fatPct: scanValue(scan, 'fatPct'),
    hadScan: (S.measurements || []).some(e => e?.d === date && e.scan),
    hadWeight: (S.bodyweight || []).find(b => b?.d === date) || null,
  }
}

/**
 * Save the scan into `S` (a draft, mutated) for `date`. `weighIn` also logs the weight as that
 * day's weigh-in. Returns the preview, or null when `values` is not a scan.
 */
export function applyScanImport(S, values, { date, weighIn = true, now = Date.now() } = {}) {
  const p = scanImportPreview(S, values, date)
  if (!p.scan) return null
  normalizeMeasurementsState(S)
  let entry = S.measurements.find(e => e.d === date)
  if (!entry) { entry = emptyMeasurement(date, S.customMeasurements); S.measurements.push(entry) }
  entry.scan = p.scan
  if (p.fatPct != null) entry.bodyFat = Math.round(p.fatPct * 10) / 10
  entry.t = now
  normalizeMeasurementsState(S)
  if (weighIn && p.weightKg != null) {
    if (!Array.isArray(S.bodyweight)) S.bodyweight = []
    const w = convertBodyWeight(p.weightKg, 'kg', S.unit || 'kg')
    const had = S.bodyweight.find(b => b.d === date)
    if (had) { had.w = w; had.t = now } else S.bodyweight.push({ d: date, w, t: now })
    S.bodyweight.sort((a, b) => (a.d < b.d ? -1 : 1))
  }
  return p
}
