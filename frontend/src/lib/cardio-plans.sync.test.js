// Cardio plans in the sync (lib/cardio-plans.js): merged one plan at a time, wiped by a reset like
// the other per-key maps, and kept by an older app that has never heard of them.
import { describe, it, expect } from 'vitest'
import { mergeStates, stampEdits, resetIdsOf, sinceReset } from './sync-merge.js'
import { stampPut } from '../../../api/sync-stamps.js'

const clone = v => JSON.parse(JSON.stringify(v))
const T = 1_800_000_000_000
const P = (id, name) => ({ id, name, at: 1, segments: [{ min: 3, speed: 5, incline: 4 }] })
const base = () => ({ _ts: T, unit: 'kg', workouts: [], routines: [{ id: 'r', name: 'R', ex: [] }], week: {}, cardioPlans: { a: P('a', 'A'), b: P('b', 'B') } })
const edit = (prev, at, mut) => { const n = clone(prev); mut(n); n._ts = at; return stampEdits(prev, n, at) }

describe('cardioPlans merge one plan at a time', () => {
  it('two devices editing two plans keep both edits', () => {
    const s0 = stampEdits(null, base(), T)
    const phone = edit(s0, T + 10, s => { s.cardioPlans.a = { ...s.cardioPlans.a, name: 'A phone' } })
    const desk = edit(s0, T + 20, s => { s.cardioPlans.b = { ...s.cardioPlans.b, name: 'B desk' } })
    for (const m of [mergeStates(phone, desk), mergeStates(desk, phone)]) {
      expect(m.cardioPlans.a.name).toBe('A phone')
      expect(m.cardioPlans.b.name).toBe('B desk')
    }
  })

  it('a removal wins over the older copy that still has it, and a new plan on the other side stays', () => {
    const s0 = stampEdits(null, base(), T)
    const phone = edit(s0, T + 10, s => { delete s.cardioPlans.a })
    const desk = edit(s0, T + 5, s => { s.cardioPlans.c = P('c', 'C') })
    for (const m of [mergeStates(phone, desk), mergeStates(desk, phone)]) {
      expect(Object.keys(m.cardioPlans).sort()).toEqual(['b', 'c'])
    }
  })

  it('a reset wipes them like the other per-key maps', () => {
    const s = base()
    const ids = resetIdsOf(s)
    expect([...ids.cardioPlans].sort()).toEqual(['a', 'b'])
    expect(sinceReset(s, T + 1, ids).cardioPlans).toEqual({})
  })
})

describe('an older app that does not know them', () => {
  it('keeps them through the server when it sends a document without them', () => {
    const cur = stampEdits(null, base(), T)
    const old = clone(cur)
    delete old.cardioPlans
    const out = stampPut(clone(cur), old, { overRead: true, stamped: false, now: T + 100 })
    expect(out.cardioPlans).toEqual(cur.cardioPlans)
  })
})
