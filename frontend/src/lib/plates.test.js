import { describe, expect, test } from 'vitest'
import { PLATE_SIZES, DEFAULT_PAIRS, inventoryFor, pairsOf, ownsPlates, withPlatePairs, withStandardPlates, loadKindOf, withLoadKind, plateStack, plateDelta, loadKindFor, baseWeightFor, rowLoad, sameLoad, dropGrid, cleanPlateWeight, plateSizesFor, withPlateSize, withoutPlateSize } from './plates.js'
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

  test('a list\'s stamp is not a plate, and a stamped list with no sizes is the standard set', () => {
    expect(inventoryFor({ unit: 'lb', plates: { lb: { 45: 1, _ts: 1700 } } })).toEqual([{ w: 45, n: 1 }])
    expect(ownsPlates({ unit: 'lb', plates: { lb: { 45: 1, _ts: 1700 } } })).toBe(true)
    const reset = { unit: 'lb', plates: { lb: { _ts: 1800 } } }
    expect(ownsPlates(reset)).toBe(false)
    expect(inventoryFor(reset)).toEqual(inventoryFor({ unit: 'lb' }))
    // Owning none of anything is a list of its own, not the standard set.
    const none = { unit: 'lb', plates: { lb: { 45: 0, 25: 0, _ts: 1900 } } }
    expect(ownsPlates(none)).toBe(true)
    expect(inventoryFor(none)).toEqual([])
    expect(ownsPlates({ unit: 'kg', plates: { lb: { 45: 1 } } })).toBe(false)
  })
})

describe('stored choices carry the time they were made', () => {
  test('the first count copies the standard set in; later ones change one size; both stamped', () => {
    const first = withPlatePairs({ unit: 'lb', plates: {} }, 45, 1, 100)
    expect(first).toEqual({ lb: { 45: 1, 35: 6, 25: 6, 10: 6, 5: 6, 2.5: 6, _ts: 100 } })
    const next = withPlatePairs({ unit: 'lb', plates: { ...first, kg: { 20: 2, _ts: 50 } } }, 15, 2.6, 200)
    expect(next.lb).toEqual({ 45: 1, 35: 6, 25: 6, 15: 3, 10: 6, 5: 6, 2.5: 6, _ts: 200 })
    expect(next.kg).toEqual({ 20: 2, _ts: 50 })   // the other unit is left alone
    expect(withPlatePairs({ unit: 'lb', plates: first }, 45, -3, 300).lb[45]).toBe(0)
  })

  test('back to the standard set is a stamped list with no sizes, for this unit only', () => {
    const S = { unit: 'kg', plates: { kg: { 20: 1, _ts: 100 }, lb: { 45: 1, _ts: 90 } } }
    expect(withStandardPlates(S, 200)).toEqual({ kg: { _ts: 200 }, lb: { 45: 1, _ts: 90 } })
    expect(withStandardPlates({ unit: 'kg' }, 200)).toEqual({ kg: { _ts: 200 } })
  })

  test('a load kind is stored with its time; null is the equipment\'s own, stamped too', () => {
    expect(withLoadKind(undefined, 'a', 'single', 100)).toEqual({ a: { kind: 'single', _ts: 100 } })
    expect(withLoadKind({ a: { kind: 'single', _ts: 100 } }, 'a', null, 200)).toEqual({ a: { kind: null, _ts: 200 } })
    expect(withLoadKind({}, 'a', 'weird', 100)).toEqual({ a: { kind: null, _ts: 100 } })
    expect(loadKindOf({ kind: 'none', _ts: 1 })).toBe('none')
    expect(loadKindOf({ kind: null, _ts: 1 })).toBe(null)
    expect(loadKindOf('pairs')).toBe('pairs')        // how the first builds stored it
    expect(loadKindOf('weird')).toBe(null)
    expect(loadKindOf(undefined)).toBe(null)
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

  test('beyond everything you own: every plate on, the rest missing, without a search', () => {
    expect(plateStack(200, homeInv)).toEqual({ plates: [45, 35, 25, 15, 10, 5, 2.5], missing: 62.5 })
    // A typo in a weight field is rendered on every keystroke; it must not build a table as
    // long as the number (for this one, nine arrays of four million entries).
    const t0 = performance.now()
    for (let i = 0; i < 5; i++) expect(plateStack(999999.75, homeInv).missing).toBe(999999.75 - 137.5)
    expect(performance.now() - t0).toBeLessThan(200)
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

  test('a stamped choice reads like a bare one; a stamped null is the equipment\'s own', () => {
    expect(loadKindFor({ loadKind: { [db]: { kind: 'single', _ts: 5 } } }, db)).toBe('single')
    expect(loadKindFor({ loadKind: { [barbell]: { kind: 'none', _ts: 5 } } }, barbell)).toBe('none')
    expect(loadKindFor({ loadKind: { [barbell]: { kind: null, _ts: 5 } } }, barbell)).toBe('pairs')
    expect(loadKindFor({ loadKind: { [bw]: { kind: null, _ts: 5 } } }, { id: bw, bodyweight: false })).toBe('none')
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
    // One pair of 45s is two 45s: a stack takes both plates of a pair.
    expect(rowLoad('single', 190, 100, homeInv).plates).toEqual([45, 45])
  })

  test('a single stack counts both plates of each pair you own (QA 1.3.11)', () => {
    const inv = inventoryFor({ unit: 'kg', plates: { kg: { 20: 1, 10: 1, _ts: 1 } } })
    // A sled leg press at 150 kg: 20+20+10+10 = 60 on, 90 short (was "20 + 10 · 120 short").
    expect(rowLoad('single', 150, 0, inv)).toMatchObject({ plates: [20, 20, 10, 10], missing: 90 })
    expect(rowLoad('single', 40, 0, inv)).toMatchObject({ plates: [20, 20], missing: 0 })
    // A bar still takes one plate of each pair per side.
    expect(rowLoad('pairs', 80, 20, inv)).toMatchObject({ perSide: 30, plates: [20, 10], missing: 0 })
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

// QA 1.3.9: a drop-set's weight was rounded to .5 whatever the bar could carry.
describe('dropGrid', () => {
  const barbell = idOf('barbell'), db = idOf('dumbbell')
  test('without a plate inventory of your own: the exercise\'s weight step', () => {
    expect(dropGrid({ unit: 'kg' }, { id: db, inc: 2 })).toBe(2)
    expect(dropGrid({ unit: 'kg' }, { id: barbell, inc: 1.25 })).toBe(1.25)
  })
  test('with your own plates on a bar: the heaviest load at or below the drop that they make', () => {
    // A 20 kg bar and pairs of 10s and 5s only: loads step in 10s above the bar.
    const S = { unit: 'kg', plates: { kg: { 10: 2, 5: 1, _ts: 1 } } }
    const snap = dropGrid(S, { id: barbell })
    expect(typeof snap).toBe('function')
    expect(snap(48)).toBe(40)
    expect(snap(64)).toBe(60)
    expect(snap(15)).toBe(20)      // below the bar: the bar is the lightest you can load
  })
  test('a single stack drops onto both plates of each pair', () => {
    const sled = idOf('sled machine')
    const S = { unit: 'kg', plates: { kg: { 20: 1, 10: 1, _ts: 1 } }, barWeights: { [sled]: 0 } }
    const snap = dropGrid(S, { id: sled })
    expect(snap(55)).toBe(50)      // 20+20+10, not 30 (one plate per pair)
    expect(snap(100)).toBe(60)     // everything owned
  })
  test('a dumbbell is not plate-loaded, so plates do not decide its drop', () => {
    const S = { unit: 'kg', plates: { kg: { 10: 2, _ts: 1 } } }
    expect(dropGrid(S, { id: db, inc: 2 })).toBe(2)
  })
})

describe('loads between quarter-unit boundaries', () => {
  test.each([0.1, 2.4, 2.6, 7.4, 8.1])('never exceeds %s and reports the actual deficit', weight => {
    const result = plateStack(weight, [{ w: 2.5, n: 3 }])
    const loaded = result.plates.reduce((sum, w) => sum + w, 0)
    expect(loaded).toBeLessThanOrEqual(weight)
    expect(result.missing).toBeCloseTo(weight - loaded)
  })

  test('drop sets snap to a load the counted plates can make', () => {
    const S = { unit: 'kg', plates: { kg: { 5: 3 } } }
    const snap = dropGrid(S, { id: idOf('barbell') })
    expect(snap(48.74)).toBe(40)
  })
})

// Plates of any weight (flexible-plate-sizes): added and removed like dumbbells.
describe('plates of any weight', () => {
  const kg = (plates = undefined) => ({ unit: 'kg', plates })

  test('a typed weight: above 0, below 1000, to the hundredth', () => {
    expect(cleanPlateWeight(7.5)).toBe(7.5)
    expect(cleanPlateWeight('7,5')).toBe(7.5)
    expect(cleanPlateWeight(1.255)).toBe(1.26)
    for (const bad of [0, -5, 1000, 999.995, '999,999', 1e6, 'abc', NaN, null, 0.001]) expect(cleanPlateWeight(bad)).toBeNull()
    expect(cleanPlateWeight(999.99)).toBe(999.99)
  })

  test('the first change copies the standard set in, then adds the new size at one pair', () => {
    const S = kg()
    const plates = withPlateSize(S, 7.5, 1)
    const after = { ...S, plates }
    expect(ownsPlates(after)).toBe(true)
    expect(pairsOf(after, 7.5)).toBe(1)
    for (const p of inventoryFor(S)) expect(pairsOf(after, p.w)).toBe(p.n)
    expect(plates.kg._ts).toBe(1)
  })

  test('adding a size already there changes nothing', () => {
    const S = kg({ kg: { 20: 2, 7.5: 3, _ts: 1 } })
    expect(withPlateSize(S, 7.5, 2)).toBe(S.plates)
    expect(withPlateSize(S, '7,50', 2)).toBe(S.plates)
    expect(withPlateSize(S, 'nope', 2)).toBe(S.plates)
  })

  test('removing an added size takes it off the sheet and off every load', () => {
    const S = kg({ kg: { 20: 2, 7.5: 4, _ts: 1 } })
    const after = { ...S, plates: withoutPlateSize(S, 7.5, 2) }
    expect(plateSizesFor(after).map(p => p.w)).not.toContain(7.5)
    expect(plateStack(7.5, inventoryFor(after)).plates).toEqual([])
  })

  test('the sheet lists every standard size, and added sizes marked as removable', () => {
    const S = kg({ kg: { 20: 2, 7.5: 0, _ts: 1 } })
    const sizes = plateSizesFor(S)
    expect(sizes.map(p => p.w)).toEqual([25, 20, 15, 10, 7.5, 5, 2.5, 1.25, 0.5])
    expect(sizes.find(p => p.w === 7.5)).toEqual({ w: 7.5, n: 0, custom: true })
    expect(sizes.find(p => p.w === 25)).toEqual({ w: 25, n: 0, custom: false })
    expect(inventoryFor(S).map(p => p.w)).toEqual([20])
    // no list of its own: the standard set, the uncommon sizes at 0
    expect(plateSizesFor(kg()).find(p => p.w === 0.5)).toEqual({ w: 0.5, n: 0, custom: false })
  })

  test('each unit keeps its own list', () => {
    const S = { unit: 'lb', plates: { kg: { 20: 2, _ts: 1 } } }
    const plates = withPlateSize(S, 2, 3)
    expect(plates.kg).toEqual({ 20: 2, _ts: 1 })
    expect(Object.keys(plates.lb)).toContain('2')
  })

  test('a load only the new size makes is found', () => {
    const inv = [{ w: 20, n: 2 }, { w: 7.5, n: 1 }]
    expect(rowLoad('pairs', 75, 20, inv)).toMatchObject({ perSide: 27.5, plates: [20, 7.5], missing: 0 })
  })

  test('microplates with decimals load exactly', () => {
    const inv = [{ w: 10, n: 2 }, { w: 0.1, n: 1 }]
    expect(plateStack(10.1, inv)).toEqual({ plates: [10, 0.1], missing: 0 })
    expect(rowLoad('pairs', 40.2, 20, inv)).toMatchObject({ plates: [10, 0.1], missing: 0 })
    expect(plateStack(2.2, [{ w: 2.2, n: 1 }])).toEqual({ plates: [2.2], missing: 0 })
    expect(plateStack(70.3, [{ w: 70, n: 1 }, { w: 0.3, n: 1 }]).missing).toBe(0)
  })
})

// Adversarial review of flexible-plate-sizes.
describe('plates of any weight: edge cases', () => {
  test('"7.50" and "7.5" are one size, never two that add up', () => {
    const S = { unit: 'kg', plates: { kg: { '7.50': 2, 20: 1, _ts: 1 } } }
    const plates = withPlatePairs(S, 7.5, 3, 2)
    const after = { ...S, plates }
    expect(Object.keys(plates.kg).filter(k => k !== '_ts').sort()).toEqual(['20', '7.5'])
    expect(inventoryFor(after)).toEqual([{ w: 20, n: 1 }, { w: 7.5, n: 3 }])
  })

  test('a stored size off the hundredth is read as its hundredth', () => {
    const S = { unit: 'kg', plates: { kg: { 1.125: 1, _ts: 1 } } }
    expect(inventoryFor(S)).toEqual([{ w: 1.13, n: 1 }])
  })

  test('a large rack with microplates stays fast on a heavy, reachable target', () => {
    const inv = [45, 35, 25, 10, 5, 2.5].map(w => ({ w, n: 10 })).concat([{ w: 0.33, n: 2 }])
    const t0 = performance.now()
    for (let i = 0; i < 50; i++) plateStack(300 + i * 1.37, inv)
    expect((performance.now() - t0) / 50).toBeLessThan(15)
    // whatever it returns adds up to the weight minus what it says is missing
    const r = plateStack(321.66, inv)
    expect(Math.abs(r.plates.reduce((a, b) => a + b, 0) + r.missing - 321.66)).toBeLessThan(1e-6)
  })

  test('the same question twice gets the same answer, and the answer can be changed safely', () => {
    const inv = [{ w: 20, n: 2 }, { w: 7.5, n: 1 }]
    const a = plateStack(27.5, inv)
    a.plates.push(999)
    expect(plateStack(27.5, inv)).toEqual({ plates: [20, 7.5], missing: 0 })
  })
})
