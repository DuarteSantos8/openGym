import { describe, expect, it } from 'vitest'
import { editCompletedSession, saveWorkoutEdit, editLeftEmpty, deleteEditedWorkout, editChangesNothing } from './session-edit.js'
import { mergeStates } from './sync-merge.js'
import { lastEntryFor } from './history.js'
import { exposuresWithPerformance, rowsOfPerformance } from './session-ui-adapter.js'
import { buildSessionExposures } from './session-start.js'
import { buildCompletedSession } from './finish-session.js'
import { makeSideSet, toggleSide } from './workout-model.js'
import { ruleOccurrence } from './test-fixtures.js'
import { migrateProfileV1ToV2 } from '../../../api/migration/profile-migration.js'
import { LIB_BY_ID } from '../../../api/coach/core/library.js'

let n = 0
// One saved exposure of `id`, written by the live finish's own writer from these rows.
const exposure = (w, id = '0025', more = {}, sets = [{ w, r: 5, done: true }]) => {
  const exposureId = more.exposureId || 'x' + ++n
  return exposuresWithPerformance([{ exposureId, exerciseId: id, ...more }], [{ exposureId, target: { mode: 'reps' }, sets }], 'kg')[0]
}
const fixture = () => ({
  active: null,
  unit: 'kg',
  exWeights: {},
  routines: [{ id: 'routine', ex: [] }],
  workouts: [{ id: 'workout', d: '2026-09-01', start: 1000, end: 2000, exposures: [exposure(40)], note: 'old', prs: ['0025'] }],
})
// A saved exposure's rows, the way the workout screen edits them.
const rows = (w, i = 0) => rowsOfPerformance(w.exposures[i].performance.sets, w.exposures[i].mode)

describe('saved workout editing', () => {
  it('A4: saving a reordered migrated draft replaces history and replays its track', () => {
    const bench = { id: '0025', rid: 'r', target: { sets: 1, reps: 5, weight: 60 }, sets: [{ w: 60, r: 5, done: true }] }
    const workout = { id: 'w', d: '2026-01-05', start: 1, end: 2, routineIds: ['r'], entries: [bench] }
    const { profile, activeSession } = migrateProfileV1ToV2({ unit: 'kg', routines: [{ id: 'r', ex: [{ id: '0025', sets: 1, reps: 5, weight: 60 }] }], workouts: [workout],
      active: { ...workout, editingWorkoutId: 'w', entries: [
        { id: '0001', target: { sets: 1, reps: 10 }, sets: [{ r: 10, done: true }] },
        { ...bench, sets: [{ w: 60, r: 2, done: true }] }
      ] } }, LIB_BY_ID)
    profile.active = activeSession
    const saved = saveWorkoutEdit(profile, 3)
    expect(saved.exposures.map(x => x.exerciseId)).toEqual(['0001', '0025'])
    expect(profile.progression['r:o0'].readyToIncrement).toBe(false)
    expect(profile.progression['r:o0'].lastCompletedLogId).toBe(saved.exposures[1].exposureId)
    expect(profile.active).toBeNull()
  })
  it('keeps history unchanged until Save, survives reload and preserves its identity, clock and templates', () => {
    const state = fixture(), history = structuredClone(state.workouts), routines = structuredClone(state.routines)
    editCompletedSession(state, 'workout')
    state.active.entries[0].sets[0].w = 80
    state.active.note = ''
    expect(state.workouts).toEqual(history)
    const reloaded = JSON.parse(JSON.stringify(state))
    const saved = saveWorkoutEdit(reloaded)
    expect(saved).toMatchObject({ id: 'workout', d: '2026-09-01', start: 1000, end: 2000, vol: 400 })
    expect(saved).not.toHaveProperty('note')
    expect(saved).not.toHaveProperty('editingWorkoutId')
    expect(reloaded.active).toBeNull()
    expect(reloaded.routines).toEqual(routines)
  })

  it('saves added exercises and sets without persisting a live prescription', () => {
    const state = fixture()
    editCompletedSession(state, 'workout')
    state.active.entries[0].sets.push({ w: 42.5, r: 4, done: true })
    state.active.exposures.push({ exposureId: 'added-x', exerciseId: 'added', routineId: 'routine', performance: { sets: [] } })
    state.active.entries.push({ id: 'added', exposureId: 'added-x', rid: 'routine', plan: { kind: 'up' }, target: { mode: 'reps' }, sets: [{ w: 25, r: 5, done: true }] })
    const saved = saveWorkoutEdit(state)
    expect(rows(saved)).toHaveLength(2)
    expect(saved.exposures[1]).toMatchObject({ exerciseId: 'added', routineId: 'routine' })
    expect(JSON.stringify(saved)).not.toMatch(/"plan"/)
  })

  it('rebuilds best weights and PR flags after lowering record work', () => {
    const state = fixture()
    state.workouts.push({ id: 'later', d: '2026-09-02', start: 3000, end: 4000, exposures: [exposure(30)], prs: [] })
    state.exWeights['0025'] = { w: 40, d: '2026-09-01' }
    editCompletedSession(state, 'workout')
    state.active.entries[0].sets[0].w = 20
    saveWorkoutEdit(state)
    // The kept 40 came from this very session, and the edit took it away.
    expect(state.exWeights['0025']).toEqual({ w: 30, d: '2026-09-02' })
    // Still the first 20 ever. The later 30 never had a badge, and a session that was not
    // edited is never handed one (the rule a date move follows too, lib/workout-date.js).
    expect(state.workouts[0].prs).toEqual(['0025'])
    expect(state.workouts[1].prs).toEqual([])
  })

  it('takes a badge from a later session the edit raised the bar above, and leaves a kept load from elsewhere', () => {
    const state = fixture()
    state.workouts[0].prs = []
    state.workouts.push({ id: 'later', d: '2026-09-02', start: 3000, end: 4000, exposures: [exposure(50)], prs: ['0025'] })
    state.exWeights['0025'] = { w: 55, d: '2026-09-03' }   // confirmed in the top-weight sheet
    editCompletedSession(state, 'workout')
    state.active.entries[0].sets[0].w = 60
    saveWorkoutEdit(state)
    expect(state.workouts.map(w => w.prs)).toEqual([['0025'], []])
    expect(state.exWeights['0025']).toEqual({ w: 55, d: '2026-09-03' })
  })

  it('keeps assisted-machine records ordered by less help after an edit', () => {
    const state = fixture()
    state.workouts[0].exposures = [exposure(30, '0017')]
    state.workouts[0].prs = ['0017']
    state.workouts.push({ id: 'later', d: '2026-09-02', start: 3000, end: 4000, exposures: [exposure(25, '0017')], prs: ['0017'] })
    state.exWeights['0017'] = { w: 25, d: '2026-09-02' }
    editCompletedSession(state, 'workout')
    state.active.entries[0].sets[0].w = 20
    saveWorkoutEdit(state)
    // 20 kg of help is less than the later 25: the edited session leads and the later one no
    // longer does. Less help is a better kept load, so there is nothing to lower.
    expect(state.workouts.map(w => w.prs)).toEqual([['0017'], []])
    expect(state.exWeights['0017']).toEqual({ w: 25, d: '2026-09-02' })
  })

  it('preserves repeated occurrences, combined-routine ownership and per-side fields', () => {
    const state = fixture(), workout = state.workouts[0]
    const sided = toggleSide(toggleSide(makeSideSet({ w: 12, r: 8 }), 'L'), 'R')
    workout.routineIds = ['a', 'b']
    workout.exposures = [
      exposure(40, '0025', { routineId: 'a', occurrenceId: 'first', opaque: { retained: true } }),
      exposure(20, '0025', { routineId: 'b', occurrenceId: 'second' }, [sided]),
    ]
    editCompletedSession(state, 'workout')
    state.active.entries[1].sets[0].sides.L.w = 14
    const saved = saveWorkoutEdit(state)
    expect(saved.exposures.map(x => [x.occurrenceId, x.routineId])).toEqual([['first', 'a'], ['second', 'b']])
    expect(saved.exposures[0].opaque).toEqual({ retained: true })
    expect(rows(saved, 1)[0].sides.L.w).toBe(14)
  })

  it('keeps a partially completed per-side occurrence and its opaque ownership', () => {
    const state = fixture()
    const half = toggleSide({ ...makeSideSet({ w: 20, r: 8 }), sides: { L: { w: 20, r: 4, done: false }, R: { w: 17.5, r: 4, done: false } } }, 'L')
    state.workouts[0].exposures = [exposure(20, '0025', { routineId: 'routine', occurrenceId: 'partial' }, [half])]
    editCompletedSession(state, 'workout')
    state.active.note = 'edited'
    const saved = saveWorkoutEdit(state)
    expect(saved.exposures[0]).toMatchObject({ routineId: 'routine', occurrenceId: 'partial' })
    expect(rows(saved)[0].sides).toEqual({ L: { w: 20, r: 4, done: true }, R: { w: 17.5, r: 4, done: false } })
    expect(saved.vol).toBe(80)
  })

  it('keeps the draft when the workout was deleted meanwhile', () => {
    const deleted = fixture()
    editCompletedSession(deleted, 'workout')
    deleted.active.entries[0].sets[0].w = 50
    deleted.workouts = []
    expect(() => saveWorkoutEdit(deleted)).toThrow('deleted on another device')
    expect(deleted.active.editingWorkoutId).toBe('workout')
    expect(deleted.active.entries[0].sets[0].w).toBe(50)
    expect(deleted.workouts).toEqual([])
  })

  // Another device moved the workout or corrected its note while this one edited its sets. What
  // the editor does not edit stays as the other device left it; the sets are the editor's.
  it('saves over the record as history holds it now, keeping what the editor does not edit', () => {
    const state = fixture()
    editCompletedSession(state, 'workout')
    state.active.entries[0].sets[0].w = 50
    Object.assign(state.workouts[0], { d: '2026-08-20', start: 500, end: 1500, note: 'from phone' })
    const saved = saveWorkoutEdit(state)
    expect(saved).toMatchObject({ id: 'workout', d: '2026-08-20', start: 500, end: 1500, note: 'from phone' })
    expect(rows(saved)[0].w).toBe(50)
    expect(saved).not.toHaveProperty('editBase')
  })

  // The note typed in WorkoutDetail after a reload that did not land on the editor, or one a sync
  // brought in: a Save that only changed a weight neither writes the opened note back nor deletes
  // the new one. A note or name the editor changed itself is still the editor's.
  it('keeps a note written or renamed elsewhere while the editor was open, unless the editor changed it', () => {
    const added = fixture()
    delete added.workouts[0].note
    editCompletedSession(added, 'workout')
    added.active.entries[0].sets[0].w = 50
    added.workouts[0].note = 'knee felt off'
    added.workouts[0].name = 'Legs'
    expect(saveWorkoutEdit(added)).toMatchObject({ note: 'knee felt off', name: 'Legs' })

    const changed = fixture()
    editCompletedSession(changed, 'workout')
    changed.active.entries[0].sets[0].w = 50
    changed.workouts[0].note = 'knee felt off'
    expect(saveWorkoutEdit(changed).note).toBe('knee felt off')

    const cleared = fixture()
    editCompletedSession(cleared, 'workout')
    cleared.workouts[0].note = 'knee felt off'
    delete cleared.active.note
    cleared.active.name = 'Heavy day'
    const saved = saveWorkoutEdit(cleared)
    expect(saved).not.toHaveProperty('note')
    expect(saved.name).toBe('Heavy day')

    const removedElsewhere = fixture()
    editCompletedSession(removedElsewhere, 'workout')
    removedElsewhere.active.entries[0].sets[0].w = 50
    delete removedElsewhere.workouts[0].note
    expect(saveWorkoutEdit(removedElsewhere)).not.toHaveProperty('note')
  })

  // The header ⋮'s "Don't count for progression" for the whole workout (lib/session-noprog.js)
  // opens on for a workout kept out as a whole, and off for one that counts. Editing it must not
  // turn it into a regular session that the next one of the exercise reads as its last time.
  it('keeps a workout kept out of progression out after an edit, with the whole-workout switch on', () => {
    const state = fixture()
    state.workouts[0].exposures = [exposure(80, '0025', { routineId: 'main' })]
    state.workouts.push({ id: 'rehab', d: '2026-09-02', start: 3000, end: 4000, exposures: [exposure(10, '0025', { routineId: 'rehab', excludedFromProgression: true })], prs: [] })
    expect(lastEntryFor(state, '0025').sets[0].w).toBe(80)
    editCompletedSession(state, 'rehab')
    expect(state.active.noProg).toBe(true)
    state.active.entries[0].sets[0].r = 6
    const saved = saveWorkoutEdit(state)
    expect(saved.exposures.every(x => x.excludedFromProgression)).toBe(true)
    expect(saved).not.toHaveProperty('noProg')
    expect(rows(saved)[0].r).toBe(6)
    expect(lastEntryFor(state, '0025').sets[0].w).toBe(80)

    editCompletedSession(state, 'workout')
    expect(state.active).not.toHaveProperty('noProg')
  })

  // A stamp outranks what another device wrote since. Opening the editor and saving without a
  // change must not give the record one, or it beats sets added on the phone that have not synced.
  it('leaves the record and its stamp alone when Save changed nothing', () => {
    const state = fixture()
    state.workouts[0] = { ...state.workouts[0], name: 'Legs', routineIds: [], vol: 200, _ts: 7 }
    const before = structuredClone(state.workouts)
    editCompletedSession(state, 'workout')
    expect(saveWorkoutEdit(state, 1234)).toEqual(before[0])
    expect(state.workouts).toEqual(before)
    expect(state.active).toBeNull()

    editCompletedSession(state, 'workout')
    state.active.entries[0].sets[0].r = 6
    expect(saveWorkoutEdit(state, 1234)._ts).toBe(1234)
  })

  it('stamps the edit, and the edit replaces the old copy by id in a merge whichever copy is newer', () => {
    const state = fixture()
    const phone = { ...structuredClone(state), _ts: 9999 }
    editCompletedSession(state, 'workout')
    state.active.entries[0].sets[0].w = 50
    const saved = saveWorkoutEdit(state, 1234)
    expect(saved._ts).toBe(1234)
    for (const merged of [mergeStates({ ...state, _ts: 1234 }, phone), mergeStates(phone, { ...state, _ts: 1234 })]) {
      expect(merged.workouts).toHaveLength(1)
      expect(rows(merged.workouts[0])[0].w).toBe(50)
    }
  })

  it('opens and saves a workout logged before ids, freezing its old key as its id', () => {
    const state = fixture()
    delete state.workouts[0].id
    const old = { d: '2026-09-02', start: 3000, end: 4000, exposures: [exposure(30)], prs: [] }
    state.workouts.push(structuredClone(old))
    editCompletedSession(state, state.workouts[1])
    expect(state.active.editingWorkoutId).toBe('2026-09-02|3000')
    state.active.entries[0].sets[0].w = 35
    const saved = saveWorkoutEdit(state)
    expect(saved).toMatchObject({ id: '2026-09-02|3000', d: '2026-09-02', start: 3000 })
    expect(state.workouts[0]).not.toHaveProperty('id')
    expect(rows(state.workouts[0])[0].w).toBe(40)
    const other = { ...fixture(), _ts: 9999, workouts: [state.workouts[0], old] }
    expect(mergeStates(other, { ...state, _ts: 1 }).workouts.map(w => rows(w)[0].w)).toEqual([40, 35])
  })

  it('keeps only the loads, not the marks the live session used, and no prescription explanation', () => {
    const state = fixture()
    editCompletedSession(state, 'workout')
    state.active.entries[0].sets[0] = { w: 45, r: 5, done: true, weightOrigin: 'manual' }
    state.active.entries[0].plan = { kind: 'hold' }
    state.active.entries[0].carried = true
    const saved = saveWorkoutEdit(state)
    expect(JSON.stringify(saved)).not.toMatch(/weightOrigin|"plan"|carried|editingWorkoutId/)
  })
})

// The engine's side of a saved workout: the summary a track moves on from, and the estimated 1RM
// its sets produced. A typo corrected in the editor takes both with it.
describe('an edit of a workout the engine counted', () => {
  const NOW = Date.parse('2026-09-01T18:00:00Z')
  function counted(weight) {
    const occ = ruleOccurrence('0025', { routineId: 'A' })
    const state = { active: null, unit: 'kg', exWeights: {}, routines: [{ id: 'A', ex: [occ] }], workouts: [], prescriptions: {}, progression: {}, oneRepMaxes: {} }
    const exposures = buildSessionExposures(state, state.routines[0], { now: NOW, newId: seed => seed })
    const p = state.prescriptions[exposures[0].prescriptionId]
    const entries = [{ exposureId: exposures[0].exposureId, id: '0025', target: { mode: 'reps' }, sets: p.rows.map((_, i) => ({ setId: 'r' + i, w: weight, r: p.prefill.reps, done: true })) }]
    const { session, oneRepMaxes, progression } = buildCompletedSession({ id: 'w', d: '2026-09-01', start: NOW, routineIds: ['A'], exposures, entries }, state, { end: NOW + 3600e3, newId: seed => seed, unit: 'kg' })
    state.workouts.push(session)
    for (const r of oneRepMaxes) state.oneRepMaxes[r.id] = r
    Object.assign(state.progression, progression)
    return { state, trackId: exposures[0].trackId }
  }

  it('moves the track on from the corrected log, and replaces the typo\'s estimated 1RM', () => {
    const { state, trackId } = counted(1000)
    expect(Object.values(state.oneRepMaxes).map(r => r.value)[0]).toBeGreaterThan(1000)
    editCompletedSession(state, 'w')
    for (const s of state.active.entries[0].sets) s.w = 100
    saveWorkoutEdit(state)
    expect(state.progression[trackId].lastActual.load.value).toBe(100)
    expect(Object.values(state.oneRepMaxes).map(r => r.value)).toEqual([expect.any(Number)])
    expect(Object.values(state.oneRepMaxes)[0].value).toBeLessThan(200)
  })

  it('leaves the track to the log before when the edit keeps the exercise out of progression', () => {
    const { state, trackId } = counted(100)
    editCompletedSession(state, 'w')
    state.active.entries[0].noProg = true
    state.active.exposures[0].excludedFromProgression = true
    saveWorkoutEdit(state)
    expect(state.progression).not.toHaveProperty(trackId)
  })
})

// An edit that unticks or removes every set would save a workout with nothing in it. The editor
// offers to delete it instead (sheets.jsx saveWorkoutEdits), and Save itself refuses.
describe('an edit that leaves no set', () => {
  it('is told apart from one with a set left, ticked sets only', () => {
    const state = fixture()
    editCompletedSession(state, 'workout')
    expect(editLeftEmpty(state.active)).toBe(false)
    state.active.entries[0].sets[0].done = false
    expect(editLeftEmpty(state.active)).toBe(true)
    state.active.entries = []
    expect(editLeftEmpty(state.active)).toBe(true)
    expect(editLeftEmpty(null)).toBe(true)
    // one side of a per-side set is a set done
    state.active.entries = [{ id: '0025', sets: [{ sides: { L: { w: 10, r: 5, done: true }, R: { w: 10, r: 5, done: false } } }] }]
    expect(editLeftEmpty(state.active)).toBe(false)
  })

  it('is never saved: Save throws and the draft stays open', () => {
    const state = fixture(), history = structuredClone(state.workouts)
    editCompletedSession(state, 'workout')
    state.active.entries = []
    expect(() => saveWorkoutEdit(state)).toThrow('Nothing logged yet')
    expect(state.workouts).toEqual(history)
    expect(state.active.editingWorkoutId).toBe('workout')
  })

  it('deletes the workout and closes the editor, leaving the other workouts alone', () => {
    const state = fixture()
    state.workouts.push({ id: 'other', d: '2026-09-02', start: 3000, end: 4000, exposures: [exposure(30)], prs: [] })
    editCompletedSession(state, 'workout')
    state.active.entries = []
    expect(deleteEditedWorkout(state)).toBe(true)
    expect(state.active).toBeNull()
    expect(state.workouts.map(w => w.id)).toEqual(['other'])
  })

  it('deletes a workout from before ids by the key the editor opened it with', () => {
    const state = fixture()
    delete state.workouts[0].id
    state.workouts.push({ d: '2026-09-02', start: 3000, end: 4000, exposures: [exposure(30)], prs: [] })
    editCompletedSession(state, state.workouts[1])
    expect(deleteEditedWorkout(state)).toBe(true)
    expect(state.workouts).toHaveLength(1)
    expect(state.workouts[0].d).toBe('2026-09-01')
  })

  it('closes the editor when another device already deleted the workout', () => {
    const state = fixture()
    editCompletedSession(state, 'workout')
    state.workouts = []
    expect(deleteEditedWorkout(state)).toBe(false)
    expect(state.active).toBeNull()
  })

  // A typed 1000 that a whole deleted workout carried is not left behind as the weight the next
  // session starts from; one confirmed elsewhere stays.
  it('lowers a kept working weight that came from the deleted workout, and only that one', () => {
    const state = fixture()
    state.workouts[0].exposures = [exposure(1000), exposure(50, '0027')]
    state.workouts.push({ id: 'earlier', d: '2026-08-20', start: 0, end: 1, exposures: [exposure(95)], prs: [] })
    state.exWeights = { '0025': { w: 1000, d: '2026-09-01' }, '0027': { w: 70, d: '2026-08-01' } }
    editCompletedSession(state, 'workout')
    state.active.entries = []
    deleteEditedWorkout(state)
    expect(state.exWeights['0025']).toEqual({ w: 95, d: '2026-08-20' })
    expect(state.exWeights['0027']).toEqual({ w: 70, d: '2026-08-01' })
  })
})

// QA 1.3.9: closing the editor asked "Save workout changes?" about a workout nobody had touched.
describe('editChangesNothing', () => {
  it('is true for a workout opened and left alone, even after a reload', () => {
    const state = fixture()
    editCompletedSession(state, 'workout')
    expect(editChangesNothing(state)).toBe(true)
    expect(editChangesNothing(JSON.parse(JSON.stringify(state)))).toBe(true)
  })
  it('is false once a set, the note or the exercises changed', () => {
    for (const change of [
      s => { s.active.entries[0].sets[0].w = 45 },
      s => { s.active.note = 'new' },
      s => { s.active.entries.push({ id: 'added', target: { mode: 'reps' }, sets: [{ w: 20, r: 5, done: true }] }) },
    ]) {
      const state = fixture()
      editCompletedSession(state, 'workout')
      change(state)
      expect(editChangesNothing(state)).toBe(false)
    }
  })
  it('is false for a draft left empty or a record deleted meanwhile, which still need a decision', () => {
    const state = fixture()
    editCompletedSession(state, 'workout')
    state.active.entries[0].sets[0].done = false
    expect(editChangesNothing(state)).toBe(false)
    const gone = fixture()
    editCompletedSession(gone, 'workout')
    gone.workouts = []
    expect(editChangesNothing(gone)).toBe(false)
    expect(editChangesNothing({ active: null, workouts: [] })).toBe(false)
  })
})
