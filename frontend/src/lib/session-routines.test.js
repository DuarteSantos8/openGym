import { describe, expect, it } from 'vitest'
import { routineFromSession, saveSessionAsRoutine } from './session-routines.js'
import { validatePlanRule } from './prescription/index.js'

const BENCH = '0025', PLANK = '0089'
const row = (reps, load, role = 'work') => ({
  role, status: 'completed', observations: [{ metric: 'repetitions', value: reps }],
  resistance: load == null ? { kind: 'bodyweight' } : { kind: 'external-load', value: load, unit: 'kg' },
})
const exposure = (over = {}) => ({ exposureId: 'x1', occurrenceId: 'occ1', routineId: 'src', exerciseId: BENCH, mode: 'reps', performance: { sets: [row(5, 40, 'warmup'), row(8, 60), row(7, 62.5)] }, ...over })

describe('routineFromSession', () => {
  it('shapes a valid rule from what was done: work sets only, first work row\'s reps, heaviest load', () => {
    const routine = routineFromSession({ name: 'Evening push', exposures: [exposure()] })
    expect(routine.name).toBe('Evening push')
    const [occ] = routine.ex
    expect(occ).toMatchObject({ exerciseId: BENCH })
    expect(occ.rule).toMatchObject({ id: occ.occurrenceId, exerciseId: BENCH, routineId: routine.id })
    expect(occ.rule.parameters).toMatchObject({ sets: { min: 2, max: 2 }, reps: { min: 8, max: 8 }, load: { mode: 'absolute', value: 62.5 } })
    expect(validatePlanRule(occ.rule).ok).toBe(true)
  })

  it('copies the plan the session followed when its routine still has it, under fresh ids', () => {
    const source = { id: 'src', ex: [{ occurrenceId: 'occ1', exerciseId: BENCH, note: 'pause', rule: { id: 'occ1', revision: 4, routineId: 'src', exerciseId: BENCH, preset: 'double', parameters: {} } }] }
    const routine = routineFromSession({ name: 'Copy', exposures: [exposure()] }, 'Copy', [source])
    const [occ] = routine.ex
    expect(occ.note).toBe('pause')
    expect(occ.rule).toMatchObject({ preset: 'double', revision: 1, routineId: routine.id })
    expect(occ.occurrenceId).not.toBe('occ1')
    expect(occ.rule.id).toBe(occ.occurrenceId)
  })

  it('leaves out an exercise with no completed work, keeps superset pairs together, and rejects an empty session', () => {
    const paired = [exposure({ sg: 'g' }), exposure({ exposureId: 'x2', exerciseId: PLANK, sg: 'g', mode: 'time', performance: { sets: [{ role: 'work', status: 'completed', observations: [{ metric: 'duration', value: 40 }], resistance: { kind: 'bodyweight' } }] } }), exposure({ exposureId: 'x3', performance: { sets: [] } })]
    const routine = routineFromSession({ name: 'Pair', exposures: paired })
    expect(routine.ex).toHaveLength(2)
    expect(routine.ex[0].sg).toBe(routine.ex[1].sg)
    expect(routine.ex[0].sg).not.toBe('g')
    expect(() => routineFromSession({ name: 'Empty', exposures: [] })).toThrow('no exercises')
  })
})

describe('saveSessionAsRoutine', () => {
  it('adds an independent routine without touching the saved workout', () => {
    const session = { id: 'w', name: 'Push', exposures: [exposure()] }
    const before = structuredClone(session)
    const state = { routines: [] }
    const id = saveSessionAsRoutine(state, session)
    expect(state.routines).toHaveLength(1)
    expect(state.routines[0].id).toBe(id)
    expect(session).toEqual(before)
  })
})
