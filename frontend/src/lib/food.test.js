import { describe, it, expect } from 'vitest'
import { mealAt, foodsOn, dayTotals, totalsOf, withFood, withoutFood, recentFoods, fromOff, lookupBarcode, searchFoods } from './food.js'
import { mergeStampedMap } from './sync-merge.js'

const hagel = { d: '2026-11-09', m: 'breakfast', n: 'Puur hagelslag', b: 'Albert Heijn', c: '8710400002970', g: 20, per: [435, 5, 67, 15] }
const quick = { d: '2026-11-09', m: 'snack', n: 'Kroket', per: [250, 8, 20, 15] }

describe('food diary', () => {
  it('picks the meal from the hour', () => {
    expect([7, 12, 16, 19, 23].map(mealAt)).toEqual(['breakfast', 'lunch', 'snack', 'dinner', 'snack'])
  })

  it('scales a product by grams and takes a quick entry as it is', () => {
    expect(totalsOf(hagel)).toEqual({ kcal: 87, p: 1, c: 13.4, f: 3 })
    expect(totalsOf(quick)).toEqual({ kcal: 250, p: 8, c: 20, f: 15 })
  })

  it('adds up a day per meal and leaves cleared items and other days out', () => {
    let map = withFood({}, 'a', hagel, 1)
    map = withFood(map, 'b', quick, 2)
    map = withFood(map, 'c', { ...quick, d: '2026-11-08' }, 3)
    map = withFood(map, 'd', quick, 4)
    map = withoutFood(map, 'd', 5)
    const items = foodsOn({ foodLog: map }, '2026-11-09')
    expect(items.map(i => i.id)).toEqual(['a', 'b'])
    const t = dayTotals(items)
    expect(t.kcal).toBe(337)
    expect(t.meals.breakfast.kcal).toBe(87)
    expect(t.meals.snack.kcal).toBe(250)
    expect(t.meals.lunch.kcal).toBe(0)
  })

  it('keeps both devices\' items and a removal through a sync merge', () => {
    const phone = withFood({}, 'a', hagel, 10)
    const laptop = withoutFood(withFood(phone, 'b', quick, 11), 'a', 12)
    const merged = mergeStampedMap(phone, laptop)
    expect(foodsOn({ foodLog: merged }, '2026-11-09').map(i => i.id)).toEqual(['b'])
  })

  it('remembers recent products once each, newest first', () => {
    let map = withFood({}, 'a', hagel, 1)
    map = withFood(map, 'b', quick, 2)
    map = withFood(map, 'c', { ...hagel, g: 30 }, 3)
    const r = recentFoods({ foodLog: map })
    expect(r.map(x => x.n)).toEqual(['Puur hagelslag', 'Kroket'])
    expect(r[0].g).toBe(30)
  })

  it('reads an Open Food Facts product, kJ only included', () => {
    expect(fromOff({ code: '1', product_name_nl: 'Volle kwark', brands: 'Jumbo, Other', serving_quantity: 150, nutriments: { 'energy-kj_100g': 523, proteins_100g: 9 } }))
      .toEqual({ n: 'Volle kwark', b: 'Jumbo', c: '1', g: 150, per: [125, 9, 0, 0] })
    expect(fromOff({ product_name: 'x', nutriments: {} })).toBeNull()
  })

  it('looks up a barcode and searches Dutch products first', async () => {
    const product = { product_name: 'Puur Hagelslag', brands: 'Albert Heijn', nutriments: { 'energy-kcal_100g': 435 } }
    const ok = body => ({ ok: true, status: 200, json: async () => body })
    expect(await lookupBarcode('8710400002970', async () => ok({ status: 1, product }))).toMatchObject({ n: 'Puur Hagelslag', c: '8710400002970', g: 100 })
    expect(await lookupBarcode('123', async () => ok({ status: 0 }))).toBeNull()

    const asked = []
    const hits = await searchFoods('kwark', async url => {
      asked.push(new URL(url).searchParams.get('countries_tags_en'))
      return ok({ products: asked.length === 1 ? [] : [product] })
    })
    expect(asked).toEqual(['netherlands', null])
    expect(hits).toHaveLength(1)
  })
})
