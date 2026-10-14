import { z } from 'zod'

const uuid = () => z.uuid()
const date = () => z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(value + 'T12:00:00Z')
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}, 'Invalid calendar date')
const quantity = () => z.number().positive().max(100000).refine(value =>
  Math.abs(value * 1000 - Math.round(value * 1000)) < 0.000001, 'At most three decimal places')
const time = () => z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional()

/** Only existing Nutrition API operations; no persistence, catalog guesses or nutrient math. */
export function createNutritionTools(request) {
  const tool = (name, description, schema, handler, extra = {}) => ({ name, description, schema,
    scope: extra.write ? 'nutrition.write' : 'nutrition.read', handler, ...extra })
  return [
    tool('nutrition_search_products', 'Search your personal product catalog. Values are per 100 grams; clarify raw/cooked and brand differences. No external food database or piece weights.',
      { search: z.string().max(200).optional(), offset: z.number().int().nonnegative().optional() },
      params => request('GET', '/api/nutrition/products', params)),
    tool('nutrition_get_product', 'Read a personal product by its ID from search results.',
      { product_id: uuid() }, p => request('GET', `/api/nutrition/products/${p.product_id}`)),
    tool('nutrition_get_diary', 'Read food entries and exact totals computed by Nutrition for an explicit local calendar date.',
      { date: date() }, p => request('GET', '/api/nutrition/diary', p)),
    tool('nutrition_get_entry', 'Read one diary entry before changing or deleting it.',
      { entry_id: uuid() }, p => request('GET', `/api/nutrition/entries/${p.entry_id}`)),
    tool('nutrition_create_entry', 'Record one confirmed product and quantity in grams. Supply a new UUID entry_id once and reuse it with the identical payload on every retry. Do not guess product, raw/cooked state, grams from pieces or a local date.',
      { entry_id: uuid(), product_id: uuid(), quantity_grams: quantity(), date: date(), time: time() },
      p => request('POST', '/api/nutrition/entries', {}, { id: p.entry_id, productId: p.product_id,
        quantityGrams: p.quantity_grams, date: p.date, time: p.time ?? null }), { write: true, idempotent: true }),
    tool('nutrition_update_entry', 'Update a previously read entry. Send its complete quantity/date/time. Omit product_id to retain historical nutrition, even if its product was deleted; specify it only for an intentional product replacement. Concurrent edits are last-write-wins.',
      { entry_id: uuid(), product_id: uuid().optional(), quantity_grams: quantity(), date: date(), time: time() },
      p => request('PUT', `/api/nutrition/entries/${p.entry_id}`, {}, { productId: p.product_id ?? null,
        quantityGrams: p.quantity_grams, date: p.date, time: p.time ?? null }), { write: true, destructive: true }),
    tool('nutrition_delete_entry', 'Delete the specific entry the user has confirmed. Read it first and ask for confirmation; do not set confirmed for an ambiguous deletion.',
      { entry_id: uuid(), confirmed: z.literal(true) }, p => request('DELETE', `/api/nutrition/entries/${p.entry_id}`),
      { write: true, destructive: true, idempotent: true })
  ]
}
