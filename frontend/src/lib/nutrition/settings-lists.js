import { UNITS, WATER_UNITS } from './diary.js'

// The list settings NutriTrace's Settings pages edit (src/routes/settings/Water.svelte,
// Categories.svelte, CustomUnits.svelte, Diary.svelte), as the hub takes them
// (fitness-hub src/nt-body-checks.ts): exactly these shapes, so a stored entry is cleaned to its
// fields before a list is written back. Each `add*` answers `{ list }` or `{ error }`, an error
// code the sheet turns into a sentence. No React and no network here.

export const WATER_CONTAINERS_MAX = 20
export const WATER_CONTAINER_NAME_MAX = 40
export const WATER_CONTAINER_ML_MAX = 10_000
export const CATEGORIES_MAX = 100
export const CATEGORY_NAME_MAX = 100
export const CATEGORY_LABEL_MAX = 16
export const CUSTOM_UNITS_MAX = 100
export const CUSTOM_UNIT_ABBR_MAX = 16
export const CUSTOM_UNIT_FULL_MAX = 60
export const MEAL_NAMES_MAX = 12
export const MEAL_NAME_MAX = 40

const listOf = value => (Array.isArray(value) ? value : [])

/* ------------------------------------------------------------------ water ------------------ */

export const WATER_UNIT_KEYS = ['ml', 'oz', 'L', 'G']

/** An amount in the water unit, as whole ml (Water.svelte _displayToMl). */
export const waterToMl = (amount, unit) => Math.round(Number(amount) * (WATER_UNITS[unit]?.[0] ?? 1))

const containerOf = c => ({ id: String(c.id), name: c.name, volumeMl: c.volumeMl })

export function addContainer(containers, { name, amount, unit }, now = Date.now()) {
  const list = listOf(containers).map(containerOf)
  const clean = String(name || '').trim()
  const ml = waterToMl(amount, unit)
  if (!clean || clean.length > WATER_CONTAINER_NAME_MAX) return { error: 'name' }
  if (!Number.isFinite(ml) || ml < 1 || ml > WATER_CONTAINER_ML_MAX) return { error: 'volume' }
  if (list.length >= WATER_CONTAINERS_MAX) return { error: 'full' }
  return { list: [...list, { id: String(now), name: clean, volumeMl: ml }] }
}

export const removeContainer = (containers, id) => listOf(containers).filter(c => String(c.id) !== String(id)).map(containerOf)

/* ------------------------------------------------------------------ categories --------------- */

export const categoryName = c => (typeof c === 'string' ? c : c?.name || '')
export const categoryLabel = c => (typeof c === 'string' ? '' : c?.label || '')
const categoryOf = c => (categoryLabel(c) ? { name: categoryName(c), label: categoryLabel(c) } : categoryName(c))

export function addCategory(categories, { name, label }) {
  const list = listOf(categories).map(categoryOf)
  const cleanName = String(name || '').trim()
  const cleanLabel = String(label || '').trim()
  if (!cleanName || cleanName.length > CATEGORY_NAME_MAX) return { error: 'name' }
  if (cleanLabel.length > CATEGORY_LABEL_MAX) return { error: 'label' }
  if (list.some(c => categoryName(c) === cleanName)) return { error: 'duplicate' }
  if (list.length >= CATEGORIES_MAX) return { error: 'full' }
  return { list: [...list, cleanLabel ? { name: cleanName, label: cleanLabel } : cleanName] }
}

export const removeCategory = (categories, name) => listOf(categories).filter(c => categoryName(c) !== name).map(categoryOf)

/* ------------------------------------------------------------------ custom units ------------- */

const unitOf = u => ({ abbr: u.abbr, full: u.full ?? u.abbr })

export function addCustomUnit(units, { abbr, full }) {
  const list = listOf(units).map(unitOf)
  const cleanAbbr = String(abbr || '').trim()
  const cleanFull = String(full || '').trim() || cleanAbbr
  if (!cleanAbbr || cleanAbbr.length > CUSTOM_UNIT_ABBR_MAX) return { error: 'abbr' }
  if (cleanFull.length > CUSTOM_UNIT_FULL_MAX) return { error: 'full' }
  const key = cleanAbbr.toLowerCase()
  if (UNITS.some(u => u.toLowerCase() === key)) return { error: 'builtin' }
  if (list.some(u => String(u.abbr).toLowerCase() === key)) return { error: 'duplicate' }
  if (list.length >= CUSTOM_UNITS_MAX) return { error: 'full-list' }
  return { list: [...list, { abbr: cleanAbbr, full: cleanFull }] }
}

export const removeCustomUnit = (units, abbr) => listOf(units).filter(u => u.abbr !== abbr).map(unitOf)

/* ------------------------------------------------------------------ meal names --------------- */

/** Rename the meal at `slot`, or add one when `slot` is the list's length. */
export function setMealName(names, slot, name) {
  const list = [...listOf(names)]
  const clean = String(name || '').trim()
  if (!clean || clean.length > MEAL_NAME_MAX) return { error: 'name' }
  if (slot < 0 || slot > list.length) return { error: 'slot' }
  if (slot === list.length && list.length >= MEAL_NAMES_MAX) return { error: 'full' }
  list[slot] = clean
  return { list }
}

export function removeMeal(names, slot) {
  const list = [...listOf(names)]
  if (list.length <= 1 || slot < 0 || slot >= list.length) return { error: 'last' }
  list.splice(slot, 1)
  return { list }
}

export function moveMeal(names, slot, by) {
  const list = [...listOf(names)]
  const to = slot + by
  if (slot < 0 || slot >= list.length || to < 0 || to >= list.length) return { error: 'slot' }
  const [moved] = list.splice(slot, 1)
  list.splice(to, 0, moved)
  return { list }
}

/* ------------------------------------------------------------------ Open Food Facts ---------- */

// The languages and countries NutriTrace's picker offers (ConnectedServices.svelte); the hub holds
// the language to two letters and the country to this list. A country is stored by its English
// name, shown by its ISO region so it follows the app's language.
export const OFF_LANGUAGES = ['en', 'fr', 'de', 'es', 'it', 'pt', 'nl', 'pl', 'ru', 'ja', 'zh', 'ar', 'ko']
export const OFF_COUNTRIES = {
  World: null, Argentina: 'AR', Australia: 'AU', Austria: 'AT', Belgium: 'BE', Brazil: 'BR', Canada: 'CA', Chile: 'CL',
  China: 'CN', Denmark: 'DK', Finland: 'FI', France: 'FR', Germany: 'DE', India: 'IN', Ireland: 'IE', Italy: 'IT',
  Japan: 'JP', Mexico: 'MX', Netherlands: 'NL', 'New Zealand': 'NZ', Norway: 'NO', Poland: 'PL', Portugal: 'PT',
  Singapore: 'SG', 'South Africa': 'ZA', 'South Korea': 'KR', Spain: 'ES', Sweden: 'SE', Switzerland: 'CH',
  'United Kingdom': 'GB', 'United States': 'US',
}
