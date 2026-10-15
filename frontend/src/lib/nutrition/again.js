// "Log again": what was logged to a meal on an earlier day, as entries for another one. A meal
// can be logged again only when every entry in it can: a food of yours (it has an id) or a quick
// entry. A saved meal, a recipe or an online result never saved to your foods cannot be rebuilt
// from the diary row alone, and logging part of a meal while saying it was all of it misleads.
//
// Each entry's uuid comes from where it is copied from and to (againUuid), so a second tap, a
// retry after a lost answer or another device logging the same meal again is the same entry,
// which NutriTrace's merge replaces in place instead of adding. An Undo tombstones those uuids
// and NutriTrace keeps a tombstoned uuid out for good, so the next log goes as the next attempt.
import { mealItems, nutritionOf } from './diary.js'

const isQuick = item => item.type === 'quick_calories'
const isOwnFood = item => !item.is_recipe && !Array.isArray(item._splitItems) && typeof item.food_server_id === 'number'

/** The entries of `meal` on a day, or null when there are none or any cannot be logged again. */
export function againItems(entry, meal) {
  const items = mealItems(entry, meal)
  if (!items.length) return null
  return items.every(i => isQuick(i) || isOwnFood(i)) ? items : null
}

/** The entries' calories, for the row that offers them. */
export const againKcal = items => Math.round(items.reduce((sum, i) => sum + (nutritionOf(i).calories || 0), 0))

// FNV-1a over the key from four bases: 128 bits that are the same for the same key. Not secret,
// only distinct, as a diary item's uuid needs to be.
const fnv = (key, basis) => {
  let h = basis >>> 0
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619) >>> 0
  return h.toString(16).padStart(8, '0')
}

/** A uuid-shaped id that is the same for the same key. */
export function stableUuid(key) {
  const hex = [0x811c9dc5, 0x050c5d1f, 0x9e3779b9, 0x85ebca6b].map(b => fnv(key, b)).join('')
  const variant = (8 | (parseInt(hex[16], 16) & 3)).toString(16)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

/** The uuid of `item` (logged on `from`) logged again to `to`, as attempt `attempt`. */
export const againUuid = (from, item, to, attempt) => stableUuid(`again|${from}|${item.uuid}|${to}|${attempt}`)

const uuidsOf = (items, { from, to }, attempt) => items.map(i => againUuid(from, i, to, attempt))

/** The attempt the entries go as: the first none of whose uuids `target` (the day they go to)
 *  has tombstoned. */
export function againAttempt(items, { from, to, target }) {
  const gone = new Set((target?.tombstones || []).filter(x => x?.kind === 'item').map(x => x.uuid))
  let attempt = 0
  while (uuidsOf(items, { from, to }, attempt).some(u => gone.has(u))) attempt += 1
  return attempt
}

/** Whether `target` already holds every entry of this attempt. */
export function againLogged(items, { from, to, target }, attempt) {
  const have = new Set((target?.items || []).map(i => i?.uuid))
  return uuidsOf(items, { from, to }, attempt).every(u => have.has(u))
}

/** The entries for `meal` on `to`, with their stable uuids. `n` is the nutrition store's state
 *  (draftFood, draftQuick). */
export function againEntries(items, meal, { from, to, attempt, n }) {
  return items.map(item => {
    const uuid = againUuid(from, item, to, attempt)
    if (isQuick(item)) {
      const { calories, proteins, carbohydrates, fat } = item.nutrition || {}
      return { ...n.draftQuick({ kcal: calories, name: item.name, proteins, carbohydrates, fat, meal }), uuid }
    }
    const food = { id: item.food_server_id, name: item.name, brand: item.brand || '', portion: item.portion, unit: item.unit, nutrition: item.nutrition, imgUrl: '' }
    return { ...n.draftFood({ food, meal, portion: item.portion, unit: item.unit, servings: item.quantity }).item, uuid }
  })
}
