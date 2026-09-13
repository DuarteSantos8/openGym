import { describe, expect, test } from 'vitest'
import { PLATE_SIZES, DEFAULT_PAIRS, inventoryFor, pairsOf, plateStack, plateDelta, loadKindFor, baseWeightFor, rowLoad, sameLoad } from './plates.js'
import { EXDB } from './exercises-data.js'

const idOf = eq => EXDB.find(e => e.eq === eq).id
// A home gym: one pair of each size (the coach's inventory, 2026-09-01).
const HOME = { unit: 'lb', plates: { lb: { 45: 1, 35: 1, 25: 1, 15: 1, 10: 1, 5: 1, 2.5: 1 } } }
const homeInv = inventoryFor(HOME)

describe('inventoryFor', () => {
  test('a profile without plates of its own gets the standard set for its unit, plenty of each', () => {
    const lb = inventoryFor({ unit: 'lb' })
    expect(lb.map(p => p.w)).toEqual([45, 35, 25, 10, 5, 2.5])   // no 15s, no 1.25s in a gym by default
    expect(lb.every(p => p.n === DEFAULT_PAIRS)).toBe(true)
    const kg = inventoryFor({ unit: 'kg' })
    expect(kg.map(p => p.w)).toEqual([25, 20, 15, 10, 5, 2.5, 1.25])
    expect(inventoryFor({}).map(p => p.w)).toEqual(kg.map(p => p.w))   // kg when unset
  })

  test('the editor lists every size, the inventory only what you have', () => {
    expect(PLATE_SIZES.lb).toContain(15)
    expect(homeInv.map(p => p.w)).toEqual([45, 35, 25, 15, 10, 5, 2.5])
    expect(homeInv.every(p => p.n === 1)).toBe(true)
    expect(pairsOf(HOME, 45)).toBe(1)
    expect(pairsOf(HOME, 1.25)).toBe(0)
    expect(pairsOf({ unit: 'lb' }, 45)).toBe(DEFAULT_PAIRS)
  })

  test('zero and junk counts drop out; the other unit\'s inventory is ignored', () => {
    const S = { unit: 'kg', plates: { kg: { 20: 2, 10: 0, 5: 'x', 2.5: 1.9 }, lb: { 45: 9 } } }
    expect(inventoryFor(S)).toEqual([{ w: 20, n: 2 }, { w: 2.5, n: 1 }])
  })
})

describe('plateStack', () => {
  test('heaviest first when that lands exactly — the way a bar is loaded', () => {
    expect(plateStack(50, homeInv)).toEqual({ plates: [45, 5], missing: 0 })
    expect(plateStack(60, inventoryFor({ unit: 'lb' }))).toEqual({ plates: [45, 10, 5], missing: 0 })
    expect(plateStack(115, inventoryFor({ unit: 'lb' }))).toEqual({ plates: [45, 45, 25], missing: 0 })
    expect(plateStack(21.25, inventoryFor({ unit: 'kg' }))).toEqual({ plates: [20, 1.25], missing: 0 })
  })

  test('the coach ramp on Monday\'s squat, one pair of each', () => {
    expect(plateStack(12.5, homeInv).plates).toEqual([10, 2.5])
    expect(plateStack(27.5, homeInv).plates).toEqual([25, 2.5])
    expect(plateStack(37.5, homeInv).plates).toEqual([35, 2.5])
    expect(plateStack(50, homeInv).plates).toEqual([45, 5])
    expect(plateStack(137.5, homeInv)).toEqual({ plates: [45, 35, 25, 15, 10, 5, 2.5], missing: 0 })
  })

  test('when greedy misses, the fewest plates that hit the weight exactly', () => {
    // greedy would take the 35 and be stuck 15 short; two 25s do it
    expect(plateStack(50, [{ w: 35, n: 1 }, { w: 25, n: 2 }])).toEqual({ plates: [25, 25], missing: 0 })
    // 100 with one pair each: 45 + 35 leaves 20 → 15 + 5
    expect(plateStack(100, homeInv)).toEqual({ plates: [45, 35, 15, 5], missing: 0 })
  })

  test('what cannot be loaded says how much is missing, from the closest load below', () => {
    expect(plateStack(140, homeInv)).toEqual({ plates: [45, 35, 25, 15, 10, 5, 2.5], missing: 2.5 })
    expect(plateStack(12.5, [{ w: 10, n: 1 }, { w: 5, n: 1 }])).toEqual({ plates: [10], missing: 2.5 })
    expect(plateStack(1, homeInv)).toEqual({ plates: [], missing: 1 })
  })

  test('nothing to load is an empty stack; an empty inventory misses everything', () => {
    expect(plateStack(0, homeInv)).toEqual({ plates: [], missing: 0 })
    expect(plateStack(null, homeInv)).toEqual({ plates: [], missing: 0 })
    expect(plateStack(30, [])).toEqual({ plates: [], missing: 30 })
  })
})

describe('plateDelta', () => {
  test('what comes off and what goes on between two stacks', () => {
    expect(plateDelta([10, 2.5], [25, 2.5])).toEqual({ strip: [10], add: [25] })
    expect(plateDelta([45, 5], [45, 5])).toEqual({ strip: [], add: [] })
    expect(plateDelta([], [45, 35])).toEqual({ strip: [], add: [45, 35] })
    expect(plateDelta([45, 45, 10], [45, 25, 5]).strip).toEqual([45, 10])
    expect(plateDelta([45, 45, 10], [45, 25, 5]).add).toEqual([25, 5])
  })
})

describe('loadKindFor', () => {
  const barbell = idOf('barbell'), smith = idOf('smith machine'), db = idOf('dumbbell')
  const bw = idOf('body weight'), weighted = idOf('weighted'), sled = idOf('sled machine')

  test('bars split per side, added weight and sleds are one stack, the rest is not plate-loaded', () => {
    expect(loadKindFor({}, barbell)).toBe('pairs')
    expect(loadKindFor({}, smith)).toBe('pairs')
    expect(loadKindFor({}, bw)).toBe('single')
    expect(loadKindFor({}, weighted)).toBe('single')
    expect(loadKindFor({}, sled)).toBe('single')
    expect(loadKindFor({}, db)).toBe('none')
    expect(loadKindFor({}, 'no-such-id')).toBe('none')
    expect(loadKindFor({}, idOf('band'))).toBe('none')             // tension, not plates
    expect(loadKindFor({}, idOf('resistance band'))).toBe('none')
    expect(loadKindFor({}, { id: idOf('band'), bodyweight: true })).toBe('none')
  })

  test('a routine flagging an exercise as body-weight follows the flag', () => {
    expect(loadKindFor({}, { id: db, bodyweight: true })).toBe('single')
    expect(loadKindFor({}, { id: bw, bodyweight: false })).toBe('none')
  })

  test('the user\'s own choice wins; junk does not', () => {
    expect(loadKindFor({ loadKind: { [db]: 'single' } }, db)).toBe('single')      // a plate-loaded leg press
    expect(loadKindFor({ loadKind: { [barbell]: 'none' } }, barbell)).toBe('none')
    expect(loadKindFor({ loadKind: { [barbell]: 'weird' } }, barbell)).toBe('pairs')
  })
})

describe('baseWeightFor', () => {
  const barbell = idOf('barbell'), sled = idOf('sled machine')
  test('the bar for bar exercises, 0 for "no bar", the override or 0 for anything else', () => {
    expect(baseWeightFor({ unit: 'lb' }, barbell)).toBe(45)
    expect(baseWeightFor({ unit: 'lb', barWeights: { [barbell]: 0 } }, barbell)).toBe(0)
    expect(baseWeightFor({ unit: 'lb', barWeights: { [barbell]: 35 } }, barbell)).toBe(35)
    expect(baseWeightFor({ unit: 'lb' }, sled)).toBe(0)
    expect(baseWeightFor({ unit: 'lb', barWeights: { [sled]: 100 } }, sled)).toBe(100)
    expect(baseWeightFor({ unit: 'lb' }, 'no-such-id')).toBe(0)
  })
})

describe('rowLoad', () => {
  test('a bar row: per side beyond the bar, as plates', () => {
    expect(rowLoad('pairs', 145, 45, homeInv)).toEqual({ kind: 'pairs', barOnly: false, perSide: 50, plates: [45, 5], missing: 0 })
    expect(rowLoad('pairs', 70, 45, homeInv).plates).toEqual([10, 2.5])
  })

  test('at or below the bar is "bar only"; no weight is nothing', () => {
    expect(rowLoad('pairs', 45, 45, homeInv)).toMatchObject({ barOnly: true, plates: [] })
    expect(rowLoad('pairs', 40, 45, homeInv)).toMatchObject({ barOnly: true })
    expect(rowLoad('pairs', 0, 45, homeInv)).toBe(null)
    expect(rowLoad('pairs', null, 45, homeInv)).toBe(null)
  })

  test('no bar (issue #138): the whole total is plates', () => {
    expect(rowLoad('pairs', 90, 0, homeInv)).toMatchObject({ perSide: 45, plates: [45] })
  })

  test('a single stack takes all of it beyond the base: a belt, a sled', () => {
    expect(rowLoad('single', 25, 0, homeInv)).toEqual({ kind: 'single', barOnly: false, perSide: 25, plates: [25], missing: 0 })
    expect(rowLoad('single', 190, 100, homeInv).plates).toEqual([45, 35, 10])
  })

  test('kind none never loads', () => {
    expect(rowLoad('none', 100, 20, homeInv)).toBe(null)
    expect(rowLoad(undefined, 100, 20, homeInv)).toBe(null)
  })

  test('sameLoad compares stacks, so a run of equal weights shows its plates once', () => {
    const a = rowLoad('pairs', 145, 45, homeInv), b = rowLoad('pairs', 145, 45, homeInv), c = rowLoad('pairs', 120, 45, homeInv)
    expect(sameLoad(a, b)).toBe(true)
    expect(sameLoad(a, c)).toBe(false)
    expect(sameLoad(rowLoad('pairs', 45, 45, homeInv), rowLoad('pairs', 40, 45, homeInv))).toBe(true)
    expect(sameLoad(a, null)).toBe(false)
    // Same plates, different shortfall (325 vs 330 total on one pair of each): not the same line.
    expect(sameLoad(rowLoad('pairs', 325, 45, homeInv), rowLoad('pairs', 330, 45, homeInv))).toBe(false)
  })
})
