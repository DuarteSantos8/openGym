// The diary's arithmetic, ported from NutriTrace so the app adds up a day exactly as NutriTrace
// does: src/lib/nutrition.js (Nutrition.calculate, sum, deriveSodiumSalt), src/lib/units.js
// (scaleFactor), src/lib/goal-resolver.js and src/routes/Diary.svelte (the calorie target),
// src/stores/diary.js (item shape and the write payload), src/lib/search-text.js (folding).
// No React and no network here.

/* ------------------------------------------------------------------ nutrition ---------------- */

const SODIUM_MG_PER_SALT_G = 400
const present = v => v != null && v !== '' && Number(v) > 0

/** Fills whichever of sodium (mg) and salt (g) is missing from the other. Mutates and returns it. */
export function deriveSodiumSalt(nutrition) {
  if (!nutrition || typeof nutrition !== 'object') return nutrition
  const hasSodium = present(nutrition.sodium)
  const hasSalt = present(nutrition.salt)
  if (hasSodium === hasSalt) return nutrition
  if (hasSodium) nutrition.salt = Math.round((Number(nutrition.sodium) / SODIUM_MG_PER_SALT_G) * 1000) / 1000
  else nutrition.sodium = Math.round(Number(nutrition.salt) * SODIUM_MG_PER_SALT_G * 10) / 10
  return nutrition
}

// The flat nutrient fields legacy items carry instead of a `nutrition` object.
const FLAT_IDS = ['calories', 'fat', 'saturated-fat', 'carbohydrates', 'sugars', 'fiber', 'proteins', 'sodium', 'salt']

/** One diary item's nutrients: per-serving values × quantity (servings). */
export function nutritionOf(item) {
  if (!item) return {}
  if (Array.isArray(item._splitItems) && item._splitItems.length > 0) return sumNutrition(item._splitItems.map(nutritionOf))
  const factor = parseFloat(item.quantity) || 1
  const out = {}
  if (item.nutrition && typeof item.nutrition === 'object' && Object.keys(item.nutrition).length > 0) {
    for (const [key, val] of Object.entries(item.nutrition)) {
      if (key === '_derived') continue
      out[key] = (parseFloat(val) || 0) * factor
    }
  } else {
    for (const id of FLAT_IDS) {
      const v = item[id]
      if (v !== undefined && v !== '' && v !== null) out[id] = (parseFloat(v) || 0) * factor
    }
    if (item.calories_kcal !== undefined && out.calories === undefined) out.calories = (parseFloat(item.calories_kcal) || 0) * factor
  }
  deriveSodiumSalt(out)
  return out
}

export function sumNutrition(list) {
  const out = {}
  for (const n of list) {
    if (!n) continue
    for (const [key, val] of Object.entries(n)) out[key] = (out[key] || 0) + (parseFloat(val) || 0)
  }
  return out
}

const MACROS = ['calories', 'proteins', 'carbohydrates', 'fat']
const pickMacros = n => Object.fromEntries(MACROS.map(k => [k, n[k] || 0]))

/** kcal, protein, carbs and fat of a list of items. */
export const totalsOf = items => pickMacros(sumNutrition((items || []).map(nutritionOf)))
export const mealItems = (entry, meal) => (entry?.items || []).filter(i => (Number(i.meal) || 0) === meal)
export const waterTotal = entry => (entry?.water || []).reduce((s, l) => s + (Number(l.amount) || 0), 0)

/* ------------------------------------------------------------------ units -------------------- */

/** The unit picker's catalogue (NutriTrace UNIT_GROUPS), in its order. */
export const UNITS = ['g', 'mg', 'kg', 'oz', 'lb', 'ml', 'l', 'tsp', 'tbsp', 'fl oz', 'cup', 'piece', 'slice']

const UNIT_TO_G = { g: 1, mg: 0.001, kg: 1000, oz: 28.3495, lb: 453.592, ml: 1, l: 1000, tsp: 4.929, tbsp: 14.787, 'fl oz': 29.574, cup: 236.588 }
const VOLUME_UNITS = new Set(['ml', 'l', 'tsp', 'tbsp', 'fl oz', 'cup'])
const unitToGrams = unit => (unit ? UNIT_TO_G[String(unit).toLowerCase()] ?? null : null)

function parseAltUnits(v) {
  if (Array.isArray(v)) return v
  if (typeof v === 'string' && v) { try { const p = JSON.parse(v); return Array.isArray(p) ? p : null } catch { return null } }
  return null
}

function altUnitGrams(altUnits, unit) {
  const list = parseAltUnits(altUnits)
  if (!list || !unit) return null
  const u = String(unit).toLowerCase()
  for (const r of list) {
    if (r && String(r.abbr || '').toLowerCase() === u) {
      const g = Number(r.grams)
      if (Number.isFinite(g) && g > 0) return g
    }
  }
  return null
}

function toCanonicalAmount(portion, unit, food) {
  const baseG = unitToGrams(unit)
  if (baseG == null) return null
  const basis = food?.nutrition_basis
  if (!basis) return portion * baseG
  const isVol = VOLUME_UNITS.has(String(unit).toLowerCase())
  if ((basis === 'g' && !isVol) || (basis === 'ml' && isVol)) return portion * baseG
  const d = Number(food.density_g_ml)
  if (!Number.isFinite(d) || d <= 0) return null
  return basis === 'g' ? portion * baseG * d : portion * baseG / d
}

/** How much the nutrients scale going from (origPortion, origUnit) to (newPortion, newUnit):
 *  per-food household units first, then the mass/volume table (density across systems), else
 *  the plain ratio of the two numbers. */
export function scaleFactor(origPortion, origUnit, newPortion, newUnit, food = null) {
  const op = parseFloat(origPortion)
  const np = parseFloat(newPortion)
  const origP = Number.isFinite(op) && op > 0 ? op : 100
  const newP = Number.isFinite(np) && np > 0 ? np : origP
  const resolve = (portion, unit) => {
    const alt = food ? altUnitGrams(food.alt_units, unit) : null
    if (alt != null) {
      if (food?.nutrition_basis !== 'ml') return portion * alt
      const d = Number(food.density_g_ml)
      return Number.isFinite(d) && d > 0 ? portion * alt / d : null
    }
    return toCanonicalAmount(portion, unit, food)
  }
  const a = resolve(origP, origUnit)
  const b = resolve(newP, newUnit)
  if (a != null && b != null && a > 0) return b / a
  return newP / origP
}

/** The units a food can be logged in: its household units, its own unit, then the catalogue. */
export function unitsFor(food) {
  const alt = (parseAltUnits(food?.alt_units) || []).map(r => String(r?.abbr || '')).filter(Boolean)
  const own = food?.unit && !UNITS.includes(food.unit) && !alt.includes(food.unit) ? [food.unit] : []
  return [...new Set([...alt, ...own, ...UNITS])]
}

/** The food as logged at (portion, unit): NutriTrace's quantity prompt (Foods.svelte
 *  confirmQtyPrompt), nutrients scaled to the new serving. */
export function atPortion(food, portion, unit) {
  const origPortion = parseFloat(food.portion) || 100
  const origUnit = food.unit || 'g'
  const newPortion = parseFloat(portion) || origPortion
  const newUnit = unit || origUnit
  const f = scaleFactor(origPortion, origUnit, newPortion, newUnit, food)
  const nutrition = food.nutrition
    ? Object.fromEntries(Object.entries(food.nutrition).filter(([k]) => k !== '_derived').map(([k, v]) => [k, (parseFloat(v) || 0) * f]))
    : food.nutrition
  return { ...food, portion: newPortion, unit: newUnit, nutrition }
}

/* ------------------------------------------------------------------ writes ------------------- */

export function newUuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const r = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).slice(1)
  return `${r()}${r()}-${r()}-${r()}-${r()}-${r()}${r()}${r()}`
}

// What a diary item keeps (stores/diary.js _KEEP_FIELDS): the snapshot that protects history,
// plus what the diary reads. The source food's other fields stay with the food.
const KEEP_FIELDS = ['uuid', 'meal', 'addedAt', 'updatedAt', 'type', 'id', 'food_server_id', 'is_recipe', 'name', 'brand', 'portion', 'unit', 'quantity', 'nutrition', 'notes', 'imgUrl', 'source', 'source_meal_id']
function referenceShape(item) {
  const out = Object.fromEntries(KEEP_FIELDS.filter(k => k in item).map(k => [k, item[k]]))
  if (Array.isArray(item._splitItems)) out._splitItems = item._splitItems.map(referenceShape)
  return out
}

/** The error a builder throws for input it cannot log: an NtError with code 'invalid'. */
export const invalid = what => Object.assign(new Error(what), { status: 0, code: 'invalid' })
const positive = v => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null }
const mealSlot = meal => { const n = Number(meal); return Number.isInteger(n) && n >= 0 && n <= 31 ? n : 0 }

/** A food logged to a meal: `food` already at its portion (atPortion), `quantity` servings.
 *  Throws invalid for servings or a portion that is not a number above 0. */
export function foodItem(food, { meal, quantity = 1, now = new Date() }) {
  const servings = positive(quantity)
  if (servings == null) throw invalid('servings must be a number above 0')
  if (food.portion != null && positive(food.portion) == null) throw invalid('portion must be a number above 0')
  const imgUrl = typeof food.imgUrl === 'string' && !food.imgUrl.startsWith('data:') ? food.imgUrl : ''
  return referenceShape({
    ...food,
    imgUrl,
    quantity: servings,
    uuid: newUuid(),
    meal: mealSlot(meal),
    addedAt: now.toISOString(),
    food_server_id: typeof food.id === 'number' ? food.id : null,
  })
}

/** NutriTrace's Quick Calories row (stores/diary.js addQuickCalories). Throws invalid without a
 *  positive kcal. */
export function quickCaloriesItem({ kcal, name, proteins, carbohydrates, fat, meal, now = new Date() }) {
  const calories = Math.round(positive(kcal) || 0)
  if (!calories) throw invalid('kcal must be a number above 0')
  const nutrition = { calories }
  const opt = v => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.round(n * 10) / 10 : null }
  for (const [k, v] of [['proteins', proteins], ['carbohydrates', carbohydrates], ['fat', fat]]) {
    const n = opt(v)
    if (n != null) nutrition[k] = n
  }
  return {
    type: 'quick_calories',
    name: typeof name === 'string' && name.trim() ? name.trim().slice(0, 60) : 'Quick Calories',
    nutrition,
    uuid: newUuid(),
    meal: mealSlot(meal),
    addedAt: now.toISOString(),
    food_server_id: null,
  }
}

/** A water entry (stores/diary.js addWaterLog). Throws invalid unless ml is a finite number above 0. */
export function waterLog(amountMl, { now = new Date(), hour12 = true } = {}) {
  const ml = positive(amountMl)
  if (ml == null || ml > 20000) throw invalid('water must be a number of ml above 0')
  return {
    uuid: newUuid(),
    amount: Math.round(ml),
    time: now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12 }),
  }
}

/**
 * The PUT body for a day, as NutriTrace's own client builds it (stores/diary.js
 * _refetchAndSave + _toApi): the day's current lists, as just read, with `add` appended and the
 * `remove` uuids taken out and named in deleted_uuids. NutriTrace orders a day by the list the
 * client sends (server/lib/diary-merge.js), so sending the whole list keeps it in log order.
 * An entry already in the day (a retry after a lost answer) is not added twice. No body_stats
 * and no notes: the server keeps the day's own.
 * @param {import('./api.js').DiaryDay|null} day
 * @returns {import('./api.js').DiaryWrite}
 */
export function dayWrite(day, { addItems = [], addWater = [], removeItems = [], removeWater = [] } = {}) {
  const merge = (list, add, remove) => {
    const gone = new Set(remove)
    const have = new Set()
    const out = []
    for (const e of [...(Array.isArray(list) ? list : []), ...add]) {
      if (!e || typeof e !== 'object' || gone.has(e.uuid) || (e.uuid && have.has(e.uuid))) continue
      if (e.uuid) have.add(e.uuid)
      out.push(e)
    }
    return out
  }
  return {
    items: merge(day?.items, addItems, removeItems).map(referenceShape),
    water: merge(day?.water, addWater, removeWater),
    deleted_uuids: { items: [...removeItems], water: [...removeWater] },
  }
}

/* ------------------------------------------------------------------ settings ----------------- */

const DEFAULT_MEALS = ['Breakfast', 'Lunch', 'Dinner', 'Snacks']
const DEFAULT_MEAL_TIMES = ['08:00', '12:00', '18:00']

/**
 * The meals, by slot. `isDefault`: NutriTrace's English default (the person never saved meal
 * names), to be translated where it is shown; a saved name is the person's and shows as saved.
 * @returns {{ slot: number, name: string, isDefault: boolean }[]}
 */
export function mealsOf(settings) {
  const names = settings?.mealNames
  const saved = Array.isArray(names) && names.length > 0 && names.every(n => typeof n === 'string' && n.trim())
  return (saved ? names : DEFAULT_MEALS).map((name, slot) => ({ slot, name, isDefault: !saved }))
}

const minutesOf = hhmm => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''))
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

/** The meal a log goes to by default: the one whose time is nearest now. NutriTrace has no
 *  time-of-day rule of its own (its diary + names the meal, its other entry points ask or
 *  default to the first); the times are its meal reminder times (notifMealTimes, 08:00 12:00
 *  18:00 unless changed), the one per-meal clock it keeps. Meals without a time (Snacks by
 *  default) are never the default. */
export function defaultMeal(settings, now = new Date()) {
  const count = mealsOf(settings).length
  const times = Array.isArray(settings?.notifMealTimes) && settings.notifMealTimes.length ? settings.notifMealTimes : DEFAULT_MEAL_TIMES
  const at = now.getHours() * 60 + now.getMinutes()
  let best = 0
  let bestGap = Infinity
  times.slice(0, count).forEach((hhmm, i) => {
    const m = minutesOf(hhmm)
    if (m == null) return
    const gap = Math.abs(at - m)
    if (gap < bestGap) { best = i; bestGap = gap }
  })
  return best
}

/* ------------------------------------------------------------------ targets ------------------ */

/** A goal entry's target on one date: a weekday split resolves to that weekday. */
export function resolveGoalFor(g, dateStr) {
  if (!g) return null
  if (g.sharedGoal !== false) return g.max ?? g.min ?? null
  if (Array.isArray(g.days) && g.days.length === 7 && dateStr) {
    const d = new Date(`${dateStr}T00:00:00`)
    if (!Number.isNaN(d.getTime())) { const v = g.days[d.getDay()]; if (v != null) return v }
  }
  return g.max ?? g.min ?? null
}

/** The day's calorie target as NutriTrace's Diary computes it (Diary.svelte 459-494) and as
 *  fitness-hub docs/reviews/decision-workout-kcal.md §1 rules: Adaptive (once ready) and Dynamic
 *  (with a burn for the day) already include training, so activity never adds to them; a fixed
 *  target (and Adaptive's or Dynamic's fallback to it) adds the day's effective activity only
 *  with "Adjust goal from activity" on.
 *  `caloriesOut`: the Dynamic burn for the date; `adaptiveTdee`: the server's estimate. */
export function calorieTarget({ settings, date, caloriesOut = null, adaptiveTdee = null, effectiveActive = 0 }) {
  const mode = settings?.calorieGoalMode || 'fixed'
  const factor = Number(settings?.calorieGoalFactor) || 1
  const fixed = resolveGoalFor(settings?.goals?.calories, date) ?? 2000
  const fromBurn = (mode === 'dynamic' && caloriesOut != null) || (mode === 'adaptive' && adaptiveTdee != null)
  const base = mode === 'dynamic' && caloriesOut != null ? Math.round(caloriesOut * factor)
    : mode === 'adaptive' && adaptiveTdee != null ? Math.round(adaptiveTdee * factor)
    : fixed
  const adjust = !!settings?.diaryShowActivity && !!settings?.calorieAdjustFromActivity
  const kcal = Number(effectiveActive)
  const added = adjust && !fromBurn && Number.isFinite(kcal) && kcal > 0 ? kcal : 0
  return { base, target: base + added, added, fromBurn, adjust }
}

// kcal per gram for a percentage-of-calories goal (Diary.svelte _macroGoal).
const DENSITY = { fat: 9, 'saturated-fat': 9, carbohydrates: 4, sugars: 4, proteins: 4 }

/** A macro's target in grams on a date, a percentage-of-calories goal converted against the base
 *  target (Diary.svelte _macroGoal). Null without a goal. */
export function macroTarget(settings, id, date, baseCalories) {
  const g = settings?.goals?.[id]
  if (!g) return null
  const raw = resolveGoalFor(g, date)
  if (raw == null) return null
  return g.isPercent && DENSITY[id] ? Math.round(baseCalories * raw / 100 / DENSITY[id]) : raw
}

export const waterGoalOf = settings => (Number(settings?.waterGoalMl) > 0 ? Number(settings.waterGoalMl) : 2000)

/* ------------------------------------------------------------------ display units ------------ */

// Stored values are always kcal and ml; these convert for display only, as NutriTrace does.

/** kcal in the person's energy unit (energyUnit 'kcal' | 'kJ'; Nutrition.displayEnergy). */
export function energyOf(kcal, settings) {
  const n = parseFloat(kcal) || 0
  return settings?.energyUnit === 'kJ' ? { value: Math.round(n * 4.184), unit: 'kJ' } : { value: Math.round(n), unit: 'kcal' }
}

const WATER_UNITS = { oz: [29.5735, 0, 'fl oz'], L: [1000, 2, 'L'], G: [3785.41, 3, 'G'] }
/** ml in the person's water unit (waterUnit 'ml' | 'oz' | 'L' | 'G'; WaterWidget.svelte formatMl). */
export function waterOf(ml, settings) {
  const n = Number(ml) || 0
  const u = WATER_UNITS[settings?.waterUnit]
  return u ? { value: Number((n / u[0]).toFixed(u[1])), unit: u[2] } : { value: Math.round(n), unit: 'ml' }
}

/* ------------------------------------------------------------------ foods -------------------- */

const SPECIALS = [[/ß/g, 'ss'], [/æ/g, 'ae'], [/œ/g, 'oe'], [/ø/g, 'o'], [/ł/g, 'l'], [/đ/g, 'd'], [/ð/g, 'd'], [/þ/g, 'th']]
export function foldText(s) {
  let out = String(s ?? '').toLowerCase()
  for (const [re, to] of SPECIALS) out = out.replace(re, to)
  return out.normalize('NFD').replace(/[̀-ͯ]/g, '')
}
/** Every word of the query somewhere in the food's name or brand, accents aside. */
export function matchesFood(food, query) {
  const hay = foldText(`${food?.name || ''} ${food?.brand || ''}`)
  return foldText(query).trim().split(/\s+/).filter(Boolean).every(tok => hay.includes(tok))
}

/** Your foods by last use (Foods.svelte "Recently used"), never-used ones left out. */
export function recentFoods(foods, limit = 8) {
  return (foods || [])
    .filter(f => f && f.last_used_at)
    .sort((a, b) => (b.last_used_at > a.last_used_at ? 1 : b.last_used_at < a.last_used_at ? -1 : (b.usage_count || 0) - (a.usage_count || 0)))
    .slice(0, limit)
}

/** kcal of one serving of a food as stored. */
export const foodKcal = food => Math.round(nutritionOf({ ...food, quantity: 1 }).calories || 0)
