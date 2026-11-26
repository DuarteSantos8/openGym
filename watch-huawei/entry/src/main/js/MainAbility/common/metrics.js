// The numbers behind the one Metrics page (the Garmin's: time, sets, volume, heart rate), as plain data over the
// core's state `c`. Pure and ES5 subset: no Huawei API, nothing here changes the state.
//
//   numbers(c)   -> null (no workout) | { elapsed, paused, sets: [done, all], volume, unit, hr }
//                   elapsed seconds (null without a start; stands still at `pausedAt` while the phone has the workout
//                   paused), hr { now, avg, max } or null (none, or the phone's show.hr is off)

import { workoutTotals, progress, hrSoFar, elapsed } from './core.js'

const isNum = v => typeof v === 'number' && isFinite(v)
const dictOf = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null)
const isOff = v => v === false || v === 0
const strOf = v => (typeof v === 'string' ? v : v == null ? '' : String(v))

export function numbers (c) {
  const s = c.s
  const w = dictOf(s.w)
  if (!w) return null
  const paused = isNum(w.pausedAt) && w.pausedAt > 0
  const show = dictOf(dictOf(s.set) ? s.set.show : null)
  const so = hrSoFar(c)
  return {
    elapsed: elapsed(c, w),
    paused: paused,
    sets: progress(s),
    volume: Math.round(workoutTotals(w)[1]),
    unit: strOf(w.unit),
    hr: !(show && isOff(show.hr)) && so ? { now: isNum(c.g.bpm) ? c.g.bpm : null, avg: so[0], max: so[1] } : null
  }
}
