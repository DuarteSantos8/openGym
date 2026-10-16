import { describe, expect, it } from 'vitest'
import { buildProgrammeBundle, mergeProgramme, parseProgramme } from './programme-share.js'
import { startProgrammeCycleInState } from './programmes.js'

const clone = value => structuredClone(value)
const custom = { id: 'custom-old', n: 'Cable turn', bp: 'back', desc: 'Controlled', eq: 'cable', custom: true }
const snapshot = (name, weight, reps) => ({
  id: 'same-old-routine', name, prog: 'linear', excludeFromProgression: true, programmeProgression: 'linear',
  ex: [{ id: 'custom-old', sets: 3, reps, weight, inc: 2.5, note: `${name} cue`, notes: `${name} programme note`, workRestSec: 135, rir: 2 }],
})
const definition = () => ({
  id: 'source-programme', name: 'Shared block', emoji: '🏋️', progression: 'linear', colour: 'sky',
  createdAt: '2020-01-01T00:00:00Z', updatedAt: '2020-01-02T00:00:00Z', owner: 'private account',
  weeks: [
    { weekIndex: 1, mode: 'deload', days: [{ weekday: 2, sessions: [
      { id: 'source-occ-2', sessionTemplateId: 'source-template-2', routineId: 'same-old-routine', routineSnapshot: snapshot('Second authored', 100, 6) },
      { id: 'source-occ-1', sessionTemplateId: 'source-template-1', routineId: 'same-old-routine', routineSnapshot: snapshot('First authored', 80, 8) },
    ] }] },
    { weekIndex: 2, mode: 'rest', days: [{ weekday: 4, sessions: [
      { id: 'source-occ-3', sessionTemplateId: 'source-template-3', routineId: 'same-old-routine', routineSnapshot: snapshot('First authored', 80, 8) },
    ] }] },
  ],
})
const recipient = () => ({
  unit: 'lb', weekStart: 0, week: { 1: ['existing-routine'] },
  routines: [{ id: 'existing-routine', name: 'Mine', ex: [{ id: '0025', sets: 1, reps: 1 }] }],
  customEx: [], workouts: [{ id: 'history' }], settingsMarker: { private: true },
  programmes: { version: 1, definitions: [{ id: 'existing-programme', name: 'Mine', weeks: [] }], cycles: [{ id: 'existing-cycle', status: 'active' }] },
})

function bundle() {
  return buildProgrammeBundle(definition(), { customEx: [{ ...custom, media: { kind: 'image', hash: 'secret' } }], unit: 'kg', now: '2026-10-08T12:00:00Z' })
}

describe('Programme file sharing', () => {
  it('exports only a reusable definition and its sanitized frozen routine snapshots', () => {
    const out = bundle()
    expect(out).toMatchObject({ opengym_programme: 1, exported: '2026-10-08', unit: 'kg' })
    expect(out.programme.weeks.map(week => week.mode)).toEqual(['deload', 'rest'])
    expect(out.programme.weeks[0].days[0].sessions.map(session => session.routineRef)).toEqual(['programme-routine-1', 'programme-routine-2'])
    expect(out.programme.weeks[1].days[0].sessions[0].routineRef).toBe('programme-routine-2')
    expect(out.programme.weeks[0].days[0].sessions[0].prescription).toEqual([{ notes: 'Second authored programme note', workRestSec: 135, rir: 2 }])
    expect(out.plan.routines.map(routine => routine.name)).toEqual(['Second authored', 'First authored'])
    expect(out.plan.customEx).toEqual([expect.objectContaining({ id: 'custom-old', n: 'Cable turn', desc: 'Controlled' })])
    const json = JSON.stringify(out)
    for (const secret of ['source-programme', 'source-occ-', 'source-template-', 'private account', 'createdAt', 'updatedAt', 'workouts', 'cycles', 'media', 'secret', 'programmeProgression', 'excludeFromProgression']) {
      expect(json).not.toContain(secret)
    }
  })

  it('imports in recipient units with fresh identities and preserves authored same-day order', () => {
    const source = recipient(); const before = clone(source)
    const parsed = parseProgramme(JSON.stringify(bundle()))
    const result = mergeProgramme(source, parsed)
    expect(source).toEqual(before)
    expect(result.counts).toEqual({ routines: 2, customExercises: 1, programmes: 1 })
    expect(result.state.week).toEqual(before.week)
    expect(result.state.workouts).toEqual(before.workouts)
    expect(result.state.settingsMarker).toEqual(before.settingsMarker)
    expect(result.state.programmes.cycles).toEqual(before.programmes.cycles)
    const imported = result.state.programmes.definitions.find(item => item.id === result.programmeId)
    expect(imported.id).not.toBe('source-programme')
    const sessions = imported.weeks[0].days[0].sessions
    expect(sessions.map(session => session.routineSnapshot.name)).toEqual(['Second authored', 'First authored'])
    expect(new Set(sessions.map(session => session.routineId)).size).toBe(2)
    expect(sessions[0]).toMatchObject({ routineSnapshot: { excludeFromProgression: true, ex: [{ id: result.state.customEx[0].id, weight: 220.5, inc: 5.5, notes: 'Second authored programme note', workRestSec: 135, rir: 2 }] } })
    expect(result.state.routines.find(item => item.id === sessions[0].routineId).ex[0]).toMatchObject({ notes: 'Second authored programme note', workRestSec: 135, rir: 2 })
    expect(result.state.routines.find(item => item.id === sessions[0].routineId).excludeFromProgression).toBeUndefined()
    expect(sessions[0].id).not.toBe('source-occ-2')
    expect(sessions[0].sessionTemplateId).not.toBe('source-template-2')
  })

  it('can import the same file twice without identity collision or overwriting existing data', () => {
    const parsed = parseProgramme(bundle())
    const first = mergeProgramme(recipient(), parsed)
    const second = mergeProgramme(first.state, parsed)
    expect(second.state.programmes.definitions).toHaveLength(3)
    expect(second.programmeId).not.toBe(first.programmeId)
    const firstDef = second.state.programmes.definitions.find(item => item.id === first.programmeId)
    const secondDef = second.state.programmes.definitions.find(item => item.id === second.programmeId)
    const ids = value => value.weeks.flatMap(week => week.days.flatMap(day => day.sessions.flatMap(session => [session.id, session.sessionTemplateId, session.routineId])))
    expect(new Set(ids(firstDef).filter(id => ids(secondDef).includes(id))).size).toBe(0)
    expect(second.state.programmes.cycles).toEqual(recipient().programmes.cycles)
    expect(second.state.routines[0].id).toBe('existing-routine')
  })

  it('rejects malformed payloads before touching recipient state', () => {
    const valid = bundle()
    const invalid = [
      { ...valid, opengym_programme: 2 },
      { ...valid, account: 'someone' },
      { ...valid, programme: { ...valid.programme, weeks: [] } },
      { ...valid, programme: { ...valid.programme, progression: 'made-up' } },
      { ...valid, programme: { ...valid.programme, weeks: Array.from({ length: 53 }, () => ({ mode: 'normal', days: [] })) } },
      { ...valid, programme: { ...valid.programme, weeks: [{ mode: 'normal', days: [{ weekday: 7, sessions: [] }] }] } },
      { ...valid, programme: { ...valid.programme, weeks: [{ mode: 'normal', days: [{ weekday: 1, sessions: [{ routineRef: 'missing' }] }] }] } },
      { ...valid, plan: { ...valid.plan, week: { 1: ['programme-routine-1'] } } },
      { ...valid, exported: '2026-02-31' },
      { ...valid, programme: { ...valid.programme, weeks: [{ mode: 'normal', days: [{ weekday: 1, sessions: [{ ...valid.programme.weeks[0].days[0].sessions[0], prescription: [{ rir: 11 }] }] }] }] } },
    ]
    const state = recipient(); const before = clone(state)
    let refusal
    try { parseProgramme(invalid[0]) } catch (error) { refusal = error }
    expect(refusal?.code).toBe('not-programme')
    for (const bad of invalid) {
      expect(() => mergeProgramme(state, bad)).toThrow(/Invalid openGym Programme file/)
      expect(state).toEqual(before)
    }
    expect(() => buildProgrammeBundle({ ...definition(), weeks: [{ days: [{ weekday: 1, sessions: [{ routineId: 'missing' }] }] }] }, { unit: 'kg' })).toThrow(/routine snapshot/)
    expect(() => buildProgrammeBundle({ ...definition(), weeks: [{ mode: 'rest', days: definition().weeks[0].days }] }, { customEx: [custom], unit: 'kg' })).toThrow(/no scheduled sessions/)
    const invalidPrescription = definition(); invalidPrescription.weeks[0].days[0].sessions[0].routineSnapshot.ex[0].rir = 12
    expect(() => buildProgrammeBundle(invalidPrescription, { customEx: [custom], unit: 'kg' })).toThrow(/RIR is invalid/)
  })

  it('starts an imported definition on the recipient’s own date and week convention', () => {
    const imported = mergeProgramme(recipient(), parseProgramme(bundle()))
    const cycle = startProgrammeCycleInState(imported.state, imported.programmeId, {
      id: 'recipient-cycle', week1StartDate: '2027-01-03', weekStart: 0, timeZone: 'America/New_York', now: '2027-01-03T15:00:00Z',
    })
    expect(cycle).toMatchObject({ id: 'recipient-cycle', programmeId: imported.programmeId, week1StartDate: '2027-01-03', weekStart: 0, timeZone: 'America/New_York', status: 'active' })
    expect(recipient().programmes.cycles).toEqual([{ id: 'existing-cycle', status: 'active' }])
  })
})
