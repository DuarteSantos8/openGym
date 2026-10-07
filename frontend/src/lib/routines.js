import { uid } from './format.js'
import { defaultConfig, isBw, modeOf, MAX_PLANNED_WARMUPS, NOTE_MAX } from './history.js'
import { isAssisted, isBodyweightEq, isCardio } from './exercises.js'
import { sessionsFor } from './progression.js'
import { isWarmupRow } from './workout-model.js'

/**
 * Create a deep copy of a routine with a new id and a "(Copy)" suffix.
 * All exercises and their configuration are preserved independently.
 */
export function copyRoutine(routine, suffix = 'Copy') {
  const copy = structuredClone(routine)
  copy.id = uid()
  // "Push (Copy)" copied again becomes "Push (Copy 2)", not "Push (Copy) (Copy)".
  const esc = suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = new RegExp('^(.*) \\(' + esc + '(?: (\\d+))?\\)$').exec(routine.name || '')
  copy.name = m ? m[1] + ' (' + suffix + ' ' + ((Number(m[2]) || 1) + 1) + ')' : routine.name + ' (' + suffix + ')'
  return copy
}

/**
 * Delete a routine and every pointer to it, in place on a store draft. A weekday holds a list of
 * routine ids, so the deleted one is pulled from each day and the key dropped when it empties
 * (never store []); a day that never named it is left exactly as it was. A per-date reschedule
 * (dayPlan) naming it goes too: left behind, the day still counts as overridden and wears a
 * "rescheduled" badge for good with no way to clear it.
 *
 * Plan's swipe, RoutineEdit's button and the Coach's remove-routine all delete through here, so
 * the next thing that learns to point at a routine is cleaned up in one place, not three.
 * Returns the dropped dayPlan entries ({ iso: id }), which the Coach records so a revert can put
 * them back.
 */
export function deleteRoutine(s, id) {
  s.routines = s.routines.filter(r => r.id !== id)
  Object.keys(s.week || {}).forEach(d => {
    const ids = [].concat(s.week[d])
    if (!ids.includes(id)) return
    const next = ids.filter(rid => rid !== id)
    if (next.length) s.week[d] = next; else delete s.week[d]
  })
  const dropped = {}
  Object.keys(s.dayPlan || {}).forEach(iso => {
    if (s.dayPlan[iso] === id) { dropped[iso] = id; delete s.dayPlan[iso] }
  })
  return dropped
}

/**
 * Everything deleteRoutine is about to take away, so an Undo can put the routine back where it
 * was (Plan's swipe and minus, v1.3.11): the routine itself and its place in the list, its place
 * on each weekday that holds it, the reschedules that name it, and its places in the saved loop
 * and the live queue. deleteRoutine leaves the last two alone (an id that no longer resolves is
 * skipped where they are read), but a save in between may have dropped it, so they are kept too.
 * Null when there is no such routine.
 */
export function routineSnapshot(S, id) {
  const index = (S.routines || []).findIndex(r => r.id === id)
  if (index < 0) return null
  const week = {}
  Object.keys(S.week || {}).forEach(d => {
    const at = [].concat(S.week[d]).indexOf(id)
    if (at >= 0) week[d] = at
  })
  const dayPlan = {}
  Object.keys(S.dayPlan || {}).forEach(iso => { if (S.dayPlan[iso] === id) dayPlan[iso] = id })
  const seqAt = Array.isArray(S.rotation?.sequence) ? S.rotation.sequence.indexOf(id) : -1
  const queueAt = Array.isArray(S.queue?.ids) ? S.queue.ids.indexOf(id) : -1
  return { routine: structuredClone(S.routines[index]), index, week, dayPlan, seqAt, queueAt }
}

const putBack = (list, at, id) => {
  if (list.includes(id)) return list
  const next = list.slice()
  next.splice(Math.min(at, next.length), 0, id)
  return next
}

/**
 * Undo for deleteRoutine, in place on a store draft, from a routineSnapshot taken just before it.
 * Each pointer goes back to its old position, or to the end of a list that has since got
 * shorter; a reschedule only where that date has not been planned again since. False, and nothing
 * changed, when a routine with that id exists again (another device put it back first).
 */
export function restoreRoutine(s, snap) {
  if (!snap?.routine || !Array.isArray(s.routines)) return false
  const id = snap.routine.id
  if (s.routines.some(r => r.id === id)) return false
  s.routines.splice(Math.min(snap.index, s.routines.length), 0, structuredClone(snap.routine))
  if (Object.keys(snap.week).length) s.week = s.week || {}
  Object.entries(snap.week).forEach(([d, at]) => {
    s.week[d] = putBack(s.week[d] == null ? [] : [].concat(s.week[d]), at, id)
  })
  if (Object.keys(snap.dayPlan).length) s.dayPlan = s.dayPlan || {}
  Object.keys(snap.dayPlan).forEach(iso => { if (s.dayPlan[iso] == null) s.dayPlan[iso] = id })
  if (snap.seqAt >= 0 && Array.isArray(s.rotation?.sequence)) {
    s.rotation = { ...s.rotation, sequence: putBack(s.rotation.sequence, snap.seqAt, id) }
  }
  if (snap.queueAt >= 0 && Array.isArray(s.queue?.ids)) s.queue = { ...s.queue, ids: putBack(s.queue.ids, snap.queueAt, id) }
  return true
}

/**
 * A routine slot with another exercise in it (#110): the machine you planned around is gone, or
 * a variation takes over the lift for a block. The slot keeps its place and what was set up for
 * it — sets, reps, weight, rest, warm-ups, the progression rule, the note, its superset — and only
 * the exercise changes. The old way (remove, add, configure again) lost all of that.
 *
 * Some things cannot come along. A cardio slot is minutes at a speed and a lifting slot is sets
 * of reps at a load, so between the two only the note, the rest and the superset carry over and
 * the rest starts from the new exercise's defaults. A load means something else once the new
 * exercise is bodyweight where the old one was not, or the other way round: 60 kg on a bench is
 * not 60 kg added to a push-up. The same goes for an assistance machine, where the number is
 * help rather than load: 40 kg off a pull-up is not 40 kg on a pulldown. There the weight goes
 * back to 0. The bodyweight, assisted and per-side flags describe the movement, not the
 * prescription, so they are dropped and the new exercise follows its own, the way the Coach's
 * swap does (lib/coach.js): a split squat's "per side" would split a back squat's reps into L/R.
 *
 * What is not carried is history. Progress belongs to a routine and an exercise together (#216),
 * so the new exercise starts on its own line — its own sessions in this routine, and until there
 * are any, the slot's numbers — and the old exercise keeps its sessions, ready if it comes back.
 * That is also why the old exercise's weight gives way to the new one's own wherever the new one
 * has been logged (`S`, and the routine `rid` the slot is in): the next session reads a slot
 * weight that differs from the one its last session was planned at as a deliberate edit, and
 * opens there (#275, nextPrescription). An 80 kg barbell bench carried onto dumbbells trained at
 * 30 would open the dumbbells at 80 — and only when the two rep schemes differed, because a
 * plan whose sets and reps match just carries on. With the new exercise's own planned weight in
 * the slot, its history decides either way. One never logged keeps the slot's weight, since
 * there is nothing better to start from.
 *
 * Picking the exercise that is already in the slot replaces nothing, and changes nothing.
 */
export function replaceSlotExercise(slot, id, S, rid) {
  const old = slot || {}
  if (old.id === id) return { ...old }
  if ((modeOf(old) === 'cardio') !== isCardio(id)) {
    const kept = ['sg', 'note', 'restSec'].filter(key => old[key] != null)
    return { id, ...defaultConfig(id), ...Object.fromEntries(kept.map(key => [key, old[key]])) }
  }
  const { id: _replaced, bodyweight: _flag, assisted: _assisted, side: _side, ...carried } = old
  const out = { id, ...carried }
  if (isCardio(id)) return out
  if (isBw(old) !== isBodyweightEq(id)) {
    out.weight = 0
    // A rep ceiling belongs to bodyweight work: it adds sets where there is no load to add.
    delete out.repsMax
  }
  if (isAssisted(old) !== isAssisted(id)) out.weight = 0
  // The session the next prescription will read for this slot (nextPrescription), so the weight
  // put here is the one that session was planned at: the restart rule then sees no edit and
  // holds at what was lifted, or the plan carries on from it. A session saved before plans were
  // stamped has no planned weight, and what was lifted in it is the nearest thing.
  const mode = modeOf(out)
  const last = S ? sessionsFor(S, id, out, rid).filter(s => s.mode === mode).at(-1) : null
  if (last) out.weight = last.planned?.weight ?? last.weight ?? 0
  return out
}

/**
 * Where a running session's exercise sits in the routine it was built from, as an index into
 * `routine.ex`, or -1 when it does not sit anywhere: a freestyle exercise, one added from
 * another routine, one swapped for something the routine never had.
 *
 * A session entry keeps the routine it came from (`rid`), and a combined day can hold the same
 * exercise twice, so the match is by position among the twins: the second bench press of that
 * routine in the session is the routine's second bench press.
 */
export function routineSlotIndex(routine, entries, idx) {
  const entry = entries?.[idx]
  if (!entry || !routine || !Array.isArray(routine.ex) || entry.rid !== routine.id) return -1
  const twinsBefore = entries.slice(0, idx).filter(e => e && e.rid === routine.id && e.id === entry.id).length
  let seen = 0
  for (let i = 0; i < routine.ex.length; i++) {
    if (routine.ex[i]?.id === entry.id && seen++ === twinsBefore) return i
  }
  return -1
}

// What the exercise config sheet writes into a routine slot that a session can also change: the
// warm-ups added or removed on the exercise, and the rest and the note its settings sheet edits.
// A key that does not apply to the exercise is left out, so it can never overwrite the slot's own:
// a cardio interval has no warm-ups, and rest-pause builds its own warm-up row (ExConfig hides
// the stepper for both).
function setupOf(entry) {
  const target = entry.target || {}
  const out = {
    restSec: Math.max(0, Math.round(Number(target.restSec)) || 0),
    note: String(target.note || '').trim().slice(0, NOTE_MAX),
  }
  if (!isCardio(entry.id) && target.intensifier?.type !== 'restpause') {
    out.warmupSets = Math.min(MAX_PLANNED_WARMUPS, (entry.sets || []).filter(isWarmupRow).length)
  }
  return out
}

/**
 * What a running session's exercise would change in its routine, or null when there is nothing
 * to change: the exercise has no routine slot, or the slot already says what the session did.
 * `changes` are `{ key, from, to }` for `warmupSets`, `restSec` and `note`.
 *
 * Warm-ups added in a session used to last that session only, and so did anything edited on the
 * exercise's settings sheet from inside it (Progression settings opens the same sheet the routine
 * editor does). Sets, reps and weight are not offered: the progression engine moves those every
 * session, and the routine is the plan it reads them against.
 */
export function routineChangesFromEntry(routine, entries, idx) {
  const at = routineSlotIndex(routine, entries, idx)
  if (at < 0) return null
  const slot = routine.ex[at]
  const now = setupOf(entries[idx])
  const changes = []
  for (const key of ['warmupSets', 'restSec', 'note']) {
    if (now[key] === undefined) continue
    const from = key === 'note' ? String(slot.note || '').trim() : Math.max(0, Math.round(Number(slot[key])) || 0)
    if (from !== now[key]) changes.push({ key, from, to: now[key] })
  }
  return changes.length ? { at, changes } : null
}

/**
 * Write those changes into the routine, in place on a store draft, the way the config sheet
 * does: a key is only stored when it has a value, so "no warm-ups" removes it instead of leaving
 * a 0 that no plan file ever had. Returns the changes it applied, or null.
 */
export function updateRoutineFromEntry(routine, entries, idx) {
  const found = routineChangesFromEntry(routine, entries, idx)
  if (!found) return null
  const slot = routine.ex[found.at]
  for (const { key, to } of found.changes) {
    if (to) slot[key] = to
    else delete slot[key]
  }
  return found.changes
}
