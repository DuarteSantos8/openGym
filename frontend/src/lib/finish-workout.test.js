import { describe, expect, it } from 'vitest'
import { buildCompletedWorkout } from './finish-workout.js'

describe('completed workout boundary', () => {
  it('builds the same legacy-shaped record doFinishWorkout stores and keeps it visible', () => {
    const active = {
      id: 'active-1', d: '2026-08-08', start: 1000, routineIds: ['routine-1'], name: 'Push', bw: 80,
      entries: [{ id: '0025', sets: [{ done: true, w: 60, r: 8 }], topW: 60, target: { sets: 1, reps: 8 } }],
    }
    const completed = buildCompletedWorkout(active, { end: 2000, prs: [] })
    expect(completed).toEqual({
      id: 'active-1', d: '2026-08-08', start: 1000, end: 2000,
      routineIds: ['routine-1'], routineId: 'routine-1', name: 'Push', bw: 80,
      entries: [{ id: '0025', sets: [{ done: true, w: 60, r: 8 }], topW: 60, target: { sets: 1, reps: 8 } }],
      prs: []
    })
  })

  it('mirrors routineIds → routineId, and tolerates a legacy scalar active.routineId', () => {
    const base = {
      id: 'w', d: '2026-08-08', start: 1,
      entries: [{ id: '0025', sets: [{ done: true, w: 60, r: 8 }], target: { sets: 1, reps: 8 } }],
    }
    const combined = buildCompletedWorkout({ ...base, routineIds: ['a', 'b'] })
    expect(combined.routineIds).toEqual(['a', 'b'])
    expect(combined.routineId).toBe('a')

    const legacy = buildCompletedWorkout({ ...base, routineId: 'only' })
    expect(legacy.routineIds).toEqual(['only'])
    expect(legacy.routineId).toBe('only')

    const freestyle = buildCompletedWorkout(base)
    expect(freestyle.routineIds).toEqual([])
    expect(freestyle.routineId).toBe(null)
  })

  it('carries per-entry rid and noProg onto the saved entry, written only when set', () => {
    const active = {
      id: 'w', d: '2026-08-08', start: 1, routineIds: ['strength', 'rehab'],
      entries: [
        { id: '0025', rid: 'strength', sets: [{ done: true, w: 60, r: 8 }], target: { sets: 1, reps: 8 } },
        { id: '0031', rid: 'rehab', noProg: true, sets: [{ done: true, w: 10, r: 12 }], target: { sets: 1, reps: 12 } },
      ],
    }
    const [a, b] = buildCompletedWorkout(active).entries
    expect(a.rid).toBe('strength')
    expect('noProg' in a).toBe(false)
    expect(b.rid).toBe('rehab')
    expect(b.noProg).toBe(true)
  })

  it('derives topW from the highest completed non-warm-up work set, not stale entry data', () => {
    const active = {
      id: 'active-1', d: '2026-08-08', start: 1000,
      entries: [{
        id: '0025', topW: 80, target: { mode: 'reps', sets: 2, reps: 8 },
        sets: [
          { phase: 'warmup', done: true, w: 120, r: 8 },
          { done: true, w: 75, r: 8 },
          { done: true, w: 85, r: 7 },
          { done: false, w: 100, r: 8 },
        ],
      }],
    }

    expect(buildCompletedWorkout(active).entries[0].topW).toBe(85)
    expect(buildCompletedWorkout({
      ...active,
      entries: [{ ...active.entries[0], topW: 120 }],
    }).entries[0].topW).toBe(85)
  })

  it('keeps a legacy topW when old completed rows have no usable weight', () => {
    const active = {
      id: 'active-1', d: '2026-08-08', start: 1000,
      entries: [{ id: '0025', topW: 60, sets: [{ done: true, r: 8 }] }],
    }

    expect(buildCompletedWorkout(active).entries[0].topW).toBe(60)
  })

  it('writes the legacy excludeFromProgression mirror iff every completed entry is noProg', () => {
    const mk = entries => ({ id: 'w', d: '2026-08-08', start: 1, routineIds: ['x'], entries })
    const done = extra => ({ id: '0025', sets: [{ done: true, w: 30, r: 8 }], target: { sets: 1, reps: 8 }, ...extra })

    // rehab-only combined session → present
    expect(buildCompletedWorkout(mk([done({ noProg: true }), done({ id: '0031', noProg: true })])))
      .toHaveProperty('excludeFromProgression', true)
    // rehab + strength → absent
    expect(buildCompletedWorkout(mk([done({ noProg: true }), done({ id: '0031' })])))
      .not.toHaveProperty('excludeFromProgression')
    // all-normal → absent
    expect(buildCompletedWorkout(mk([done(), done({ id: '0031' })])))
      .not.toHaveProperty('excludeFromProgression')
  })

  it('persists a muscle snapshot only when the caller supplies one', () => {
    const active = {
      id: 'active-1', d: '2026-08-08', start: 1000,
      entries: [
        { id: 'catalogue', sets: [{ done: true }] },
        { id: 'custom', sets: [{ done: true }] },
      ],
    }
    const completed = buildCompletedWorkout(active, {
      end: 2000,
      snapshotFor: entry => entry.id === 'custom'
        ? { n: 'Custom lift', muscleWeights: { chest: 1 } }
        : null,
    })

    expect(completed.entries[0]).not.toHaveProperty('muscleSnapshot')
    expect(completed.entries[1].muscleSnapshot).toEqual({
      n: 'Custom lift', muscleWeights: { chest: 1 },
    })
  })
})

// Notes written during a session have to survive it, or "write a note during your workout"
// means "write a note and lose it when you tap Finish".
describe('session notes', () => {
  const active = (entry) => ({
    id: 'w1', d: '2026-08-25', start: 1, routineId: 'r1', name: 'Push', bw: null,
    entries: [{ id: '0025', sets: [{ w: 100, r: 5, done: true }], ...entry }],
  })

  it('keeps a per-exercise note and its pin', () => {
    const w = buildCompletedWorkout(active({ note: '  narrower grip next time  ', notePin: true }))
    expect(w.entries[0].note).toBe('narrower grip next time')
    expect(w.entries[0].notePin).toBe(true)
  })

  it('keeps an unpinned note without inventing a pin', () => {
    const w = buildCompletedWorkout(active({ note: 'shoulder twinged' }))
    expect(w.entries[0].note).toBe('shoulder twinged')
    expect('notePin' in w.entries[0]).toBe(false)
  })

  it('writes no note fields at all when nothing was typed', () => {
    const w = buildCompletedWorkout(active({ note: '   ', notePin: true }))
    expect('note' in w.entries[0]).toBe(false)
    expect('notePin' in w.entries[0]).toBe(false)
  })

  it('keeps a whole-session note on the workout', () => {
    const a = active({})
    expect(buildCompletedWorkout({ ...a, note: 'slept badly' }).note).toBe('slept badly')
    expect('note' in buildCompletedWorkout(a)).toBe(false)
  })
})
