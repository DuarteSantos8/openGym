// Weigh-ins read back from Health Connect on the Android app (#544): a smart scale, or any other
// app that writes the weight there, shows up in the body-weight log. Worked out from the state and
// the records alone; lib/health-sync.js reads the records through the native plugin and keeps
// what it has seen in the phone's own file.
//
// A weigh-in that came from there carries `src: 'hc'` and `at`, the time it was measured (`t`
// is restamped when it lands in the log, lib/sync-merge.js stampChange). It is not written back
// to Health Connect (lib/health-connect.js), and a correction typed in openGym drops both fields.
import { isoOf } from './format.js'
import { LB_PER_KG } from './health-connect.js'

const DAY = 86400000
// How far back each read goes from the last one: a scale's app often hands its readings to
// Health Connect hours or days after they were taken.
export const WINDOW = 14 * DAY

/** Where the next read starts: from the beginning the first time, then a window before the last. */
export function readSince(lastAt) {
  const at = Number(lastAt)
  return at > 0 ? Math.max(0, at - WINDOW) : 0
}

/**
 * What a read brings into the log. `records` are Health Connect's weights ({ id, time, kg }, the
 * ones openGym wrote already left out), `seen` the ids taken into account before ({ [id]: time }).
 * Per day the latest measurement is the one that counts, and it takes the day over only when it
 * is newer than the weigh-in the log has (a typed one is as new as when it was typed), and when
 * the day was not deleted after it was measured. Returns { add: [{ d, w, t, src, at }], seen },
 * `seen` keeping only what the next read can still return.
 */
export function planWeightImport(S, records, seen = {}, now = Date.now()) {
  const unit = S?.unit === 'lb' ? 'lb' : 'kg'
  const have = new Map((Array.isArray(S?.bodyweight) ? S.bodyweight : []).filter(b => b?.d).map(b => [b.d, b]))
  const deleted = S?.deleted?.bodyweight && typeof S.deleted.bodyweight === 'object' ? S.deleted.bodyweight : {}
  const nextSeen = {}
  const keep = (id, time) => { if (time >= now - WINDOW) nextSeen[id] = time }
  for (const [id, time] of Object.entries(seen || {})) keep(id, Number(time) || 0)

  const days = new Map()
  for (const r of Array.isArray(records) ? records : []) {
    const time = Number(r?.time), kg = Number(r?.kg)
    if (!r?.id || seen?.[r.id] != null || !(time > 0)) continue
    keep(r.id, time)
    if (!(kg > 0)) continue
    const d = isoOf(new Date(time))
    if (!(days.get(d)?.time >= time)) days.set(d, { time, kg })
  }

  const add = []
  for (const [d, { time, kg }] of days) {
    if ((Number(deleted[d]) || 0) >= time) continue
    const ex = have.get(d)
    if (ex && (Number(ex.at ?? ex.t) || 0) >= time) continue
    const w = Math.round((unit === 'lb' ? kg * LB_PER_KG : kg) * 10) / 10
    if (!(w > 0)) continue
    add.push({ d, w, t: time, src: 'hc', at: time })
  }
  add.sort((a, b) => (a.d < b.d ? -1 : 1))
  return { add, seen: nextSeen }
}

/** Puts the weigh-ins planWeightImport found into the log: each one takes its day. Mutates `s`. */
export function mergeHealthWeights(s, add) {
  if (!Array.isArray(add) || !add.length) return false
  if (!Array.isArray(s.bodyweight)) s.bodyweight = []
  for (const b of add) {
    const i = s.bodyweight.findIndex(x => x?.d === b.d)
    if (i >= 0) s.bodyweight[i] = { ...b }
    else s.bodyweight.push({ ...b })
  }
  s.bodyweight.sort((a, b) => (a.d < b.d ? -1 : 1))
  return true
}
