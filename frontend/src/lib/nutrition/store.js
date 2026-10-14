import { create } from 'zustand'
import { NtApi } from './api.js'
import { atPortion, dayWrite, foodItem, invalid, quickCaloriesItem, waterLog } from './diary.js'
import { offResults } from './off.js'
import { useDiarySelection } from './selection.js'
import { useHubSync } from './sync.js'
import { useStore } from '../../store/useStore.js'
import { todayISO } from '../format.js'

// NutriTrace's data as the app shows it: the diary per date, the settings it adds up against,
// the day's activity rows, the target's inputs and your foods. Server state read through the hub
// (api.js), cached per date so going back a day and forward again does not reload.
//
// Writes, as NutriTrace's own client makes them (stores/diary.js _refetchAndSave): read the day,
// then PUT its lists with the change. They are not optimistic, and they are retry-safe: an entry
// is built once, as a draft (draftFood, draftQuick, draftWater), and a retry sends that same
// draft, so a write whose answer was lost does not log twice. A failed write throws an NtError
// (api.js) to the caller, which keeps the draft and the input.
//
// Answers are applied in order: per date, an answer older than the newest one applied is
// dropped (and a dropped write answer reloads the day); after an account change every answer
// still in flight is dropped.
//
// Every `status` is 'idle' | 'loading' | 'ready' | 'error'.

const initial = () => ({
  settings: { status: 'idle', data: null, error: null },
  days: {},
  activity: {},
  goalInputs: {},
  foods: { status: 'idle', list: [], error: null },
  logged: { days: new Set(), checked: new Set() },
})

const ADAPTIVE_KEY = 'adaptive'
const LOGGED_RANGE_MAX = 42
const LOGGED_CONCURRENCY = 4
const withImg = ({ img_url, ...f }) => ({ ...f, imgUrl: img_url || f.imgUrl || '' })
const isoDays = (from, to) => {
  const out = []
  const d = new Date(from + 'T12:00:00')
  const end = new Date(to + 'T12:00:00')
  while (d <= end && out.length < LOGGED_RANGE_MAX) {
    out.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'))
    d.setDate(d.getDate() + 1)
  }
  return out
}

// NutriTrace's _userGen: bumped when the account changes, so a request made for the account
// before never lands in the next one's cache.
let gen = 0
// Per date: the number of the last request made, and of the last answer applied.
const issued = {}
const applied = {}
const inflightGoal = new Map()

export const useNutrition = create((set, get) => {
  const patchDay = (date, patch) => set(s => ({ days: { ...s.days, [date]: { ...s.days[date], ...patch } } }))
  const issue = date => (issued[date] = (issued[date] || 0) + 1)

  function markLogged(date, entry) {
    const { days, checked } = get().logged
    const has = (entry?.items?.length || 0) > 0
    if (days.has(date) === has && checked.has(date)) return
    const next = new Set(days)
    if (has) next.add(date); else next.delete(date)
    set({ logged: { days: next, checked: new Set(checked).add(date) } })
  }

  // Applies a day's answer unless a newer one is already applied. Returns whether it did.
  function applyDay(date, n, g, entry, { fromWrite = false } = {}) {
    if (g !== gen) return false
    if (n < (applied[date] || 0)) {
      if (fromWrite) get().loadDay(date, { force: true })
      return false
    }
    applied[date] = n
    patchDay(date, { status: 'ready', entry, error: null })
    markLogged(date, entry)
    return true
  }

  async function write(date, change) {
    // Nothing is logged to a day that has not happened: it would count toward that day's target
    // before it exists, and a weight logged ahead would become the current one.
    if ((change.addItems?.length || change.addWater?.length) && !(date <= todayISO())) throw invalid('nothing can be logged to a future day')
    const g = gen
    const current = await NtApi.getDiaryDate(date)
    const n = issue(date)
    const entry = await NtApi.saveDiaryDate(date, dayWrite(current, change))
    applyDay(date, n, g, entry, { fromWrite: true })
    return entry
  }

  // The food as NutriTrace stores it: an online result is saved as one of your foods first
  // (Foods.svelte _addFoodToDiaryNoNav), so the diary item points at a food you can find again.
  async function ownFood(food) {
    if (typeof food.id === 'number') return food
    const g = gen
    const saved = withImg(await NtApi.createFood({ ...food, created_at: new Date().toISOString() }))
    if (g === gen) set(s => ({ foods: { ...s.foods, list: [...s.foods.list.filter(f => f.id !== saved.id), saved] } }))
    return saved
  }

  return {
    ...initial(),

    reset() {
      gen += 1
      for (const k of Object.keys(issued)) delete issued[k]
      for (const k of Object.keys(applied)) delete applied[k]
      inflightGoal.clear()
      set(initial())
    },

    /** @returns {Promise<import('./api.js').NtSettings|null>} the settings, or the last ones on failure */
    async loadSettings({ force = false } = {}) {
      const cur = get().settings
      if (!force && cur.status === 'ready') return cur.data
      const g = gen
      set({ settings: { ...cur, status: 'loading' } })
      try {
        const data = await NtApi.getSettings()
        if (g === gen) set({ settings: { status: 'ready', data, error: null } })
        return data
      } catch (e) {
        if (g === gen) set({ settings: { status: 'error', data: cur.data, error: e } })
        return cur.data
      }
    },

    // `signal`: the caller no longer wants the day (the calendar moved on); an aborted load
    // leaves the day as it was before it.
    async loadDay(date, { force = false, signal } = {}) {
      const cur = get().days[date]
      if (!force && cur && (cur.status === 'ready' || cur.status === 'loading')) return
      if (signal?.aborted) return
      const g = gen
      const n = issue(date)
      if (!cur || cur.status !== 'ready') patchDay(date, { status: 'loading' })
      try {
        applyDay(date, n, g, await NtApi.getDiaryDate(date, { signal }))
      } catch (e) {
        if (g !== gen || n < (applied[date] || 0) || get().days[date]?.status === 'ready') return
        if (e?.code === 'aborted') patchDay(date, { status: cur?.status || 'idle', error: cur?.error || null })
        else patchDay(date, { status: 'error', error: e })
      }
    },

    // Activity rows (the workout entry and "Covered by" among them) and the effective active kcal
    // the target may add. A failure leaves the rows out; the diary still adds up.
    async loadActivity(date, policy) {
      const g = gen
      try {
        const [rows, sum] = await Promise.all([NtApi.getActivity(date), NtApi.getActivitySum(date, policy)])
        if (g === gen) set(s => ({ activity: { ...s.activity, [date]: { status: 'ready', rows: Array.isArray(rows) ? rows : [], sum, error: null } } }))
      } catch (e) {
        if (g === gen) set(s => ({ activity: { ...s.activity, [date]: { status: 'error', rows: s.activity[date]?.rows || [], sum: s.activity[date]?.sum || null, error: e } } }))
      }
    },

    // What a Dynamic or Adaptive target is computed from (Diary.svelte _loadDynamicGoal,
    // _loadAdaptiveTdee). An answer is kept (null included: no burn, not ready); a failure is
    // not, so the next call asks again, as NutriTrace does.
    async loadGoalInputs(date, mode) {
      const one = (key, fetchValue) => {
        if (key in get().goalInputs) return null
        if (inflightGoal.has(key)) return inflightGoal.get(key)
        const g = gen
        const p = fetchValue()
          .then(v => { if (g === gen) set(s => ({ goalInputs: { ...s.goalInputs, [key]: v } })) })
          .catch(() => {})
          .finally(() => inflightGoal.delete(key))
        inflightGoal.set(key, p)
        return p
      }
      await Promise.all([
        mode === 'dynamic' ? one(date, async () => (await NtApi.getCaloriesOut(date))?.calories_out ?? null) : null,
        mode === 'adaptive' ? one(ADAPTIVE_KEY, async () => { const r = await NtApi.getAdaptiveTdee(); return r?.ready ? r.tdee : null }) : null,
      ])
    },
    caloriesOut: date => get().goalInputs[date] ?? null,
    adaptiveTdee: () => get().goalInputs[ADAPTIVE_KEY] ?? null,

    async loadFoods({ force = false } = {}) {
      const cur = get().foods
      if (!force && (cur.status === 'ready' || cur.status === 'loading')) return
      const g = gen
      set({ foods: { ...cur, status: 'loading' } })
      try {
        const rows = await NtApi.getFoods()
        if (g === gen) set({ foods: { status: 'ready', list: (Array.isArray(rows) ? rows : []).map(withImg), error: null } })
      } catch (e) {
        if (g === gen) set({ foods: { ...get().foods, status: 'error', error: e } })
      }
    },

    // Which days from `from` to `to` (at most 42, the calendar's visible weeks) have food logged:
    // `logged.days`, with `logged.checked` the days known either way. NutriTrace has no range
    // read, so each day not already in the cache is one GET /api/diary/:date (and lands in it).
    // Days after today are never read (nothing can be logged to them). `signal` stops the rest,
    // and aborts the reads in flight, when the calendar moves to another month or closes.
    async loadLogged(from, to, { signal } = {}) {
      const today = todayISO()
      const days = isoDays(from, to).filter(d => d <= today)
      const want = days.filter(d => !get().logged.checked.has(d) && get().days[d]?.status !== 'ready')
      for (const d of days) if (get().days[d]?.status === 'ready') markLogged(d, get().days[d].entry)
      const queue = [...want]
      const worker = async () => {
        while (queue.length && !signal?.aborted) await get().loadDay(queue.shift(), { signal })
      }
      await Promise.all(Array.from({ length: Math.min(LOGGED_CONCURRENCY, queue.length) }, worker))
    },

    /** Online results for a search, mapped to unsaved foods (off.js). Throws an NtError
     *  ('aborted' once `signal` aborts: a newer search replaced this one). */
    async searchOnline(query, lang, { signal } = {}) {
      return offResults(await NtApi.searchOnline(query, { lang, signal }), lang)
    },

    /* --- drafts: build once, log (and retry) the same one --- */

    /** A food at (portion, unit) × servings for a meal. Throws invalid (diary.js) for a portion
     *  or servings that are not numbers above 0. */
    draftFood: ({ food, meal, portion, unit, servings }) => ({
      food,
      item: foodItem(atPortion(food, portion ?? food.portion, unit ?? food.unit), { meal, quantity: servings }),
    }),
    draftQuick: fields => quickCaloriesItem(fields),
    draftWater: ml => waterLog(ml, { hour12: get().settings.data?.timeFormat !== '24h' }),

    /** Logs a draftFood draft to the date. Resolves to the item logged. */
    async logFood(date, draft) {
      if (!draft?.item?.uuid || !draft.food) throw invalid('logFood takes a draftFood draft')
      const saved = await ownFood(draft.food)
      const item = typeof saved.id === 'number' ? { ...draft.item, id: saved.id, food_server_id: saved.id } : draft.item
      await write(date, { addItems: [item] })
      // Recents order by this (POST /api/foods/:id/used). Fire and forget, as NutriTrace does.
      if (typeof saved.id === 'number') {
        NtApi.markFoodUsed(saved.id, date).catch(() => {})
        set(s => ({
          foods: {
            ...s.foods,
            list: s.foods.list.map(f => (f.id === saved.id
              ? { ...f, last_used_at: f.last_used_at && f.last_used_at > date ? f.last_used_at : date, usage_count: (f.usage_count || 0) + 1 }
              : f)),
          },
        }))
      }
      return item
    },

    /** Logs a draftQuick item to the date. */
    async logQuick(date, item) {
      if (item?.type !== 'quick_calories' || !item.uuid) throw invalid('logQuick takes a draftQuick item')
      await write(date, { addItems: [item] })
      return item
    },

    /** Logs a draftWater entry to the date. */
    async logWater(date, log) {
      if (!log?.uuid || !(Number(log.amount) > 0)) throw invalid('logWater takes a draftWater entry')
      await write(date, { addWater: [log] })
      return log
    },

    // Undo of a log just made: out of the day, and a tombstone for its uuid (deleted_uuids).
    removeItem: (date, uuid) => write(date, { removeItems: [uuid] }),
    removeWater: (date, uuid) => write(date, { removeWater: [uuid] }),
  }
})

// Another account signing in on this device never sees the last one's data, picks or sync.
// (Tests that replace useStore with a bare hook have no subscribe; they have no account to change.)
const who = s => (s.user ? String(s.user.id ?? s.user.name ?? '') : '')
if (typeof useStore.subscribe === 'function') {
  useStore.subscribe((s, prev) => {
    if (who(s) === who(prev)) return
    useNutrition.getState().reset()
    useDiarySelection.getState().reset()
    useHubSync.getState().reset()
  })
}
