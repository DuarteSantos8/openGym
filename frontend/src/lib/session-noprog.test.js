import { describe, expect, it } from 'vitest'
import { sessionNoProg, setSessionNoProg, setEntryNoProg, joinSessionNoProg } from './session-noprog.js'
import { buildCompletedWorkout } from './finish-workout.js'
import { entryExcluded, lastEntryFor } from './history.js'

// "Don't count for progression" for the whole workout (Discord, asierlama: an injury day).
const entry = (id, extra = {}) => ({ id, target: { sets: 1, reps: 5, weight: 60 }, sets: [{ w: 60, r: 5, done: true }], ...extra })
const session = entries => ({ id: 'a', d: '2026-09-24', start: 0, routineIds: ['main'], name: 'Main', entries })
const deloadOwns = e => e.rid === 'deload'

describe('setSessionNoProg', () => {
  it('on: every entry is kept out and the session says it is out as a whole', () => {
    const active = session([entry('0025'), entry('0027', { noProg: true })])
    setSessionNoProg(active, true)
    expect(sessionNoProg(active)).toBe(true)
    expect(active.entries.map(e => e.noProg)).toEqual([true, true])
  })

  it('off: every entry counts again, apart from the ones a deload routine keeps out', () => {
    const active = session([entry('0025', { rid: 'main' }), entry('0027', { rid: 'deload', noProg: true })])
    setSessionNoProg(active, true, deloadOwns)
    setSessionNoProg(active, false, deloadOwns)
    expect(sessionNoProg(active)).toBe(false)
    expect('noProg' in active).toBe(false)
    expect(active.entries.map(e => e.noProg)).toEqual([undefined, true])
  })

  it('does nothing without a session', () => {
    expect(() => setSessionNoProg(null, true)).not.toThrow()
    expect(sessionNoProg(null)).toBe(false)
  })
})

describe('setEntryNoProg', () => {
  it('keeps one exercise out without making it the whole session', () => {
    const active = session([entry('0025')])
    setEntryNoProg(active, 0, true)
    expect(active.entries[0].noProg).toBe(true)
    expect(sessionNoProg(active)).toBe(false)
  })

  it('counting one exercise again ends the whole-session choice, the others stay out', () => {
    const active = session([entry('0025'), entry('0027')])
    setSessionNoProg(active, true)
    setEntryNoProg(active, 1, false)
    expect(sessionNoProg(active)).toBe(false)
    expect(active.entries.map(e => e.noProg)).toEqual([true, undefined])
  })

  it('ignores an index with no entry', () => {
    const active = session([entry('0025')])
    setSessionNoProg(active, true)
    setEntryNoProg(active, 5, false)
    expect(sessionNoProg(active)).toBe(true)
  })
})

describe('joinSessionNoProg', () => {
  it('an entry added to a session kept out as a whole is kept out too', () => {
    const active = session([entry('0025')])
    setSessionNoProg(active, true)
    expect(joinSessionNoProg(active, entry('0043')).noProg).toBe(true)
  })

  it('an exercise kept out by hand is not passed on to one added after it', () => {
    const active = session([entry('0025')])
    setEntryNoProg(active, 0, true)
    const added = entry('0043')
    expect(joinSessionNoProg(active, added)).toBe(added)
    expect(added.noProg).toBeUndefined()
  })
})

// The saved workout is built from the entries, so it reads exactly like one whose exercises were
// each kept out by hand: the whole-workout mirror, every entry excluded, no session-only field.
describe('a session kept out as a whole, saved', () => {
  it('writes excludeFromProgression and noProg on every entry, and the history reads past it', () => {
    const active = session([entry('0025', { rid: 'main' }), entry('0027', { rid: 'main' })])
    setSessionNoProg(active, true)
    active.entries.push(joinSessionNoProg(active, entry('0043', { rid: 'main' })))
    const saved = buildCompletedWorkout(active, { end: 1 })
    expect(saved.excludeFromProgression).toBe(true)
    expect(saved.entries.every(e => e.noProg === true && entryExcluded(saved, e))).toBe(true)
    expect(saved).not.toHaveProperty('noProg')

    const earlier = { id: 'w0', d: '2026-09-20', routineIds: ['main'], entries: [entry('0025', { rid: 'main', sets: [{ w: 100, r: 5, done: true }] })] }
    const S = { workouts: [earlier, saved], routines: [], exWeights: {} }
    expect(lastEntryFor(S, '0025', 'main').d).toBe('2026-09-20')
  })

  it('switched off again before the finish, it saves as an ordinary counting workout', () => {
    const active = session([entry('0025'), entry('0027')])
    setSessionNoProg(active, true)
    setSessionNoProg(active, false)
    const saved = buildCompletedWorkout(active, { end: 1 })
    expect(saved).not.toHaveProperty('excludeFromProgression')
    expect(saved.entries.some(e => 'noProg' in e)).toBe(false)
  })
})
