import { describe, expect, it } from 'vitest'
import {
  MEALS, foodEntryProblem, addFood, removeFood, restoreFood, readFood, foodsOn, nutrientsOf,
  dayTotals, fromLookup, foodDays, fromNutriTrace, nutriTraceProblem,
} from './nutrition-diary.js'
import { mergeStates, resetIdsOf, STAMPED_MAPS } from './sync-merge.js'
import { STAMPED_MAPS as API_STAMPED_MAPS } from '../../../api/sync-stamps.js'

const state = (over = {}) => ({ unit: 'kg', workouts: [], routines: [], customEx: [], ...over })
const oats = { d: '2026-11-13', meal: 'breakfast', name: 'Rolled oats', amount: 60, basis: 'g',
  per100: { kcal: 372, proteinG: 13.5, carbohydrateG: 58.7, fatG: 7 } }
let n = 0
const ids = () => 'f' + (++n)

describe('an entry is checked before it is written', () => {
  it('accepts a complete entry and one with unknown nutrients', () => {
    expect(foodEntryProblem(oats)).toBe(null)
    expect(foodEntryProblem({ ...oats, per100: { kcal: null, proteinG: null, carbohydrateG: null, fatG: null } })).toBe(null)
  })
  it('refuses what cannot be a food on a label', () => {
    expect(foodEntryProblem({ ...oats, name: '  ' })).toMatch(/name/i)
    expect(foodEntryProblem({ ...oats, d: '13/11/2026' })).toMatch(/date/i)
    expect(foodEntryProblem({ ...oats, meal: 'brunch' })).toMatch(/meal/i)
    expect(foodEntryProblem({ ...oats, amount: 0 })).toMatch(/amount/i)
    expect(foodEntryProblem({ ...oats, amount: 5001 })).toMatch(/amount/i)
    expect(foodEntryProblem({ ...oats, basis: 'oz' })).toMatch(/unit/i)
    // 100 g of anything holds at most 100 g of protein and about 900 kcal (pure fat).
    expect(foodEntryProblem({ ...oats, per100: { ...oats.per100, proteinG: 101 } })).toMatch(/protein/i)
    expect(foodEntryProblem({ ...oats, per100: { ...oats.per100, kcal: 1000 } })).toMatch(/energy/i)
    expect(foodEntryProblem({ ...oats, per100: { ...oats.per100, fatG: -1 } })).toMatch(/fat/i)
  })
})

describe('the diary reads honestly', () => {
  it('scales per-100 values to the amount eaten, keeping unknown as unknown', () => {
    expect(nutrientsOf({ ...oats })).toEqual({ kcal: 223, proteinG: 8.1, carbohydrateG: 35.2, fatG: 4.2 })
    expect(nutrientsOf({ ...oats, per100: { kcal: 100, proteinG: null, carbohydrateG: 0, fatG: null } }))
      .toEqual({ kcal: 60, proteinG: null, carbohydrateG: 0, fatG: null })
  })
  it('a day total says how many entries had no value, instead of counting them as zero', () => {
    const t = dayTotals([
      { ...oats },
      { ...oats, name: 'Mystery bar', amount: 50, per100: { kcal: 400, proteinG: null, carbohydrateG: null, fatG: null } },
    ])
    expect(t).toEqual({
      kcal: 423, proteinG: 8.1, carbohydrateG: 35.2, fatG: 4.2, entries: 2,
      missing: { kcal: 0, proteinG: 1, carbohydrateG: 1, fatG: 1 },
    })
    expect(dayTotals([])).toEqual({ kcal: 0, proteinG: 0, carbohydrateG: 0, fatG: 0, entries: 0, missing: { kcal: 0, proteinG: 0, carbohydrateG: 0, fatG: 0 } })
  })
  it('lists one day in meal order, then in the order logged', () => {
    const S = state()
    addFood(S, { ...oats, meal: 'dinner', name: 'Rice' }, { now: 3, id: ids() })
    addFood(S, { ...oats }, { now: 5, id: ids() })
    addFood(S, { ...oats, name: 'Milk' }, { now: 4, id: ids() })
    addFood(S, { ...oats, d: '2026-11-12', name: 'Yesterday' }, { now: 1, id: ids() })
    expect(foodsOn(S, '2026-11-13').map(f => f.name)).toEqual(['Milk', 'Rolled oats', 'Rice'])
    expect(MEALS).toEqual(['breakfast', 'lunch', 'dinner', 'snack'])
    expect(foodDays(S)).toEqual(['2026-11-13', '2026-11-12'])
  })
})

describe('writing, removing and undoing', () => {
  it('writes a stamped entry and refuses a bad one without touching state', () => {
    const S = state()
    const id = addFood(S, oats, { now: 7, id: 'a1' })
    expect(id).toBe('a1')
    expect(S.foodLog.a1).toEqual({ ...oats, src: { kind: 'manual' }, _ts: 7 })
    expect(() => addFood(S, { ...oats, amount: -2 }, { now: 8, id: 'a2' })).toThrow(/amount/i)
    expect(Object.keys(S.foodLog)).toEqual(['a1'])
  })
  it('a removal is a stamped empty entry (so a sync cannot bring it back), and undo restores it', () => {
    const S = state()
    addFood(S, oats, { now: 7, id: 'a1' })
    const before = S.foodLog.a1
    removeFood(S, 'a1', 9)
    expect(S.foodLog.a1).toEqual({ _ts: 9 })
    expect(readFood(S.foodLog.a1)).toBe(null)
    expect(foodsOn(S, oats.d)).toEqual([])
    restoreFood(S, 'a1', before, 11)
    expect(foodsOn(S, oats.d).map(f => f.name)).toEqual(['Rolled oats'])
    expect(S.foodLog.a1._ts).toBe(11)
  })
  it('drops unknown fields and trims text from a stored entry read back', () => {
    const f = readFood({ ...oats, name: '  Oats  ', extra: '<script>', _ts: 1 })
    expect(f.name).toBe('Oats')
    expect('extra' in f).toBe(false)
  })
})

describe('from a barcode lookup', () => {
  const food = { barcode: '3017620422003', name: 'Nutella', brand: 'Ferrero', basis: '100g',
    per100: { kcal: 539, proteinG: 6.3, carbohydrateG: 57.5, fatG: 30.9, sugarG: 56.3 }, source: 'Open Food Facts' }
  it('keeps the product, its basis and where it came from', () => {
    expect(fromLookup(food, { d: '2026-11-13', meal: 'snack', amount: 15 })).toEqual({
      d: '2026-11-13', meal: 'snack', name: 'Nutella', brand: 'Ferrero', amount: 15, basis: 'g',
      per100: { kcal: 539, proteinG: 6.3, carbohydrateG: 57.5, fatG: 30.9 },
      src: { kind: 'off', code: '3017620422003' },
    })
    expect(fromLookup({ ...food, basis: '100ml' }, { d: '2026-11-13', meal: 'snack', amount: 330 }).basis).toBe('ml')
  })
})

describe('synced like every other per-entry map', () => {
  it('is merged per entry on both sides of the sync (client and server agree)', () => {
    expect(STAMPED_MAPS).toContain('foodLog')
    expect(API_STAMPED_MAPS).toEqual(STAMPED_MAPS)
  })
  it('two devices logging different foods keep both; a later removal wins over the older add', () => {
    const a = state({ _ts: 10 }), b = state({ _ts: 20 })
    addFood(a, oats, { now: 10, id: 'p1' })
    addFood(b, { ...oats, name: 'Banana' }, { now: 20, id: 'w1' })
    const m = mergeStates(a, b)
    expect(foodsOn(m, oats.d).map(f => f.name).sort()).toEqual(['Banana', 'Rolled oats'])
    const c = structuredClone(m); c._ts = 30
    removeFood(c, 'p1', 30)
    expect(foodsOn(mergeStates(c, a), oats.d).map(f => f.name)).toEqual(['Banana'])
    expect(foodsOn(mergeStates(a, c), oats.d).map(f => f.name)).toEqual(['Banana'])
  })
  it('an amount corrected on the phone survives the laptop logging something else since', () => {
    const phone = state({ _ts: 10 }), laptop = state({ _ts: 10 })
    addFood(phone, oats, { now: 5, id: 'x' }); addFood(laptop, oats, { now: 5, id: 'x' })
    addFood(phone, { ...oats, amount: 80 }, { now: 50, id: 'x' }); phone._ts = 50
    addFood(laptop, { ...oats, name: 'Coffee' }, { now: 60, id: 'y' }); laptop._ts = 60
    const m = mergeStates(laptop, phone)
    expect(readFood(m.foodLog.x).amount).toBe(80)
    expect(readFood(m.foodLog.y).name).toBe('Coffee')
  })
  it('"reset everything" takes the diary with it', () => {
    const S = state()
    addFood(S, oats, { now: 5, id: 'x' })
    expect(resetIdsOf(S).foodLog).toEqual(['x'])
  })
  it('a profile without a diary merges exactly as before', () => {
    expect('foodLog' in mergeStates(state({ _ts: 1 }), state({ _ts: 2 }))).toBe(false)
  })
})

describe('from the NutriTrace food library', () => {
  const skyr = { id: '7', name: 'Skyr', brand: 'Arla', portion: 150, unit: 'g', basis: '100g',
    per100: { kcal: 63, proteinG: 11, carbohydrateG: 4, fatG: 0.2 }, perPortion: { kcal: 95, proteinG: 16.5, carbohydrateG: 6, fatG: 0.3 } }
  it('logs grams of a food NutriTrace measures in g or mL, and remembers which food it was', () => {
    const input = fromNutriTrace(skyr, { d: '2026-11-13', meal: 'breakfast', amount: 150 })
    expect(input).toEqual({ d: '2026-11-13', meal: 'breakfast', name: 'Skyr', brand: 'Arla', amount: 150, basis: 'g',
      per100: { kcal: 63, proteinG: 11, carbohydrateG: 4, fatG: 0.2 }, src: { kind: 'nutritrace', id: '7' } })
    const S = state()
    addFood(S, input, { now: 1, id: 'n1' })
    expect(readFood(S.foodLog.n1).src).toEqual({ kind: 'nutritrace', id: '7' })
    expect(nutrientsOf(readFood(S.foodLog.n1))).toEqual({ kcal: 95, proteinG: 16.5, carbohydrateG: 6, fatG: 0.3 })
  })
  it('refuses a food it cannot weigh (a cup, a piece) instead of guessing a density', () => {
    expect(fromNutriTrace({ ...skyr, unit: 'cup', basis: null, per100: null }, { d: '2026-11-13', meal: 'lunch', amount: 1 })).toBe(null)
  })
  it('an odd source id read back from another device is dropped to manual, not trusted', () => {
    expect(readFood({ ...oats, src: { kind: 'nutritrace', id: '' } }).src).toEqual({ kind: 'manual' })
    expect(readFood({ ...oats, src: { kind: 'nutritrace', id: 'x'.repeat(65) } }).src).toEqual({ kind: 'manual' })
  })
})

describe('a NutriTrace food the diary must not take', () => {
  const base = { id: '1', name: 'Typo', portion: 1, unit: 'g', basis: '100g', perPortion: { kcal: 50 } }
  it('says why: no weight, or values no food can have (from the server, or checked here again)', () => {
    expect(nutriTraceProblem({ ...base, basis: null, per100: null, unit: 'cup' })).toBe('unweighable')
    expect(nutriTraceProblem({ ...base, per100: null, basis: null, problem: 'implausible' })).toBe('implausible')
    // An older server that did not check: the app checks the same limits itself.
    expect(nutriTraceProblem({ ...base, per100: { kcal: 5000, proteinG: null, carbohydrateG: null, fatG: null } })).toBe('implausible')
    expect(nutriTraceProblem({ ...base, per100: { kcal: 59, proteinG: 101, carbohydrateG: null, fatG: null } })).toBe('implausible')
    expect(nutriTraceProblem({ ...base, per100: { kcal: 59, proteinG: 11, carbohydrateG: 4, fatG: 0.2 } })).toBe(null)
  })
  it('never builds an entry for one, so nothing wrong reaches the diary', () => {
    expect(fromNutriTrace({ ...base, per100: { kcal: 5000, proteinG: null, carbohydrateG: null, fatG: null } }, { d: '2026-11-13', meal: 'snack', amount: 1 })).toBe(null)
    expect(fromNutriTrace({ ...base, per100: null, basis: null, problem: 'implausible' }, { d: '2026-11-13', meal: 'snack', amount: 1 })).toBe(null)
  })
  it('a portion logged as its own amount gives back exactly what NutriTrace says a portion has', () => {
    const skyr = { id: '7', name: 'Skyr', portion: 150, unit: 'g', basis: '100g',
      per100: { kcal: 63, proteinG: 11, carbohydrateG: 4, fatG: 0.2 }, perPortion: { kcal: 95, proteinG: 16.5, carbohydrateG: 6, fatG: 0.3 } }
    const S = state()
    addFood(S, fromNutriTrace(skyr, { d: '2026-11-13', meal: 'lunch', amount: skyr.portion }), { now: 1, id: 'p' })
    const n = nutrientsOf(readFood(S.foodLog.p))
    expect(Math.abs(n.kcal - skyr.perPortion.kcal)).toBeLessThanOrEqual(1)
    expect(n.proteinG).toBe(16.5)
    expect(n.carbohydrateG).toBe(6)
    expect(n.fatG).toBe(0.3)
  })
})
