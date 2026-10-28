// A workout left running on the phone (you walked out without Finish): "All done?" once nothing
// has happened in it for FORGOTTEN_GAP_MS. That is the same 20 minutes after which Finish already
// ends a session at its last set (finish-workout.js sessionEnd), and after which the Watch asks
// (WatchCore Idle.askAfter). Asked once per quiet spell: the time it was asked counts as activity,
// so Continue (or closing the sheet) waits another 20 minutes. Kept on the device only.
import { FORGOTTEN_GAP_MS, rowLengthMs } from './finish-workout.js'
import { hasCompletedWork } from './workout-model.js'

const KEY = 'gym_forgotten_asked'

/** The workout's newest activity: its start, or the later end of a ticked row (a row ticked
 *  when it started reaches to its own length, as in sessionEnd). */
export function lastActivity(active) {
  let last = Number(active?.start) || 0
  for (const e of active?.entries || []) {
    for (const s of e?.sets || []) {
      if (hasCompletedWork(s) && Number.isFinite(s.at)) last = Math.max(last, s.at + rowLengthMs(s))
    }
  }
  return last
}

/** Whether to ask now. `asked`: { start, at } from the last time this workout was asked about.
 *  `busy`: a rest, hold or count-in is running, which is the workout going on. */
export function forgottenDue(active, now, asked = null, busy = false) {
  if (!active || busy || active.editingWorkoutId || active.backfill || !(active.start > 0)) return false
  const answered = asked && asked.start === active.start ? Number(asked.at) || 0 : 0
  return now - Math.max(lastActivity(active), answered) >= FORGOTTEN_GAP_MS
}

/** How long it has been quiet, for the question (ms). */
export const quietFor = (active, now) => Math.max(0, now - lastActivity(active))

export function readAsked() {
  try { return JSON.parse(localStorage.getItem(KEY)) || null } catch { return null }
}
export function writeAsked(active, now) {
  try { localStorage.setItem(KEY, JSON.stringify({ start: active.start, at: now })) } catch { /* private mode: asks again */ }
}
