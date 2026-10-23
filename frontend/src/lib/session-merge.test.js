import { describe, it, expect } from 'vitest'
import { buildCombinedEntries, deriveSessionName, appendSessionEntries } from './session-merge.js'
import { buildSessionEntries } from './session-start.js'
import { buildCompletedWorkout } from './finish-workout.js'
import { isWarmupRow } from './workout-model.js'

const st = {
  unit: 'kg', workouts: [], exWeights: {},
  routines: [
    { id: 'r1', name: 'Strength', prog: 'off', ex: [{ id: '0025', sets: 3, reps: 5, weight: 60 }, { id: '0031', sets: 3, reps: 8, weight: 40 }] },
    { id: 'r2', name: 'Core', prog: 'off', ex: [{ id: '0047', sets: 3, reps: 12, weight: 0 }] },
    { id: 'rehab', name: 'Rehab', excludeFromProgression: true, ex: [{ id: '0050', sets: 2, reps: 15, weight: 5 }] },
  ],
}

describe('buildCombinedEntries', () => {
  it('concatenates each routine’s entries in list order, stamping rid on every one', () => {
    const { entries, routineIds } = buildCombinedEntries(st, ['r1', 'r2'])
    expect(entries.map(e => e.id)).toEqual(['0025', '0031', '0047'])
    expect(entries.map(e => e.rid)).toEqual(['r1', 'r1', 'r2'])
    expect(routineIds).toEqual(['r1', 'r2'])
  })

  it('de-dupes a repeated id (first wins) and drops an id with no matching routine', () => {
    const { entries, routineIds } = buildCombinedEntries(st, ['r1', 'gone', 'r1', 'r2'])
    expect(routineIds).toEqual(['r1', 'r2'])
    expect(entries.map(e => e.rid)).toEqual(['r1', 'r1', 'r2'])
  })

  it('an empty / null list builds nothing', () => {
    expect(buildCombinedEntries(st, [])).toMatchObject({ entries: [], routineIds: [], routines: [] })
    expect(buildCombinedEntries(st, null)).toMatchObject({ entries: [], routineIds: [] })
  })

  it('a single-element list matches the plain buildSessionEntries path (bar the rid stamp)', () => {
    const combined = buildCombinedEntries(st, ['r1']).entries.map(({ rid, ...e }) => e)
    expect(combined).toEqual(buildSessionEntries(st, st.routines[0]))
  })

  it('carries an excluded routine’s per-entry noProg through the merge', () => {
    const { entries } = buildCombinedEntries(st, ['r1', 'rehab'])
    expect(entries.find(e => e.id === '0050')).toMatchObject({ rid: 'rehab', noProg: true })
    expect(entries.find(e => e.id === '0025').noProg).toBeUndefined()
  })
})

// A combined day that holds the same exercise twice — a heavy block and a light block — saves
// two entries for it. Each routine's next session reads its own one (#216); it used to read only
// the first, so the light block came back at the heavy block's numbers.
describe('the same exercise in two routines of one combined day', () => {
  const work = e => e.sets.filter(s => !isWarmupRow(s))
  const A = { id: 'A', name: 'Heavy', ex: [{ id: '0025', sets: 2, reps: 10, weight: 60 }] }
  const B = { id: 'B', name: 'Light', ex: [{ id: '0025', sets: 2, reps: 15, weight: 40 }] }

  it('opens each routine from its own entry of the saved workout', () => {
    const state = { unit: 'kg', exWeights: {}, routines: [A, B], workouts: [] }
    const { entries, routineIds } = buildCombinedEntries(state, ['A', 'B'])
    const active = { id: 'w1', d: '2026-08-01', start: 1, routineIds, name: 'Heavy + Light', entries: entries.map(e => ({ ...e, sets: e.sets.map(s => ({ ...s, done: true })) })) }
    state.workouts.push(buildCompletedWorkout(active, { end: 2 }))

    const next = buildCombinedEntries(state, ['A', 'B']).entries
    expect(work(next[0]).map(s => [s.w, s.r])).toEqual([[62.5, 10], [62.5, 10]])
    expect(work(next[1]).map(s => [s.w, s.r])).toEqual([[42.5, 15], [42.5, 15]])
  })
})

describe('deriveSessionName', () => {
  it('is null for an empty list', () => {
    expect(deriveSessionName([])).toBe(null)
  })
  it('joins 1–3 names with " + "', () => {
    expect(deriveSessionName(['Rehab'])).toBe('Rehab')
    expect(deriveSessionName(['Rehab', 'Core'])).toBe('Rehab + Core')
    expect(deriveSessionName(['A', 'B', 'C'])).toBe('A + B + C')
  })
  it('collapses 4+ to "A + B + N more"', () => {
    expect(deriveSessionName(['A', 'B', 'C', 'D'])).toBe('A + B + 2 more')
    expect(deriveSessionName(['A', 'B', 'C', 'D', 'E'])).toBe('A + B + 3 more')
  })
})


describe('combined phase snapshots', () => {
  const phase = { id: 'shared', label: 'Preparation', type: 'warmup', countsAsWork: false }
  const phased = id => ({ id, name: id, sections: [phase], ex: [{ id: '0025', sectionId: 'shared', sets: 1, reps: 5, weight: 40, prog: 'off' }] })
  it('isolates phase ids and repeated exercises across routines through JSON reload', () => {
    const routines = [phased('one'), phased('two')]
    const result = JSON.parse(JSON.stringify(buildCombinedEntries({ ...st, routines }, ['one', 'two'])))
    expect(new Set(result.sections.map(s => s.id)).size).toBe(2)
    expect(new Set(result.entries.map(e => e.occurrenceId)).size).toBe(2)
    expect(result.entries.map(e => e.rid)).toEqual(['one', 'two'])
    result.entries.forEach((e, i) => {
      expect(e.sectionId).toBe(result.sections[i].id)
      expect(e.target.sectionId).toBe(e.sectionId)
      expect(e.section.type).toBe('warmup')
    })
    expect(routines[1].sections[0].id).toBe('shared')
  })
  it('gives appended flat routines a work phase without Web Crypto or changing logged preparation', () => {
    const active = buildCombinedEntries({ ...st, routines: [phased('one')] }, ['one'])
    active.entries[0].sets[0].done = true
    const before = structuredClone(active.entries[0])
    const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {} })
    try { appendSessionEntries(active, buildCombinedEntries(st, ['r1'])) }
    finally {
      if (cryptoDescriptor) Object.defineProperty(globalThis, 'crypto', cryptoDescriptor)
      else delete globalThis.crypto
    }
    expect(active.entries[0]).toEqual(before)
    expect(active.sections.map(s => s.type)).toEqual(['warmup', 'work'])
    expect(active.entries.slice(1).every(e => e.section.type === 'work')).toBe(true)
  })
  it('rejects excessive phases without partially mutating the active session', () => {
    const active = { entries: [{ id: '0025' }], routineId: 'legacy' }
    const before = structuredClone(active)
    const source = { entries: [], sections: Array.from({ length: 50 }, (_, i) => ({ ...phase, id: 'p' + i })) }
    expect(() => appendSessionEntries(active, source)).toThrow('at most 50')
    expect(active).toEqual(before)
  })
})
