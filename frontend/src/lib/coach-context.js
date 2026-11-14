// What the app hands the Coach beyond the synced profile, which the payload builder (api/coach/
// core/payload.js) already reads on either side. One place for it, so a new piece of context —
// the next thing the Coach should know about — is added here and travels the same way to the
// server and to a phone running the Coach itself.
//
// Today that is the session running on this device: the server never holds `S.active` (a push
// leaves it out), so a question asked mid-workout ("how long between these sets?") would
// otherwise be answered without the workout it is about. Only the numbers go: exercise ids,
// planned or extra, targets and logged sets — no notes, media or device bookkeeping.
import { isWarmupRow } from './workout-model.js'

const SET_KEYS = ['w', 'r', 'sec', 'min', 'speed', 'rir', 'rpe']

/** The running session as the Coach reads it, or null when there is none (or it is a history edit). */
export function todayForCoach(S, now = Date.now()) {
  const a = S?.active
  if (!a || a.editingWorkoutId != null || !Array.isArray(a.entries) || !a.entries.length) return null
  return {
    d: a.d || null,
    name: a.name || null,
    minutes: a.start ? Math.max(0, Math.round((now - a.start) / 60000)) : null,
    ...(Number.isInteger(a.cur) ? { current: a.cur } : {}),
    entries: a.entries.filter(Boolean).map(e => ({
      id: e.id,
      ...(e.extra === true ? { extra: true } : {}),
      ...(e.target && typeof e.target === 'object' ? { target: { sets: e.target.sets, reps: e.target.reps, sec: e.target.sec, weight: e.target.weight } } : {}),
      sets: (Array.isArray(e.sets) ? e.sets : []).filter(Boolean).map(s => {
        const o = { done: s.done === true }
        if (isWarmupRow(s)) o.warmup = true
        else if (s.failure === true) o.failure = true
        for (const k of SET_KEYS) if (Number.isFinite(s[k])) o[k] = s[k]
        return o
      }),
    })),
  }
}
