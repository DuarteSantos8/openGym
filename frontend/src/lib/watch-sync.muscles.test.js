// The watch's Muscles page: the phone sends what each exercise of the running workout trains, with
// its own weights, and the muscles' names in the app's language; the watch adds up the sets.
import { describe, expect, it } from 'vitest'
import { buildSnapshot, fitSnapshot } from './watch-sync.js'
import { EXIDX } from './exercises.js'
import { musclesOf, MUSCLE_NAME } from './muscles.js'

const ID = '1173' // a barbell bench press
const state = () => ({ unit: 'kg', restSec: 90, active: { id: 'w1', name: 'Push', start: 1, cur: 0, entries: [{ id: ID, sets: [{ w: 60, r: 8 }] }] } })

describe('muscles on the watch', () => {
  it('sends the phone\'s weights per exercise and a name for each muscle', () => {
    const snap = buildSnapshot(state())
    const want = musclesOf(EXIDX[ID])
    const m = snap.active.entries[0].muscles
    expect(Object.keys(m).sort()).toEqual(Object.keys(want).sort())
    for (const k in m) expect(m[k]).toBeCloseTo(want[k], 2)
    for (const k in m) expect(snap.active.muscleNames[k]).toBe(MUSCLE_NAME[k])
  })

  it('an exercise it knows nothing about sends no muscles', () => {
    const s = state()
    s.active.entries = [{ id: 'my-own', target: { name: 'Mystery' }, sets: [] }]
    expect(buildSnapshot(s).active.entries[0].muscles).toBeUndefined()
  })

  it('a snapshot too big drops the muscles before the records of the running workout', () => {
    const snap = buildSnapshot(state())
    snap.active.entries[0].best = { w: 100, r: 1 }
    const small = fitSnapshot(snap, JSON.stringify({ ...snap, active: { ...snap.active, muscleNames: undefined, entries: [{ ...snap.active.entries[0], muscles: undefined }] }, ready: null }).length + 5)
    expect(small.active.entries[0].muscles).toBeUndefined()
    expect(small.active.entries[0].best).toBeDefined()
  })
})
