// Rest by heart rate (Settings, Apple Watch): the timed rest stays the limit, and on top of it the
// app says "ready" once the heart rate the watch streams has come back down. Advice only: nothing
// here ends a rest. The phone decides and tells the watch, so the rule lives in one place.

export const HR_HOLD_SEC = 5
export const HR_READY_DEFAULT = { on: false, bpm: 110, floorSec: 45 }
const STALE_MS = 10000
const NOT_READY = { ready: false, since: null }

/**
 * { ready, since } for the rest that started at `restStartedAt`: past `floorSec`, the latest
 * reading at most 10 s old, and the readings at or under `targetBpm` without a break for at least
 * `holdSec` (one dip under the target is not a recovery). `since` is the oldest reading of that run.
 */
export function readiness({ samples, restStartedAt, now, targetBpm = HR_READY_DEFAULT.bpm, floorSec = HR_READY_DEFAULT.floorSec, holdSec = HR_HOLD_SEC } = {}) {
  if (!(now - restStartedAt >= floorSec * 1000)) return NOT_READY
  const list = (Array.isArray(samples) ? samples : [])
    .filter(s => Number.isFinite(s?.t) && Number.isFinite(s?.bpm) && s.t >= restStartedAt && s.t <= now)
    .sort((a, b) => a.t - b.t)
  if (!list.length || now - list[list.length - 1].t > STALE_MS) return NOT_READY
  if (list[list.length - 1].bpm > targetBpm) return NOT_READY
  let i = list.length - 1
  while (i > 0 && list[i - 1].bpm <= targetBpm) i--
  if (now - list[i].t < holdSec * 1000) return NOT_READY
  return { ready: true, since: list[i].t }
}

/** A target from a workout's heart rate summary (w.hr): a third of the way up from its lowest to its average. */
export function suggestedTarget(hr) {
  const avg = Number(hr?.avg), min = Number(hr?.min)
  if (hr?.avg == null || hr?.min == null || !Number.isFinite(avg) || !Number.isFinite(min)) return null
  return Math.min(150, Math.max(80, Math.round(min + 0.35 * (avg - min))))
}

/** S.hrReady with every field present and in range, whatever an older or foreign profile holds. */
export function hrReadyOf(S) {
  const v = S?.hrReady && typeof S.hrReady === 'object' ? S.hrReady : {}
  const num = (x, lo, hi, d) => (Number.isFinite(Number(x)) && x !== null && x !== '' ? Math.min(hi, Math.max(lo, Math.round(Number(x)))) : d)
  return {
    on: v.on === true,
    bpm: num(v.bpm, 60, 180, HR_READY_DEFAULT.bpm),
    floorSec: num(v.floorSec, 15, 180, HR_READY_DEFAULT.floorSec),
  }
}

/** suggestedTarget of the latest workout with a heart rate summary, null when none has one. */
export function lastWorkoutTarget(workouts) {
  const withHr = (Array.isArray(workouts) ? workouts : []).filter(w => suggestedTarget(w?.hr) != null)
  if (!withHr.length) return null
  const key = w => String(w.d || '') + ':' + String(Number(w.start) || 0).padStart(16, '0')
  const last = withHr.reduce((a, b) => (key(b) > key(a) ? b : a))
  return suggestedTarget(last.hr)
}
