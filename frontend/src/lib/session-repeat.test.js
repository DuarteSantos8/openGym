import { describe, expect, it } from 'vitest'
import { repeatSessionEntries } from './session-repeat.js'
import { makeSideSet, toggleSide, isWarmupRow, isSideSet } from './workout-model.js'

const row = (patch = {}) => ({ w: 40, r: 8, done: true, ...patch })
const entry = (id, target, sets, extra = {}) => ({ id, target, sets, ...extra })
const exists = () => true
const state = (over = {}) => ({ unit: 'kg', workouts: [], exWeights: {}, routines: [], ...over })
const work = e => e.sets.filter(s => !isWarmupRow(s))

describe('repeatSessionEntries (#58)', () => {
  it('seeds the rows from this workout, not from a later one of the same exercise', () => {
    const old = { id: 'w1', d: '2026-09-01', name: 'Push', entries: [entry('bench', { reps: 8, weight: 60 }, [row({ w: 60, r: 8 }), row({ w: 62.5, r: 6 })])] }
    const later = { id: 'w2', d: '2026-09-20', name: 'Push', entries: [entry('bench', { reps: 5, weight: 80 }, [row({ w: 80, r: 5 }), row({ w: 80, r: 5 }), row({ w: 80, r: 5 })])] }
    const st = state({ workouts: [old, later], exWeights: { bench: { w: 80 } } })
    const { entries, skipped } = repeatSessionEntries(st, old, { exists })
    expect(skipped).toBe(0)
    expect(entries).toHaveLength(1)
    expect(work(entries[0]).map(s => [s.w, s.r])).toEqual([[60, 8], [62.5, 6]])
  })

  it('takes as many work sets as were done that day, the bonus set included', () => {
    const w = { name: 'Legs', entries: [entry('squat', { reps: 5, weight: 100, sets: 3 }, [row({ w: 100, r: 5 }), row({ w: 100, r: 5 }), row({ w: 100, r: 5 }), row({ w: 100, r: 4 })], { planned: { sets: 3, reps: 5 }, rid: 'r1' })] }
    const { entries } = repeatSessionEntries(state(), w, { exists })
    expect(work(entries[0])).toHaveLength(4)
    expect(entries[0].target.sets).toBe(4)
  })

  it('every row starts unchecked, and the source workout is not changed', () => {
    const w = { name: 'Push', entries: [entry('bench', { reps: 8 }, [row(), row({ done: false })])] }
    const before = structuredClone(w)
    const { entries } = repeatSessionEntries(state({ workouts: [w] }), w, { exists })
    expect(entries[0].sets.every(s => s.done === false)).toBe(true)
    expect(w).toEqual(before)
  })

  it('keeps supersets adjacent under a fresh group id', () => {
    const w = {
      name: 'SS', entries: [
        entry('a', { reps: 10 }, [row()], { sg: 'old' }),
        entry('b', { reps: 12 }, [row({ r: 12 })], { sg: 'old' }),
        entry('c', { reps: 5 }, [row({ r: 5 })]),
      ]
    }
    const { entries } = repeatSessionEntries(state(), w, { exists })
    expect(entries.map(e => e.id)).toEqual(['a', 'b', 'c'])
    expect(entries[0].sg).toBeTruthy()
    expect(entries[0].sg).toBe(entries[1].sg)
    expect(entries[0].sg).not.toBe('old')
    expect(entries[2].sg).toBeUndefined()
  })

  it('rebuilds the warm-ups the workout had in front of its work sets', () => {
    const w = { name: 'Bench', entries: [entry('bench', { reps: 5, weight: 100 }, [row({ phase: 'warmup', w: 50, r: 8 }), row({ phase: 'warmup', w: 75, r: 5 }), row({ w: 100, r: 5 })])] }
    const { entries } = repeatSessionEntries(state(), w, { exists })
    const sets = entries[0].sets
    expect(sets.filter(isWarmupRow)).toHaveLength(2)
    expect(work(entries[0]).map(s => s.w)).toEqual([100])
    expect(sets.findIndex(s => !isWarmupRow(s))).toBe(2)
  })

  it('handles per-side, timed and cardio exercises', () => {
    const side = toggleSide(toggleSide(makeSideSet({ w: 20, r: 16 }), 'L'), 'R')
    const w = {
      name: 'Mixed', entries: [
        entry('lunge', { reps: 16, side: true, weight: 20 }, [side]),
        entry('plank', { mode: 'time', sec: 45 }, [{ sec: 60, w: 0, done: true }]),
        entry('bike', { mode: 'cardio', min: 20, speed: 25 }, [{ min: 30, speed: 28, done: true }]),
      ]
    }
    const { entries } = repeatSessionEntries(state(), w, { exists })
    expect(isSideSet(entries[0].sets[0])).toBe(true)
    expect(entries[0].sets[0].sides.L.done).toBe(false)
    expect(entries[1].sets[0]).toMatchObject({ sec: 60, done: false })
    expect(entries[2].sets[0]).toMatchObject({ min: 30, speed: 28, done: false })
  })

  it('leaves out an exercise that no longer exists and counts it; its superset partner stands alone', () => {
    const w = {
      name: 'Old', entries: [
        entry('gone', { reps: 10 }, [row()], { sg: 'g' }),
        entry('kept', { reps: 10 }, [row()], { sg: 'g' }),
        entry('also-gone', { reps: 10 }, [row()]),
      ]
    }
    const { entries, skipped } = repeatSessionEntries(state(), w, { exists: id => id === 'kept' })
    expect(skipped).toBe(2)
    expect(entries.map(e => e.id)).toEqual(['kept'])
    expect(entries[0].sg).toBeUndefined()
  })

  it('is a freestyle session: no routine, plan or progression fields', () => {
    const w = { name: 'Push', routineIds: ['r1'], entries: [entry('bench', { reps: 8, rid: 'r1' }, [row()], { rid: 'r1', planned: { sets: 1, reps: 8 }, noProg: true, carried: true })] }
    const { entries } = repeatSessionEntries(state({ routines: [{ id: 'r1', name: 'Push', ex: [] }] }), w, { exists })
    const e = entries[0]
    for (const key of ['rid', 'planned', 'noProg', 'carried']) {
      expect(e[key]).toBeUndefined()
      expect(e.target[key]).toBeUndefined()
    }
    expect(e.plan).toBeNull()
  })

  it('a workout with nothing to repeat gives nothing', () => {
    expect(repeatSessionEntries(state(), { name: 'Empty', entries: [] }, { exists })).toEqual({ entries: [], skipped: 0 })
  })
  it('repeats a per-side timed hold as its sets, not one set per side row (#58 x #322)', () => {
    const hold = side => ({ sec: 30, w: 0, side, done: true })
    const w = { name: 'Core', entries: [entry('plank', { mode: 'time', side: true, sets: 2, sec: 30 }, [hold('L'), hold('R'), hold('L'), hold('R')])] }
    const { entries } = repeatSessionEntries(state({ workouts: [w] }), w, { exists })
    expect(entries[0].target.sets).toBe(2)
    expect(entries[0].sets.map(s => s.side)).toEqual(['L', 'R', 'L', 'R'])
  })
})
