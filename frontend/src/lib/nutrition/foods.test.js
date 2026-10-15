import { describe, expect, it } from 'vitest'
import { categoriesOf, foodOf, formOf, per100Of, per100Unit, sortFoods, visibleFoods } from './foods.js'

const food = (over = {}) => ({ id: 1, name: 'Oats', brand: '', portion: 100, unit: 'g', nutrition: { calories: 380, proteins: 13 }, usage_count: 0, last_used_at: null, ...over })

describe('per 100', () => {
  it('scales a serving of a mass or volume to 100, and says nothing for a count', () => {
    const bar = food({ portion: 40, nutrition: { calories: 160, proteins: 12 } })
    expect(per100Unit(bar)).toBe('g')
    expect(per100Of(bar).nutrition).toEqual({ calories: 400, proteins: 30 })
    const milk = food({ portion: 250, unit: 'ml', nutrition: { calories: 120 } })
    expect(per100Unit(milk)).toBe('ml')
    expect(per100Of(milk).nutrition.calories).toBeCloseTo(48)
    expect(per100Unit(food({ unit: 'piece' }))).toBeNull()
    expect(per100Of(food({ unit: 'piece' }))).toBeNull()
  })
})

describe('the list', () => {
  const list = [
    food({ id: 1, name: 'Bread', usage_count: 3, last_used_at: '2026-10-10' }),
    food({ id: 2, name: 'apple' }),
    food({ id: 3, name: 'Cheese', usage_count: 9, last_used_at: '2026-10-13', favorite: 1, category: 'Dairy' }),
    food({ id: 4, name: 'Butter', category: 'Dairy' }),
  ]
  const ids = fs => fs.map(f => f.id)

  it('sorts as NutriTrace does and does not touch the input', () => {
    const copy = [...list]
    expect(ids(sortFoods(list, 'alpha'))).toEqual([2, 1, 4, 3])
    expect(ids(sortFoods(list, 'recent'))).toEqual([3, 1, 2, 4])
    expect(ids(sortFoods(list, 'most'))).toEqual([3, 1, 2, 4])
    expect(list).toEqual(copy)
  })

  it('puts favourites first unless searching or narrowed to a category', () => {
    expect(ids(visibleFoods(list, {}))).toEqual([3, 2, 1, 4])
    expect(ids(visibleFoods(list, { category: 'Dairy' }))).toEqual([4, 3])
    expect(ids(visibleFoods(list, { query: 'b' }))).toEqual([1, 4])
  })

  it('names the categories in use', () => {
    expect(categoriesOf(list)).toEqual(['Dairy'])
  })
})

describe('the editor', () => {
  it('round-trips a food through the form, and an edit with no nutrient changed sends no nutrition', () => {
    const f = food({ brand: 'Quaker', category: 'Pantry', notes: 'n', nutrition: { calories: 380, proteins: 13.5, sodium: 20 } })
    const { food: out } = foodOf(formOf(f), { food: f })
    expect(out).toMatchObject({ id: 1, name: 'Oats', brand: 'Quaker', portion: 100, unit: 'g', category: 'Pantry', notes: 'n', favorite: false })
    expect(out).not.toHaveProperty('nutrition')
  })

  // NutriTrace's PUT replaces `nutrition` whole: what the editor does not show, and values finer
  // than its fields, must come back as they went.
  const rich = () => food({ nutrition: { calories: 112.5, kilojoules: 470, 'omega-3': 0.3, 'saturated-fat': 0.004, proteins: 2.5 } })

  it('keeps every nutrient when only Favorite changes', () => {
    const f = rich()
    const { food: out } = foodOf({ ...formOf(f), favorite: true }, { food: f })
    expect(out.favorite).toBe(true)
    expect(out).not.toHaveProperty('nutrition')
  })

  it('writes a changed nutrient over the food\'s own nutrition, untouched values unrounded', () => {
    const f = rich()
    const form = formOf(f)
    const { food: out } = foodOf({ ...form, nutrients: { ...form.nutrients, proteins: '3' } }, { food: f })
    expect(out.nutrition).toEqual({ calories: 112.5, kilojoules: 470, 'omega-3': 0.3, 'saturated-fat': 0.004, proteins: 3 })
  })

  it('drops a nutrient that is cleared, and derives salt again when sodium changes', () => {
    const f = food({ nutrition: { calories: 100, fat: 2, sodium: 400, salt: 1, kilojoules: 418 } })
    const form = formOf(f)
    const { food: out } = foodOf({ ...form, nutrients: { ...form.nutrients, fat: '', sodium: '800' } }, { food: f })
    expect(out.nutrition).toEqual({ calories: 100, sodium: 800, salt: 2, kilojoules: 418 })
  })

  it('shows and takes energy in kJ for a kJ user, and stores kcal', () => {
    const f = food({ nutrition: { calories: 100, proteins: 5 } })
    const form = formOf(f, { energyUnit: 'kJ' })
    expect(form.nutrients.calories).toBe('418.4')
    const untouched = foodOf({ ...form, nutrients: { ...form.nutrients, proteins: '6' } }, { food: f, energyUnit: 'kJ' }).food
    expect(untouched.nutrition.calories).toBe(100)
    const typed = foodOf({ ...form, nutrients: { ...form.nutrients, calories: '836.8' } }, { food: f, energyUnit: 'kJ' }).food
    expect(typed.nutrition.calories).toBe(200)
    const fresh = formOf(null, { energyUnit: 'kJ' })
    expect(foodOf({ ...fresh, name: 'Tea', nutrients: { ...fresh.nutrients, calories: '41.84' } }, { clientKey: 'k', energyUnit: 'kJ' }).food.nutrition).toEqual({ calories: 10 })
  })

  it('refuses what cannot be saved, naming the first field', () => {
    const base = formOf(null)
    expect(foodOf(base)).toEqual({ error: 'name' })
    expect(foodOf({ ...base, name: 'x', portion: '0' })).toEqual({ error: 'portion' })
    expect(foodOf({ ...base, name: 'x', nutrients: { ...base.nutrients, fat: '-1' } })).toEqual({ error: 'nutrient:fat' })
    expect(foodOf({ ...base, name: 'x', nutrients: { ...base.nutrients, fat: 'a lot' } })).toEqual({ error: 'nutrient:fat' })
  })

  it('reads a comma as a decimal point, and gives a new food its key once', () => {
    const base = { ...formOf(null), name: 'Skyr', nutrients: { ...formOf(null).nutrients, proteins: '11,5' } }
    const a = foodOf(base, { clientKey: 'k1' }).food
    expect(a.nutrition.proteins).toBe(11.5)
    expect(a.client_key).toBe('k1')
    expect(a).not.toHaveProperty('id')
    expect(a).not.toHaveProperty('favorite')
  })
})
