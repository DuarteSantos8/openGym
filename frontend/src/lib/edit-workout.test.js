import { describe, it, expect } from 'vitest'
import { buildEditedWorkout, updateWorkoutInHistory, applyEditedWorkoutWeights } from './edit-workout.js'

describe('edit-workout helpers', () => {
  const original = {
    id: 'w-1',
    d: '2026-03-01',
    start: 100000,
    end: 160000,
    name: 'Push Day',
    routineIds: ['r1'],
    routineId: 'r1',
    bw: 75,
    prs: ['ex-1'],
    entries: [
      {
        id: 'ex-1',
        sets: [
          { w: 80, r: 8, done: true },
          { w: 80, r: 8, done: true },
        ],
      },
    ],
    vol: 1280,
  }

  describe('buildEditedWorkout', () => {
    it('recalculates end time from durationMin and updates name and volume', () => {
      const updated = buildEditedWorkout({
        originalWorkout: original,
        name: 'Heavy Push',
        d: '2026-03-01',
        start: 100000,
        durationMin: 45,
        entries: [
          {
            id: 'ex-1',
            sets: [
              { w: 85, r: 5, done: true },
              { w: 85, r: 5, done: true },
            ],
          },
        ],
        note: 'Felt strong',
      })

      expect(updated.id).toBe('w-1')
      expect(updated.name).toBe('Heavy Push')
      expect(updated.end).toBe(100000 + 45 * 60000)
      expect(updated.vol).toBe(85 * 5 * 2)
      expect(updated.note).toBe('Felt strong')
      expect(updated.entries[0].topW).toBe(85)
    })

    it('filters out unchecked sets and drops empty entries', () => {
      const updated = buildEditedWorkout({
        originalWorkout: original,
        entries: [
          {
            id: 'ex-1',
            sets: [
              { w: 90, r: 5, done: true },
              { w: 90, r: 5, done: false }, // unchecked set
            ],
          },
          {
            id: 'ex-2',
            sets: [
              { w: 50, r: 10, done: false }, // whole entry unchecked
            ],
          },
        ],
      })

      expect(updated.entries).toHaveLength(1)
      expect(updated.entries[0].id).toBe('ex-1')
      expect(updated.entries[0].sets).toHaveLength(1)
      expect(updated.entries[0].sets[0].done).toBe(true)
      expect(updated.vol).toBe(90 * 5)
    })

    it('preserves routineIds, bw, prs, and per-entry notes', () => {
      const updated = buildEditedWorkout({
        originalWorkout: original,
        entries: [
          {
            id: 'ex-1',
            note: '  adjust bench angle  ',
            notePin: true,
            sets: [{ w: 80, r: 8, done: true }],
          },
        ],
      })

      expect(updated.routineIds).toEqual(['r1'])
      expect(updated.bw).toBe(75)
      expect(updated.prs).toEqual(['ex-1'])
      expect(updated.entries[0].note).toBe('adjust bench angle')
      expect(updated.entries[0].notePin).toBe(true)
    })
  })

  describe('updateWorkoutInHistory', () => {
    const w1 = { id: 'w-1', d: '2026-03-01', start: 1000 }
    const w2 = { id: 'w-2', d: '2026-03-05', start: 2000 }
    const w3 = { id: 'w-3', d: '2026-03-10', start: 3000 }

    it('replaces workout and preserves chronological order', () => {
      const updatedW2 = { ...w2, name: 'Renamed' }
      const res = updateWorkoutInHistory([w1, w2, w3], 'w-2', updatedW2)
      expect(res.map(w => w.id)).toEqual(['w-1', 'w-2', 'w-3'])
      expect(res[1].name).toBe('Renamed')
    })

    it('re-sorts when date changes to earlier', () => {
      const updatedW3 = { ...w3, d: '2026-02-28', start: 500 }
      const res = updateWorkoutInHistory([w1, w2, w3], 'w-3', updatedW3)
      expect(res.map(w => w.id)).toEqual(['w-3', 'w-1', 'w-2'])
    })

    it('re-sorts when date changes to later', () => {
      const updatedW1 = { ...w1, d: '2026-03-15', start: 4000 }
      const res = updateWorkoutInHistory([w1, w2, w3], 'w-1', updatedW1)
      expect(res.map(w => w.id)).toEqual(['w-2', 'w-3', 'w-1'])
    })
  })

  describe('applyEditedWorkoutWeights', () => {
    it('updates personal best when a set is heavier', () => {
      const exWeights = { 'ex-1': { w: 80, d: '2026-01-01' } }
      const workout = {
        d: '2026-03-01',
        entries: [{ id: 'ex-1', sets: [{ w: 90, r: 5, done: true }] }],
      }

      const res = applyEditedWorkoutWeights(exWeights, workout)
      expect(res['ex-1']).toEqual({ w: 90, d: '2026-03-01' })
    })

    it('does not downgrade personal best when sets are lighter', () => {
      const exWeights = { 'ex-1': { w: 100, d: '2026-01-01' } }
      const workout = {
        d: '2026-03-01',
        entries: [{ id: 'ex-1', sets: [{ w: 90, r: 5, done: true }] }],
      }

      const res = applyEditedWorkoutWeights(exWeights, workout)
      expect(res['ex-1']).toEqual({ w: 100, d: '2026-01-01' })
    })

    it('creates new record if exercise was never logged before', () => {
      const exWeights = {}
      const workout = {
        d: '2026-03-01',
        entries: [{ id: 'ex-new', sets: [{ w: 45, r: 10, done: true }] }],
      }

      const res = applyEditedWorkoutWeights(exWeights, workout)
      expect(res['ex-new']).toEqual({ w: 45, d: '2026-03-01' })
    })
  })
})
