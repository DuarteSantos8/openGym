import { describe, expect, it, vi } from 'vitest'
import { WARMUP_MOVEMENTS, normalizeWarmup } from '../../../api/training/guided-warmup.js'
import { EXIDX } from './exercises.js'
import { ACC_V, exAvailable } from './equipment.js'
import * as equipment from './equipment.js'
import { suggestWarmup, warmupProposal } from './warmup-suggestions.js'

const definitions = steps => steps.map(step => WARMUP_MOVEMENTS.find(movement => movement.id === step.id))
const coverage = steps => new Set(definitions(steps).flatMap(movement => movement.coverage))

describe('muscle-based warm-up suggestions', () => {
  it('prepares upper-body pressing without adding lower-body-only movements', () => {
    const steps = suggestWarmup({}, [{ id: '0025', sets: 3 }])
    expect(steps.length).toBeGreaterThan(0)
    expect(steps.length).toBeLessThan(5)
    expect(coverage(steps).has('chest')).toBe(true)
    expect(coverage(steps).has('deltoids')).toBe(true)
    expect(definitions(steps).every(movement => movement.coverage.some(muscle => ['chest', 'triceps', 'deltoids'].includes(muscle)))).toBe(true)
  })

  it('prepares the hips and ankles of a lower-body session', () => {
    const steps = suggestWarmup({}, [{ id: '0043' }])
    expect(coverage(steps).has('quadriceps')).toBe(true)
    expect(coverage(steps).has('gluteal')).toBe(true)
    expect(coverage(steps).has('hip-flexors')).toBe(true)
    expect(definitions(steps).some(movement => movement.family === 'ankles')).toBe(true)
    expect(steps.length).toBeLessThanOrEqual(5)
  })

  it('covers a combined session without repeating movement families', () => {
    const steps = suggestWarmup({}, [{ id: '0025' }, { id: '0043' }, { id: '0293' }])
    const movements = definitions(steps)
    expect(coverage(steps).has('chest')).toBe(true)
    expect(coverage(steps).has('quadriceps')).toBe(true)
    expect(coverage(steps).has('upper-back')).toBe(true)
    expect(new Set(movements.map(movement => movement.family)).size).toBe(steps.length)
    expect(normalizeWarmup({ enabled: true, steps }).steps).toEqual(steps)
    expect(steps.length).toBeLessThanOrEqual(5)
  })

  it('is stable across duplicate entries, set counts and exercise order', () => {
    const expected = suggestWarmup({}, [{ id: '0025' }, { id: '0043' }])
    expect(suggestWarmup({}, [{ id: '0043', sets: 100 }, { id: '0025' }, { id: '0025' }])).toEqual(expected)
    expect(suggestWarmup({}, ['0025', '0043'])).toEqual(expected)
  })

  it('does not invent a prescription when nothing has known targets', () => {
    for (const exercises of [undefined, null, [], [null], [{ id: 'missing' }], [{ id: 'missing', muscleWeights: { chest: 0 } }]]) {
      expect(suggestWarmup({}, exercises)).toEqual([])
    }
  })

  it('uses custom muscle metadata and existing body-part fallback', () => {
    const state = { customEx: [{ id: 'custom-press', primaries: ['chest'], secondaries: ['triceps'] }, { id: 'custom-legs', bp: 'upper legs' }] }
    expect(coverage(suggestWarmup(state, [{ id: 'custom-press' }])).has('chest')).toBe(true)
    expect(coverage(suggestWarmup(state, [{ id: 'custom-legs' }])).has('quadriceps')).toBe(true)
    expect(coverage(suggestWarmup({}, [{ id: 'imported', bp: 'shoulders' }])).has('deltoids')).toBe(true)
  })

  it('respects an active profile with no equipment by offering only available movements', () => {
    const state = { equipFilterOn: true, activeEquipId: 'home', equipProfiles: [{ id: 'home', equipment: [], accV: ACC_V }] }
    const steps = suggestWarmup(state, [{ id: '0025' }, { id: '0043' }])
    expect(steps.length).toBeGreaterThan(0)
    expect(steps.every(step => exAvailable(state, EXIDX[step.id]))).toBe(true)
    expect(steps.every(step => EXIDX[step.id].eq === 'body weight')).toBe(true)
  })

  it('leaves caller state and manual steps untouched and returns fresh defaults', () => {
    const state = { customEx: [], routines: [{ warmup: { enabled: true, steps: [{ id: '3094', mode: 'time', sec: 60 }] } }] }
    const exercises = [{ id: '0025', sets: 3 }]
    const beforeState = structuredClone(state), beforeExercises = structuredClone(exercises)
    const first = suggestWarmup(state, exercises)
    first[0].sec = 100
    expect(suggestWarmup(state, exercises)[0].sec).toBe(30)
    expect(state).toEqual(beforeState)
    expect(exercises).toEqual(beforeExercises)
  })

  it('returns canonical target context from the same custom metadata used for selection', () => {
    const state = { customEx: [{ id: 'custom', primaries: ['delts', 'pectorals'], secondaries: ['triceps'] }] }
    const proposal = warmupProposal(state, [{ id: 'custom' }])
    expect(proposal.targetMuscles).toEqual(['deltoids', 'chest', 'triceps'])
    expect(proposal.steps).toEqual(suggestWarmup(state, [{ id: 'custom' }]))
    const changed = { customEx: [{ id: 'custom', primaries: ['calves'] }] }
    expect(warmupProposal(changed, [{ id: 'custom' }]).snapshot).not.toBe(proposal.snapshot)
  })

  it('ignores unrelated custom edits and equivalent equipment profiles in proposal snapshots', () => {
    const exercises = [{ id: '0025' }]
    const original = warmupProposal({}, exercises)
    const changed = warmupProposal({
      customEx: [{ id: 'unused', primaries: ['calves'] }], equipFilterOn: true,
      activeEquipId: 'home', equipProfiles: [{ id: 'home', name: 'Renamed home', equipment: [], accV: ACC_V }],
    }, exercises)
    expect(changed.snapshot).toBe(original.snapshot)
  })

  it('invalidates a proposal when changed equipment availability changes its movements', () => {
    // Current candidates are bodyweight; keep the guard valid if a reviewed candidate
    // later needs equipment without altering the licensed catalogue in this test.
    const available = vi.spyOn(equipment, 'exAvailable').mockImplementation((state, ex) =>
      !(state.activeEquipId === 'restricted' && ex.id === '3905'))
    try {
      const before = warmupProposal({}, [{ id: '0025' }])
      const after = warmupProposal({ activeEquipId: 'restricted' }, [{ id: '0025' }])
      expect(after.steps).not.toEqual(before.steps)
      expect(after.snapshot).not.toBe(before.snapshot)
    } finally { available.mockRestore() }
  })
})
