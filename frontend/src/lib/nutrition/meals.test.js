import { describe, expect, it } from 'vitest'
import { parentOf, tabOf } from '../tab-route.js'
import { nutritionOf } from './diary.js'
import { fixtureFoods, fixtureMeals } from './fake-nutritrace.js'
import { formOf, ingredientOf, mealDraft, mealKcal, mealOf, rescaleIngredient, withItems } from './meals.js'

const [meal, recipe] = fixtureMeals()
const oats = { ...fixtureFoods()[0], imgUrl: '' }

describe('pages', () => {
  it('belong to the Nutrition tab and go back to it', () => {
    expect(tabOf('/food/meals')).toBe('food')
    expect(tabOf('/food/recipes')).toBe('food')
    expect(parentOf('/food/meals')).toBe('/food')
    expect(parentOf('/food/recipes')).toBe('/food')
  })
})

describe('ingredients', () => {
  it('keep the food at the amount used, with its nutrients for that amount', () => {
    const item = ingredientOf(oats, 60, 'g')
    expect(item).toMatchObject({ id: 11, name: 'Rolled oats', portion: 60, unit: 'g', quantity: 1 })
    expect(item.nutrition.calories).toBeCloseTo(228)
    expect(item).not.toHaveProperty('imgUrl')
  })

  it('scale across units and refuse an amount that is not above 0', () => {
    expect(ingredientOf(oats, 1, 'kg').nutrition.calories).toBeCloseTo(3800)
    expect(() => ingredientOf(oats, 0, 'g')).toThrow(expect.objectContaining({ code: 'invalid' }))
    expect(rescaleIngredient(ingredientOf(oats, 60, 'g'), 120, 'g').nutrition.calories).toBeCloseTo(456)
  })
})

describe('what a form saves', () => {
  it('is a meal whose nutrients are the total of its ingredients', () => {
    const made = mealOf({ ...formOf(meal, { recipe: false }), name: ' Oats and bread ' }, { recipe: false })
    expect(made.meal).toMatchObject({ name: 'Oats and bread', is_recipe: false, notes: 'Weekday breakfast' })
    expect(made.meal.nutrition.calories).toBeCloseTo(354)
    expect(made.meal).not.toHaveProperty('servings')
  })

  it('is a recipe stored per serving: weight and nutrients divided by the servings', () => {
    const form = formOf(recipe, { recipe: true })
    expect(form).toMatchObject({ amount: '1200', servings: '4', unit: 'g' })
    const { meal: body } = mealOf({ ...form, servings: '3' }, { recipe: true })
    expect(body).toMatchObject({ is_recipe: true, servings: 3, portion: 400, unit: 'g' })
    expect(body.nutrition.calories).toBeCloseTo(280)
  })

  it('takes the total weight from the ingredients until it is typed, and again when they change', () => {
    const empty = formOf(null, { recipe: true })
    const two = withItems(empty, [ingredientOf(oats, 60, 'g'), ingredientOf(oats, 140, 'g')], { recipe: true })
    expect(two.amount).toBe('200')
    expect(mealOf({ ...two, name: 'Porridge', amount: '' }, { recipe: true }).meal.portion).toBe(200)
  })

  it('says what is missing', () => {
    const form = formOf(recipe, { recipe: true })
    expect(mealOf({ ...form, name: '  ' }, { recipe: true })).toEqual({ error: 'name' })
    expect(mealOf({ ...form, items: [] }, { recipe: true })).toEqual({ error: 'items' })
    expect(mealOf({ ...form, servings: '' }, { recipe: true })).toEqual({ error: 'servings' })
    expect(mealOf({ ...form, servings: '0' }, { recipe: true })).toEqual({ error: 'servings' })
    expect(mealOf({ ...form, amount: '0' }, { recipe: true })).toEqual({ error: 'amount' })
  })

  it('carries the key a retry needs, on a create', () => {
    expect(mealOf(formOf(meal, { recipe: false }), { recipe: false, clientKey: 'k-1' }).meal.client_key).toBe('k-1')
    expect(mealOf(formOf(meal, { recipe: false }), { recipe: false }).meal).not.toHaveProperty('client_key')
  })
})

describe('logging', () => {
  it('a meal adds each ingredient at its saved amount, in the chosen meal', () => {
    const draft = mealDraft(meal, { slot: 2 })
    expect(draft.items.map(i => [i.name, i.meal, i.quantity, i.food_server_id])).toEqual([['Rolled oats', 2, 1, 11], ['Wholemeal bread', 2, 1, 12]])
    expect(new Set(draft.items.map(i => i.uuid)).size).toBe(2)
    expect(draft.items.reduce((s, i) => s + nutritionOf(i).calories, 0)).toBeCloseTo(354)
  })

  it('a recipe adds one entry for the servings eaten', () => {
    const { items } = mealDraft(recipe, { slot: 1, servings: 1.5 })
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ id: 22, is_recipe: true, name: 'Lentil soup', meal: 1, quantity: 1.5, portion: 300, unit: 'g' })
    expect(nutritionOf(items[0]).calories).toBeCloseTo(315)
  })

  it('refuses servings that are not above 0 and a meal with nothing in it', () => {
    expect(() => mealDraft(recipe, { slot: 0, servings: 0 })).toThrow(expect.objectContaining({ code: 'invalid' }))
    expect(() => mealDraft({ ...meal, items: [] }, { slot: 0 })).toThrow(expect.objectContaining({ code: 'invalid' }))
  })

  it('shows a meal at its total and a recipe at one serving', () => {
    expect(mealKcal(meal)).toBe(354)
    expect(mealKcal(recipe)).toBe(210)
  })
})

describe('an edit sends only what changed', () => {
  const edit = (saved, change, opts = {}) => {
    const recipeMode = !!saved.is_recipe
    return mealOf({ ...formOf(saved, { recipe: recipeMode }), ...change }, { recipe: recipeMode, original: saved, ...opts })
  }
  // A recipe imported from CookTrace: ingredients carry more than the hub lets through, and the
  // stored totals are the source's own rollup, not the sum of the ingredients.
  const imported = {
    ...recipe,
    source_app: 'cooktrace',
    nutrition: { calories: 999, proteins: 20, carbohydrates: 50, fat: 9 },
    items: recipe.items.map(i => ({ ...i, imgUrl: 'https://ct/x.jpg', barcode: '1' })),
  }

  it('a rename sends the name and nothing else', () => {
    expect(edit(meal, { name: 'Oats' }).meal).toEqual({ name: 'Oats' })
    expect(edit(imported, { name: 'Soup' }).meal).toEqual({ name: 'Soup' })
    expect(edit(meal, {}).meal).toEqual({})
  })

  it('changed notes are sent trimmed, unchanged notes are not', () => {
    expect(edit(meal, { notes: ' Lunch ' }).meal).toEqual({ notes: 'Lunch' })
    expect(edit({ ...meal, notes: null }, {}).meal).toEqual({})
  })

  it('changed ingredients send the items and recompute the totals', () => {
    const form = formOf(meal, { recipe: false })
    const { meal: body } = edit(meal, { items: form.items.slice(0, 1) })
    expect(Object.keys(body).sort()).toEqual(['items', 'nutrition'])
    expect(body.nutrition.calories).toBeCloseTo(228)
  })

  it('a recipe whose ingredients changed is saved per serving again', () => {
    const form = formOf(imported, { recipe: true })
    const { meal: body } = edit(imported, { items: form.items.slice(0, 1) })
    expect(body).toMatchObject({ portion: 300, unit: 'g', servings: 4 })
    expect(body.nutrition.calories).toBeCloseTo(150)
  })

  it('only the servings changing rescales the stored per-serving values', () => {
    const { meal: body } = edit(imported, { servings: '8' })
    expect(body).toMatchObject({ servings: 8, portion: 150 })
    expect(body.nutrition.calories).toBeCloseTo(499.5)
    expect(body).not.toHaveProperty('items')
  })

  it('only the total weight changing moves the portion', () => {
    const { meal: body } = edit(recipe, { amount: '2400' })
    expect(body).toEqual({ portion: 600 })
  })

  it('a recipe with no servings stays unset until the person sets one', () => {
    const legacy = { ...recipe, servings: null }
    expect(formOf(legacy, { recipe: true }).servings).toBe('')
    expect(edit(legacy, { name: 'Soup' }).meal).toEqual({ name: 'Soup' })
    expect(edit(legacy, { items: legacy.items.slice(0, 1) }).meal).not.toHaveProperty('servings')
    const { meal: body } = edit(legacy, { servings: '2' })
    expect(body).toMatchObject({ servings: 2, portion: 150 })
    expect(body.nutrition.calories).toBeCloseTo(105)
  })

  it('a new meal still sends everything', () => {
    const made = mealOf(formOf(meal, { recipe: false }), { recipe: false, clientKey: 'k' })
    expect(Object.keys(made.meal).sort()).toEqual(['client_key', 'is_recipe', 'items', 'name', 'notes', 'nutrition'])
  })
})

describe('a recipe\'s total weight', () => {
  const food = u => ({ ...ingredientOf(oats, 1, 'g'), portion: 1, unit: u })
  const weight = items => withItems(formOf(null, { recipe: true }), items, { recipe: true }).amount

  it('counts kg, l, lb and a food\'s own slice at their real weight', () => {
    expect(weight([food('kg')])).toBe('1000')
    expect(weight([food('l')])).toBe('1000')
    expect(weight([food('lb')])).toBe('454')
    expect(weight([{ ...food('slice'), alt_units: [{ abbr: 'slice', grams: 36 }] }])).toBe('36')
  })

  it('keeps a piece at 100 g as NutriTrace does, and a unit with no weight adds nothing', () => {
    expect(weight([food('piece')])).toBe('100')
    expect(weight([food('slice')])).toBe('')
  })

  it('is not replaced by the ingredients once it has been typed', () => {
    const typed = { ...formOf(null, { recipe: true }), amount: '750', amountTyped: true }
    expect(withItems(typed, [ingredientOf(oats, 60, 'g')], { recipe: true }).amount).toBe('750')
  })
})
