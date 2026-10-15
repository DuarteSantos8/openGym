// Your foods as the Foods page shows and edits them. Ported from NutriTrace: the sort and the
// favourites-first order (src/routes/Foods.svelte _applySort, _renderList), the nutrient list
// (src/lib/nutrition.js NUTRIMENTS) and the editor's fields (src/routes/FoodEditor.svelte).
// No React and no network here.
import { t } from '../i18n.js'
import { atPortion, deriveSodiumSalt, foldText, matchesFood } from './diary.js'

/* ------------------------------------------------------------------ nutrients ---------------- */

// `main`: the nutrients the editor and the detail show first (NutriTrace's default set); the
// rest sit under "More nutrients". Values are per serving, in these units.
export const NUTRIENTS = [
  { id: 'calories', unit: 'kcal', main: true },
  { id: 'fat', unit: 'g', main: true },
  { id: 'saturated-fat', unit: 'g', main: true, sub: true },
  { id: 'carbohydrates', unit: 'g', main: true },
  { id: 'sugars', unit: 'g', main: true, sub: true },
  { id: 'fiber', unit: 'g', main: true, sub: true },
  { id: 'proteins', unit: 'g', main: true },
  { id: 'salt', unit: 'g', main: true },
  { id: 'sodium', unit: 'mg', main: true },
  { id: 'trans-fat', unit: 'g', sub: true },
  { id: 'polyunsaturated-fat', unit: 'g', sub: true },
  { id: 'monounsaturated-fat', unit: 'g', sub: true },
  { id: 'added-sugars', unit: 'g', sub: true },
  { id: 'cholesterol', unit: 'mg' },
  { id: 'potassium', unit: 'mg' },
  { id: 'calcium', unit: 'mg' },
  { id: 'iron', unit: 'mg' },
  { id: 'magnesium', unit: 'mg' },
  { id: 'zinc', unit: 'mg' },
  { id: 'phosphorus', unit: 'mg' },
  { id: 'caffeine', unit: 'mg' },
  { id: 'alcohol', unit: 'g' },
  { id: 'vitamin-a', unit: 'mcg' },
  { id: 'vitamin-c', unit: 'mg' },
  { id: 'vitamin-d', unit: 'mcg' },
  { id: 'vitamin-e', unit: 'mg' },
  { id: 'vitamin-k', unit: 'mcg' },
  { id: 'b1', unit: 'mg' },
  { id: 'b2', unit: 'mg' },
  { id: 'b3', unit: 'mg' },
  { id: 'b6', unit: 'mg' },
  { id: 'b9', unit: 'mcg' },
  { id: 'b12', unit: 'mcg' },
]

// Literal t() calls: the string checks only see a key written inside the call.
const LABELS = {
  calories: () => t('Calories'),
  fat: () => t('Fat'),
  'saturated-fat': () => t('Saturated fat'),
  'trans-fat': () => t('Trans fat'),
  'polyunsaturated-fat': () => t('Polyunsaturated fat'),
  'monounsaturated-fat': () => t('Monounsaturated fat'),
  carbohydrates: () => t('Carbs'),
  sugars: () => t('Sugars'),
  'added-sugars': () => t('Added sugars'),
  fiber: () => t('Fiber'),
  proteins: () => t('Protein'),
  salt: () => t('Salt'),
  sodium: () => t('Sodium'),
  cholesterol: () => t('Cholesterol'),
  potassium: () => t('Potassium'),
  calcium: () => t('Calcium'),
  iron: () => t('Iron'),
  magnesium: () => t('Magnesium'),
  zinc: () => t('Zinc'),
  phosphorus: () => t('Phosphorus'),
  caffeine: () => t('Caffeine'),
  alcohol: () => t('Alcohol'),
  'vitamin-a': () => t('Vitamin A'),
  'vitamin-c': () => t('Vitamin C'),
  'vitamin-d': () => t('Vitamin D'),
  'vitamin-e': () => t('Vitamin E'),
  'vitamin-k': () => t('Vitamin K'),
  b1: () => t('Vitamin B1'),
  b2: () => t('Vitamin B2'),
  b3: () => t('Vitamin B3'),
  b6: () => t('Vitamin B6'),
  b9: () => t('Folate (B9)'),
  b12: () => t('Vitamin B12'),
}
export const nutrientLabel = id => (LABELS[id] ? LABELS[id]() : id)

/** Rounded for display: whole above 10, one decimal above 1, else two. */
export function fmtAmount(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '0'
  const a = Math.abs(n)
  const r = a >= 10 ? Math.round(n) : a >= 1 ? Math.round(n * 10) / 10 : Math.round(n * 100) / 100
  return String(r)
}

/* ------------------------------------------------------------------ serving ------------------ */

const MASS_UNITS = new Set(['g', 'mg', 'kg', 'oz', 'lb'])
const VOLUME_UNITS = new Set(['ml', 'l', 'tsp', 'tbsp', 'fl oz', 'cup'])

/** 'g' or 'ml' when the food's serving is a mass or a volume, so "per 100 g" means something;
 *  null for a count (a piece, a slice) with no weight to scale by. */
export function per100Unit(food) {
  const unit = String(food?.unit || 'g').toLowerCase()
  if (VOLUME_UNITS.has(unit)) return 'ml'
  if (MASS_UNITS.has(unit)) return food?.nutrition_basis === 'ml' ? 'ml' : 'g'
  return null
}

/** The food at 100 g (or 100 ml): the same arithmetic as logging it at that serving. */
export function per100Of(food) {
  const unit = per100Unit(food)
  return unit ? atPortion(food, 100, unit) : null
}

/* ------------------------------------------------------------------ list --------------------- */

export const SORTS = ['alpha', 'recent', 'most']

const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''))

/** A new array, in NutriTrace's three orders: A to Z; last used first (never used at the end, by
 *  name); most used first (ties by name). */
export function sortFoods(foods, mode) {
  const list = [...(foods || [])]
  if (mode === 'recent') {
    return list.sort((a, b) => {
      const al = a.last_used_at || ''
      const bl = b.last_used_at || ''
      if (al && bl) return bl.localeCompare(al)
      if (al) return -1
      if (bl) return 1
      return byName(a, b)
    })
  }
  if (mode === 'most') return list.sort((a, b) => (b.usage_count || 0) - (a.usage_count || 0) || byName(a, b))
  return list.sort(byName)
}

/** The page's list: searched, narrowed to a category, sorted; favourites first unless searching
 *  or narrowed to a category (NutriTrace's order). */
export function visibleFoods(foods, { query = '', category = '', sort = 'alpha' } = {}) {
  let list = query.trim() ? foods.filter(f => matchesFood(f, query)) : foods
  if (category) list = list.filter(f => f.category === category)
  list = sortFoods(list, sort)
  if (query.trim() || category) return list
  return [...list.filter(f => f.favorite), ...list.filter(f => !f.favorite)]
}

/** The categories your foods use, A to Z. */
export function categoriesOf(foods) {
  return [...new Set((foods || []).map(f => f.category).filter(Boolean))].sort((a, b) => foldText(a).localeCompare(foldText(b)))
}

/** The names in the person's category setting (plain strings or { name }), for the editor. */
export const categoryChoices = settings =>
  (Array.isArray(settings?.foodCategories) ? settings.foodCategories : [])
    .map(c => (typeof c === 'string' ? c : c?.name || ''))
    .filter(Boolean)

/* ------------------------------------------------------------------ editor ------------------- */

const KJ_PER_KCAL = 4.184
const round2 = n => Math.round(n * 100) / 100

/** The unit the editor's energy field is in: the person's (NutriTrace FoodEditor: a kJ user
 *  types kJ, and it is stored as kcal). */
export const editorEnergyUnit = settings => (settings?.energyUnit === 'kJ' ? 'kJ' : 'kcal')

/** The editor's fields as text, from a saved food (or empty). Calories show in `energyUnit`. */
export function formOf(food, { energyUnit = 'kcal' } = {}) {
  const nutrients = {}
  for (const { id } of NUTRIENTS) {
    const v = food?.nutrition?.[id]
    const shown = id === 'calories' && energyUnit === 'kJ' ? Number(v) * KJ_PER_KCAL : Number(v)
    nutrients[id] = v === undefined || v === null || v === 0 || !Number.isFinite(shown) ? '' : String(round2(shown))
  }
  return {
    name: food?.name || '',
    brand: food?.brand || '',
    barcode: food?.barcode || '',
    portion: String(food?.portion ?? 100),
    unit: food?.unit || 'g',
    category: food?.category || '',
    notes: food?.notes || '',
    favorite: !!food?.favorite,
    nutrients,
  }
}

const num = s => {
  const v = String(s ?? '').trim().replace(',', '.')
  if (v === '') return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : NaN
}

// The nutrition to save: the food's own object with the edited fields over it. NutriTrace's PUT
// replaces `nutrition` whole, and a food holds more than the editor shows (kilojoules, its own
// ids, values finer than the field's two decimals), so only a field the person changed is
// written. Sodium and salt are one fact: changing one drops the other, which is derived again.
function editedNutrition(form, base, original, energyUnit) {
  const nutrition = { ...(original || {}) }
  const changed = NUTRIENTS.filter(n => form.nutrients[n.id] !== base.nutrients[n.id]).map(n => n.id)
  for (const id of changed) {
    let n = num(form.nutrients[id])
    if (Number.isNaN(n) || n < 0) return { error: `nutrient:${id}` }
    if (id === 'calories' && energyUnit === 'kJ') n = round2(n / KJ_PER_KCAL)
    if (n > 0) nutrition[id] = n
    else delete nutrition[id]
  }
  const sodium = changed.includes('sodium'), salt = changed.includes('salt')
  if (sodium && !salt) delete nutrition.salt
  if (salt && !sodium) delete nutrition.sodium
  deriveSodiumSalt(nutrition)
  return { nutrition, changed: changed.length > 0 }
}

/**
 * The editor's text as a food to save: `food` is the saved food it edits, or null for a new one
 * (which takes `clientKey`, so a retry after a lost answer saves one food). `{ error }` names the
 * first field that cannot be saved: 'name', 'portion' or 'nutrient:<id>'. An edit sends
 * `nutrition` only when a nutrient field changed. A saved food keeps the fields the editor does
 * not show (its household units, density, image) because only the edit fields are sent.
 * @returns {{ food: object } | { error: string }}
 */
export function foodOf(form, { food = null, clientKey = null, energyUnit = 'kcal' } = {}) {
  const name = form.name.trim()
  if (!name) return { error: 'name' }
  const portion = num(form.portion)
  if (!(portion > 0)) return { error: 'portion' }
  const editing = typeof food?.id === 'number'
  const made = editedNutrition(form, formOf(food, { energyUnit }), food?.nutrition, energyUnit)
  if (made.error) return { error: made.error }
  const out = {
    name,
    brand: form.brand.trim(),
    barcode: form.barcode.trim(),
    portion,
    unit: form.unit,
    category: form.category,
    notes: form.notes.trim(),
    ...(!editing || made.changed ? { nutrition: made.nutrition } : {}),
  }
  if (editing) return { food: { ...out, id: food.id, favorite: form.favorite } }
  return { food: { ...out, client_key: clientKey } }
}

/** What a failed online search tells the person; 429 is the hub's limit of 30 a minute. */
export function searchErrorText(e) {
  if (e?.code === 'offline' || e?.code === 'timeout') return t('The search did not finish: no connection.')
  if (e?.status === 429) return t('Too many searches. Wait a moment and try again.')
  return t('The search did not work. Try again.')
}

/** What a failed food read or write tells the person; never the error's own message. */
export function foodErrorText(e, { write = false } = {}) {
  if (e?.code === 'offline' || e?.code === 'timeout') return write ? t('Not saved: no connection. Try again when you are back online.') : t('Foods did not load: no connection.')
  if (e?.status === 401) return write ? t('Not saved: you are signed out. Sign in and try again.') : t('Foods did not load: you are signed out.')
  return write ? t('The food was not saved. Try again.') : t('Foods did not load.')
}
