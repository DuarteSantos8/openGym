// Health records (S.health): one record per reading, of any metric (lib/health/metrics.js).
//
//   { id, type, v, u, t, d, src, sid?, g?, lo?, hi?, c, _ts }
//
//   id   unique; for an imported reading it is derived from the source and the source's own id
//        (importId), so two devices importing the same reading make the same record, and the
//        sync merge (lib/sync-merge.js) unites them instead of keeping two
//   type the metric; one this version does not know is kept as it is (a newer app's metric)
//   v    the value, in the metric's canonical unit `u` (kg, cm, km, kcal, %, bpm, count, min)
//   t    when it was measured, ms — the source's own time, never the time of the import
//   d    the local day it belongs to (YYYY-MM-DD): the day of `t`, or for a day's total (steps,
//        sleep) the day the source summed it for
//   src  where it came from: 'manual', 'apple-health', or a future source's id (providers.js)
//   sid  the source's own id for it: a HealthKit sample's UUID, or `<type>:<day>` for a day's
//        total, which a source recomputes as the day goes on
//   g    a body composition measurement: the records of one reading of a scale share it, so the
//        form opens, edits and deletes them together
//   lo/hi a day's lowest and highest reading, next to its mean (heart rate)
//   a/kc/km a workout's activity (api/health/catalogue.js WORKOUTS), energy (kcal), distance (km)
//   c    created, ms; `_ts` last edited, ms — the stamp the sync merge holds two copies by
//
// Why separate records and not one BodyComposition object: every metric is then the same shape
// whatever its source (a smart scale's twelve values, HealthKit's single body-fat sample, a
// day's steps), a new metric is one line in metrics.js and not a schema change, and a reading is
// deduplicated, merged, deleted and charted one at a time. The body composition form puts the
// object back together from `g`.
//
// The records belong to the profile's own state, which only ever syncs to the user's own server
// (pushState); the account's id is the document's, so a record carries none of its own.
import { HEALTH_METRICS, metricOf } from './metrics.js'
import { EXTRA_FIELDS, trimImported } from '../../../../api/health/catalogue.js'
import { isoOf, uid, weekKey } from '../format.js'

export const MANUAL = 'manual'
const list = v => (Array.isArray(v) ? v : [])
const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v)
const ISO = /^\d{4}-\d{2}-\d{2}$/

/** A record's id for a reading of source `src` with the source's id `sid`. */
export const importId = (src, sid) => `${src}:${sid}`
const dayOf = ms => isoOf(new Date(ms))

/**
 * A record from what a form or a source handed over, or null when it is not a reading at all.
 * Values outside what the metric allows are refused rather than clamped: a scale that reports a
 * body fat of 0 % has not measured anything.
 */
export function makeRecord({ type, v, t, d, src = MANUAL, sid, g, id, ...more }, now = Date.now()) {
  const m = metricOf(type)
  const value = Number(v)
  const at = Number(t)
  if (!m || !Number.isFinite(value) || !Number.isFinite(at)) return null
  if (value < m.min || value > m.max) return null
  const r = {
    id: id || (sid != null ? importId(src, sid) : uid()),
    type, v: value, u: m.unit, t: at,
    d: typeof d === 'string' && ISO.test(d) ? d : dayOf(at),
    src: String(src || MANUAL),
  }
  if (sid != null) r.sid = String(sid)
  if (g) r.g = String(g)
  for (const k of EXTRA_FIELDS) {
    const x = more[k]
    if (x == null || x === '') continue
    if (k === 'a') r.a = String(x)
    else if (Number.isFinite(Number(x))) r[k] = Number(x)
  }
  r.c = now
  r._ts = now
  return r
}

// A stored record is kept when it is shaped like one; its type need not be known.
const wellFormed = r => isMap(r) && r.id != null && typeof r.type === 'string' && Number.isFinite(Number(r.v)) &&
  Number.isFinite(Number(r.t)) && typeof r.d === 'string' && ISO.test(r.d)

const byTime = (a, b) => (a.t - b.t) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
const newer = (a, b) => (Number(b._ts) || 0) > (Number(a._ts) || 0) ? b : a

/**
 * S.health brought into shape, for every path a state takes in (a load, a pull, a backup): a
 * list, nothing malformed, one record per id and one per source reading (the later-edited one),
 * in time order. An older profile without the field gets an empty list. Mutates and returns S.
 */
export function normalizeHealthState(S) {
  if (!S || typeof S !== 'object') return S
  const byId = new Map()
  for (const r of list(S.health)) {
    if (!wellFormed(r)) continue
    const cur = byId.get(r.id)
    byId.set(r.id, cur ? newer(cur, r) : r)
  }
  const bySource = new Map()
  const out = []
  for (const r of byId.values()) {
    if (r.sid == null || r.src === MANUAL) { out.push(r); continue }
    const key = `${r.src}|${r.type}|${r.sid}`
    const cur = bySource.get(key)
    bySource.set(key, cur ? newer(cur, r) : r)
  }
  out.push(...bySource.values())
  // Within what a profile can hold (catalogue.js MAX_IMPORTED), the same way on every copy.
  S.health = trimImported(out.sort(byTime))
  return S
}

const sameReading = (a, b) => a.v === b.v && a.t === b.t && a.d === b.d && EXTRA_FIELDS.every(k => (a[k] ?? null) === (b[k] ?? null))
const extrasOf = r => Object.fromEntries(EXTRA_FIELDS.filter(k => r[k] != null).map(k => [k, r[k]]))

/**
 * Readings from a source folded into the records. A reading the records already hold (same
 * source, same source id) is updated only when it changed — a day's steps as the day goes on —
 * and keeps its id and creation time; a new one is added. A record the user deleted (`deleted`,
 * the ids S.deleted.health has on record as removed) is not brought back by the next sync; a
 * reconnect passes `ignoreDeleted`, as asking for everything again is the user's own choice.
 * Manual records are never touched. Returns { health, added, updated }; the input is not mutated.
 */
export function importRecords(health, incoming, { now = Date.now(), deleted = null, ignoreDeleted = false } = {}) {
  const out = list(health).slice()
  const at = new Map()
  out.forEach((r, i) => { if (r?.sid != null && r.src !== MANUAL) at.set(`${r.src}|${r.type}|${r.sid}`, i) })
  const gone = !ignoreDeleted && isMap(deleted) ? deleted : {}
  let added = 0, updated = 0
  for (const raw of list(incoming)) {
    if (!raw || raw.src === MANUAL || raw.sid == null) continue
    const rec = makeRecord(raw, now)
    if (!rec) continue
    const key = `${rec.src}|${rec.type}|${rec.sid}`
    const i = at.get(key)
    if (i != null) {
      const cur = out[i]
      if (sameReading(cur, rec)) continue
      out[i] = { ...cur, v: rec.v, t: rec.t, d: rec.d, ...extrasOf(rec), _ts: now }
      updated++
      continue
    }
    if (Number(gone[rec.id]) > 0) continue
    at.set(key, out.length)
    out.push(rec)
    added++
  }
  return { health: trimImported(out.sort(byTime)), added, updated }
}

/** The records without those of `src` — what "remove imported data" takes out. */
export const withoutSource = (health, src) => list(health).filter(r => r?.src !== src)
export const countSource = (health, src) => list(health).filter(r => r?.src === src).length

// ---- Body composition measurements (the "+" form) -------------------------------------------

/**
 * The body composition measurements: the records sharing a `g`, put back together, newest first.
 * [{ g, t, d, src, values: { type: v }, ids: [id] }]
 */
export function compositionMeasurements(health) {
  const byG = new Map()
  for (const r of list(health)) {
    if (!r?.g) continue
    let m = byG.get(r.g)
    if (!m) byG.set(r.g, m = { g: r.g, t: r.t, d: r.d, src: r.src, values: {}, ids: [] })
    m.values[r.type] = r.v
    m.ids.push(r.id)
  }
  return [...byG.values()].sort((a, b) => b.t - a.t)
}

/**
 * Saves a body composition measurement: `values` by type in canonical units, empty ones left out,
 * taken at `t`. With `g` it replaces that measurement (an edit keeps its group, and each record
 * that stays keeps its id and creation time). Returns the new S.health; the input is not mutated.
 * Throws 'empty' when no value is left and 'range' (with `.type`) for one out of range.
 */
export function saveComposition(health, { g = null, t, values }, now = Date.now()) {
  const group = g || uid()
  const old = new Map(list(health).filter(r => r?.g === group).map(r => [r.type, r]))
  const recs = []
  for (const [type, raw] of Object.entries(values || {})) {
    if (raw == null || raw === '' || !HEALTH_METRICS[type]?.bia) continue
    const prev = old.get(type)
    const rec = makeRecord({ type, v: raw, t, g: group, id: prev?.id }, now)
    if (!rec) { const e = new Error('range'); e.type = type; throw e }
    if (prev) {
      rec.c = prev.c ?? now
      // Unchanged: keeps its own edit stamp, so a merge does not take it for a new edit.
      if (prev.v === rec.v && prev.t === rec.t) rec._ts = prev._ts ?? now
    }
    recs.push(rec)
  }
  if (!recs.length) throw new Error('empty')
  return [...list(health).filter(r => r?.g !== group), ...recs].sort(byTime)
}

export const deleteComposition = (health, g) => list(health).filter(r => r?.g !== g)

// ---- Weight and the weigh-in log -------------------------------------------------------------

const LB_PER_KG = 2.2046226218
const kgOf = (w, unit) => (unit === 'lb' ? Number(w) / LB_PER_KG : Number(w))
const inUnit = (kg, unit) => Math.round((unit === 'lb' ? kg * LB_PER_KG : kg) * 10) / 10

/**
 * The weigh-in log after weight readings came in, from a scale form or a source. The log keeps
 * one weigh-in per day (S.bodyweight, in the profile's unit), the one the rest of the app reads,
 * so a reading becomes that day's weigh-in like this:
 *   - from the form (`manual`): it is the day's weigh-in, as logging one in the weigh-in sheet is
 *   - from a source: the latest reading of a day fills a day that has none, or replaces one that
 *     came from the same source; a weigh-in the user typed is never overwritten by an import
 * A weigh-in from a source carries `src`, so it can be told apart and taken out with the source's
 * data. Returns { bodyweight, changed }; the input is not mutated.
 */
export function bridgeWeights(bodyweight, readings, unit = 'kg', now = Date.now()) {
  const out = list(bodyweight).map(b => b)
  const latest = new Map()
  for (const r of list(readings)) {
    if (r?.type !== 'weight' || !Number.isFinite(Number(r.v))) continue
    const cur = latest.get(r.d)
    if (!cur || r.t >= cur.t) latest.set(r.d, r)
  }
  let changed = false
  for (const [d, r] of latest) {
    const w = inUnit(Number(r.v), unit)
    const i = out.findIndex(b => b?.d === d)
    const manual = !r.src || r.src === MANUAL
    if (i < 0) {
      out.push(manual ? { d, w, t: now } : { d, w, t: now, src: r.src })
      changed = true
    } else if (manual || out[i].src === r.src) {
      if (out[i].w === w && (manual ? !out[i].src : true)) continue
      const next = { ...out[i], w, t: now }
      if (manual) delete next.src
      out[i] = next
      changed = true
    }
  }
  if (changed) out.sort((a, b) => (a.d < b.d ? -1 : 1))
  return { bodyweight: out, changed }
}

/** The weigh-ins without those a source wrote (bridgeWeights). */
export const weighInsWithoutSource = (bodyweight, src) => list(bodyweight).filter(b => b?.src !== src)

// ---- Reading the records back ----------------------------------------------------------------

/**
 * One value per day for `type`, oldest first: [{ d, t, v, lo?, hi?, n }]. Weight comes from the
 * weigh-in log (in kg), which holds one per day and is the weight the rest of the app shows; the
 * other metrics from the records, folded by the metric's `daily` rule. BMI with no reading of
 * its own is worked out from weight and the latest height (`derived: true`).
 */
export function dailyValues(S, type) {
  const m = metricOf(type)
  if (!m) return []
  if (type === 'weight') {
    return list(S?.bodyweight)
      .filter(b => b && ISO.test(b.d || '') && Number(b.w) > 0)
      .map(b => ({ d: b.d, t: new Date(b.d + 'T12:00:00').getTime(), v: Math.round(kgOf(b.w, S.unit) * 100) / 100, n: 1, src: b.src || MANUAL }))
      .sort((a, b) => (a.d < b.d ? -1 : 1))
  }
  const byDay = new Map()
  for (const r of list(S?.health)) {
    if (r?.type !== type) continue
    let day = byDay.get(r.d)
    if (!day) byDay.set(r.d, day = [])
    day.push(r)
  }
  const out = []
  for (const [d, rs] of byDay) {
    rs.sort(byTime)
    const last = rs[rs.length - 1]
    let v
    if (m.daily === 'sum') {
      // One total per source and day (a day's total is one record); two sources for the same
      // day are not added together — the larger one is taken, the other being a partial copy.
      const bySrc = new Map()
      for (const r of rs) bySrc.set(r.src, (bySrc.get(r.src) || 0) + Number(r.v))
      v = Math.max(...bySrc.values())
    } else if (m.daily === 'mean') v = rs.reduce((s, r) => s + Number(r.v), 0) / rs.length
    else if (m.daily === 'max') v = Math.max(...rs.map(r => Number(r.v)))
    else v = Number(last.v)
    const lo = rs.some(r => r.lo != null) ? Math.min(...rs.map(r => r.lo ?? r.v)) : undefined
    const hi = rs.some(r => r.hi != null) ? Math.max(...rs.map(r => r.hi ?? r.v)) : undefined
    out.push({ d, t: last.t, v, n: rs.length, src: last.src, ...(lo != null ? { lo } : {}), ...(hi != null ? { hi } : {}) })
  }
  out.sort((a, b) => (a.d < b.d ? -1 : 1))
  if (type === 'bmi' && !out.length) return derivedBmi(S)
  return out
}

/** BMI from the weigh-ins and the latest height (cm): kg / m². Empty without a height. */
export function derivedBmi(S) {
  const h = latestRecord(S, 'height')
  if (!h || !(h.v > 0)) return []
  const m2 = (h.v / 100) ** 2
  return dailyValues(S, 'weight').map(w => ({ d: w.d, t: w.t, v: Math.round(w.v / m2 * 10) / 10, n: 1, derived: true }))
}

function latestRecord(S, type) {
  let best = null
  for (const r of list(S?.health)) if (r?.type === type && (!best || r.t > best.t)) best = r
  return best
}

/**
 * The latest day's value of `type` and the change from the day before it that has one:
 * { v, d, t, prev, delta, derived } or null with no data.
 */
export function latestOf(S, type) {
  const days = dailyValues(S, type)
  if (!days.length) return null
  const last = days[days.length - 1], prev = days.length > 1 ? days[days.length - 2] : null
  return { v: last.v, d: last.d, t: last.t, lo: last.lo, hi: last.hi, src: last.src, derived: !!last.derived,
    prev: prev ? prev.v : null, prevD: prev ? prev.d : null, delta: prev ? last.v - prev.v : null }
}

/** Whether the profile has any value of `type`. */
export const hasData = (S, type) => dailyValues(S, type).length > 0

// The chart ranges: days covered, and the bucket a point stands for.
export const RANGES = {
  week: { days: 7, bucket: 'day' },
  month: { days: 30, bucket: 'day' },
  year: { days: 365, bucket: 'week' },
  all: { days: 0, bucket: 'month' },
}

/**
 * The chart's points for `type` over `range` (RANGES): one per day, or per week or month — the
 * mean of the days in it that have a value, so a week of steps reads as steps per day and a
 * month of weigh-ins as that month's weight. [{ t, d, v, n }] oldest first, values canonical.
 */
export function seriesOf(S, type, range = 'month', { now = Date.now(), ws = 1 } = {}) {
  const r = RANGES[range] || RANGES.month
  const from = r.days ? isoOf(new Date(now - (r.days - 1) * 86400000)) : ''
  const days = dailyValues(S, type).filter(x => x.d >= from)
  if (r.bucket === 'day') return days.map(x => ({ t: x.t, d: x.d, v: x.v, n: 1 }))
  const key = x => (r.bucket === 'week' ? weekKey(x.d, ws) : x.d.slice(0, 7) + '-01')
  const buckets = new Map()
  for (const x of days) {
    const k = key(x)
    if (!buckets.has(k)) buckets.set(k, [])
    buckets.get(k).push(x)
  }
  return [...buckets.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, xs]) => ({
    d: k, t: new Date(k + 'T12:00:00').getTime(), v: xs.reduce((s, x) => s + x.v, 0) / xs.length, n: xs.length,
  }))
}

/** Every record of `type`, newest first, for a metric's history list (weight: the weigh-ins). */
export function historyOf(S, type) {
  if (type === 'weight') return dailyValues(S, 'weight').reverse().map(x => ({ id: 'bw:' + x.d, type, v: x.v, t: x.t, d: x.d, src: x.src, weighIn: true }))
  return list(S?.health).filter(r => r?.type === type).slice().sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : b.t - a.t))
}
