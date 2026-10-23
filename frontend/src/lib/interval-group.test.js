import { expect, it } from 'vitest'
import { nextIntervalSet, intervalGroupReady } from './interval-group.js'
import { setSupersetMeta, syncSupersetMeta } from './superset-meta.js'
import { buildPlanBundle, parsePlan } from './plan-share.js'
const entry = done => ({ target: { mode: 'time', sgMode: 'interval' }, sets: [{ sec: 30, done }] })
it('skips spent members and wraps within the group only', () => {
  const entries = [entry(true), entry(false), entry(false)]
  expect(nextIntervalSet(entries, [0, 1], 1)).toEqual({ idx: 1, i: 0, roundEnd: true })
  entries[1].sets[0].done = true
  expect(nextIntervalSet(entries, [0, 1])).toBeNull()
})
it('rejects unsupported and malformed unfinished rows without changing them', () => {
  for (const patch of [{ sec: Infinity }, { sec: -1 }, { side: 'L' }, { failure: true }, { warmup: true }]) {
    const entries = [entry(false), entry(false)]
    Object.assign(entries[0].sets[0], patch)
    expect(intervalGroupReady(entries, [0, 1])).toBe(false)
  }
})
it('carries the mode to new members and clears it when unpaired or switched back', () => {
  const ex = [{ sg: 'g' }, { sg: 'g' }]
  setSupersetMeta(ex, 'g', { mode: 'interval', intervalRest: 0 })
  ex.push({ sg: 'g' })
  syncSupersetMeta(ex)
  expect(ex[2]).toMatchObject({ sgMode: 'interval', sgIntervalRest: 0 })
  delete ex[2].sg; syncSupersetMeta(ex)
  expect(ex[2].sgMode).toBeUndefined()
  setSupersetMeta(ex, 'g', {})
  expect(ex[0].sgMode).toBeUndefined()
})
it('round trips group mode and rests through plan sharing', () => {
  const ex = ['0025', '0007'].map(id => ({ id, mode: 'time', sec: 30, sets: 3, sg: 'g' }))
  setSupersetMeta(ex, 'g', { name: 'Finisher', mode: 'interval', intervalRest: 0, rest: 20, work: 40, prep: 10, roundRest: 0 })
  const bundle = buildPlanBundle({ routines: [{ id: 'r', name: 'Mixed', ex }], week: {}, customEx: [] }, 'Plan')
  const result = parsePlan(bundle).routines[0].ex
  expect(result[0]).toMatchObject({ sgMode: 'interval', sgIntervalRest: 0, sgRest: 20, sgName: 'Finisher', sgWork: 40, sgPrep: 10, sgRoundRest: 0 })
})
