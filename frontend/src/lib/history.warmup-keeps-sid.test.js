import { describe, it, expect } from 'vitest'
import { makeWarmupAt, makeWorkAt } from './history.js'
import { ensureSetIds, ensureWatchSet } from './watch-sync.js'

// A set turned into a warm-up on the phone is still the same set. Its id has to survive, or a
// late tick or correction from a watch adds a second row and the set is saved twice.
describe('a warm-up move keeps the set\'s identity', () => {
  const state = () => {
    const S = { active: { id: 'w1', entries: [{ id: '0025', sets: [{ w: 60, r: 8, done: true, at: 1000, hr: 141 }, { w: 60, r: 8, done: false }] }] } }
    ensureSetIds(S.active)
    return S
  }

  it('keeps sid, at and hr through Make it a warm-up set, and back', () => {
    const S = state()
    const sid = S.active.entries[0].sets[0].sid
    expect(sid).toBeTruthy()
    const rows = makeWarmupAt(S.active.entries[0].sets, 0)
    const warm = rows.find(r => r.warmup)
    expect(warm).toMatchObject({ sid, at: 1000, hr: 141, done: true })
    const back = makeWorkAt(rows, rows.indexOf(warm))
    expect(back.find(r => r.sid === sid)).toMatchObject({ at: 1000, hr: 141, done: true })
  })

  it('a watch correction by the old id lands on the warm-up row, not on a second row', () => {
    const S = state()
    const e = S.active.entries[0]
    const sid = e.sets[0].sid
    e.sets = makeWarmupAt(e.sets, 0)
    ensureSetIds(S.active)
    expect(ensureWatchSet(S, { exId: '0025', entryIdx: 0, setIdx: 0, sid }, null, { done: true, w: 62.5, r: 8, at: 2000 })).toBe(true)
    expect(e.sets.filter(r => r.done)).toHaveLength(1)
    expect(e.sets).toHaveLength(2)
    expect(e.sets.filter(r => r.sid === sid)).toHaveLength(1)
  })

  it('a per-side set keeps its id too', () => {
    const rows = [{ sid: 's-side', at: 5, sides: { L: { w: 10, r: 8, done: true }, R: { w: 10, r: 8, done: true } }, w: 10, r: 16, done: true }]
    expect(makeWarmupAt(rows, 0)[0]).toMatchObject({ sid: 's-side', at: 5, warmup: true })
  })
})
