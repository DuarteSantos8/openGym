import { uid } from './format.js'
import { planPhase, withRest } from './prescription/index.js'
import { migrateProfileV1ToV2 } from '../../../api/migration/profile-migration.js'
import { LIB_BY_ID } from '../../../api/coach/core/library.js'
import { lastEntryFor, pickedExerciseConfig } from './history.js'
import { warmupModeOf, ownRowsOf, ownRowsFromSession, sameOwnRows } from './warmup-ramp.js'
import { isRungRow } from './warmup-snap.js'
import { isWarmupRow } from './workout-model.js'
import { isAssisted, isBodyweightEq, isCardio } from './exercises.js'

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
  // An occurrence's progression track is its own occurrenceId (two occurrences of the same
  // exercise progress independently) — carrying the source's ids over verbatim would entangle
  // the copy's history with the original's. Legacy occurrences (no occurrenceId) have nothing
  // here to regenerate and pass through untouched.
  copy.ex = (copy.ex || []).map(e => e.occurrenceId == null ? e : {
    ...e,
    occurrenceId: uid(),
    ...(e.rule ? { rule: { ...e.rule, id: uid(), routineId: copy.id } } : {}),
  })
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
 * A routine slot with another exercise in it (#110). The slot keeps its place, its superset, its
 * note and — when the two exercises are the same kind of work — its rule, warm-up and intensifier,
 * and only the exercise changes. Cardio, bodyweight and assistance-machine work each mean something
 * else by "load", so between kinds the slot starts from the new exercise's default rule.
 *
 * The replacement is a new occurrence: progression belongs to an occurrence (its track), so the new
 * exercise starts on its own line instead of inheriting the old exercise's load history, and the old
 * one keeps its history, ready if it comes back. Picking the exercise already in the slot changes
 * nothing.
 */
// The slot's planned substitutes stay with the slot (lib/routine-backups.js), less the exercise
// that now fills it: a backup of itself means nothing.
function dropSelfBackup(out) {
  if (!Array.isArray(out.subs)) { delete out.subCfg; return out }
  const subs = out.subs.filter(x => x !== out.exerciseId)
  if (subs.length) out.subs = subs
  else delete out.subs
  // A backup's own plan (#978) goes with it: none for the exercise now in the slot.
  if (out.subCfg && typeof out.subCfg === 'object') {
    const left = Object.fromEntries(Object.entries(out.subCfg).filter(([k]) => subs.includes(k)))
    if (Object.keys(left).length) out.subCfg = left
    else delete out.subCfg
  } else delete out.subCfg
  return out
}

/**
 * The occurrence a v1 exercise config stands for (`{ id, sets, reps, weight, … }`), through the one
 * converter profiles and shared plans go through, so a default made here is the default v1 made.
 */
export function occurrenceFromConfig(S, cfg, { routineId = null, prog } = {}) {
  const { profile } = migrateProfileV1ToV2({
    unit: S?.unit === 'lb' ? 'lb' : 'kg', restSec: S?.restSec, progDefault: S?.progDefault, customEx: S?.customEx || [],
    routines: [{ id: 'r', name: 'r', ...(prog ? { prog } : {}), ex: [cfg] }], workouts: []
  }, LIB_BY_ID)
  const occ = profile.routines[0]?.ex[0]
  if (!occ) return null
  const occurrenceId = uid()
  return { ...occ, occurrenceId, rule: { ...occ.rule, id: occurrenceId, routineId } }
}

/** What an exercise picked from the library starts with (v1 pickedExerciseConfig): 3 × 10 with the weight still to enter, a hold on the clock, one limb per side. */
export const defaultOccurrence = (S, id, opts) => occurrenceFromConfig(S, { id, ...pickedExerciseConfig(id, undefined, S) }, opts)

// The policy a rule runs, in v1's words, for a config rebuilt around it.
const POLICY = { linear: 'linear', greyskull: 'greyskull', double: 'double', triple: 'triple', bodyweight_ladder: 'linear', hold_seconds: 'time' }

export function replaceSlotExercise(slot, id, S, rid) {
  const old = slot || {}
  if (old.exerciseId === id) return { ...old }
  const occurrenceId = uid()
  const cardioWas = old.mode === 'cardio' || (old.mode == null && isCardio(old.exerciseId))
  const p = old.rule ? planPhase(old.rule).parameters : null
  // Its rest goes along either way: the profile's, none, or its own.
  const rest = o => (old.restFromProfile || !p ? o : { ...o, rule: withRest(o.rule, p.restSeconds), restFromProfile: undefined })
  if (!old.rule || cardioWas !== isCardio(id)) {
    // Minutes at a speed and sets of reps at a load share nothing: the new exercise starts from its
    // own defaults, and only the note, the rest and the superset carry over.
    const kept = Object.fromEntries(['sg', 'note', 'subs', 'subCfg', 'restOff', 'restFromProfile'].filter(key => old[key] != null).map(key => [key, old[key]]))
    const fresh = rest({ ...defaultOccurrence(S, id, { routineId: rid ?? null }), ...kept })
    if (fresh.restFromProfile === undefined) delete fresh.restFromProfile
    return dropSelfBackup(fresh)
  }
  // "Assisted", "bodyweight" and "per side" describe the movement, not the prescription: the new
  // exercise follows its own. So are the 1RM the old one adopted and its 1RM preference.
  const { assisted: _movement, bodyweight: _bw, side: _side, ref: _ref, refs: _refs, ...carried } = old
  const out = { ...carried, occurrenceId, exerciseId: id, rule: { ...old.rule, id: occurrenceId, exerciseId: id, revision: 1 } }
  if (isCardio(id)) return dropSelfBackup(out)
  const bwWas = typeof old.bodyweight === 'boolean' ? old.bodyweight : isBodyweightEq(old.exerciseId)
  const helpWas = typeof old.assisted === 'boolean' ? old.assisted : isAssisted(old.exerciseId)
  // The weight the next session reads: the new exercise's own where it has been logged (its
  // history decides from there), else the slot's — unless the number meant something else on the
  // old movement (60 kg on a bench is not 60 kg added to a push-up, nor 40 kg of help), then none.
  // (the weight that session was planned at: its plan then carries on, or restarts, as its own history says)
  const logged = S ? [...(S.workouts || [])].reverse().flatMap(w => w.exposures || []).filter(x => x.exerciseId === id && !x.excludedFromProgression) : []
  const last = logged.find(x => rid && x.routineId === rid) || logged[0] || null
  const start = last && S.prescriptions?.[last.prescriptionId]?.ruleSnapshot?.program.phases[0].parameters.load
  const own = !last ? null : start?.mode === 'absolute' ? start.value : lastEntryFor(S, id, rid)?.sets?.find(r => !isWarmupRow(r))?.w ?? 0
  const moved = bwWas !== isBodyweightEq(id) || helpWas !== isAssisted(id)
  if (own == null && !moved) return dropSelfBackup(out)
  if (p.durationSeconds) return dropSelfBackup(out)
  // A rule is shaped by what it loads (a bodyweight ladder, a loaded policy), so the slot is put
  // through the converter again at the new weight: its sets, reps, range and policy as they were.
  const policy = POLICY[old.rule.preset]
  const again = occurrenceFromConfig(S, {
    id, mode: 'reps', sets: p.sets.min, ...(old.rule.preset === 'bodyweight_ladder' ? { reps: p.reps.min } : { reps: p.reps.max, ...(p.reps.max > p.reps.min ? { repsMin: p.reps.min } : {}) }), ...(p.sets.max > p.sets.min && policy === 'triple' ? { setsMax: p.sets.max } : {}),
    weight: own ?? 0, ...(policy ? { prog: policy } : { prog: 'off' })
  }, { routineId: old.rule.routineId ?? rid ?? null })
  return dropSelfBackup(rest({ ...out, rule: { ...again.rule, id: occurrenceId } }))
}

export function ownWarmupsChange(slot, entry, floor = 0, { force = false } = {}) {
  const warm = (entry?.sets || []).filter(isWarmupRow)
  const chose = warmupModeOf(slot)
  if (!force && !chose && !warm.some(isRungRow)) return undefined
  const saved = chose === 'own' ? ownRowsOf(slot) : []
  const touched = warm.some(r => r.edited === true) || (chose === 'own' && warm.length !== saved.length)
  if (!force && !touched) return null
  const own = ownRowsFromSession(entry?.sets || [], floor)
  if (!own) return null
  if (chose === 'own' && sameOwnRows(saved, own)) return null
  return own
}


export function keepOwnWarmups(slot, rows) {
  slot.warmup = 'own'
  slot.warmupRows = rows
  delete slot.warmupSets
}
