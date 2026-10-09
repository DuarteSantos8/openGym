import { describe, expect, it } from 'vitest'
import { normalizeProgrammeNamespace } from './programme-compat.js'

describe('legacy Programme cycle metadata', () => {
  it.each(['active', 'completed'])('recovers %s cycle labels from its snapshot without changing history', status => {
    const source = {
      definitions: [{ id: 'p1', name: 'Renamed template', emoji: 'run', colour: 'pink', progression: 'linear' }],
      cycles: [{
        id: 'c1', programmeId: 'p1', status, programmeRevision: 3,
        programmeSnapshot: { name: 'Original block', emoji: 'dumbbell', colour: 'sky', progression: 'double' },
        snapshot: { weeks: [{ days: [{ weekday: 2, sessions: [{ instanceId: 'pi:original', routineSnapshot: { ex: [] } }] }] }] },
        completion: { workoutIds: ['w1'], at: '2026-08-01' },
      }],
    }
    const before = structuredClone(source)
    const normalized = normalizeProgrammeNamespace(source)
    expect(normalized.cycles[0]).toEqual({
      ...source.cycles[0], name: 'Original block', emoji: 'dumbbell', colour: 'sky', progression: 'double',
    })
    expect(source).toEqual(before)
    expect(normalizeProgrammeNamespace(normalized).cycles[0]).toBe(normalized.cycles[0])
  })

  it('fills only missing values and falls back to a matching definition when no snapshot has them', () => {
    const existing = { id: 'c1', programmeId: 'p1', name: 'Edited cycle', emoji: '', colour: 'gold', progression: 'off' }
    const source = {
      definitions: [{ id: 'p1', name: 'Template', emoji: 'run', colour: 'pink', progression: 'linear' }],
      cycles: [existing, { id: 'c2', programmeId: 'p1', snapshot: { name: 'Saved name' } }, { id: 'orphan' }],
    }
    const normalized = normalizeProgrammeNamespace(source)
    expect(normalized.cycles[0]).toBe(existing)
    expect(normalized.cycles[1]).toMatchObject({ name: 'Saved name', emoji: 'run', colour: 'pink', progression: 'linear' })
    expect(normalized.cycles[2]).toEqual({ id: 'orphan' })
  })
})
