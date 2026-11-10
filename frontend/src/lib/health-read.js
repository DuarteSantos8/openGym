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
