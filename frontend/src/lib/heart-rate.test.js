// @vitest-environment happy-dom
// Heart rate per set from the Apple Watch: two OPTIONAL fields on a logged set (hr, restHr), and
// nothing else. These pin that the data is safe: a profile without them is byte for byte what it
// was after loading, saving, finishing, merging and a backup; with them, every one of those keeps
// them; a reading that does not hold up is never written; a saved workout patched later is stamped
// so a sync keeps the change.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sanitizeHr, hrLabel } from './heart-rate.js'
import { buildCompletedWorkout } from './finish-workout.js'
import { mergeStates } from './sync-merge.js'
import { patchSetIn } from './watch-sync.js'

const workout = (id, sets, extra = {}) => ({ id, d: '2026-10-10', name: 'Push', start: 1000, end: 4000, entries: [{ id: '0025', target: { sets: sets.length, reps: 8 }, sets }], ...extra })
const plainSets = () => [{ w: 60, r: 8, done: true, at: 2000 }, { w: 60, r: 7, done: true, at: 3000 }]
const hrSets = () => [{ w: 60, r: 8, done: true, at: 2000, hr: { avg: 128, max: 149 }, restHr: { avg: 110, max: 131 } }, { w: 60, r: 7, done: true, at: 3000, hr: { avg: 135, max: 156 } }]

describe('the reading', () => {
  it('is whole beats per minute in a plausible range, or nothing', () => {
    expect(sanitizeHr({ avg: 128.4, max: 149.6 })).toEqual({ avg: 128, max: 150 })
    for (const bad of [null, {}, { avg: 'x', max: 1 }, { avg: 10, max: 20 }, { avg: 140, max: 120 }, { avg: 120, max: 300 }, 'hr']) expect(sanitizeHr(bad)).toBeNull()
  })
  it('shows only where there is one', () => {
    expect(hrLabel({ w: 60, r: 8 })).toBe('')
    expect(hrLabel({ hr: { avg: 128, max: 149 } })).toBe(' ♥ 128/149')
  })
})

describe('a profile without the fields', () => {
  it('finishes a session byte for byte as before: no hr, no restHr, nothing renamed', () => {
    const active = { id: 'a1', d: '2026-10-10', start: 1000, entries: [{ id: '0025', target: { sets: 2, reps: 8 }, sets: plainSets() }] }
    const w = buildCompletedWorkout(active, { end: 4000 })
    expect(JSON.stringify(w.entries[0].sets)).toBe(JSON.stringify(plainSets()))
    expect(JSON.stringify(w)).not.toMatch(/"hr"|restHr/)
  })

  it('merges byte for byte as before', () => {
    const a = { workouts: [workout('w1', plainSets(), { _ts: 5 })] }
    const b = { workouts: [workout('w1', plainSets(), { _ts: 4 }), workout('w2', plainSets())] }
    const m = mergeStates(a, b)
    expect(JSON.stringify(m.workouts.find(w => w.id === 'w1'))).toBe(JSON.stringify(a.workouts[0]))
    expect(JSON.stringify(m)).not.toMatch(/"hr"|restHr/)
  })
})

describe('a profile with them', () => {
  it('keeps them when the session is finished', () => {
    const active = { id: 'a1', d: '2026-10-10', start: 1000, entries: [{ id: '0025', target: { sets: 2, reps: 8 }, sets: hrSets() }] }
    expect(buildCompletedWorkout(active, { end: 4000 }).entries[0].sets).toEqual(hrSets())
  })

  it('keeps them through a merge, whichever copy was edited last', () => {
    const withHr = workout('w1', hrSets(), { _ts: 5 })
    // another device's copy, edited after it read this one (it carries the fields along, untouched)
    const otherNewer = { ...workout('w1', hrSets().map(s => ({ ...s, r: s.r + 1 })), { _ts: 9 }) }
    expect(mergeStates({ workouts: [withHr] }, { workouts: [] }).workouts[0].entries[0].sets).toEqual(hrSets())
    const m = mergeStates({ workouts: [withHr] }, { workouts: [otherNewer] })
    expect(m.workouts[0].entries[0].sets.map(s => s.hr)).toEqual(hrSets().map(s => s.hr))
    expect(m.workouts[0].entries[0].sets[0].restHr).toEqual({ avg: 110, max: 131 })
  })

  it('survives a JSON round trip the way an older app stores and sends the profile', () => {
    const S = { workouts: [workout('w1', hrSets())] }
    expect(JSON.parse(JSON.stringify(S))).toEqual(S)
  })
})

describe('a set patched after the workout was saved (the rest\'s reading comes late)', () => {
  it('gets the fields, and the workout is stamped as edited so the sync keeps it', () => {
    const s = { active: null, workouts: [workout('w1', plainSets())] }
    const stamp = vi.fn(w => { w._ts = 99 })
    expect(patchSetIn(s, { wid: 'w1', exId: '0025', entryIdx: 0, setIdx: 0 }, { restHr: { avg: 110, max: 131 } }, stamp)).toBe(true)
    expect(s.workouts[0].entries[0].sets[0]).toEqual({ ...plainSets()[0], restHr: { avg: 110, max: 131 } })
    expect(s.workouts[0].entries[0].sets[1]).toEqual(plainSets()[1])
    expect(stamp).toHaveBeenCalledTimes(1)
    expect(s.workouts[0]._ts).toBe(99)
  })

  it('in the running session, without a stamp; a set that is not there changes nothing', () => {
    const s = { active: { id: 'a1', entries: [{ id: '0025', sets: plainSets() }] }, workouts: [] }
    const stamp = vi.fn()
    expect(patchSetIn(s, { wid: 'a1', exId: '0025', entryIdx: 0, setIdx: 1 }, { hr: { avg: 130, max: 150 } }, stamp)).toBe(true)
    expect(s.active.entries[0].sets[1].hr).toEqual({ avg: 130, max: 150 })
    expect(stamp).not.toHaveBeenCalled()
    const before = JSON.stringify(s)
    expect(patchSetIn(s, { wid: 'a1', exId: '9999', entryIdx: 4, setIdx: 0 }, { hr: { avg: 130, max: 150 } }, stamp)).toBe(false)
    expect(patchSetIn(s, { wid: 'gone', exId: '0025', entryIdx: 0, setIdx: 0 }, { hr: { avg: 130, max: 150 } }, stamp)).toBe(false)
    expect(JSON.stringify(s)).toBe(before)
  })
})

describe('the store: load, save, backup', () => {
  beforeEach(() => { localStorage.clear(); vi.resetModules() })
  const fixture = sets => ({ unit: 'kg', restSec: 90, routines: [], workouts: [workout('w1', sets)], bodyweight: [] })

  it('a profile without the fields loads and saves byte for byte', async () => {
    localStorage.setItem('gym_state_v1', JSON.stringify(fixture(plainSets())))
    const { useStore } = await import('../store/useStore.js')
    useStore.getState().update(() => {})
    const saved = JSON.parse(localStorage.getItem('gym_state_v1'))
    expect(JSON.stringify(saved.workouts)).toBe(JSON.stringify(fixture(plainSets()).workouts))
  })

  it('a profile with them loads, saves, exports and imports with them', async () => {
    localStorage.setItem('gym_state_v1', JSON.stringify(fixture(hrSets())))
    const { useStore } = await import('../store/useStore.js')
    useStore.getState().update(() => {})
    expect(JSON.parse(localStorage.getItem('gym_state_v1')).workouts[0].entries[0].sets).toEqual(hrSets())
    // Settings → Export is JSON.stringify(S); Import is importBackup of it
    const backup = JSON.parse(JSON.stringify(useStore.getState().S, null, 2))
    useStore.getState().update(s => { s.workouts = [] })
    useStore.getState().importBackup(backup)
    expect(useStore.getState().S.workouts[0].entries[0].sets).toEqual(hrSets())
  })
})
