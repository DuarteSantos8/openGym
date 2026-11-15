// What openGym takes back from the phone's health hub (#544, #127): Health Connect on Android,
// Apple Health on the iPhone. Two things, each behind its own switch in Settings:
//
//   - the heart rate during a finished workout, per set and for the session (lib/heart-rate.js
//     works out which samples belong to which set), for every watch that saves to the hub;
//   - weigh-ins other apps saved there (a smart scale's, Garmin's, Withings', Samsung's...).
//
// Pure: lib/health-sync.js reads the hub and hands the records over; this decides what goes into
// the log. The rules:
//   - a set that already has a heart rate keeps it (the Apple Watch measured it live);
//   - a weigh-in read in joins the day's others with its own time (lib/weigh-ins.js), never
//     replacing one typed into openGym; the daily-value setting picks the day's number;
//   - openGym's own records in the hub (what it wrote there itself) are never read back as new;
//   - an imported weigh-in carries `src` and is never written back to the hub (no ping-pong:
//     lib/health-connect.js healthRecords leaves it out).
import { hrFromSamples, sanitizeHr } from './heart-rate.js'
import { stampWorkout } from './sync-merge.js'
import { isoOf } from './format.js'
import { addWeighIn, readingsOf, timeOf, hashId } from './weigh-ins.js'

export const LB_PER_KG = 2.2046226218
// Weigh-ins outside this are a typo or another person's profile in the hub, not a body weight.
const KG_MIN = 20
const KG_MAX = 400
// Packages and bundle ids that are openGym: the app, its test build, the Apple Watch app.
const OWN = /^ch\.duartesantos\.opengym(\.|$)/

/** Whether a record in the hub is one openGym wrote itself (by its client id or by its origin). */
export function isOwnRecord(rec) {
  if (!rec || typeof rec !== 'object') return false
  if (/^opengym-/.test(String(rec.clientId || ''))) return true
  return OWN.test(String(rec.origin || ''))
}

/**
 * The heart rate read for workout `wid` (`samples`: [ms, bpm] from the hub) put into the log `S`
 * (mutated). Only sets without a reading get one; the session's reading is set when the workout
 * has none, or replaced by a fuller one from the same hub (Garmin and Fitbit sync late, so a
 * read right after the workout can hold only part of it). One the watch took is never replaced.
 * The workout is stamped as edited, so a sync keeps the change. Returns whether anything changed.
 */
export function mergeHeartRate(S, wid, samples, src, now = Date.now()) {
  const w = (S?.workouts || []).find(x => x && x.id === wid)
  if (!w) return false
  const res = hrFromSamples(w, samples)
  let changed = false
  for (const [key, got] of res.sets) {
    const [ei, si] = key.split(':').map(Number)
    const set = w.entries?.[ei]?.sets?.[si]
    if (!set) continue
    if (got.hr && !sanitizeHr(set.hr)) { set.hr = got.hr; changed = true }
    if (got.restHr && !sanitizeHr(set.restHr)) { set.restHr = got.restHr; changed = true }
  }
  if (res.session) {
    const cur = w.hr && typeof w.hr === 'object' ? w.hr : null
    const fuller = !cur || (cur.src === src && res.n > (Number(cur.n) || 0))
    if (fuller && cur?.src !== 'watch') {
      w.hr = { ...res.session, src, n: res.n }
      changed = true
    }
  }
  if (changed) stampWorkout(w, now)
  return changed
}

/** Whether a workout still has sets the hub could fill: one done and without a heart rate. */
export function lacksHeartRate(w) {
  if (!w || typeof w !== 'object') return false
  if (!w.hr) return true
  return (w.entries || []).some(e => (e?.sets || []).some(s => s && (s.done === true || s.sides) && !sanitizeHr(s.hr)))
}

/** The id a hub sample gets among a day's weigh-ins: the same on every phone that reads it. */
export function hubReadingId(r) {
  return 'h' + hashId(String(r?.id || r?.t || ''))
}

/**
 * Weigh-ins from the hub (`records`: [{ t, kg, id, origin, clientId }]) put into the log `S`
 * (mutated), each with its time (#859): a scale that weighs you morning and evening gives the day
 * two readings, and the profile's daily value (lib/weigh-ins.js) picks the one the charts use.
 * `seen` is this phone's memo of what it imported ({ [reading id]: { id, t } }), updated in place,
 * which makes a second read of the same records a no-op. A sample is left out when the day already
 * has it (by the hub's id) or another weigh-in at the same minute (typed in, or read by another
 * phone), when it was removed in openGym, or when its whole day was deleted in openGym after it
 * was taken. Weights go in in the profile's unit. Returns the days changed.
 */
export function mergeWeighIns(S, records, { src, seen = {} } = {}) {
  const unit = S?.unit === 'lb' ? 'lb' : 'kg'
  const fresh = []
  for (const r of Array.isArray(records) ? records : []) {
    if (!r || isOwnRecord(r)) continue
    const t = Number(r.t), kg = Number(r.kg)
    if (!(t > 0) || !(kg >= KG_MIN && kg <= KG_MAX)) continue
    fresh.push({ t, kg, id: r.id || null })
  }
  if (!fresh.length) return []
  fresh.sort((a, b) => a.t - b.t)
  if (!Array.isArray(S.bodyweight)) S.bodyweight = []
  const deleted = S.deleted?.bodyweight && typeof S.deleted.bodyweight === 'object' ? S.deleted.bodyweight : {}
  const days = new Set()
  for (const r of fresh) {
    const rid = hubReadingId(r)
    if (seen[rid]) continue
    const d = isoOf(new Date(r.t)), at = timeOf(r.t)
    const day = S.bodyweight.find(b => b && b.d === d)
    if (!day && Number(deleted[d]) > r.t) continue        // the day was removed in openGym after it was taken
    if (day) {
      const rs = readingsOf(day)
      const removed = Number(day.gone?.[rid]) > 0
      if (removed || rs.some(x => x.id === rid || (x.at && x.at === at))) { seen[rid] = { id: r.id, t: r.t }; continue }
    }
    const w = Math.round((unit === 'lb' ? r.kg * LB_PER_KG : r.kg) * 10) / 10
    addWeighIn(S, { d, at, w, t: r.t, id: rid, src, sid: r.id })
    seen[rid] = { id: r.id, t: r.t }
    days.add(d)
  }
  return [...days].sort()
}

/* ---------- body composition (body fat, lean mass, bone mass, body water, BMR) ---------- */
//
// What a smart scale saves to the hub besides the weight (idea by @baron-de-ropp (#197) and
// @TheBlackSide243 (#589), body water from @elmillgoa (#1014)). Health Connect has all five, Apple
// Health body fat and lean mass. It
// is shown under Body measurements as the hub has it, read-only: kept in this phone's health file
// (lib/health-sync.js), not in the log, so it never syncs, never rides in a backup and never
// competes with a measurement you typed in. The hub stays the place it lives.

export const BODY_KINDS = ['fat', 'lean', 'bone', 'water', 'bmr']
// Plausible bounds per kind: anything outside is another person's profile or a scale's hiccup.
const BODY_RANGE = { fat: [2, 75], lean: [15, 200], bone: [0.3, 10], water: [10, 120], bmr: [500, 5000] }
// Readings kept per kind: a weigh-in a day for well over half a year.
export const BODY_KEEP = 240

/**
 * Body-composition records from the hub (`records`: [{ kind, t, v, id, origin, clientId }], fat in
 * percent, masses in kg, BMR in kcal a day) merged into `store` ({ fat: [{ t, v, id }], ... }),
 * returning the new store, or null when nothing new came in. One reading per id (and per time, a
 * second scale app copying the first), newest last, the oldest let go past BODY_KEEP.
 */
export function mergeBodyComp(store, records) {
  const out = {}
  let changed = false
  for (const k of BODY_KINDS) out[k] = Array.isArray(store?.[k]) ? [...store[k]] : []
  for (const r of Array.isArray(records) ? records : []) {
    if (!r || isOwnRecord(r) || !BODY_RANGE[r.kind]) continue
    const t = Number(r.t), v = Number(r.v)
    const [lo, hi] = BODY_RANGE[r.kind]
    if (!(t > 0) || !(v >= lo && v <= hi)) continue
    const list = out[r.kind]
    const id = String(r.id || '')
    if (list.some(x => (id && x.id === id) || x.t === t)) continue
    list.push({ t, v: Math.round(v * 100) / 100, ...(id ? { id } : {}) })
    changed = true
  }
  if (!changed) return null
  for (const k of BODY_KINDS) out[k] = out[k].sort((a, b) => a.t - b.t).slice(-BODY_KEEP)
  return out
}

/**
 * What the Body measurements screen shows of it: per kind with any reading, the latest one and the
 * change since the reading closest to 30 days before it (null without one at least a week older).
 */
export function bodyCompSummary(store) {
  const out = []
  for (const kind of BODY_KINDS) {
    const list = Array.isArray(store?.[kind]) ? store[kind] : []
    const latest = list.at(-1)
    if (!latest) continue
    const want = latest.t - 30 * 24 * 3600e3
    const older = list.filter(x => x.t <= latest.t - 7 * 24 * 3600e3)
    const base = older.reduce((best, x) => (!best || Math.abs(x.t - want) < Math.abs(best.t - want) ? x : best), null)
    out.push({ kind, t: latest.t, v: latest.v, change: base ? Math.round((latest.v - base.v) * 10) / 10 : null })
  }
  return out
}
