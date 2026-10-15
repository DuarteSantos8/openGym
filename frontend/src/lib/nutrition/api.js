// NutriTrace (nutrition) and the hub's sync routes, as the browser reaches them: same origin, the
// openGym session cookie, through the hub at /nt/api/* and /hub/api/sync/*. The hub checks the
// session and the request's origin itself (Sec-Fetch-Site), so there is no token to send, and it
// forwards only the routes in fitness-hub src/nt-routes.ts: a call to anything else is a 404.
// Every shape here is NutriTrace's own (server/routes/*.js, src/lib/api.js, src/stores/diary.js).
import { appBase } from '../app-base.js'
import { MOBILE } from '../mobile.js'
import { offSearchUrl } from './off.js'

/**
 * Per-serving nutrients keyed by NutriTrace nutrient id: calories (kcal), proteins,
 * carbohydrates, fat, fiber, sugars, salt (g); sodium, potassium, cholesterol (mg); ...
 * (src/lib/nutrition.js NUTRIMENTS).
 * @typedef {Record<string, number>} Nutrition
 */
/**
 * One logged entry of a day. `meal` is the slot index into the meal names; `quantity` is the
 * number of servings; `portion` + `unit` the serving; `nutrition` per serving, already scaled
 * to that portion. `type: 'quick_calories'` rows carry only `name` and `nutrition`.
 * @typedef {{ uuid: string, meal: number, addedAt: string, updatedAt?: string, type?: 'quick_calories',
 *   id?: number, food_server_id?: number|null, is_recipe?: boolean, name: string, brand?: string,
 *   portion?: number, unit?: string, quantity?: number, nutrition: Nutrition, notes?: string,
 *   imgUrl?: string, source?: string, _splitItems?: DiaryItem[] }} DiaryItem
 */
/** @typedef {{ uuid: string, amount: number, time: string }} WaterLog  amount in ml */
/**
 * GET/PUT /api/diary/:date. A day with nothing logged answers this shape with empty lists.
 * @typedef {{ date: string, items: DiaryItem[], water: WaterLog[], body_stats: Record<string, number>,
 *   notes: string, completed_at: string|null, completed_meals: number[],
 *   tombstones?: { kind: 'item'|'water', uuid: string, deleted_at: string }[] }} DiaryDay
 */
/**
 * PUT /api/diary/:date body. The server merges per uuid: entries named are added or updated,
 * uuids in deleted_uuids removed, everything else kept (lib/nutrition/diary.js addPayload).
 * @typedef {{ items: DiaryItem[], water: WaterLog[], deleted_uuids: { items: string[], water: string[] } }} DiaryWrite
 */
/**
 * A food (GET/POST /api/foods). Nutrition is per `portion` `unit` (100 g for most). The client
 * maps `img_url` to `imgUrl` (lib/nutrition/store.js), as NutriTrace's client does.
 * @typedef {{ id: number, name: string, brand?: string, portion: number, unit: string, nutrition: Nutrition,
 *   barcode?: string, nutrition_basis?: 'g'|'ml'|null, alt_units?: { abbr: string, grams: number }[]|null,
 *   density_g_ml?: number|null, imgUrl?: string, usage_count?: number, last_used_at?: string|null }} Food
 */
/**
 * GET /api/activity/:date rows. `source: 'opengym'` rows are the hub's workout entries;
 * `covered_by` names the wearable whose active kcal count instead that day (else null).
 * @typedef {{ id: number, date: string, name: string, kcal: number, duration_min: number|null,
 *   source: string, external_id?: string|null, covered_by: string|null }} ActivityRow
 */
/** @typedef {{ date: string, manual: number, wearable: number, effective: number, covered_by: string|null, policy: string }} ActivitySum */
/**
 * GET /api/settings: the user's settings by key. The diary reads mealNames, goals,
 * calorieGoalMode ('fixed'|'dynamic'|'adaptive'), calorieGoalFactor, waterGoalMl,
 * diaryShowActivity, calorieAdjustFromActivity, manualActivityPolicy, notifMealTimes,
 * offSearchLanguage, timeFormat. Any may be absent (NutriTrace's defaults then apply).
 * @typedef {Record<string, unknown>} NtSettings
 */
/**
 * GET /hub/api/sync/status (fitness-hub src/sync/engine.ts).
 * @typedef {{ state: 'ok'|'syncing'|'retrying'|'needs_confirmation'|'error'|'suspended', pending: number,
 *   held: number, last_synced_at: number|null, next_retry_at: number|null, suspended: string|null,
 *   problems: unknown[] }} SyncStatus
 */
/** @typedef {{ workout_id: string, date: string, kcal: number, kcal_method: string, weight_kg: number|null,
 *   state: 'pending'|'synced'|'user_edited'|'failed'|'expired'|'deleted' }} WorkoutSyncStatus */
/**
 * Every failure is an Error with `status` (the HTTP status, 0 without an answer) and `code`:
 * 'offline' (no connection), 'timeout', 'http' (a 4xx/5xx), 'bad-response' (a 2xx that is not
 * the JSON expected), 'aborted' (the caller's signal), 'invalid' (input refused before any
 * request: diary.js builders, store.js). `message` is for logs, never for the screen: map
 * `code`/`status` to a t() string.
 * @typedef {Error & { status: number, code: 'offline'|'timeout'|'http'|'bad-response'|'aborted'|'invalid' }} NtError
 */

const TIMEOUT_GET_MS = 20000
const TIMEOUT_MS = 30000

const failure = (message, status, code) => Object.assign(new Error(message), { status, code })

/** The web app behind the hub has nutrition; a phone build talks to openGym alone, and so does a
 *  guest (no session for the hub to check). */
export function nutritionAvailable(user) {
  return !MOBILE && !!user
}

const urlOf = path => appBase().replace(/\/$/, '') + path

// `nullable`: a JSON null is an answer (the hub's status for someone it has not stored yet).
async function call(method, path, body, { signal, nullable = false } = {}) {
  if (signal?.aborted) throw failure('aborted', 0, 'aborted')
  const ctl = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; ctl.abort() }, method === 'GET' ? TIMEOUT_GET_MS : TIMEOUT_MS)
  const onAbort = () => ctl.abort()
  signal?.addEventListener('abort', onAbort)
  let res
  try {
    res = await fetch(urlOf(path), {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctl.signal,
    })
  } catch {
    if (timedOut) throw failure('timeout', 0, 'timeout')
    if (signal?.aborted) throw failure('aborted', 0, 'aborted')
    throw failure('offline', 0, 'offline')
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
  let data
  let parsed = true
  try { data = await res.json() } catch { parsed = false }
  if (!res.ok) throw failure((parsed && data && typeof data.error === 'string' && data.error) || 'HTTP ' + res.status, res.status, 'http')
  if (parsed && data === null && nullable) return null
  if (!parsed || data === null || typeof data !== 'object') throw failure('bad response', res.status, 'bad-response')
  return data
}

const nt = (method, path, body, opts) => call(method, '/nt' + path, body, opts)

// What PUT /api/foods/:id may carry (the hub's isFoodEdit), picked by name: never a spread.
const FOOD_EDIT_FIELDS = ['name', 'brand', 'barcode', 'portion', 'unit', 'category', 'notes', 'favorite', 'nutrition']

export const NtApi = {
  /** @returns {Promise<DiaryDay>} */
  getDiaryDate: date => nt('GET', `/api/diary/${date}`),
  /** Every day with a row (the calendar's logged marks). @returns {Promise<DiaryDay[]>} */
  getAllDiary: () => nt('GET', '/api/diary'),
  /** @param {DiaryWrite} payload @returns {Promise<DiaryDay>} the day after the merge */
  saveDiaryDate: (date, payload) => nt('PUT', `/api/diary/${date}`, payload),
  /** @returns {Promise<NtSettings>} */
  getSettings: () => nt('GET', '/api/settings'),
  /** Upserts one setting. The hub takes exactly { key, value } for calorieGoalMode, calorieGoalFactor,
   *  goals, goalTemplates, waterGoalMl, calorieAdjustFromActivity, diaryShowActivity, fastingEnabled
   *  and fastingDefaultHours, type-checks the value, and refuses anything else with 400. */
  putSetting: (key, value) => nt('PUT', '/api/settings', { key, value }),
  /** Your own foods, by name. @returns {Promise<Food[]>} (img_url, not imgUrl) */
  getFoods: () => nt('GET', '/api/foods'),
  /** Saves a food as yours: always private, never with an image (the hub refuses `img_url`,
   *  `imgUrl` and any other visibility). `client_key` makes a retry return the food made the
   *  first time. @returns {Promise<Food>} */
  createFood: food => {
    const { img_url: _img, imgUrl: _imgUrl, visibility: _vis, id: _id, ...rest } = food
    return nt('POST', '/api/foods', { ...rest, visibility: 'private' })
  },
  /** Edits one of your foods. The body is the fields to change (NutriTrace keeps what is left
   *  out); `nutrition` replaces the whole object. Only FOOD_EDIT_FIELDS are sent: the hub refuses
   *  any other key (an image, a visibility, an id) with a 400.
   *  @returns {Promise<Food>} */
  updateFood: (id, food) =>
    nt('PUT', `/api/foods/${encodeURIComponent(id)}`, Object.fromEntries(FOOD_EDIT_FIELDS.filter(k => food[k] !== undefined).map(k => [k, food[k]]))),
  /** Removes one of your foods (NutriTrace keeps a tombstone). Past diary entries keep their copy. */
  deleteFood: id => nt('DELETE', `/api/foods/${encodeURIComponent(id)}`),
  /** Orders recents (usage_count, last_used_at = the diary date). */
  markFoodUsed: (id, date) => nt('POST', `/api/foods/${encodeURIComponent(id)}/used`, { date }),
  /** @returns {Promise<ActivityRow[]>} */
  getActivity: date => nt('GET', `/api/activity/${date}`),
  /** @returns {Promise<ActivitySum>} */
  getActivitySum: (date, policy) => nt('GET', `/api/activity/sum/${date}?policy=${encodeURIComponent(policy || 'wearable_wins')}`),
  /** Dynamic goal: yesterday's wearable burn for the date. @returns {Promise<{ calories_out: number|null }>} */
  getCaloriesOut: date => nt('GET', `/api/wellness/calories-out?date=${date}`),
  /** Learned from 35 days of weight and diary (server/lib/adaptive-tdee.js).
   *  @returns {Promise<{ ready: boolean, daysAvailable?: number, daysRequired?: number, tdee?: number|null,
   *    trendKgPerWeek?: number|null, confidence?: number|null }>} */
  getAdaptiveTdee: () => nt('GET', '/api/goals/adaptive-tdee'),
  /** Open Food Facts text search through NutriTrace's proxy (the hub lets this one URL shape by,
   *  30 a minute per person). Raw OFF answer: map it with off.js offResults. */
  searchOnline: (query, { page = 1, pageSize = 20, lang = 'en', signal } = {}) =>
    nt('GET', '/api/proxy?url=' + encodeURIComponent(offSearchUrl(query, { page, pageSize, lang })), undefined, { signal }),
}

export const HubSync = {
  /** Runs a cycle (waits up to 8 s for it). Null for a person the hub has not stored yet.
   *  @returns {Promise<SyncStatus|null>} */
  now: () => call('POST', '/hub/api/sync/now', {}, { nullable: true }),
  /** @returns {Promise<SyncStatus|null>} */
  status: () => call('GET', '/hub/api/sync/status', undefined, { nullable: true }),
  /** A workout's kcal row as the hub stored it; 404 before the hub has seen it. @returns {Promise<WorkoutSyncStatus>} */
  workout: id => call('GET', `/hub/api/sync/workouts/${encodeURIComponent(id)}`),
}
