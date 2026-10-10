// What the Apple Watch app shows of a running workout, and what it may send back. The watch has no
// copy of the log: the iPhone app hands it one small snapshot whenever something on it changes
// (lib/watch-sync.js), and the watch answers with an action — a set done with its reps and
// weight, or the rest skipped, lengthened, held or carried on. Nothing here talks to the watch;
// this is the part a test can pin.
//
// The set the watch offers is the one the workout screen would: the first one not done in the
// marked exercise (`active.cur`), else the first one not done anywhere. A set the watch cannot log
// as it is — timed, cardio, per side — is shown with its name and left to the phone.
import { isSideSet, isWarmupRow, modeForSet } from './workout-model.js'

export const WATCH_PROTOCOL = 1
const MAX_REPS = 1000
const MAX_WEIGHT = 2000

/** { entryIdx, setIdx } of the set to do next, or null when every set is done. */
export function currentSet(active) {
  const entries = Array.isArray(active?.entries) ? active.entries : []
  const firstOpen = idx => (Array.isArray(entries[idx]?.sets) ? entries[idx].sets.findIndex(s => !s?.done) : -1)
  const cur = Number.isInteger(active?.cur) ? active.cur : 0
  const here = firstOpen(cur)
  if (here >= 0) return { entryIdx: cur, setIdx: here }
  for (let idx = 0; idx < entries.length; idx++) {
    const i = firstOpen(idx)
    if (i >= 0) return { entryIdx: idx, setIdx: i }
  }
  return null
}

// The rest as the watch counts it: from the end while it runs (the watch counts down on its own,
// so the snapshot does not change every second), from what is left while it is held.
function restOf(timer) {
  if (!timer) return null
  if (timer.ready) return { ready: true, total: timer.total || 0 }
  if (timer.paused) return { paused: true, left: Math.max(0, timer.left || 0), total: timer.total || 0 }
  return { endsAt: timer.endsAt, total: timer.total || 0, ...(timer.kind === 'switch' ? { switching: true } : {}) }
}

/**
 * The snapshot the watch shows. `nameOf(entry)` names an exercise in the app's language and
 * `labels` carries the few words the watch prints, so the watch needs no translations of its own.
 */
export function watchSnapshot(S, timer, { nameOf = e => e?.id || '', labels = {} } = {}) {
  const A = S?.active
  if (!A || !Array.isArray(A.entries)) return { v: WATCH_PROTOCOL, active: false, labels }
  const entries = A.entries
  const all = entries.flatMap(e => (Array.isArray(e?.sets) ? e.sets : []))
  const progress = { done: all.filter(s => s?.done).length, total: all.length }
  const pos = currentSet(A)
  const base = { v: WATCH_PROTOCOL, active: true, workout: String(A.name || ''), unit: S.unit === 'lb' ? 'lb' : 'kg', progress, rest: restOf(timer), labels }
  if (!pos) return { ...base, set: null }
  const entry = entries[pos.entryIdx]
  const set = entry.sets[pos.setIdx]
  const mode = modeForSet(set, entry.target || {})
  return {
    ...base,
    set: {
      entryIdx: pos.entryIdx,
      setIdx: pos.setIdx,
      exercise: String(nameOf(entry) || ''),
      setNo: pos.setIdx + 1,
      setCount: entry.sets.length,
      warmup: isWarmupRow(set),
      mode,
      reps: Math.max(0, Math.round(Number(set.r) || 0)),
      weight: Math.max(0, Number(set.w) || 0),
      loggable: mode === 'reps' && !isSideSet(set),
    },
  }
}

const REST_ACTIONS = new Set(['skipRest', 'addRest', 'pauseRest', 'resumeRest'])

/**
 * An action from the watch, checked against the workout as it is now. A set done comes back as
 * { type: 'done', entryIdx, setIdx, reps, weight } only while that set is still the one to do
 * and can be logged from the watch: one the phone has moved past since (ticked there, a set
 * added, the exercise swapped) is dropped rather than ticking the wrong row. Rest actions pass
 * as { type, sec? }. Anything else is null.
 */
export function readWatchAction(active, action) {
  const type = action?.type
  if (REST_ACTIONS.has(type)) {
    if (type !== 'addRest') return { type }
    const sec = Math.round(Number(action.sec))
    return Number.isFinite(sec) && sec !== 0 && Math.abs(sec) <= 600 ? { type, sec } : null
  }
  if (type !== 'done') return null
  const pos = currentSet(active)
  if (!pos || pos.entryIdx !== action.entryIdx || pos.setIdx !== action.setIdx) return null
  const set = active.entries[pos.entryIdx].sets[pos.setIdx]
  if (modeForSet(set, active.entries[pos.entryIdx].target || {}) !== 'reps' || isSideSet(set)) return null
  const reps = Number(action.reps), weight = Number(action.weight)
  if (!Number.isInteger(reps) || reps < 0 || reps > MAX_REPS) return null
  if (!Number.isFinite(weight) || weight < 0 || weight > MAX_WEIGHT) return null
  return { type, entryIdx: pos.entryIdx, setIdx: pos.setIdx, reps, weight: Math.round(weight * 100) / 100 }
}
