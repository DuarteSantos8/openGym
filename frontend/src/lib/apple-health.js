// Native iPhone integration. The opt-in is local to this phone and account; it is never sent
// to the server or copied into an exported openGym profile. HealthKit's own permission sheet
// is the final authority for each read and write type.
import { MOBILE } from './mobile.js'
import { convertBodyWeight } from './units.js'

const KEY = 'opengym_apple_health_owner'
const LEDGER = 'opengym_apple_health_written'
let pluginInstance
let running = null
let timer = null

export const appleHealthOwner = store => {
  const { user, sync } = store.getState()
  return JSON.stringify([sync?.server || 'local', user?.id || 'local'])
}
const ownerOf = appleHealthOwner
let generation = 0

async function plugin() {
  if (!MOBILE) return null
  const { Capacitor, registerPlugin } = await import('@capacitor/core')
  if (Capacitor.getPlatform() !== 'ios') return null
  // Capacitor's proxy answers any property, including `then`. Returning it from an
  // async function or Promise.resolve() makes JS treat it as a thenable and wait forever.
  return (pluginInstance ||= { native: registerPlugin('HealthSync') })
}

export async function appleHealthAvailable() {
  // The native probe can fail while Capacitor is still attaching its bridge. Keep the
  // setting visible on iOS so activation can report the actual error instead of hiding it.
  if (!MOBILE) return false
  try {
    const { Capacitor } = await import('@capacitor/core')
    return Capacitor.getPlatform() === 'ios'
  } catch { return false }
}

export const appleHealthEnabled = store => {
  try { return localStorage.getItem(KEY) === ownerOf(store) } catch { return false }
}

export function disableAppleHealth() {
  generation += 1
  try { localStorage.removeItem(KEY) } catch { /* storage may be unavailable */ }
}

export async function enableAppleHealth(store) {
  const owner = ownerOf(store), attempt = ++generation
  const native = (await plugin())?.native
  if (!native || !(await native.available()).available) throw new Error('Apple Health is unavailable')
  await native.authorize()
  if (owner !== ownerOf(store) || attempt !== generation) throw new Error('Health sync account changed')
  localStorage.setItem(KEY, owner)
}

// Health can contain several readings on a day, returned in any order.
export function validHealthWeight(row) {
  if (!row || !/^\d{4}-\d{2}-\d{2}$/.test(row.date || '')) return false
  const day = Date.parse(`${row.date}T00:00:00Z`)
  return Number.isFinite(day) && new Date(day).toISOString().slice(0, 10) === row.date &&
    Number.isFinite(row.kg) && row.kg > 0 && row.kg < 500 &&
    Number.isFinite(row.timestamp) && row.timestamp > 0 && row.timestamp <= 8640000000000000
}

export function latestHealthWeights(rows) {
  const latest = new Map()
  for (const row of rows) {
    if (validHealthWeight(row) && !row.own && (!latest.has(row.date) || row.timestamp > latest.get(row.date).timestamp)) latest.set(row.date, row)
  }
  return latest
}

// A historical weigh-in belongs to its selected day, not the day it was edited.
// Keep the edit timestamp separately as HealthKit's replacement version.
export function healthWeightPayload(entry, unit) {
  const edited = Number(entry.t)
  const at = new Date(edited)
  const localDay = Number.isFinite(edited) ? `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}` : ''
  const timestamp = localDay === entry.d ? edited : Date.parse(`${entry.d}T12:00:00`)
  return { date: entry.d, kg: unit === 'lb' ? Number(entry.w) / 2.2046226218 : Number(entry.w), timestamp, version: edited > 0 ? edited : timestamp }
}
const weightFingerprint = weight => `${weight.kg}:${weight.timestamp}:${weight.version}`

export async function syncAppleHealth(store) {
  if (!appleHealthEnabled(store)) return { imported: 0, weights: 0, workouts: 0 }
  if (running) { await running; return syncAppleHealth(store) }
  const owner = ownerOf(store), attempt = generation
  const current = () => appleHealthEnabled(store) && ownerOf(store) === owner && attempt === generation
  const empty = { imported: 0, weights: 0, workouts: 0 }
  running = (async () => {
    const native = (await plugin())?.native
    if (!native || !current()) return empty
    // Compare the most recent reading from another Health source with openGym's last edit.
    // Equal or older Health readings never overwrite a weight entered in openGym.
    const healthRows = (await native.readWeights()).weights || []
    if (!current()) return empty
    const latest = latestHealthWeights(healthRows)
    const before = store.getState().S
    const incoming = [...latest.values()].filter(row => {
      const local = before.bodyweight.find(b => b.d === row.date)
      return !local || Number(row.timestamp) > Number(local.t || 0)
    })
    if (incoming.length) store.getState().update(s => {
      for (const row of incoming) {
        const local = s.bodyweight.find(b => b.d === row.date)
        if (local && Number(local.t || 0) >= Number(row.timestamp)) continue
        if (local) { local.w = convertBodyWeight(row.kg, 'kg', s.unit); local.t = row.timestamp }
        else s.bodyweight.push({ d: row.date, w: convertBodyWeight(row.kg, 'kg', s.unit), t: row.timestamp })
      }
      s.bodyweight.sort((a, b) => a.d.localeCompare(b.d))
    })
    const state = store.getState().S
    let ledger = { owner, weights: {}, workouts: [] }
    try {
      const saved = JSON.parse(localStorage.getItem(LEDGER) || 'null')
      if (saved?.owner === ledger.owner && saved.weights && typeof saved.weights === 'object' && !Array.isArray(saved.weights) && Array.isArray(saved.workouts)) ledger = saved
    } catch { /* A damaged local marker only causes an idempotent HealthKit lookup. */ }
    ledger.weights ||= {}
    const writtenWorkouts = new Set(ledger.workouts || [])
    const weights = state.bodyweight
      .filter(b => (!latest.has(b.d) || Number(b.t || 0) > Number(latest.get(b.d).timestamp)) && Number.isFinite(Number(b.w)) && Number(b.w) > 0)
      .map(b => healthWeightPayload(b, state.unit))
      .filter(b => validHealthWeight(b) && Number.isFinite(b.version) && b.version > 0 && b.version <= 8640000000000000 && ledger.weights?.[b.date] !== weightFingerprint(b))
    const workouts = state.workouts
      .filter(w => w.id && !writtenWorkouts.has(String(w.id)) && Number.isFinite(Number(w.start)) && Number.isFinite(Number(w.end)) && Number(w.end) > Number(w.start) && Number(w.start) > 0 && Number(w.end) <= 8640000000000000)
      .map(w => ({ id: String(w.id), name: w.name || 'openGym', start: Number(w.start), end: Number(w.end) }))
    if (!current()) return empty
    const savedWeights = weights.length ? await native.writeWeights({ weights }) : { written: 0 }
    if (!current()) return empty
    const savedWorkouts = workouts.length ? await native.writeWorkouts({ workouts }) : { written: 0 }
    if (!current()) return empty
    for (const weight of weights) ledger.weights[weight.date] = weightFingerprint(weight)
    for (const workout of workouts) writtenWorkouts.add(workout.id)
    ledger.workouts = [...writtenWorkouts]
    try { localStorage.setItem(LEDGER, JSON.stringify(ledger)) } catch { /* Native metadata still deduplicates. */ }
    return { imported: incoming.length, weights: savedWeights.written || 0, workouts: savedWorkouts.written || 0 }
  })()
  try { return await running } finally { running = null }
}

export function startAppleHealthSync(store) {
  if (!MOBILE) return
  const schedule = () => {
    clearTimeout(timer)
    timer = setTimeout(() => { if (store.getState().ready) syncAppleHealth(store).catch(() => {}) }, 1500)
  }
  store.subscribe((next, prev) => {
    if (!appleHealthEnabled(store) || !next.ready) return
    const weights = s => JSON.stringify((s.bodyweight || []).map(b => [b.d, b.w, b.t]))
    const workouts = s => JSON.stringify((s.workouts || []).map(w => [w.id, w.start, w.end, w._ts]))
    if ((!prev.ready && next.ready) || weights(next.S) !== weights(prev.S) || workouts(next.S) !== workouts(prev.S)) schedule()
  })
  document.addEventListener('visibilitychange', () => { if (!document.hidden && appleHealthEnabled(store)) schedule() })
  import('@capacitor/app').then(({ App }) => App.addListener('appStateChange', ({ isActive }) => {
    if (isActive && appleHealthEnabled(store)) schedule()
  })).catch(() => {})
}
