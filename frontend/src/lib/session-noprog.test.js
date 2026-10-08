import { describe, expect, it } from 'vitest'
import { sessionNoProg, setSessionNoProg, setEntryNoProg, joinSessionNoProg, syncExposureExclusion } from './session-noprog.js'

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

// The engine reads a session's exclusion from its exposures (finish-session.js), so the entries' marker is mirrored onto them.
describe('a session kept out, on its exposures', () => {
  it('mirrors every entry marker onto its exposure, and clears it when counted again', () => {
    const active = session([entry('0025', { exposureId: 'a' }), entry('0027', { exposureId: 'b' })])
    active.exposures = [{ exposureId: 'a', excludedFromProgression: false }, { exposureId: 'b', excludedFromProgression: false }]
    setSessionNoProg(active, true)
    syncExposureExclusion(active)
    expect(active.exposures.map(x => x.excludedFromProgression)).toEqual([true, true])
    setEntryNoProg(active, 0, false)
    syncExposureExclusion(active)
    expect(active.exposures.map(x => x.excludedFromProgression)).toEqual([false, true])
  })
})
