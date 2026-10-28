import { describe, expect, it } from 'vitest'
import { extraIn, frequentExtras, keepGoingLine, keepGoingLines } from './keep-going.js'

const set = (extra = {}) => ({ done: true, w: 20, r: 10, ...extra })
const entry = (id, { extra = true, sets = [set()] } = {}) => ({ id, sets, ...(extra ? { extra: true } : {}) })
const workout = (end, entries) => ({ id: 'w' + end, end, entries })

describe('the extras you add most often', () => {
  it('counts each workout once per exercise, most sessions first, then the most recent', () => {
    const ws = [
      workout(1, [entry('curl'), entry('curl')]),
      workout(2, [entry('curl'), entry('plank')]),
      workout(3, [entry('dips')]),
      workout(4, [entry('plank')]),
      workout(5, [entry('calf')]),
    ]
    // plank and curl twice each, plank the more recent; then calf, more recent than dips.
    expect(frequentExtras(ws, null)).toEqual([{ id: 'plank', times: 2 }, { id: 'curl', times: 2 }, { id: 'calf', times: 1 }])
  })

  it('only extras with a work set done: planned exercises, warm-ups alone and unticked sets do not count', () => {
    const ws = [
      workout(1, [entry('bench', { extra: false })]),
      workout(2, [entry('row', { sets: [set({ warmup: true })] })]),
      workout(3, [entry('fly', { sets: [{ done: false, w: 10, r: 10 }] })]),
      workout(4, [entry('curl')]),
    ]
    expect(frequentExtras(ws, null).map(c => c.id)).toEqual(['curl'])
  })

  it('leaves out what this session already has, and what keep turns down, and stops at n', () => {
    const ws = [workout(1, [entry('a'), entry('b'), entry('c'), entry('d'), entry('e')])]
    const active = { entries: [{ id: 'b', sets: [] }] }
    expect(frequentExtras(ws, active, { n: 2, keep: id => id !== 'a' }).map(c => c.id)).toEqual(['c', 'd'])
  })

  it('without the mark, an exercise its routine does not have is an extra; freestyle never is', () => {
    const routines = [{ id: 'r1', ex: [{ id: 'bench' }, { id: 'dips' }] }, { id: 'r2', ex: [{ id: 'squat' }] }]
    const plain = (id, sets = [set()]) => ({ id, sets })
    const ws = [
      { end: 1, routineIds: ['r1'], entries: [plain('bench'), plain('curl'), plain('plank')] },
      { end: 2, routineId: 'r1', entries: [plain('curl')] },                       // the older single id
      { end: 3, routineIds: ['r1', 'r2'], entries: [plain('squat'), plain('curl')] }, // squat is r2's
      { end: 4, entries: [plain('row')] },                                          // freestyle
      { end: 5, routineIds: ['gone'], entries: [plain('fly')] },                    // routine deleted
    ]
    expect(frequentExtras(ws, null, { routines })).toEqual([{ id: 'curl', times: 3 }, { id: 'plank', times: 1 }])
    expect(extraIn(ws[0], plain('bench'), new Map(routines.map(r => [r.id, r])))).toBe(false)
    expect(extraIn({}, { id: 'x', extra: true })).toBe(true)
  })

  it('a profile with no history, or odd data, suggests nothing', () => {
    expect(frequentExtras(undefined, undefined)).toEqual([])
    expect(frequentExtras([null, {}, { entries: [null, { extra: true }] }], {})).toEqual([])
  })
})

describe('the line that cheers you on', () => {
  it('is always one of the lines, whatever the draw', () => {
    const lines = keepGoingLines()
    expect(lines.length).toBe(100)
    expect(new Set(lines).size).toBe(100)
    for (const r of [0, 0.2, 0.5, 0.99, 1, -1, NaN]) expect(lines).toContain(keepGoingLine(r))
    expect(keepGoingLine(0)).toBe(lines[0])
    expect(keepGoingLine(0.999)).toBe(lines[lines.length - 1])
  })
})
