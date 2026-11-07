// Pausing a running workout (#976). A phone call, the kids, a machine queue: the workout clock
// stops, and so do the rest, a hold and its count-in (store/useUI.js pauseAuto), with their
// notifications. Resuming carries on from where it stopped.
//
// S.active.pausedAt is when it was paused (ms), so a reload, another device and the watch all see
// it paused. Resuming moves `start` on by the time paused, so everything that reads the workout's
// length from start and end (the header clock, the saved duration, Apple Health, the watch) counts
// time trained, not time on the clock; `pausedMs` adds up the pauses, for the record. Finishing
// while paused ends the workout at the pause. `pauses` keeps each pause's span ({ from, to }) for
// the live session only: the sets keep their real tick times, so the session's end
// (lib/finish-workout.js sessionEnd) must not read a 30-minute pause between two sets as the
// workout being over (#1021).

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/** Whether this workout is paused. Only a live one can be: not a past workout logged or edited. */
export const isPaused = A => !!A && num(A.pausedAt) > 0

/** Whether this workout can be paused at all: running live, with a start. */
export const canPause = A => !!A && !A.backfill && A.editingWorkoutId == null && num(A.start) > 0

/** The workout paused at `now`; unchanged if it cannot be or already is. Mutates and returns `A`. */
export function pauseWorkout(A, now = Date.now()) {
  if (!canPause(A) || isPaused(A)) return A
  A.pausedAt = Math.max(num(A.start), now)
  return A
}

/** The workout running again at `now`, its start moved on by the pause. Mutates and returns `A`. */
export function resumeWorkout(A, now = Date.now()) {
  if (!isPaused(A)) return A
  const held = Math.max(0, now - num(A.pausedAt))
  A.start = num(A.start) + held
  A.pausedMs = num(A.pausedMs) + held
  if (held > 0) A.pauses = [...(Array.isArray(A.pauses) ? A.pauses : []), { from: num(A.pausedAt), to: now }]
  delete A.pausedAt
  return A
}

/** How long the workout has run at `now`, its pauses left out (ms). */
export const elapsedMs = (A, now = Date.now()) =>
  !A || !(num(A.start) > 0) ? 0 : Math.max(0, (isPaused(A) ? num(A.pausedAt) : now) - num(A.start))

/** When a workout finished at `end` stopped: at its pause, if it was paused. */
export const stopAt = (A, end) => (isPaused(A) ? Math.min(end, num(A.pausedAt)) : end)

/** The spans this workout stood paused, up to `now` (a pause still running included). */
export function pauseSpans(A, now = Date.now()) {
  const spans = (Array.isArray(A?.pauses) ? A.pauses : [])
    .filter(p => num(p?.from) > 0 && num(p?.to) > num(p?.from))
    .map(p => ({ from: num(p.from), to: num(p.to) }))
  if (isPaused(A) && now > num(A.pausedAt)) spans.push({ from: num(A.pausedAt), to: now })
  return spans
}

/** How much of the time between `a` and `b` the workout stood paused. */
export function pausedBetween(spans, a, b) {
  let ms = 0
  for (const p of spans || []) ms += Math.max(0, Math.min(b, p.to) - Math.max(a, p.from))
  return ms
}
