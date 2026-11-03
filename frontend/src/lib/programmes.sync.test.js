// Programmes in the sync (#159): merged one programme at a time, the running one as a setting,
// and kept by an older app that has never heard of them.
import { describe, it, expect } from 'vitest'
import { mergeStates, stampEdits, resetIdsOf, sinceReset } from './sync-merge.js'
import { stampPut } from '../../../api/sync-stamps.js'

const clone = v => JSON.parse(JSON.stringify(v))
const T = 1_800_000_000_000
const P = (id, name) => ({ id, name, at: 1, weeks: [{ rpe: 8 }], days: { 1: ['r'] } })
const base = () => ({ _ts: T, unit: 'kg', workouts: [], routines: [{ id: 'r', name: 'R', ex: [] }], week: {}, programmes: { a: P('a', 'A'), b: P('b', 'B') }, programme: null })
const edit = (prev, at, mut) => { const n = clone(prev); mut(n); n._ts = at; return stampEdits(prev, n, at) }

describe('programmes merge one at a time', () => {
  it('two devices editing two programmes keep both edits', () => {
    const s0 = stampEdits(null, base(), T)
    const phone = edit(s0, T + 10, s => { s.programmes.a = { ...s.programmes.a, name: 'A phone' } })
    const desk = edit(s0, T + 20, s => { s.programmes.b = { ...s.programmes.b, name: 'B desk' } })
    for (const m of [mergeStates(phone, desk), mergeStates(desk, phone)]) {
      expect(m.programmes.a.name).toBe('A phone')
      expect(m.programmes.b.name).toBe('B desk')
    }
  })

  it('a removal wins over the older copy that still has it, and a new one on the other side stays', () => {
    const s0 = stampEdits(null, base(), T)
    const phone = edit(s0, T + 10, s => { delete s.programmes.a })
    const desk = edit(s0, T + 5, s => { s.programmes.c = P('c', 'C') })
    for (const m of [mergeStates(phone, desk), mergeStates(desk, phone)]) {
      expect(Object.keys(m.programmes).sort()).toEqual(['b', 'c'])
    }
  })

  it('the running programme is one setting: the later start wins whole', () => {
    const s0 = stampEdits(null, base(), T)
    const phone = edit(s0, T + 10, s => { s.programme = { id: 'a', startedOn: '2026-10-19', cycle: 1, bump: 0, saved: { week: {} } } })
    const desk = edit(s0, T + 20, s => { s.programme = { id: 'b', startedOn: '2026-10-20', cycle: 1, bump: 0, saved: { week: {} } } })
    expect(mergeStates(phone, desk).programme.id).toBe('b')
    expect(mergeStates(desk, phone).programme.id).toBe('b')
  })

  it('a reset wipes them like the other per-key maps', () => {
    const s = base()
    const ids = resetIdsOf(s)
    expect(ids.programmes.sort()).toEqual(['a', 'b'])
    expect(sinceReset(s, T + 1, ids).programmes).toEqual({})
  })
})

describe('an older app that does not know them', () => {
  it('keeps them through the server when it sends a document without them', () => {
    const cur = stampEdits(null, base(), T)
    const old = clone(cur)
    delete old.programmes
    delete old.programme
    const out = stampPut(clone(cur), old, { overRead: true, stamped: false, now: T + 100 })
    expect(out.programmes).toEqual(cur.programmes)
  })
})
