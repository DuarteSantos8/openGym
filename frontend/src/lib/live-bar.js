// What the live workout bar shows (components/LiveBar.jsx draws it): when it shows, and its text,
// rest, progress, pulse and watch mark. Pure; every number comes from the helpers the Lock Screen uses.
import { EXIDX } from './exercises.js'
import { exerciseNameText } from './format.js'
import { upcomingSets } from './live-activity.js'
import { heartNow } from './live-tiles.js'
import { isWarmupRow } from './workout-model.js'

// The one rule for "a workout is running and the bar (not the workout screen) is where it shows".
export const liveBarShows = (S, pathname) => {
  const A = S?.active
  return !!A && pathname !== '/workout' && !A.editingWorkoutId && !A.backfill && A.start > 0
}

// Where the bar shows, the old rest bar goes only for a plain rest counting down (and the ready state
// after it): a timed hold, a count-in and a paused rest need its Done, Pause and Resume.
export const liveBarHidesRest = ({ timer, work, countIn }) => !work && !countIn && !timer?.paused

const nameOf = e => (EXIDX[e.id] ? exerciseNameText(EXIDX[e.id]) : String(e.target?.name || e.name || e.id || ''))
// A watch row that is gone is none; one that answers is linked; delayed or not answering is still being looked for.
const DEVICE = { live: 'linked', offline: 'none', notFound: 'none' }

export function liveBarState (S, { timer = null, live = null, rows = [], checking = false } = {}) {
  const A = S?.active
  if (!A) return null
  const entries = Array.isArray(A.entries) ? A.entries : []
  let done = 0, total = 0
  for (const e of entries) for (const s of e?.sets || []) { total++; if (s?.done) done++ }
  const up = upcomingSets(S)[0]
  const e = up && entries[up.entryIdx]
  const s = e?.sets[up.setIdx]
  const work = e ? e.sets.filter(x => !isWarmupRow(x)) : []
  const resting = !!timer && !timer.ready && timer.left > 0
  const watch = rows.find(r => r.id === 'watch')
  const bpm = heartNow(A, live)?.bpm ?? null
  const device = watch ? DEVICE[watch.state] || 'relinking' : checking ? 'checking' : null
  return {
    routine: A.name || '',
    exercise: e ? nameOf(e) : '',
    set: e && !isWarmupRow(s) ? { n: work.indexOf(s) + 1, of: work.length } : null,
    allDone: entries.length > 0 && !up,
    rest: resting ? { left: timer.left, switch: timer.kind === 'switch' } : null,
    next: resting && e ? nameOf(e) : '',
    start: A.start,
    pausedAt: A.pausedAt || 0,
    done,
    total,
    progress: resting ? Math.max(0, Math.min(1, timer.left / timer.total)) || 0 : total ? done / total : 0,
    bpm,
    device,
    pulseSlot: bpm != null || device === 'linked',
  }
}
