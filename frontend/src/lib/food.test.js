import { describe, it, expect } from 'vitest'
import { foodCSV, copyMeal, savedMeals, withSavedMeal, savedMealTotal, waterOn, withWater, weekOf, mealAt, foodsOn, dayTotals, totalsOf, withFood, withoutFood, recentFoods, fromOff, lookupBarcode, searchFoods } from './food.js'
import { mergeStampedMap } from './sync-merge.js'

const hagel = { d: '2026-11-09', m: 'breakfast', n: 'Puur hagelslag', b: 'Albert Heijn', c: '8710400002970', g: 20, per: [435, 5, 67, 15] }
const quick = { d: '2026-11-09', m: 'snack', n: 'Kroket', per: [250, 8, 20, 15] }

describe('food diary', () => {
  it('picks the meal from the hour', () => {
    expect([7, 12, 16, 19, 23].map(mealAt)).toEqual(['breakfast', 'lunch', 'snack', 'dinner', 'snack'])
  })

  it('scales a product by grams and takes a quick entry as it is', () => {
    expect(totalsOf(hagel)).toEqual({ kcal: 87, p: 1, c: 13.4, f: 3, fib: 0, sug: 0, salt: 0 })
    expect(totalsOf(quick)).toEqual({ kcal: 250, p: 8, c: 20, f: 15, fib: 0, sug: 0, salt: 0 })
    expect(totalsOf({ ...hagel, per: [435, 5, 67, 15, 7, 64, 0.3] })).toMatchObject({ fib: 1.4, sug: 12.8, salt: 0.1 })
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
      .toEqual({ n: 'Volle kwark', b: 'Jumbo', c: '1', g: 150, s: 150, per: [125, 9, 0, 0, 0, 0, 0] })
    expect(fromOff({ product_name: 'x', nutriments: {} })).toBeNull()
  })

  it('asks this server first, Open Food Facts straight when the server has no such route', async () => {
    const product = { product_name: 'Puur Hagelslag', brands: 'Albert Heijn', nutriments: { 'energy-kcal_100g': 435 } }
    const json = body => ({ ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: async () => body })
    const html = { ok: true, status: 200, headers: new Headers({ 'content-type': 'text/html' }) }
    const server = async url => json(url.startsWith('/api/food/product/') ? { product } : { products: [product] })
    expect(await lookupBarcode('8710400002970', server)).toMatchObject({ n: 'Puur Hagelslag', c: '8710400002970', g: 100 })
    expect(await searchFoods('hagel', server)).toHaveLength(1)

    const asked = []
    const direct = async url => {
      if (url.startsWith('/api/')) return html
      asked.push(new URL(url).searchParams.get('countries_tags_en'))
      return json(url.includes('/product/') ? { status: 0 } : { products: asked.length === 1 ? [] : [product] })
    }
    expect(await lookupBarcode('123', direct)).toBeNull()
    asked.length = 0
    expect(await searchFoods('kwark', direct)).toHaveLength(1)
    expect(asked).toEqual(['netherlands', null])
    // Answered once, kept for the session.
    expect(await searchFoods('Kwark', async () => { throw new Error('offline') })).toHaveLength(1)
  })
})

describe('food diary next to an app build without it', () => {
  it('stamps foodLog as a setting, so an older merge keeps the newer diary', async () => {
    const { stampEdits } = await import('./sync-merge.js')
    const prev = { foodLog: {} }
    const next = stampEdits(prev, { foodLog: withFood({}, 'a', hagel, 5) }, 99)
    expect(next.edited.foodLog).toBe(99)
  })
})

describe('food diary extras', () => {
  const shift = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }

  it('copies a meal to another day under new ids', () => {
    let map = withFood({}, 'a', hagel, 1)
    map = withFood(map, 'b', quick, 2)
    let n = 0
    map = copyMeal(map, '2026-11-09', '2026-11-10', 'breakfast', () => 'new' + n++, 3)
    expect(foodsOn({ foodLog: map }, '2026-11-10').map(i => [i.id, i.n, i.m])).toEqual([['new0', 'Puur hagelslag', 'breakfast']])
  })

  it('saves a meal and adds up its total', () => {
    const map = withSavedMeal({}, 'm1', ' Ontbijt ', [hagel, { ...hagel, g: 40 }], 5)
    const [m] = savedMeals({ foodMeals: { ...map, gone: { _ts: 6 } } })
    expect(m).toMatchObject({ id: 'm1', n: 'Ontbijt' })
    expect(m.items).toHaveLength(2)
    expect(savedMealTotal(m).kcal).toBe(261)
  })

  it('keeps water per day', () => {
    const map = withWater({}, '2026-11-09', 750, 1)
    expect(waterOn({ foodWater: map }, '2026-11-09')).toBe(750)
    expect(waterOn({ foodWater: map }, '2026-11-08')).toBe(0)
  })

  it('averages a week over the days with something logged', () => {
    let map = withFood({}, 'a', quick, 1)
    map = withFood(map, 'b', { ...quick, d: '2026-11-07', per: [350, 0, 0, 0] }, 2)
    const w = weekOf({ foodLog: map }, '2026-11-09', shift)
    expect(w.days).toHaveLength(7)
    expect(w.days.at(-1).d).toBe('2026-11-09')
    expect(w.logged).toBe(2)
    expect(w.avg.kcal).toBe(300)
  })
})

describe('food export', () => {
  it('writes one row per item, quoting names with commas', () => {
    let map = withFood({}, 'a', { ...quick, n: 'Kroket, groot' }, 1)
    map = withFood(map, 'b', hagel, 2)
    const lines = foodCSV({ foodLog: map }).trim().split('\n')
    expect(lines).toHaveLength(3)
    expect(lines[1]).toBe('2026-11-09,breakfast,Puur hagelslag,Albert Heijn,8710400002970,20,87,1,13.4,3,0,0,0')
    expect(lines[2]).toContain('"Kroket, groot"')
  })
})
