// A fake of NutriTrace and the hub's sync routes at the fetch boundary, for tests. It answers
// what the hub forwards (fitness-hub src/nt-routes.ts), as strictly as the hub does, with
// NutriTrace's real shapes and merge rules (server/routes/diary.js, foods.js, meals.js,
// activity.js, server/lib/diary-merge.js); any other path is a 404, as the hub answers it.
//
//   const nt = createFakeNutriTrace({ days: { '2026-10-14': fixtureDay() } })
//   vi.stubGlobal('fetch', nt.fetch)
//   ...
//   expect(nt.writes().at(-1)).toMatchObject({ method: 'PUT', path: '/nt/api/diary/2026-10-14' })
//   nt.failNext('PUT', '/nt/api/diary/', { status: 500 })              // refused before saving
//   nt.failNext('PUT', '/nt/api/diary/', 'offline')                    // no connection
//   nt.failNext('PUT', '/nt/api/diary/', { lost: true, status: 504 })  // saved, answer lost
//   nt.failNext('PUT', '/nt/api/diary/', { lost: true })               // saved, then offline
//   const slow = nt.hold('GET', '/nt/api/diary/'); ...; slow.release()  // answered now, delivered later
//
// Not imported by the app.

/* ------------------------------------------------------------------ fixtures ----------------- */

export const emptyDay = date => ({ date, items: [], body_stats: {}, water: [], notes: '', completed_at: null, completed_meals: [], tombstones: [] })

/** A diary row as GET /api/diary/:date answers it (server/routes/diary.js parse). */
export function fixtureDay(date = '2026-10-14') {
  return {
    id: 7, user_id: 3, date,
    items: [
      { uuid: 'it-oats', meal: 0, addedAt: `${date}T07:42:10.000Z`, id: 11, food_server_id: 11, name: 'Rolled oats', brand: '', portion: 60, unit: 'g', quantity: 1, nutrition: { calories: 228, proteins: 8.1, carbohydrates: 36, fat: 4.2, fiber: 6 }, imgUrl: '' },
      { uuid: 'it-quick', meal: 1, addedAt: `${date}T12:05:00.000Z`, type: 'quick_calories', name: 'Quick Calories', nutrition: { calories: 450 }, food_server_id: null },
    ],
    body_stats: {},
    water: [{ uuid: 'w-1', amount: 250, time: '8:15 AM' }],
    notes: '',
    notes_updated_at: null,
    completed_at: null,
    completed_meals: [],
    updated_at: `${date} 12:05:00`,
    deleted_at: null,
    tombstones: [],
  }
}

/** GET /api/settings for a user who set a few things (keys as src/stores/settings.js names them). */
export const fixtureSettings = () => ({
  mealNames: ['Breakfast', 'Lunch', 'Dinner', 'Snacks'],
  goals: { calories: { min: 2200, max: 2200, sharedGoal: true }, proteins: { max: 160 }, carbohydrates: { max: 30, isPercent: true }, fat: { max: 70 } },
  calorieGoalMode: 'fixed',
  calorieGoalFactor: 1,
  waterGoalMl: 2500,
  diaryShowActivity: true,
  calorieAdjustFromActivity: false,
  manualActivityPolicy: 'wearable_wins',
  notifMealTimes: ['08:00', '12:00', '18:00'],
  timeFormat: '24h',
})

/** GET /api/foods rows (server/routes/foods.js parse: nutrition and alt_units parsed). */
export const fixtureFoods = () => [
  { id: 11, user_id: 3, name: 'Rolled oats', brand: '', portion: 100, unit: 'g', nutrition: { calories: 380, proteins: 13.5, carbohydrates: 60, fat: 7, fiber: 10 }, img_url: null, barcode: null, nutrition_basis: 'g', alt_units: null, density_g_ml: null, usage_count: 9, last_used_at: '2026-10-13', visibility: 'private', created_at: '2026-09-01 10:00:00', updated_at: '2026-10-13 07:40:00', deleted_at: null },
  { id: 12, user_id: 3, name: 'Wholemeal bread', brand: 'Baker', portion: 100, unit: 'g', nutrition: { calories: 247, proteins: 13, carbohydrates: 41, fat: 3.4 }, img_url: '/uploads/1700000000000-abcdef12.jpg', barcode: '5000000000001', nutrition_basis: 'g', alt_units: [{ abbr: 'slice', grams: 36 }], density_g_ml: null, usage_count: 3, last_used_at: '2026-10-10', visibility: 'private', created_at: '2026-09-02 10:00:00', updated_at: '2026-10-10 08:00:00', deleted_at: null },
  { id: 13, user_id: 3, name: 'Crème fraîche', brand: '', portion: 100, unit: 'g', nutrition: { calories: 292, proteins: 2.4, carbohydrates: 2.8, fat: 30 }, img_url: null, barcode: null, nutrition_basis: 'g', alt_units: null, density_g_ml: null, usage_count: 0, last_used_at: null, visibility: 'private', created_at: '2026-09-03 10:00:00', updated_at: '2026-09-03 10:00:00', deleted_at: null },
]

/** GET /api/meals rows (server/routes/meals.js parse: nutrition and items parsed, is_recipe a
 *  boolean). A meal's nutrition is its total; the recipe's, per serving (4 servings of 300 g). */
export const fixtureMeals = () => [
  { id: 21, user_id: 3, name: 'Oats and bread', is_recipe: false, notes: 'Weekday breakfast', portion: 100, unit: 'g', servings: null, visibility: 'private', img_url: null, favorite: 0, usage_count: 4, last_used_at: '2026-10-12', created_at: '2026-09-05 08:00:00', updated_at: '2026-10-12 07:50:00', deleted_at: null,
    nutrition: { calories: 354, proteins: 16.1, carbohydrates: 55.2, fat: 5.3 },
    items: [
      { id: 11, name: 'Rolled oats', brand: '', portion: 60, unit: 'g', quantity: 1, nutrition: { calories: 228, proteins: 8.1, carbohydrates: 36, fat: 4.2 }, nutrition_basis: 'g', alt_units: null, density_g_ml: null },
      { id: 12, name: 'Wholemeal bread', brand: 'Baker', portion: 51, unit: 'g', quantity: 1, nutrition: { calories: 126, proteins: 8, carbohydrates: 19.2, fat: 1.1 }, nutrition_basis: 'g', alt_units: [{ abbr: 'slice', grams: 36 }], density_g_ml: null },
    ] },
  { id: 22, user_id: 3, name: 'Lentil soup', is_recipe: true, notes: null, portion: 300, unit: 'g', servings: 4, visibility: 'private', img_url: null, favorite: 0, usage_count: 1, last_used_at: '2026-10-08', created_at: '2026-09-10 18:00:00', updated_at: '2026-10-08 19:00:00', deleted_at: null,
    nutrition: { calories: 210, proteins: 12, carbohydrates: 30, fat: 4 },
    items: [
      { id: 31, name: 'Red lentils', brand: '', portion: 400, unit: 'g', quantity: 1, nutrition: { calories: 600, proteins: 36, carbohydrates: 108, fat: 4 }, nutrition_basis: 'g', alt_units: null, density_g_ml: null },
      { id: 32, name: 'Vegetable stock', brand: '', portion: 800, unit: 'g', quantity: 1, nutrition: { calories: 240, proteins: 12, carbohydrates: 12, fat: 12 }, nutrition_basis: 'g', alt_units: null, density_g_ml: null },
    ] },
]

/** GET /api/activity/:date: a hub workout row (source 'opengym', server/lib/active-calories.js). */
export const fixtureActivity = (date = '2026-10-14', coveredBy = null) => [
  { id: 41, user_id: 3, date, name: 'Push A', kcal: 190, duration_min: 55, distance: null, source: 'opengym', met: null, is_template: 0, external_id: 'og:w:abc123', user_edited_at: null, created_at: `${date} 18:30:00`, updated_at: `${date} 18:30:00`, deleted_at: null, covered_by: coveredBy },
]
export const fixtureActivitySum = (date = '2026-10-14', coveredBy = null) => ({ date, manual: 190, wearable: coveredBy ? 420 : 0, effective: coveredBy ? 420 : 190, covered_by: coveredBy, policy: 'wearable_wins' })

/** The proxy's answer for a public Open Food Facts search (the `products` envelope). */
export const fixtureOffSearch = () => ({
  count: 2, page: 1, page_size: 20,
  products: [
    { code: '3017620422003', product_name: 'Nutella', brands: 'Ferrero', lang: 'fr', nutrition_data_per: '100g', serving_size: '15 g', serving_quantity: 15, image_front_small_url: 'https://images.openfoodfacts.org/images/products/301/762/042/2003/front_fr.200.jpg', nutriments: { 'energy-kcal_100g': 539, energy_100g: 2255, proteins_100g: 6.3, carbohydrates_100g: 57.5, sugars_100g: 56.3, fat_100g: 30.9, 'saturated-fat_100g': 10.6, salt_100g: 0.107, fiber_100g: 0 } },
    { code: '0000000000000', product_name: '', brands: '', nutriments: {} },
  ],
})

/** The proxy's answer for an Open Food Facts product lookup (api/v3/product/<code>). */
export const fixtureOffProduct = (code = '3017620422003') => ({
  code, status: 'success', status_verbose: 'product found',
  product: { code, product_name: 'Nutella', brands: 'Ferrero', lang: 'fr', nutrition_data_per: '100g', serving_size: '15 g', serving_quantity: 15, nutriments: { 'energy-kcal_100g': 539, energy_100g: 2255, proteins_100g: 6.3, carbohydrates_100g: 57.5, sugars_100g: 56.3, fat_100g: 30.9, 'saturated-fat_100g': 10.6, salt_100g: 0.107, fiber_100g: 0 } },
})

/** A completed fast as GET /api/fasts answers it (server/routes/fasts.js _row). */
export const fixtureFast = (id, startAt, endAt, goalHours = 16) => ({
  id, user_id: 3, start_at: startAt, end_at: endAt, goal_hours: goalHours, notes: null,
  created_at: startAt.slice(0, 19).replace('T', ' '), updated_at: (endAt || startAt).slice(0, 19).replace('T', ' '),
})

/** GET /hub/api/sync/status when all is well. Pass `syncStatus: null` for a person the hub has
 *  not stored yet (it answers JSON null). */
export const fixtureSyncStatus = (state = 'ok') => ({ state, pending: 0, held: 0, last_synced_at: 1760464800000, next_retry_at: null, suspended: null, problems: [] })

/* ------------------------------------------------------------------ hub rules ---------------- */

const DATE = /^\d{4}-\d{2}-\d{2}$/
const ID = /^[A-Za-z0-9_-]{1,64}$/
// PUT /api/settings (fitness-hub src/nt-body-checks.ts WRITABLE_SETTINGS): each key with the type
// NutriTrace reads it as.
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v)
// The hub's field checks (nt-body-checks.ts), shared by the settings below and the meals routes.
const text = max => v => typeof v === 'string' && v.length <= max
const nonEmptyText = max => v => typeof v === 'string' && v.trim() !== '' && v.length <= max
const nullable = check => v => v === null || check(v)
const oneOf = (...allowed) => v => allowed.includes(v)
const bool = v => typeof v === 'boolean'
const numberIn = (min, max) => v => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max
const integerIn = (min, max) => v => Number.isInteger(v) && v >= min && v <= max
const positiveAmount = numberIn(Number.MIN_VALUE, 1_000_000)
const hasOnly = (o, fields) => isObject(o) && Object.entries(o).every(([k, v]) => Object.hasOwn(fields, k) && fields[k](v))
const hasAll = (o, keys) => keys.every(k => Object.hasOwn(o, k))
const arrayOf = (check, max) => v => Array.isArray(v) && v.length <= max && v.every(check)
// An object with these fields and no others; `required` must all be there.
const exactly = (required, fields) => v => isObj(v) && hasAll(v, required) && hasOnly(v, fields)
const idList = arrayOf(nonEmptyText(60), 200)
const SORT = oneOf('recent', 'most', 'alpha')
const OFF_COUNTRIES = ['World', 'Argentina', 'Australia', 'Austria', 'Belgium', 'Brazil', 'Canada', 'Chile', 'China', 'Denmark', 'Finland', 'France', 'Germany', 'India', 'Ireland', 'Italy', 'Japan', 'Mexico', 'Netherlands', 'New Zealand', 'Norway', 'Poland', 'Portugal', 'Singapore', 'South Africa', 'South Korea', 'Spain', 'Sweden', 'Switzerland', 'United Kingdom', 'United States']
const plainMap = max => v => isObj(v) && Object.keys(v).length <= max && Object.values(v).every(isObj)
const WRITABLE_SETTINGS = {
  // Goals and Fasting.
  calorieGoalMode: oneOf('fixed', 'adaptive', 'dynamic'),
  calorieGoalFactor: oneOf(0.8, 1, 1.1, 1.2),
  goals: plainMap(100),
  goalTemplates: arrayOf(isObj, 30),
  waterGoalMl: numberIn(1, 50000),
  calorieAdjustFromActivity: bool,
  diaryShowActivity: bool,
  fastingEnabled: bool,
  fastingDefaultHours: numberIn(1, 168),
  // Diary and meals.
  mealNames: v => Array.isArray(v) && v.length > 0 && arrayOf(nonEmptyText(40), 12)(v),
  diaryShowBrands: bool,
  diaryShowTimestamps: bool,
  diaryShowThumbnails: bool,
  diaryShowAllNutrients: bool,
  diaryShowNutritionUnits: bool,
  diaryShowMacroSummary: bool,
  diaryPromptQuantity: bool,
  diaryShowPortionSize: bool,
  diaryShowNotes: bool,
  diaryShowCompletion: bool,
  showQuickCalories: bool,
  showUnitMetadata: bool,
  warnUnitMismatch: bool,
  diaryDefaultField: oneOf('servings', 'portion'),
  quickCaloriesDisplay: oneOf('summed', 'separate'),
  manualActivityPolicy: oneOf('wearable_wins', 'manual_wins', 'additive'),
  // Water.
  waterUnit: oneOf('ml', 'oz', 'L', 'G'),
  waterShowInDiary: bool,
  waterShowInStats: bool,
  waterContainers: arrayOf(exactly(['id', 'name', 'volumeMl'], { id: nonEmptyText(32), name: nonEmptyText(40), volumeMl: numberIn(1, 10000) }), 20),
  // Foods and scanning (the flashlight is a device setting: not here).
  foodsShowThumbnails: bool,
  foodsShowCategories: bool,
  foodsShowLabels: bool,
  foodsShowNotes: bool,
  barcodeBeep: bool,
  cropPhotos: bool,
  foodsDefaultSource: oneOf('local', 'off', 'usda', 'all'),
  foodsSort: SORT,
  mealsSort: SORT,
  recipesSort: SORT,
  // Food sources: switches and search preferences, never a key or login.
  offEnabled: bool,
  offSearchLanguage: v => typeof v === 'string' && /^[a-z]{2}$/.test(v),
  offSearchCountry: oneOf(...OFF_COUNTRIES),
  offImportPortion: oneOf('per100g', 'perServing'),
  usdaEnabled: bool,
  // Custom nutrients, categories and units, in the shapes NutriTrace's own pages write.
  customNutriments: arrayOf(exactly(['id', 'label', 'unit'], {
    id: v => typeof v === 'string' && /^custom_\S{1,33}$/.test(v), label: nonEmptyText(60), unit: nonEmptyText(16),
  }), 50),
  visibleNutriments: v => v === null || idList(v),
  nutrimentsOrder: idList,
  foodCategories: arrayOf(v => nonEmptyText(100)(v) || exactly(['name'], { name: nonEmptyText(100), label: text(16) })(v), 100),
  customUnits: arrayOf(exactly(['abbr'], { abbr: nonEmptyText(16), full: text(60) }), 100),
  // Units and language, statistics and the body stats lists.
  energyUnit: oneOf('kcal', 'kJ'),
  dateFormat: oneOf('ISO', 'US', 'EU', 'natural'),
  timeFormat: oneOf('12h', '24h'),
  statsChartType: oneOf('bar', 'line'),
  statsAvgLine: bool,
  statsGoalLine: bool,
  statsTrendLine: bool,
  statsIncludeToday: bool,
  statsShowEmptyDays: bool,
  statsYZero: bool,
  statsMetricOrder: idList,
  statsHiddenMetrics: idList,
  bodyStatsOrder: idList,
  hiddenBodyStats: idList,
}

function onlyKeys(params, allowed) {
  const seen = new Set()
  for (const key of params.keys()) {
    if (!allowed.has(key) || seen.has(key)) return false
    seen.add(key)
  }
  return true
}
const boundedInt = (v, max) => v === null || (/^[1-9]\d{0,2}$/.test(v) && Number(v) <= max)

// fitness-hub src/nt-routes.ts isOffSearchQuery, as is.
export function isOffSearchQuery(params) {
  if (!onlyKeys(params, new Set(['url']))) return false
  const raw = params.get('url')
  if (raw === null || !raw.startsWith('https://search.openfoodfacts.org/search?')) return false
  let target
  try { target = new URL(raw) } catch { return false }
  if (target.origin !== 'https://search.openfoodfacts.org' || target.pathname !== '/search') return false
  if (target.username !== '' || target.password !== '' || target.hash !== '') return false
  const s = target.searchParams
  if (!onlyKeys(s, new Set(['q', 'page', 'page_size', 'langs']))) return false
  const q = s.get('q')
  if (q === null || q.trim() === '' || q.length > 200) return false
  const langs = s.get('langs')
  if (langs !== null && !/^[a-z]{2}$/.test(langs)) return false
  return boundedInt(s.get('page'), 100) && boundedInt(s.get('page_size'), 50)
}

// fitness-hub src/nt-routes.ts isOffProductQuery: the barcode lookup, matched on the raw string.
const OFF_PRODUCT_URL = /^https:\/\/world\.openfoodfacts\.org\/api\/v3\/product\/\d{8,14}(?:\?lc=[a-z]{2})?$/
export function isOffProductQuery(params) {
  if (!onlyKeys(params, new Set(['url']))) return false
  const raw = params.get('url')
  return raw !== null && OFF_PRODUCT_URL.test(raw)
}

// GET /api/wellness/fitbit/data and /api/wellness/garmin/data (proposed hub rule, PR body "Hub
// routes needed"): exactly `from` and `to`, once each, both dates, `from` not after `to`, and no
// more than 366 days between them. Without them NutriTrace falls back to its own 30-day window
// and `date` reads one day; the app sends neither.
export function isWellnessDataQuery(params) {
  if (!onlyKeys(params, new Set(['from', 'to']))) return false
  const from = params.get('from')
  const to = params.get('to')
  if (from === null || to === null || !DATE.test(from) || !DATE.test(to) || from > to) return false
  return (Date.parse(to + 'T12:00:00Z') - Date.parse(from + 'T12:00:00Z')) / 86400000 <= 366
}

// GET /api/diary/index (proposed hub rule, docs/reviews/api-diary-index.md §7): `since` (the
// previous page's `next`: letters, digits, _ and -, 1 to 200 of them, never empty) and `limit`
// (1 to 500), each at most once; nothing else.
export function isDiaryIndexQuery(params) {
  if (!onlyKeys(params, new Set(['since', 'limit']))) return false
  const since = params.get('since')
  return (since === null || /^[A-Za-z0-9_-]{1,200}$/.test(since)) && boundedInt(params.get('limit'), 500)
}

const isObject = v => typeof v === 'object' && v !== null && !Array.isArray(v)

// fitness-hub src/nt-body-checks.ts, fasts: an instant as toISOString writes it (or with an offset),
// never later than now plus 5 minutes of clock skew, and no earlier than maxAgeMs ago.
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/
const instantUpToNow = maxAgeMs => v => {
  if (typeof v !== 'string' || !ISO_INSTANT.test(v) || Number.isNaN(Date.parse(v))) return false
  const at = Date.parse(v)
  return at <= Date.now() + 5 * 60_000 && at >= Date.now() - maxAgeMs
}
const FAST_START_FIELDS = {
  goal_hours: v => typeof v === 'number' && Number.isFinite(v) && v >= 1 && v <= 168,
  start_at: instantUpToNow(Number.POSITIVE_INFINITY),
}
// (hasOnly, below, is the hub's: every key named in the fields and its value passing.)
const isFastStart = b => hasOnly(b, FAST_START_FIELDS)
const isFastStartEdit = b => isObject(b) && Object.keys(b).length === 1 && hasOnly(b, { start_at: instantUpToNow(7 * 24 * 3600_000) })
const isEmptyObject = b => isObject(b) && Object.keys(b).length === 0
// fitness-hub isPrivateFoodWithoutImage
const isPrivateFoodWithoutImage = b => isObject(b) && !('img_url' in b) && !('imgUrl' in b) && b.visibility === 'private'
// The meals routes' allow-lists with the type of each field, as the hub checks them (fitness-hub
// nt-body-checks.ts MEAL_EDIT_FIELDS, NEW_MEAL_FIELDS, INGREDIENT_FIELDS, ALT_UNIT_FIELDS, with
// the ingredient rules of gains-hub#11): a key outside them, or a value of the wrong kind, is a 400,
// in the meal and in each ingredient.
const isNutrition = v => isObject(v) && Object.keys(v).length <= 100 && Object.entries(v).every(([k, n]) => k.length <= 40 && numberIn(0, 1e9)(n))
const ALT_UNIT_FIELDS = { abbr: nonEmptyText(20), grams: positiveAmount }
const INGREDIENT_AMOUNT = numberIn(0, 1_000_000)
const INGREDIENT_FIELDS = {
  id: v => integerIn(0, Number.MAX_SAFE_INTEGER)(v) || text(64)(v), name: text(200), brand: nullable(text(200)),
  portion: INGREDIENT_AMOUNT, unit: text(16), quantity: INGREDIENT_AMOUNT, nutrition: isNutrition,
  nutrition_basis: nullable(oneOf('g', 'ml')), alt_units: nullable(arrayOf(u => hasOnly(u, ALT_UNIT_FIELDS), 20)),
  density_g_ml: nullable(positiveAmount), is_recipe: bool,
}
const isIngredient = v => isObject(v) && hasAll(v, ['name', 'portion', 'unit', 'nutrition']) && hasOnly(v, INGREDIENT_FIELDS)
const MEAL_EDIT_FIELDS = {
  name: nonEmptyText(200), notes: text(5000), items: v => Array.isArray(v) && v.length > 0 && arrayOf(isIngredient, 100)(v),
  is_recipe: bool, nutrition: isNutrition, portion: positiveAmount, unit: nonEmptyText(16), servings: integerIn(1, 1000),
}
const NEW_MEAL_FIELDS = { ...MEAL_EDIT_FIELDS, client_key: nonEmptyText(128), visibility: oneOf('private') }
const isNewMeal = b => isObject(b) && hasAll(b, ['name', 'items', 'is_recipe', 'visibility']) && hasOnly(b, NEW_MEAL_FIELDS)
const isMealEdit = b => isObject(b) && hasOnly(b, MEAL_EDIT_FIELDS)
const isMealUsedBump = b => isObject(b) && hasOnly(b, { date: v => typeof v === 'string' && DATE.test(v) })

// fitness-hub isFoodEdit (gains-hub nt-body-checks.ts FOOD_EDIT_FIELDS): only these keys, anything
// else is a 400 before NutriTrace sees it. Kept apart from api.js on purpose: it is the hub's list.
const HUB_FOOD_EDIT_FIELDS = ['name', 'brand', 'barcode', 'portion', 'unit', 'category', 'notes', 'favorite', 'nutrition']
const isFoodEdit = b => isObject(b) && Object.keys(b).every(k => HUB_FOOD_EDIT_FIELDS.includes(k))

/* ------------------------------------------------------------------ NutriTrace's merge ------- */

// server/lib/diary-merge.js mergeEntries, minus the legacy echo matching: the client's list in
// its order (an entry the server holds a strictly newer copy of keeps the server's), then the
// server's entries the client did not name, in server order. Tombstoned uuids stay out.
function merge(server, client, deleted, tombstoned) {
  const ts = e => String(e?.updatedAt || e?.addedAt || '')
  const gone = new Set([...tombstoned, ...deleted])
  const serverBy = new Map()
  for (const e of server) if (e?.uuid && !gone.has(e.uuid) && !serverBy.has(e.uuid)) serverBy.set(e.uuid, e)
  const pos = new Map()
  const out = []
  for (const e of client) {
    if (!e || typeof e !== 'object' || !e.uuid || gone.has(e.uuid)) continue
    if (pos.has(e.uuid)) { if (ts(e) >= ts(out[pos.get(e.uuid)])) out[pos.get(e.uuid)] = e; continue }
    const have = serverBy.get(e.uuid)
    pos.set(e.uuid, out.length)
    out.push(!have || ts(e) >= ts(have) ? e : have)
  }
  for (const [uuid, e] of serverBy) if (!pos.has(uuid)) out.push(e)
  return out
}

/* ------------------------------------------------------------------ the diary index --------- */

// server/routes/diary.js diaryIndexEntry, written on its own (not from lib/nutrition/diary.js) so a
// drift between the two shows up in a test: kcal from the stored nutrition x quantity, a split
// recipe as the sum of its children.
const NEVER = '1970-01-01 00:00:00'
const sqlTime = ms => new Date(ms).toISOString().slice(0, 19).replace('T', ' ')
const itemKcal = item => {
  if (Array.isArray(item._splitItems) && item._splitItems.length) return item._splitItems.reduce((sum, c) => sum + itemKcal(c), 0)
  const calories = isObject(item.nutrition) && Object.keys(item.nutrition).length ? item.nutrition.calories : (item.calories ?? item.calories_kcal)
  return (parseFloat(calories) || 0) * (parseFloat(item.quantity) || 1)
}
function indexEntry(day) {
  const all = (day.items || []).filter(isObject)
  const items = all.filter(i => typeof i.uuid === 'string' && typeof i.name === 'string').map(i => {
    const foodId = i.is_recipe || i.food_server_id === null ? null : (i.food_server_id ?? i.id)
    const parts = (Array.isArray(i._splitItems) ? i._splitItems : []).map(c => c?.name).filter(p => typeof p === 'string')
    return {
      uuid: i.uuid, name: i.name, ...(i.brand ? { brand: i.brand } : {}),
      food_id: typeof foodId === 'number' ? foodId : null, meal: Number(i.meal) || 0, kcal: Math.round(itemKcal(i)),
      ...(parts.length ? { parts } : {}),
    }
  })
  return { date: day.date, rev: day.updated_at.replace(' ', 'T') + 'Z', kcal: Math.round(all.reduce((sum, i) => sum + itemKcal(i), 0)), items }
}
const encodeCursor = (u, d) => btoa(JSON.stringify({ u, d })).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
function decodeCursor(since) {
  try {
    const c = JSON.parse(atob(since.replaceAll('-', '+').replaceAll('_', '/')))
    return typeof c?.u === 'string' && typeof c?.d === 'string' ? c : null
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ the fake ----------------- */

export function createFakeNutriTrace({
  days = {}, settings = fixtureSettings(), foods = fixtureFoods(), meals = fixtureMeals(), activity = {}, activitySum = {},
  caloriesOut = {}, adaptiveTdee = { ready: false }, offSearch = fixtureOffSearch(),
  syncStatus = fixtureSyncStatus(), workouts = {}, fasts = [], offProducts = { '3017620422003': fixtureOffProduct() },
  wellness = {},
} = {}) {
  const state = {
    days: structuredClone(days), settings: structuredClone(settings), foods: structuredClone(foods), meals: structuredClone(meals),
    activity, activitySum, caloriesOut, adaptiveTdee, offSearch, syncStatus, workouts,
    fasts: structuredClone(fasts), offProducts,
    // { fitbit: { date: { metric_type: value } }, garmin: { ... } }, as the two /data routes answer.
    wellness: structuredClone(wellness),
    // date → [{ kind: 'item'|'water', uuid, deleted_at }]
    tombstones: {},
  }
  const requests = []
  const failures = []
  const holds = []
  let nextFoodId = Math.max(100, ...state.foods.map(f => f.id + 1))
  let nextFastId = Math.max(1, ...state.fasts.map(f => f.id + 1))
  let nextMealId = Math.max(100, ...state.meals.map(m => m.id + 1))

  const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
  const notFound = () => json({ error: 'not found' }, 404)
  const tombsOf = date => state.tombstones[date] || []
  const answerDay = date => ({ ...(state.days[date] || emptyDay(date)), tombstones: tombsOf(date) })

  function route(method, path, query, body) {
    const seg = path.split('/').filter(Boolean)
    if (seg[0] === 'hub') {
      const sub = seg.slice(3).join('/')
      if (method === 'POST' && sub === 'now') return json(state.syncStatus)
      if (method === 'GET' && sub === 'status') return json(state.syncStatus)
      if (method === 'GET' && seg[3] === 'workouts' && seg.length === 5) {
        const row = state.workouts[decodeURIComponent(seg[4])]
        return row ? json(row) : notFound()
      }
      return notFound()
    }
    if (seg[0] !== 'nt' || seg[1] !== 'api') return notFound()
    const [, , res, a, b] = seg
    const n = seg.length
    if (res === 'diary') {
      if (method === 'GET' && n === 3) return json(Object.keys(state.days).filter(d => !state.days[d].deleted_at).map(answerDay))
      // Must come before /:date, as on the server (route order, api-diary-index.md §4).
      if (a === 'index' && n === 4) {
        if (method !== 'GET') return notFound()
        if (!isDiaryIndexQuery(query)) return json({ error: 'forbidden' }, 403)
        const since = query.get('since')
        const from = since ? decodeCursor(since) : { u: NEVER, d: '' }
        if (!from) return json({ error: 'bad cursor', code: 'bad_cursor' }, 400)
        const limit = Number(query.get('limit') || 200)
        const rows = Object.values(state.days)
          .map(d => ({ d, u: d.updated_at || NEVER }))
          .filter(r => r.u > from.u || (r.u === from.u && r.d.date > from.d))
          .sort((x, y) => (x.u < y.u ? -1 : x.u > y.u ? 1 : x.d.date < y.d.date ? -1 : 1))
        const page = rows.slice(0, limit)
        // The cursor never moves into the current second: a write may still land there.
        const current = sqlTime(Date.now())
        const settled = page.filter(r => r.u < current)
        const last = settled[settled.length - 1]
        const next = last ? encodeCursor(last.u, last.d.date) : (since || encodeCursor(from.u, from.d))
        return json({
          days: page.map(r => (r.d.deleted_at ? { date: r.d.date, rev: r.u.replace(' ', 'T') + 'Z', deleted: true } : indexEntry({ ...r.d, updated_at: r.u }))),
          total: Object.values(state.days).filter(d => !d.deleted_at).length,
          next,
          has_more: rows.length > limit && settled.length === page.length,
        })
      }
      if (n !== 4 || !DATE.test(a)) return notFound()
      if (method === 'GET') return json(answerDay(a))
      if (method === 'PUT') {
        if (!isObject(body)) return json({ error: 'request body refused' }, 400)
        const cur = state.days[a] || emptyDay(a)
        const tombs = tombsOf(a)
        const now = new Date().toISOString()
        const delItems = body.deleted_uuids?.items || []
        const delWater = body.deleted_uuids?.water || []
        const next = {
          ...cur,
          items: merge(cur.items, body.items || [], delItems, tombs.filter(t => t.kind === 'item').map(t => t.uuid)),
          water: merge(cur.water, body.water || [], delWater, tombs.filter(t => t.kind === 'water').map(t => t.uuid)),
          notes: 'notes' in body ? body.notes : cur.notes,
          updated_at: sqlTime(Date.now()),
          deleted_at: null,
        }
        const fresh = [...delItems.map(uuid => ({ kind: 'item', uuid })), ...delWater.map(uuid => ({ kind: 'water', uuid }))]
          .filter(t => !tombs.some(x => x.kind === t.kind && x.uuid === t.uuid))
          .map(t => ({ ...t, deleted_at: now }))
        state.tombstones[a] = [...tombs, ...fresh]
        state.days[a] = next
        return json(answerDay(a))
      }
      return notFound()
    }
    if (res === 'settings' && method === 'GET' && n === 3) return json(state.settings)
    // server/routes/settings.js stores one key per write, as JSON (what is read back is a copy).
    // The hub lets through only exactly { key, value } for a writable key, and answers 400 otherwise.
    if (res === 'settings' && method === 'PUT' && n === 3) {
      const exact = isObj(body) && Object.keys(body).sort().join() === 'key,value'
      const check = exact && Object.hasOwn(WRITABLE_SETTINGS, body.key) ? WRITABLE_SETTINGS[body.key] : null
      if (!check || !check(body.value)) return json({ error: 'request body refused' }, 400)
      state.settings[body.key] = structuredClone(body.value)
      return json({ ok: true })
    }
    // Fasting (fitness-hub nt-routes.ts): GET /api/fasts takes `limit` only; every other fast route
    // takes no query (403). Start, end and PATCH bodies are checked (400); DELETE takes no body.
    if (res === 'fasts') {
      const active = () => state.fasts.find(f => !f.end_at)
      const stamp = iso => iso.slice(0, 19).replace('T', ' ')
      if (n > 3 && [...query.keys()].length) return json({ error: 'forbidden' }, 403)
      if (method === 'DELETE' && body !== undefined) return json({ error: 'request body refused' }, 400)
      if (method === 'GET' && n === 3) {
        const limit = query.get('limit')
        if ([...query.keys()].some(k => k !== 'limit') || (limit !== null && !(/^[1-9]\d{0,2}$/.test(limit) && Number(limit) <= 365))) return json({ error: 'forbidden' }, 403)
        return json([...state.fasts].sort((x, y) => y.start_at.localeCompare(x.start_at)).slice(0, limit === null ? 30 : Number(limit)))
      }
      if (method === 'GET' && n === 4 && a === 'active') return json(active() || null)
      if (method === 'POST' && n === 4 && a === 'start') {
        if (!isFastStart(body)) return json({ error: 'request body refused' }, 400)
        if (active()) return json({ error: 'A fast is already in progress. End it before starting a new one.' }, 409)
        const goal = Number(body.goal_hours)
        let start = new Date(Date.now()).toISOString()
        const asked = body.start_at ? new Date(body.start_at) : null
        if (asked && !isNaN(asked.getTime()) && asked.getTime() <= Date.now() && asked.getTime() > Date.now() - 24 * 3600 * 1000) start = asked.toISOString()
        const fast = { id: nextFastId++, user_id: 3, start_at: start, end_at: null, goal_hours: Number.isFinite(goal) && goal > 0 && goal <= 168 ? Math.round(goal * 10) / 10 : 16, notes: null, created_at: stamp(start), updated_at: stamp(start) }
        state.fasts.push(fast)
        return json(fast, 201)
      }
      if (n >= 4 && /^[1-9]\d{0,11}$/.test(a)) {
        const fast = state.fasts.find(f => String(f.id) === a)
        if (method === 'POST' && n === 5 && b === 'end') {
          if (!isEmptyObject(body)) return json({ error: 'request body refused' }, 400)
          if (!fast) return json({ error: 'Fast not found' }, 404)
          if (fast.end_at) return json({ error: 'Fast is already ended' }, 400)
          fast.end_at = new Date(Date.now()).toISOString()
          return json(fast)
        }
        if (method === 'PATCH' && n === 4) {
          if (!isFastStartEdit(body)) return json({ error: 'request body refused' }, 400)
          if (!fast) return json({ error: 'Fast not found' }, 404)
          const at = new Date(body.start_at)
          if (!isNaN(at.getTime())) fast.start_at = at.toISOString()
          return json(fast)
        }
        if (method === 'DELETE' && n === 4) {
          if (!fast) return json({ error: 'Fast not found' }, 404)
          state.fasts = state.fasts.filter(f => f !== fast)
          return json({ ok: true })
        }
      }
      return notFound()
    }
    if (res === 'foods') {
      if (method === 'GET' && n === 3) return [...query.keys()].length ? json({ error: 'forbidden' }, 403) : json(state.foods)
      if (method === 'POST' && n === 3) {
        if (!isPrivateFoodWithoutImage(body)) return json({ error: 'request body refused' }, 400)
        if (!body.name) return json({ error: 'Name required' }, 400)
        const made = state.foods.find(f => (body.client_key && f.client_key === body.client_key) || (body.barcode && f.barcode === body.barcode))
        if (made) return json(made, 200)
        const food = { usage_count: 0, last_used_at: null, alt_units: null, nutrition_basis: null, density_g_ml: null, img_url: null, ...body, id: nextFoodId++, user_id: 3 }
        state.foods.push(food)
        return json(food, 201)
      }
      // PUT and DELETE on one of your foods (gains-hub #9): no query string (403), a PUT body of
      // the edit fields only (400).
      if ((method === 'PUT' || method === 'DELETE') && n === 4 && ID.test(a)) {
        if ([...query.keys()].length) return json({ error: 'forbidden' }, 403)
        const food = state.foods.find(f => String(f.id) === a)
        if (!food) return json({ error: 'Not found' }, 404)
        if (method === 'DELETE') {
          state.foods = state.foods.filter(f => f !== food)
          return json({ ok: true })
        }
        if (!isFoodEdit(body)) return json({ error: 'request body refused' }, 400)
        Object.assign(food, body, { id: food.id })
        return json(food)
      }
      if (method === 'POST' && n === 5 && ID.test(a) && b === 'used') {
        const food = state.foods.find(f => String(f.id) === a)
        if (!food) return json({ error: 'Not found' }, 404)
        food.usage_count = (food.usage_count || 0) + 1
        food.last_used_at = body?.date || food.last_used_at
        return json({ ok: true })
      }
      return notFound()
    }
    if (res === 'meals') {
      const live = () => state.meals.find(m => String(m.id) === a && !m.deleted_at)
      if (method === 'GET' && n === 3) {
        // Meals or, with recipes=1 and nothing else, recipes. Any other query is refused.
        const recipes = query.get('recipes')
        if (!onlyKeys(query, new Set(['recipes'])) || (recipes !== null && recipes !== '1')) return json({ error: 'forbidden' }, 403)
        return json(state.meals.filter(m => !m.deleted_at && m.is_recipe === (recipes === '1')).sort((x, y) => x.name.localeCompare(y.name)))
      }
      if (method === 'GET' && n === 4 && ID.test(a)) return live() ? json(live()) : json({ error: 'Not found' }, 404)
      if (method === 'POST' && n === 3) {
        if (!isNewMeal(body)) return json({ error: 'request body refused' }, 400)
        if (!body.name) return json({ error: 'Name required' }, 400)
        const made = state.meals.find(m => body.client_key && m.client_key === body.client_key)
        if (made) return json(made, 200)
        const meal = { portion: 100, unit: 'g', servings: null, notes: null, usage_count: 0, last_used_at: null, favorite: 0, img_url: null, items: [], nutrition: {}, ...body, is_recipe: !!body.is_recipe, id: nextMealId++, user_id: 3, deleted_at: null }
        state.meals.push(meal)
        return json(meal, 201)
      }
      if (method === 'PUT' && n === 4 && ID.test(a)) {
        if (!isMealEdit(body)) return json({ error: 'request body refused' }, 400)
        const meal = live()
        if (!meal) return json({ error: 'Not found' }, 404)
        Object.assign(meal, body)
        return json(meal)
      }
      if (method === 'DELETE' && n === 4 && ID.test(a)) {
        const meal = live()
        if (!meal) return json({ error: 'Not found' }, 404)
        meal.deleted_at = new Date().toISOString()
        return json({ ok: true })
      }
      if (method === 'POST' && n === 5 && ID.test(a) && b === 'used') {
        if (!isMealUsedBump(body)) return json({ error: 'request body refused' }, 400)
        const meal = live()
        if (!meal) return json({ error: 'Not found' }, 404)
        meal.usage_count = (meal.usage_count || 0) + 1
        meal.last_used_at = body?.date || meal.last_used_at
        return json({ ok: true })
      }
      return notFound()
    }
    if (res === 'activity' && method === 'GET') {
      if (n === 4 && DATE.test(a)) return json(state.activity[a] || [])
      if (n === 5 && a === 'sum' && DATE.test(b)) return json(state.activitySum[b] || { date: b, manual: 0, wearable: 0, effective: 0, covered_by: null, policy: query.get('policy') || 'wearable_wins' })
      return notFound()
    }
    if (res === 'wellness' && a === 'calories-out' && method === 'GET' && n === 4) return json({ calories_out: state.caloriesOut[query.get('date')] ?? null })
    if (res === 'wellness' && (a === 'fitbit' || a === 'garmin') && b === 'data' && method === 'GET' && n === 5) {
      if (!isWellnessDataQuery(query)) return json({ error: 'forbidden' }, 403)
      const from = query.get('from')
      const to = query.get('to')
      return json(Object.fromEntries(Object.entries(state.wellness[a] || {}).filter(([date]) => date >= from && date <= to)))
    }
    if (res === 'goals' && a === 'adaptive-tdee' && method === 'GET' && n === 4) return json(state.adaptiveTdee)
    if (res === 'proxy' && method === 'GET' && n === 3) {
      if (isOffSearchQuery(query)) return json(state.offSearch)
      if (!isOffProductQuery(query)) return json({ error: 'forbidden' }, 403)
      const answer = state.offProducts[new URL(query.get('url')).pathname.split('/').pop()]
      return answer ? json(answer) : json({ error: 'Upstream 404' }, 404)
    }
    return notFound()
  }

  async function fakeFetch(input, init = {}) {
    const url = new URL(typeof input === 'string' ? input : input.url, 'http://gains.test')
    const method = (init.method || 'GET').toUpperCase()
    let body
    if (typeof init.body === 'string') { try { body = JSON.parse(init.body) } catch { body = init.body } }
    requests.push({ method, path: url.pathname, query: Object.fromEntries(url.searchParams), body })
    const signal = init.signal
    const aborted = () => Object.assign(new Error('aborted'), { name: 'AbortError' })
    if (signal?.aborted) throw aborted()
    const h = holds.findIndex(x => x.method === method && url.pathname.startsWith(x.prefix))
    if (h >= 0) {
      // The server answers now; the answer reaches the app when released (a slow network).
      const [held] = holds.splice(h, 1)
      const answer = route(method, url.pathname, url.searchParams, body)
      await held.gate
      if (signal?.aborted) throw aborted()
      return answer
    }
    const i = failures.findIndex(f => f.method === method && url.pathname.startsWith(f.prefix))
    if (i >= 0) {
      const [f] = failures.splice(i, 1)
      if (f.how === 'offline') throw new TypeError('Failed to fetch')
      if (f.how.lost) {
        route(method, url.pathname, url.searchParams, body)
        if (!f.how.status) throw new TypeError('Failed to fetch')
        return json({ error: 'upstream timeout' }, f.how.status)
      }
      return json({ error: f.how.error || 'upstream_error' }, f.how.status || 500)
    }
    return route(method, url.pathname, url.searchParams, body)
  }

  return {
    fetch: fakeFetch,
    requests,
    state,
    /** The next matching request fails (see the header for the forms). */
    failNext(method, prefix, how = { status: 500 }) { failures.push({ method, prefix, how }) },
    /** The next matching request is answered by the server at once, but the answer reaches the
     *  app only on `release()`: two requests can then answer in the other order. */
    hold(method, prefix) {
      let release
      const gate = new Promise(r => { release = r })
      holds.push({ method, prefix, gate })
      return { release }
    },
    writes: () => requests.filter(r => r.method !== 'GET'),
  }
}
