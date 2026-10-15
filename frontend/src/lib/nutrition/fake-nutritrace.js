// A fake of NutriTrace and the hub's sync routes at the fetch boundary, for tests. It answers
// what the hub forwards (fitness-hub src/nt-routes.ts), as strictly as the hub does, with
// NutriTrace's real shapes and merge rules (server/routes/diary.js, foods.js, activity.js,
// server/lib/diary-merge.js); any other path is a 404, as the hub answers it.
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

/** GET /hub/api/sync/status when all is well. Pass `syncStatus: null` for a person the hub has
 *  not stored yet (it answers JSON null). */
export const fixtureSyncStatus = (state = 'ok') => ({ state, pending: 0, held: 0, last_synced_at: 1760464800000, next_retry_at: null, suspended: null, problems: [] })

/* ------------------------------------------------------------------ hub rules ---------------- */

const DATE = /^\d{4}-\d{2}-\d{2}$/
const ID = /^[A-Za-z0-9_-]{1,64}$/
// PUT /api/settings (fitness-hub src/nt-body-checks.ts WRITABLE_SETTINGS): each key with the type
// NutriTrace reads it as.
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v)
const WRITABLE_SETTINGS = {
  calorieGoalMode: v => ['fixed', 'adaptive', 'dynamic'].includes(v),
  calorieGoalFactor: v => [0.8, 1, 1.2].includes(v),
  goals: v => isObj(v) && Object.keys(v).length <= 100 && Object.values(v).every(isObj),
  goalTemplates: v => Array.isArray(v) && v.length <= 30 && v.every(isObj),
  waterGoalMl: v => typeof v === 'number' && v >= 1 && v <= 50000,
  calorieAdjustFromActivity: v => typeof v === 'boolean',
  diaryShowActivity: v => typeof v === 'boolean',
  fastingEnabled: v => typeof v === 'boolean',
  fastingDefaultHours: v => typeof v === 'number' && v >= 1 && v <= 168,
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

const isObject = v => typeof v === 'object' && v !== null && !Array.isArray(v)
// fitness-hub isPrivateFoodWithoutImage
const isPrivateFoodWithoutImage = b => isObject(b) && !('img_url' in b) && !('imgUrl' in b) && b.visibility === 'private'

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

/* ------------------------------------------------------------------ the fake ----------------- */

export function createFakeNutriTrace({
  days = {}, settings = fixtureSettings(), foods = fixtureFoods(), activity = {}, activitySum = {},
  caloriesOut = {}, adaptiveTdee = { ready: false }, offSearch = fixtureOffSearch(),
  syncStatus = fixtureSyncStatus(), workouts = {},
} = {}) {
  const state = {
    days: structuredClone(days), settings: structuredClone(settings), foods: structuredClone(foods),
    activity, activitySum, caloriesOut, adaptiveTdee, offSearch, syncStatus, workouts,
    // date → [{ kind: 'item'|'water', uuid, deleted_at }]
    tombstones: {},
  }
  const requests = []
  const failures = []
  const holds = []
  let nextFoodId = Math.max(100, ...state.foods.map(f => f.id + 1))

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
      if (method === 'GET' && n === 3) return json(Object.keys(state.days).map(answerDay))
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
      if (method === 'POST' && n === 5 && ID.test(a) && b === 'used') {
        const food = state.foods.find(f => String(f.id) === a)
        if (!food) return json({ error: 'Not found' }, 404)
        food.usage_count = (food.usage_count || 0) + 1
        food.last_used_at = body?.date || food.last_used_at
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
    if (res === 'goals' && a === 'adaptive-tdee' && method === 'GET' && n === 4) return json(state.adaptiveTdee)
    if (res === 'proxy' && method === 'GET' && n === 3) return isOffSearchQuery(query) ? json(state.offSearch) : json({ error: 'forbidden' }, 403)
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
