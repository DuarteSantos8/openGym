// The food diary: what you ate, per day and meal, beside your training.
//
//   S.foodLog = { '<id>': { d, meal, name, brand?, amount, basis, per100, src, _ts }, … }
//
// One entry per food eaten. `amount` is in `basis` (g or ml); `per100` is the label's energy and
// macros per 100 of that basis, each a number or null for "the label does not say". `src` is where
// the numbers came from: { kind: 'off', code } for an Open Food Facts barcode, { kind: 'nutritrace',
// id } for a food of the user's NutriTrace library, { kind: 'manual' } for typed in.
//
// It syncs as one of sync-merge.js's STAMPED_MAPS (like dayPhotos): every entry carries its own
// `_ts`, the merge keeps every id either copy has and of an id both have the one edited last. So a
// removal writes a stamped empty entry (`{ _ts }`), never a deleted key: a deleted key would come
// back from the other device's copy at the next sync.
//
// Nothing here estimates. A value the label does not give stays null, and a day's total says how
// many entries it is missing instead of counting them as zero.

export const MEALS = ['breakfast', 'lunch', 'dinner', 'snack']
export const NUTRIENTS = ['kcal', 'proteinG', 'carbohydrateG', 'fatG']
export const AMOUNT_MAX = 5000
const ISO = /^\d{4}-\d{2}-\d{2}$/
const BASES = new Set(['g', 'ml'])
// Per 100 g or ml: no food has more than 100 g of a macro in 100 g, nor more energy than pure fat.
const LIMIT = { kcal: 900, proteinG: 100, carbohydrateG: 100, fatG: 100 }
const LABEL = { kcal: 'Energy', proteinG: 'Protein', carbohydrateG: 'Carbohydrate', fatG: 'Fat' }

const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v)
const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const num = v => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : NaN)
const round1 = v => Math.round(v * 10) / 10
const validDay = d => ISO.test(String(d)) && !Number.isNaN(Date.parse(d + 'T00:00:00Z')) && new Date(d + 'T00:00:00Z').toISOString().slice(0, 10) === d

/** Why `input` cannot be a diary entry, in plain words, or null when it can. */
export function foodEntryProblem(input) {
  if (!isMap(input)) return 'Nothing to log'
  if (!text(input.name, 80)) return 'Give the food a name'
  if (!validDay(input.d)) return 'Pick a valid date'
  if (!MEALS.includes(input.meal)) return 'Pick a meal'
  const amount = num(input.amount)
  if (!(amount > 0) || amount > AMOUNT_MAX) return `Enter an amount between 1 and ${AMOUNT_MAX}`
  if (!BASES.has(input.basis)) return 'Pick grams or millilitres as the unit'
  const per = isMap(input.per100) ? input.per100 : {}
  for (const k of NUTRIENTS) {
    const v = num(per[k])
    if (v === null) continue
    if (Number.isNaN(v) || v < 0 || v > LIMIT[k]) return `${LABEL[k]} per 100 must be between 0 and ${LIMIT[k]}`
  }
  return null
}

const readSource = src => {
  if (src?.kind === 'off' && /^\d{8,14}$/.test(String(src.code))) return { kind: 'off', code: String(src.code) }
  if (src?.kind === 'nutritrace' && typeof src.id === 'string' && src.id && src.id.length <= 64) return { kind: 'nutritrace', id: src.id }
  return { kind: 'manual' }
}

/** One stored entry read back, cleaned, or null for a removed or malformed one. */
export function readFood(entry, id) {
  if (!isMap(entry) || foodEntryProblem(entry)) return null
  const per = {}
  for (const k of NUTRIENTS) per[k] = num(entry.per100?.[k])
  const src = readSource(entry.src)
  return {
    ...(id != null ? { id } : {}),
    d: entry.d, meal: entry.meal, name: text(entry.name, 80),
    ...(text(entry.brand, 60) ? { brand: text(entry.brand, 60) } : {}),
    amount: num(entry.amount), basis: entry.basis, per100: per, src,
    _ts: Number(entry._ts) || 0,
  }
}

const mapOf = S => (isMap(S?.foodLog) ? S.foodLog : {})
const newId = now => 'f' + now.toString(36) + Math.random().toString(36).slice(2, 8)

/** Writes (or, with an existing `id`, replaces) an entry. Throws on a bad one; returns its id. */
export function addFood(state, input, { now = Date.now(), id = newId(now) } = {}) {
  const problem = foodEntryProblem(input)
  if (problem) throw new Error(problem)
  const clean = readFood({ ...input, _ts: now })
  const { _ts, ...stored } = clean
  if (input.src == null) stored.src = { kind: 'manual' }
  state.foodLog = { ...mapOf(state), [id]: { ...stored, _ts: now } }
  return id
}

/** Removes an entry: a stamped empty one, so the removal wins the next sync. */
export function removeFood(state, id, now = Date.now()) {
  if (!(id in mapOf(state))) return
  state.foodLog = { ...mapOf(state), [id]: { _ts: now } }
}

/** Undo of removeFood: the entry as it was, stamped now so it beats the removal. */
export function restoreFood(state, id, entry, now = Date.now()) {
  const f = readFood(entry)
  if (!f) return
  const { _ts, ...stored } = f
  state.foodLog = { ...mapOf(state), [id]: { ...stored, _ts: now } }
}

/** Every live entry of day `d`, in meal order, then in the order logged. */
export function foodsOn(S, d) {
  return Object.entries(mapOf(S))
    .map(([id, e]) => readFood(e, id))
    .filter(f => f && f.d === d)
    .sort((a, b) => MEALS.indexOf(a.meal) - MEALS.indexOf(b.meal) || a._ts - b._ts)
}

/** The days that have at least one live entry, newest first. */
export function foodDays(S) {
  const days = new Set()
  for (const e of Object.values(mapOf(S))) { const f = readFood(e); if (f) days.add(f.d) }
  return [...days].sort().reverse()
}

/** What one entry gave, scaled from per-100 to its amount. kcal whole, grams to a tenth. */
export function nutrientsOf(entry) {
  const out = {}
  for (const k of NUTRIENTS) {
    const v = num(entry?.per100?.[k])
    if (v == null || Number.isNaN(v)) { out[k] = null; continue }
    const scaled = v * num(entry.amount) / 100
    out[k] = k === 'kcal' ? Math.round(scaled) : round1(scaled)
  }
  return out
}

/** A day's totals, and per nutrient how many entries had no value for it. */
export function dayTotals(entries) {
  const sum = { kcal: 0, proteinG: 0, carbohydrateG: 0, fatG: 0 }
  const missing = { kcal: 0, proteinG: 0, carbohydrateG: 0, fatG: 0 }
  const list = Array.isArray(entries) ? entries : []
  for (const e of list) {
    const n = nutrientsOf(e)
    for (const k of NUTRIENTS) { if (n[k] == null) missing[k]++; else sum[k] += n[k] }
  }
  for (const k of NUTRIENTS) sum[k] = k === 'kcal' ? Math.round(sum[k]) : round1(sum[k])
  return { ...sum, entries: list.length, missing }
}

/** A diary entry from an /api/addons/food answer. Sugar is not kept: the diary tracks the four. */
export function fromLookup(food, { d, meal, amount }) {
  const per = {}
  for (const k of NUTRIENTS) per[k] = num(food?.per100?.[k])
  return {
    d, meal, name: text(food?.name, 80) || 'Unnamed product',
    ...(text(food?.brand, 60) ? { brand: text(food.brand, 60) } : {}),
    amount: num(amount), basis: food?.basis === '100ml' ? 'ml' : 'g', per100: per,
    src: /^\d{8,14}$/.test(String(food?.barcode)) ? { kind: 'off', code: String(food.barcode) } : { kind: 'manual' },
  }
}

/** A diary entry from a /api/integrations/nutritrace/foods food, or null for one the diary cannot
 * weigh: NutriTrace foods in cups, pieces or custom units have no grams without a density, and the
 * diary does not guess one. */
/** Why the diary cannot take a NutriTrace food, or null when it can: 'unweighable' (cups, pieces,
 * custom units: no grams without a density) or 'implausible' (values no food has per 100, as the
 * server judged or as this app judges again with the diary's own limits). */
export function nutriTraceProblem(food) {
  if (!food || food.problem === 'implausible') return 'implausible'
  if (!isMap(food.per100) || (food.basis !== '100g' && food.basis !== '100ml')) return 'unweighable'
  for (const k of NUTRIENTS) {
    const v = num(food.per100[k])
    if (v !== null && (Number.isNaN(v) || v < 0 || v > LIMIT[k])) return 'implausible'
  }
  return null
}

export function fromNutriTrace(food, { d, meal, amount }) {
  if (nutriTraceProblem(food)) return null
  const per = {}
  for (const k of NUTRIENTS) per[k] = num(food.per100[k])
  return {
    d, meal, name: text(food.name, 80) || 'Unnamed food',
    ...(text(food.brand, 60) ? { brand: text(food.brand, 60) } : {}),
    amount: num(amount), basis: food.basis === '100ml' ? 'ml' : 'g', per100: per,
    src: { kind: 'nutritrace', id: String(food.id).slice(0, 64) },
  }
}
