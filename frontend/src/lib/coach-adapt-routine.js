// What the Coach's mid-workout changes would mean for the routine, offered once they are applied
// (components/WorkoutCoachSheet.jsx). It reads the session as it was when the changes were applied
// and as it is now, and writes nothing itself: the routine changes go through the Coach's own
// change-set (coach.js applyChangeSet), so a snapshot is taken first and Undo puts them back.
//
// Only what a session can tell a routine is offered: a swap kept, the order kept, an added
// exercise kept. Sets, reps, weight, rest and skips stay with today. The routine is the plan, and
// a session never edits its numbers; the workout screen's Update routine item says the same of
// warm-ups, rest and notes.
import { modeOf } from './history.js'
import { resolveEntry } from './coach-adapt.js'

/**
 * The running session as applyAdapt is about to see it, taken inside the same store update: each
 * entry's object (the one applyAdapt changes in place, moves, or replaces), its exercise and its
 * routine. An entry carries no key of its own, so the object stands for the slot.
 */
export const sessionBefore = active => ({
  cur: Number.isInteger(active?.cur) ? active.cur : 0,
  entries: (active?.entries || []).map(e => ({ id: e.id, rid: e.rid || null, ref: e })),
})

/**
 * The applied changes (lib/coach-adapt.js) as routine changes in the Coach's change-set shape
 * (coach.js applyChangeSet): order, swaps and additions. `before` is sessionBefore() of the
 * session the changes were resolved against, `after` that session once they were applied.
 */
export function routineChangesFor(changes, routines, before, after) {
  const routineOf = slot => (slot?.rid && routines.find(r => r.id === slot.rid)) || null
  const slotOf = c => before.entries[resolveEntry(before, c)] || null
  const swaps = changes.filter(c => c.type === 'swap')
  // The slot an entry of the session now stood in before the changes: the same object, or the
  // slot whose exercise a swap replaced with this one.
  const slotNow = entry => {
    const same = before.entries.find(s => s.ref === entry)
    if (same) return same
    const swap = swaps.find(c => c.to === entry?.id)
    return swap ? slotOf(swap) : null
  }
  const out = []

  // Order first, while it still names the routine's exercises as they were before any swap. Only
  // from a session that was still in the routine's order, with each exercise once, so the new
  // order is the Coach's move alone.
  for (const c of changes.filter(c => c.type === 'move')) {
    const routine = routineOf(slotOf(c))
    if (!routine || out.some(x => x.type === 'reorder' && x.target.routineId === routine.id)) continue
    const own = routine.ex.map(ex => ex.id)
    const was = before.entries.filter(s => s.rid === routine.id).map(s => s.id)
    const now = (after?.entries || []).map(slotNow).filter(s => s?.rid === routine.id).map(s => s.id)
    if (new Set(own).size !== own.length || was.join() !== own.join() || now.length !== own.length || new Set(now).size !== own.length || now.join() === own.join()) continue
    out.push({ id: `${c.id}-order`, type: 'reorder', target: { routineId: routine.id }, before: own, after: now, why: c.why })
  }

  for (const c of changes) {
    if (c.type === 'add') {
      // Beside the exercise it follows, or the one you were on (coach-adapt.js add).
      const slot = Number.isInteger(c.entry) ? before.entries[c.entry] : before.entries[before.cur]
      const routine = routineOf(slot)
      if (!routine || routine.ex.some(ex => ex.id === c.to) ||
        out.some(x => x.type === 'add-exercise' && x.target.routineId === routine.id && x.after.id === c.to)) continue
      const amount = c.sec ? { mode: 'time', sec: c.sec } : { mode: 'reps', reps: c.reps || 10 }
      // Next to its slot; at the end of a routine also being reordered, wherever that order lands.
      const position = out.some(x => x.type === 'reorder' && x.target.routineId === routine.id)
        ? routine.ex.length : routine.ex.findIndex(ex => ex.id === slot.id) + 1 || routine.ex.length
      out.push({ id: `${c.id}-add`, type: 'add-exercise', target: { routineId: routine.id }, before: null,
        after: { id: c.to, sets: c.sets || 3, ...amount, position }, why: c.why })
      continue
    }
    if (c.type !== 'swap') continue
    const slot = slotOf(c)
    const routine = routineOf(slot)
    const ex = routine?.ex.find(e => e.id === slot.id)
    // A routine swap keeps the slot's prescription, so only into an exercise logged the same way,
    // and not into one the routine already has.
    const toMode = c.sec ? 'time' : c.reps ? 'reps' : modeOf({ ...ex, id: c.to })
    if (!ex || routine.ex.some(e => e.id === c.to) || toMode !== modeOf(ex)) continue
    out.push({ id: `${c.id}-swap-exercise`, type: 'swap-exercise', target: { routineId: routine.id, exId: ex.id }, before: null, after: { id: c.to }, why: c.why })
  }
  return out
}
