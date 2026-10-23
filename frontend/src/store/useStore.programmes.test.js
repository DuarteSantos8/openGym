// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { DEF, hasData, normalizeState, restoredStateFor } from './useStore.js'

const classic = { routines: [{ id: 'r1' }], workouts: [], bodyweight: [], mystery: { keep: true } }

describe('Programme state compatibility', () => {
  it.each([
    [{}, false],
    [{ programmes: null }, false],
    [{ programmes: [] }, false],
    [{ programmes: { definitions: 'bad', cycles: null } }, false],
    [{ programmes: { definitions: [{ id: 'p1' }], cycles: [] } }, true],
    [{ programmes: { definitions: [], cycles: [{ id: 'c1' }] } }, true],
    [{ programmeMode: false, programmes: { definitions: [{ id: 'p1' }], cycles: [] } }, false],
    [{ programmeMode: true }, true],
    [{ programmeMode: 'true', programmes: { definitions: [{ id: 'p1' }], cycles: [] } }, false],
  ])('normalizes mode and namespace for %o', (input, mode) => {
    const normalized = normalizeState({ ...classic, ...input })
    expect(normalized.programmeMode).toBe(mode)
    expect(normalized.programmes).toMatchObject({ version: 1 })
    expect(Array.isArray(normalized.programmes.definitions)).toBe(true)
    expect(Array.isArray(normalized.programmes.cycles)).toBe(true)
    expect(normalized.mystery).toEqual({ keep: true })
    expect(normalized.routines).toEqual(classic.routines)
  })

  it('preserves unknown Programme fields and valid recoverable entries', () => {
    const definition = { id: 'p1', future: { value: 1 } }
    const normalized = normalizeState({ programmes: { version: 9, definitions: [definition], cycles: [], futureRoot: 2 } })
    expect(normalized.programmes).toEqual({ version: 1, definitions: [definition], cycles: [], futureRoot: 2 })
  })

  it('counts Programme-only profiles as data', () => {
    expect(hasData(structuredClone(DEF))).toBe(false)
    expect(hasData(normalizeState({ programmes: { definitions: [{ id: 'p1' }], cycles: [] } }))).toBe(true)
    expect(hasData(normalizeState({ programmes: { definitions: [], cycles: [{ id: 'c1' }] } }))).toBe(true)
  })

  it('normalizes remote state while carrying the exact local active workout', () => {
    const active = { id: 'active', entries: [{ id: 'x' }] }
    const restored = restoredStateFor({ ...normalizeState({}), active }, {
      _ts: 10, programmes: { definitions: [{ id: 'p1', unknown: true }], cycles: [] }
    })
    expect(restored.active).toBe(active)
    expect(restored.programmes.definitions[0]).toMatchObject({ id: 'p1', unknown: true })
    expect(restored.programmeMode).toBe(true)
  })

  it('retains opaque legacy Programme list entries and counts them as data', () => {
    const legacy = [
      {
        id: 'legacy-programme',
        title: 'Legacy block',
        weeks: [{ days: [{ weekday: 1, sessions: [{
          routineId: 'push',
          routineSnapshot: { id: 'push', ex: [], groupMeta: { kind: 'paired', cue: 'alternate' }, futureRoutineField: 'keep' },
        }] }] }],
        future: { owner: 'live', revision: 7 },
      },
    ]
    const normalized = normalizeState({
      programmes: legacy,
      programmeDispositions: { 'legacy-programme': { disposition: 'owed' } },
    })

    expect(normalized.programmes).toMatchObject({
      version: 1,
      definitions: [],
      cycles: [],
      legacyEntries: legacy,
    })
    expect(normalized.programmes.legacyEntries).toEqual(legacy)
    expect(normalized.programmeDispositions).toEqual({ 'legacy-programme': { disposition: 'owed' } })
    expect(hasData(normalized)).toBe(true)
    expect(normalized.programmeMode).toBe(false)

    const restored = restoredStateFor(normalizeState({}), { _ts: 20, programmes: legacy })
    expect(restored.programmes.legacyEntries).toEqual(legacy)
  })

  it('round-trips namespace metadata and workout lifecycle identity without projection', () => {
    const programmes = {
      version: 9,
      definitions: [{ id: 'p1', futureDefinition: { keep: true } }],
      cycles: [{ id: 'c1', futureCycle: { keep: true } }],
      skippedInstanceIds: ['c1:session-2'],
      timeZone: 'Europe/Berlin',
      futureNamespace: { preserve: ['exactly'] },
    }
    const programmeDispositions = {
      'c1:session-1': { disposition: 'partial', owed: true, exitIntent: 'resume' },
    }
    const workout = {
      id: 'w1',
      entries: [{ id: 'push', groupMeta: { kind: 'paired', cue: 'alternate' }, sg: 'A' }],
      programmeInstance: { instanceId: 'c1:session-1', cycleId: 'c1', sessionId: 'session-1' },
      programmeSession: { sessionId: 'session-1', routineId: 'push' },
      programmeStep: { stepId: 'step-1', index: 2 },
      cycleId: 'c1',
      sessionId: 'session-1',
      instanceId: 'c1:session-1',
      partial: true,
      partialVersion: 3,
      partialExitBaseline: { completedSets: 2 },
      complete: false,
      completion: { at: null, sets: 2 },
      disposition: 'partial',
      owed: true,
      exitIntent: 'resume',
    }
    const source = { programmes, programmeDispositions, workouts: [workout] }
    const normalized = normalizeState(source)
    const restored = normalizeState(JSON.parse(JSON.stringify(normalized)))

    expect(restored.programmes).toEqual({ ...programmes, version: 1 })
    expect(restored.programmeDispositions).toEqual(programmeDispositions)
    expect(restored.workouts).toEqual([workout])
  })
})
