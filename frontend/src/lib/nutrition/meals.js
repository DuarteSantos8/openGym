// Saved meals and recipes, ported from NutriTrace (src/routes/MealEditor.svelte, Foods.svelte
// _expandMealToDiary, stores/diary.js addDiaryItem). A recipe is a meal with `is_recipe`.
//
//  - A saved meal is a list of ingredients (foods at the amount used). Logging it adds each
//    ingredient to the diary at that amount; the meal is not a diary entry itself.
//  - A recipe makes N servings. It is stored per serving (nutrition and portion), and logging it
//    adds one entry, the recipe, for the servings eaten.
//
// No React and no network here.
import { t } from '../i18n.js'
import { atPortion, foodItem, gramsOfPortion, invalid, nutritionOf, scaleFactor, sumNutrition } from './diary.js'

const positive = v => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null }
const decimal = v => parseFloat(String(v ?? '').replace(',', '.'))
const round2 = n => Math.round(n * 100) / 100

// How a recipe's total weight is guessed from its ingredients (MealEditor.svelte toGrams). Its
// table had no kg, l, lb or slice, so those counted as 1 g; the real mass and volume table is used
// here, and the food's own household units. A piece or serving with no size is 100 g, as in
// NutriTrace; any other unit with no weight adds nothing rather than a made-up gram.
const UNSIZED = { piece: 100, serving: 100 }
const gramsOf = item => {
  const portion = parseFloat(item.portion) || 0
  const g = gramsOfPortion(portion, item.unit, item) ?? portion * (UNSIZED[item.unit] ?? 0)
  return g * (parseFloat(item.quantity) || 1)
}
const gramsOfAll = items => Math.round(items.reduce((s, i) => s + gramsOf(i), 0))

/** The nutrients of a list of ingredients, added up. */
export const totalOf = items => sumNutrition((items || []).map(nutritionOf))

/** kcal of one ingredient list, or of a recipe's one serving. */
export const mealKcal = meal => Math.round((meal.is_recipe ? nutritionOf({ nutrition: meal.nutrition }) : totalOf(meal.items)).calories || 0)

/** A recipe's servings; one for a recipe saved before servings existed. */
export const servingsOf = recipe => Math.max(1, parseInt(recipe?.servings, 10) || 1)

/** The food kept as an ingredient: the food at `amount` `unit` with its nutrients for that amount
 *  (MealEditor.svelte confirmPortion). Throws invalid unless amount is a number above 0. */
export function ingredientOf(food, amount, unit) {
  const total = positive(amount)
  if (total == null) throw invalid('amount must be a number above 0')
  const at = atPortion(food, total, unit || food.unit)
  const { id, name, brand, nutrition_basis, alt_units, density_g_ml } = food
  return { id, name, brand, nutrition_basis, alt_units, density_g_ml, portion: total, unit: at.unit, quantity: 1, nutrition: at.nutrition }
}

/** An ingredient at another amount, its nutrients scaled from what they were. */
export function rescaleIngredient(item, amount, unit) {
  const total = positive(amount)
  if (total == null) throw invalid('amount must be a number above 0')
  const before = (parseFloat(item.portion) || 100) * (parseFloat(item.quantity) || 1)
  const f = scaleFactor(before, item.unit || 'g', total, unit, item)
  const nutrition = Object.fromEntries(Object.entries(nutritionOf(item)).map(([k, v]) => [k, v * f]))
  return { ...item, portion: total, unit, quantity: 1, nutrition }
}

/** What the ingredient reads as: "120 g". */
export const amountOf = item => {
  const n = (parseFloat(item.portion) || 0) * (parseFloat(item.quantity) || 1)
  return `${Math.round(n * 100) / 100} ${item.unit || 'g'}`
}

/* ------------------------------------------------------------------ the editor's form -------- */

/** The editor's fields for a new meal or recipe, or for the saved one being edited. Numbers are
 *  strings, as typed. */
export function formOf(meal, { recipe }) {
  const items = Array.isArray(meal?.items) ? meal.items : []
  return {
    name: meal?.name || '',
    notes: meal?.notes || '',
    items,
    // What the ingredients were when the editor opened: an edit sends them only if they changed.
    baseItems: items,
    unit: meal?.unit || 'g',
    amount: recipe && meal ? String(round2((parseFloat(meal.portion) || 0) * servingsOf(meal)) || gramsOfAll(items) || '') : '',
    // A recipe saved before servings existed has none: the field stays blank until the person
    // sets one, and saving leaves it unset (NutriTrace keeps null rather than filling in 1).
    servings: !meal ? '1' : meal.servings == null ? '' : String(servingsOf(meal)),
    // The person typed a total weight: adding an ingredient no longer replaces it.
    amountTyped: false,
  }
}

/** The form with other ingredients. A recipe's total weight follows them, as in NutriTrace, until
 *  the person types a weight of their own. */
export function withItems(form, items, { recipe }) {
  if (!recipe || form.amountTyped) return { ...form, items }
  const grams = gramsOfAll(items)
  return { ...form, items, unit: 'g', amount: grams > 0 ? String(grams) : '' }
}

const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const scaled = (nutrition, f) => Object.fromEntries(Object.entries(nutrition || {}).map(([k, v]) => [k, v * f]))

/**
 * The body to save, or why not: `error` is 'name', 'items', 'servings' or 'amount'. A recipe is
 * saved per serving: its total weight and nutrients divided by the servings it makes.
 *
 * A new one sends everything. An edit (`original`, the saved meal) sends only what changed, because
 * NutriTrace's PUT keeps any field left out: a rename must not rewrite the ingredients (the hub
 * lets through ten fields of each) or recompute the totals of a recipe imported from CookTrace,
 * whose own rollup NutriTrace deliberately keeps (MealEditor.svelte save()). Changing only the
 * servings or the weight of a recipe rescales its stored per-serving values instead.
 * @returns {{ error: string } | { meal: object }}
 */
export function mealOf(form, { recipe, clientKey = null, original = null }) {
  const name = form.name.trim()
  if (!name) return { error: 'name' }
  if (!form.items.length) return { error: 'items' }
  const notes = form.notes.trim()
  const blankServings = form.servings === '' && original != null && original.servings == null
  const servings = blankServings ? 1 : Number(form.servings)
  if (recipe && (!Number.isInteger(servings) || servings < 1)) return { error: 'servings' }
  const start = original ? formOf(original, { recipe }) : null
  const amount = form.amount === '' ? gramsOfAll(form.items) || 100 : decimal(form.amount)
  if (recipe && !(amount > 0)) return { error: 'amount' }

  if (!original) {
    const body = { name, notes, items: form.items, is_recipe: recipe }
    if (clientKey) body.client_key = clientKey
    const total = totalOf(form.items)
    if (!recipe) return { meal: { ...body, nutrition: total } }
    return { meal: { ...body, portion: amount / servings, unit: form.unit || 'g', servings, nutrition: scaled(total, 1 / servings) } }
  }

  const body = {}
  if (name !== original.name) body.name = name
  if (notes !== (original.notes || '').trim()) body.notes = notes
  const itemsChanged = !sameJson(form.items, form.baseItems)
  if (itemsChanged) {
    body.items = form.items
    const total = totalOf(form.items)
    if (!recipe) body.nutrition = total
    else Object.assign(body, { portion: amount / servings, unit: form.unit || 'g', nutrition: scaled(total, 1 / servings) })
  } else if (recipe) {
    const before = servingsOf(original)
    if (servings !== before) {
      body.nutrition = scaled(nutritionOf({ nutrition: original.nutrition }), before / servings)
      // An import with no stored weight (CookTrace) has nothing to scale: the weight shown is used.
      const stored = parseFloat(original.portion)
      body.portion = stored > 0 ? stored * before / servings : amount / servings
    }
    if (form.amount !== start.amount) body.portion = amount / servings
  }
  if (recipe && !blankServings && (itemsChanged || form.servings !== start.servings)) body.servings = servings
  return { meal: body }
}

/* ------------------------------------------------------------------ logging ------------------ */

/**
 * What logging a meal or recipe adds to a day, built once: keep it and send the same one on a
 * retry (store.js logMeal), so a save whose answer was lost does not log twice.
 *  - a meal: every ingredient, at its saved amount;
 *  - a recipe: one entry for `servings` servings.
 * Throws invalid for a meal without ingredients, or servings that are not a number above 0.
 * @returns {{ meal: import('./api.js').Meal, items: object[] }}
 */
export function mealDraft(meal, { slot, servings = 1 }) {
  if (meal.is_recipe) {
    const food = { id: meal.id, name: meal.name, brand: '', portion: meal.portion, unit: meal.unit, nutrition: meal.nutrition, is_recipe: true }
    return { meal, items: [foodItem(food, { meal: slot, quantity: servings })] }
  }
  if (!Array.isArray(meal.items) || !meal.items.length) throw invalid('a meal needs ingredients')
  return { meal, items: meal.items.map(i => foodItem(i, { meal: slot, quantity: i.quantity || 1 })) }
}

/* ------------------------------------------------------------------ text --------------------- */

/** What to tell the person about a failed read of the lists (a failed write: log-feedback.js
 *  writeErrorText). Never the error's own message. */
export function mealLoadErrorText(e) {
  if (e?.code === 'offline' || e?.code === 'timeout') return t('Could not load: no connection.')
  if (e?.code === 'http' && e.status === 401) return t('Could not load: you are signed out.')
  return t('Could not load. Try again.')
}

/** The editor's refusal of a form, as the sentence under it. */
export function problemText(error) {
  if (error === 'name') return t('Give it a name.')
  if (error === 'items') return t('Add at least one ingredient.')
  if (error === 'servings') return t('Servings must be a whole number, 1 or more.')
  return t('The total weight must be above 0.')
}

/** The list in name order, as NutriTrace answers it. */
export const sortedByName = list => [...list].sort((a, b) => String(a.name).localeCompare(String(b.name)))
