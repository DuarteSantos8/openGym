// Editing a workout that is already in history (#143): its exercises, sets and notes.
//
// The editor is the ordinary workout screen working on a draft in `state.active` (the store keeps
// it as A; `editingWorkoutId` says whose), so a reload, a closed tab or an offline spell keeps the
// draft, and the saved record stays exactly as it was until Save. When the session happened — its
// day, start and length — is not edited here: WorkoutDetail has its own rows for that
// (lib/workout-date.js).
//
// The draft is the saved exposures read back into the rows the workout screen edits
// (rowsOfPerformance), and Save writes them the way a live finish does (buildCompletedSession):
// the same rows, summary and audit, against the prescription the session was built from.
//
// Save replaces the record by id. Getting that replacement onto every device is the sync's job,
// not this file's: the record is stamped with the time of the edit (stampWorkout), and a conflict
// between two copies keeps the version edited last (lib/sync-merge.js). So the edit replaces the
// old copy wherever it is, is never joined by it as a duplicate, and an older copy cannot come
// back over it on a 409.
import { reconcileDerivedOneRms, appendOneRm, replayProgression } from './prescription/index.js'
import { beatsWeight } from './exercises.js'
import { uid } from './format.js'
import { buildCompletedSession, workLoadOf } from './finish-session.js'
import { plannedOf, rowsOfPerformance, targetFor } from './session-ui-adapter.js'
import { hasCompletedWork } from './workout-model.js'
import { stampWorkout } from './sync-merge.js'
import { legacySyncKey, rebuildPrHistory } from './workout-date.js'

const clone = value => structuredClone(value)
const list = v => (Array.isArray(v) ? v : [])

// Which record the editor works on. A workout logged before ids existed is keyed by its day and
// start, the way the sync keys it; Save freezes that key as its id (as a date move does), so the
// other device's untouched copy is still recognised as the same record.
const keyOf = w => (w?.id != null ? w.id : legacySyncKey(w))

// The fields of the whole workout the editor can change — its note, its name (renamed, or derived
// again when a routine is added) and the body weight it was logged with — which the history can
// change too while the editor is open: WorkoutDetail writes the note, and a sync brings in what
// another device wrote. Save takes the draft's value only where the editor changed it, so an
// editor opened on an old note does not write that old note back over a newer one, or delete a
// note written meanwhile. The note is compared as the finish writes it, trimmed.
const SESSION_FIELDS = ['note', 'name', 'bw']
const sessionField = (w, k) => (k === 'note' ? (w?.note || '').trim() : (w?.[k] ?? null))

// The same data whatever order its keys were written in. A key holding undefined is no key, as it
// is once the record is stored.
function sameData(a, b) {
  if (a === b) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false
  const keys = o => Object.keys(o).filter(k => o[k] !== undefined)
  const ka = keys(a)
  return ka.length === keys(b).length && ka.every(k => sameData(a[k], b[k]))
}

// What the finish worked out from the rows, which Save works out again.
const DERIVED_EXPOSURE = ['performance', 'actual', 'audit', 'completedAt', 'sourceAudit']
// One saved exposure as the entry the workout screen edits, with the plan it was built from.
function entryOf(x, prescriptions) {
  const p = prescriptions?.[x.prescriptionId]
  return {
    id: x.exerciseId,
    exposureId: x.exposureId,
    ...(x.routineId ? { rid: x.routineId } : {}),
    ...(x.excludedFromProgression ? { noProg: true } : {}),
    ...(x.sg ? { sg: x.sg } : {}),
    target: { ...Object.fromEntries(['dbLoad', 'lastToFailure', 'backoff'].filter(k => x[k] != null).map(k => [k, x[k]])), ...(p?.backoffStep ? { backoffStep: p.backoffStep } : {}), ...(x.mode ? { mode: x.mode } : {}), ...(typeof x.assisted === 'boolean' ? { assisted: x.assisted } : {}), ...(x.warmupRestSec != null ? { warmupRestSec: x.warmupRestSec } : {}), ...(p ? targetFor(p, x.mode) : {}), ...(x.side ? { side: true } : {}), ...(x.bodyweight != null ? { bodyweight: x.bodyweight } : {}), ...(x.intensifier ? { intensifier: x.intensifier } : {}) },
    ...(p ? { planned: plannedOf(p) } : {}),
    ...(x.performance?.note ? { note: x.performance.note } : {}),
    ...(x.performance?.notePin ? { notePin: true } : {}),
    sets: rowsOfPerformance(x.performance?.sets, x.mode)
  }
}

// The draft a saved workout opens as. Deterministic, so the same record always opens the same way.
function draftOf(state, original, key) {
  const { exposures, vol, prs, _ts, media, ...session } = clone(original)
  // A saved exposure with no id (imported history) gets one for the draft to pair its entry by.
  const drafted = list(exposures).map((x, i) => ({ ...Object.fromEntries(Object.entries(x).filter(([k]) => !DERIVED_EXPOSURE.includes(k))), exposureId: x.exposureId ?? `${key}:x${i}`, performance: { sets: [] } }))
  const entries = list(exposures).map((x, i) => entryOf({ ...x, exposureId: drafted[i].exposureId }, state.prescriptions))
  return {
    ...session,
    cur: 0,
    editingWorkoutId: key,
    exposures: drafted,
    entries,
    // A workout kept out of progression as a whole opens with the header's "Don't count for
    // progression" on (lib/session-noprog.js), so it can be switched off there, and an exercise
    // added in the editor stays out with the rest.
    ...(entries.length && entries.every(e => e.noProg) ? { noProg: true } : {})
  }
}

// What the editor changes, compared with a fresh open of the record as history holds it now.
const draftData = a => ({ entries: a.entries, routineIds: list(a.routineIds) })

// The best load one workout logged for an exercise, across every exposure of it.
function bestIn(workout, id) {
  let best = 0
  for (const x of list(workout?.exposures)) {
    if (x?.exerciseId !== id) continue
    const w = workLoadOf(x)
    if (beatsWeight(id, w, best)) best = w
  }
  return best
}

// The kept working weight of an exercise is lowered only when it came from this session and the
// edit took it away — a typed 1000 corrected to 100, or deleted with the rest of the workout. Then
// it is the best set left in history, or gone. One confirmed anywhere else ("Tracked — next time
// starts at…") is left as it is. `saved` is the record after the edit, null once it is deleted.
function lowerKeptWeights(state, ids, current, saved) {
  for (const id of ids) {
    const kept = state.exWeights?.[id]
    const before = bestIn(current, id)
    if (!kept || !(kept.w > 0) || kept.w !== before || !beatsWeight(id, before, bestIn(saved, id))) continue
    let best = null
    for (const w of state.workouts) {
      const top = bestIn(w, id)
      if (beatsWeight(id, top, best?.w || 0)) best = { w: top, d: w.d }
    }
    if (best) state.exWeights[id] = best
    else delete state.exWeights[id]
  }
}

// The estimated 1RMs this workout's own sets produced. An edit replaces them with what the edited
// sets estimate, so a typo's 1RM goes with the typo.
const ownEstimates = (state, exposureIds) => Object.fromEntries(Object.entries(state.oneRepMaxes || {})
  .filter(([, r]) => !(r?.source === 'estimated' && exposureIds.has(r.sourceRecordId))))

/**
 * Whether the editor holds nothing Save could keep: not one set ticked done. This draft would save
 * as a workout with nothing logged in it — an empty row in the history that counts as a training day.
 */
export const editLeftEmpty = active => !list(active?.entries).some(entry => list(entry?.sets).some(hasCompletedWork))

/**
 * Opens the editor on a saved workout: its draft becomes `state.active`. `ref` is the workout or
 * its id. Throws while another session is running, or when the workout is gone.
 */
export function editCompletedSession(state, ref) {
  if (state.active) throw new Error('Finish the current workout first.')
  const key = ref && typeof ref === 'object' ? keyOf(ref) : ref
  const original = key == null ? null : list(state.workouts).find(w => keyOf(w) === key)
  if (!original) throw new Error('Workout deleted')
  const active = draftOf(state, original, key)
  active.editBase = Object.fromEntries(SESSION_FIELDS.map(k => [k, sessionField(original, k)]))
  state.active = active
  return active
}

/**
 * Saves the editor into history and closes it. Returns the saved record.
 *
 * The record is the one history holds now, not the one the editor opened: another device may have
 * moved it or corrected its note meanwhile, and what the editor does not edit stays as that left
 * it — the note and the name too, unless the editor changed them itself. The sets are the
 * editor's — the edit saved last wins, as it does between devices. A record deleted meanwhile
 * (the deletion already reached this device) is not brought back behind the person's back: Save
 * throws, and the draft stays open to keep editing or drop.
 */
export function saveWorkoutEdit(state, now = Date.now()) {
  const active = state.active
  const key = active?.editingWorkoutId
  const index = key == null ? -1 : list(state.workouts).findIndex(w => keyOf(w) === key)
  if (index < 0) throw new Error('This workout was deleted on another device. Your edits are still here.')
  // Never saved empty: the editor asks to delete the workout instead (deleteEditedWorkout).
  if (editLeftEmpty(active)) throw new Error('Nothing logged yet')
  const current = state.workouts[index]
  // A Save that changed nothing closes the editor and leaves the record as it is. A new stamp
  // would outrank an edit another device made since and has not synced yet (sets added on the
  // phone), for nothing — the date and duration rows skip an unchanged save the same way.
  if (unchanged(state, active, current, key)) {
    state.active = null
    return current
  }
  const ids = new Set([...list(current.exposures), ...list(active.exposures)].map(x => x.exposureId))
  state.oneRepMaxes = ownEstimates(state, ids)
  const { session, oneRepMaxes } = buildCompletedSession(active, state, { end: current.end, newId: uid, unit: state.unit })
  const record = { ...current, ...session, id: key, d: current.d, start: current.start, end: current.end }
  const base = active.editBase
  for (const k of SESSION_FIELDS) {
    // A draft from before `editBase` existed has nothing to compare with, and keeps the editor's.
    const value = !base || sessionField(session, k) !== base[k] ? sessionField(session, k) : current[k]
    if (value == null || value === '') delete record[k]
    else record[k] = value
  }
  stampWorkout(record, now)
  state.workouts[index] = record
  for (const r of oneRepMaxes) state.oneRepMaxes = appendOneRm(state.oneRepMaxes, r)

  // A track whose newest log is the edited one moves on from what that log now says: its logs are
  // replayed the way each finish advanced them. Kept out of progression now, the track is left
  // where the logs before it put it.
  state.progression ||= {}
  for (const x of [...current.exposures, ...record.exposures]) {
    if (state.progression[x.trackId]?.lastCompletedLogId !== x.exposureId) continue
    const replayed = replayProgression({ workouts: state.workouts, trackId: x.trackId, prescriptions: state.prescriptions })
    if (replayed) state.progression[x.trackId] = replayed
    else delete state.progression[x.trackId]
  }

  // Badges are a claim about the sessions before each one. The edited session can earn one it now
  // leads with, and a later one loses its own if the edit raised the bar above it — the same
  // asymmetric rule a date move follows, so imported history never sprouts trophies.
  const touched = [...new Set([...list(current.exposures), ...record.exposures].map(x => x?.exerciseId).filter(id => id != null))]
  state.workouts = rebuildPrHistory(state.workouts, touched, record)
  const saved = state.workouts.find(w => keyOf(w) === key)
  lowerKeptWeights(state, touched, current, saved)
  reconcileDerivedOneRms(state)
  state.active = null
  return saved
}

// Whether Save would write the record as history holds it: the same rows and routines as a fresh
// open of it, and no whole-workout field the editor changed to something else.
function unchanged(state, active, current, key) {
  if (!sameData(draftData(active), draftData(draftOf(state, current, key)))) return false
  const base = active.editBase
  return SESSION_FIELDS.every(k => sessionField(active, k) === (base ? base[k] : sessionField(current, k)) || sessionField(active, k) === sessionField(current, k))
}

/**
 * Whether closing the editor would lose nothing: Save would write the record exactly as history
 * holds it. Closing then just closes — asking "Save workout changes?" about a workout nobody
 * touched (QA 1.3.9) made every look at a past session end in a question. A record deleted
 * meanwhile, or a draft left empty, is a change: those still ask.
 */
export function editChangesNothing(state) {
  const active = state?.active
  const key = active?.editingWorkoutId
  if (key == null || editLeftEmpty(active)) return false
  const current = list(state.workouts).find(w => keyOf(w) === key)
  return !!current && unchanged(state, active, current, key)
}

/** The saved record the editor is open on, as history holds it now — or null (none open, or it
 *  was deleted meanwhile). */
export function editedRecord(state) {
  const key = state?.active?.editingWorkoutId
  return key == null ? null : list(state.workouts).find(w => keyOf(w) === key) || null
}

/** Refresh derived references after ordinary history deletion or editor deletion. */
export function reconcileSessionHistory(state) {
  reconcileDerivedOneRms(state)
  const tracks = new Set([...Object.keys(state.progression || {}), ...list(state.workouts).flatMap(w => list(w.exposures).map(x => x.trackId).filter(Boolean))])
  state.progression ||= {}
  for (const trackId of tracks) {
    const next = replayProgression({ workouts: state.workouts, trackId, prescriptions: state.prescriptions })
    if (next) state.progression[trackId] = next
    else delete state.progression[trackId]
  }
}

/**
 * Deletes the workout the editor is open on and closes the editor: what an edit that took out
 * every set gets instead of Save (editLeftEmpty). The record is found the way Save finds it, and
 * goes the way History's Delete takes it out; a kept working weight that came from it is lowered
 * the way Save lowers one an edit took away. A record another device deleted meanwhile is already
 * gone, and the editor just closes. Returns whether a record was removed.
 */
export function deleteEditedWorkout(state) {
  const current = editedRecord(state)
  state.active = null
  if (!current) return false
  state.workouts = state.workouts.filter(w => w !== current)
  reconcileSessionHistory(state)
  lowerKeptWeights(state, [...new Set(list(current.exposures).map(x => x?.exerciseId).filter(id => id != null))], current, null)
  return true
}
