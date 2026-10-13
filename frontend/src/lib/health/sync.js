// Keeping the health records in step with a source (providers.js). Which sources this device is
// connected to, and how far each one has been read, is a fact about the device, not the profile:
// it is kept in its own file (as lib/health-sync.js keeps Health Connect's), never in S, so it
// does not sync, ride in a backup or switch on on a second phone. The readings themselves go into
// S.health and sync like everything else.
//
// Disconnecting stops the reading and keeps every record already imported: they are the user's
// data. Removing them is a separate, explicit choice (removeSourceData).
import { MOBILE, readJsonFile, writeJsonFile } from '../mobile.js'
import { providerById } from './providers.js'
import { bridgeWeights, importRecords, weighInsWithoutSource, withoutSource } from './records.js'

export const SOURCES_FILE = 'opengym-health-sources.json'
const DAY = 86400000
// The first read goes this far back; later ones from the last read, less an overlap: a day's
// totals keep changing until the day is over, and a sample can reach HealthKit late (a Watch
// that synced in the morning).
export const FIRST_DAYS = 730
export const OVERLAP_DAYS = 2

let cached = null
export async function loadSources() {
  if (cached) return cached
  const f = await readJsonFile(SOURCES_FILE)
  cached = f && typeof f === 'object' && f.providers && typeof f.providers === 'object' ? f : { providers: {} }
  return cached
}
async function saveSource(id, patch) {
  const all = await loadSources()
  cached = { ...all, providers: { ...all.providers, [id]: { ...(all.providers[id] || {}), ...patch } } }
  await writeJsonFile(SOURCES_FILE, cached)
  listeners.forEach(cb => { try { cb(cached) } catch { /* a closed screen */ } })
  return cached.providers[id]
}
const listeners = new Set()
/** Called with the file's content after every change, for the Settings rows. */
export function onSourcesChange(cb) { listeners.add(cb); return () => listeners.delete(cb) }

/** From when to read, given the last successful read (ms) or none. */
export const readSince = (last, now = Date.now()) => (last > 0 ? last - OVERLAP_DAYS * DAY : now - FIRST_DAYS * DAY)

/**
 * The profile after a source's readings came in: new and changed records folded into S.health
 * (importRecords) and the weight readings into the weigh-in log (bridgeWeights). Pure; `update`
 * in the store runs it. Returns the counts.
 */
export function applyReadings(s, readings, { now = Date.now(), ignoreDeleted = false } = {}) {
  const r = importRecords(s.health, readings, { now, deleted: s.deleted?.health, ignoreDeleted })
  s.health = r.health
  const weights = r.health.filter(x => x.type === 'weight' && readings.some(y => y.type === 'weight' && `${y.src}:${y.sid}` === x.id))
  if (weights.length) {
    const b = bridgeWeights(s.bodyweight, weights, s.unit, now)
    if (b.changed) s.bodyweight = b.bodyweight
  }
  return { added: r.added, updated: r.updated }
}

const running = new Map()

/**
 * Reads what is new from a connected source and folds it in. `full` reads from the start again
 * and brings back records deleted earlier (a reconnect). Resolves { ok, added, updated, error };
 * never rejects. A no-op for a source that is not on.
 */
export function syncSource(id, getState, update, { full = false, now = Date.now() } = {}) {
  if (running.has(id)) return running.get(id)
  const job = (async () => {
    const provider = providerById(id)
    const st = (await loadSources()).providers[id]
    if (!provider || !st?.on) return { ok: false, added: 0, updated: 0, error: 'off' }
    try {
      if (!(await provider.isAvailable())) throw Object.assign(new Error('unavailable'), { code: 'unavailable' })
      const since = readSince(full ? 0 : st.at, now)
      const readings = await provider.fetchMeasurements({ types: st.types || provider.getAvailableDataTypes(), since, until: now })
      let counts = { added: 0, updated: 0 }
      if (readings.length && getState()) update(s => { counts = applyReadings(s, readings, { now, ignoreDeleted: full }) })
      await saveSource(id, { at: now, error: null })
      return { ok: true, ...counts, error: null }
    } catch (e) {
      const error = e?.code === 'unavailable' ? 'unavailable' : 'failed'
      await saveSource(id, { error })
      return { ok: false, added: 0, updated: 0, error }
    }
  })().finally(() => running.delete(id))
  running.set(id, job)
  return job
}

/**
 * Connecting: asks the source for read access to `types` (all it offers by default), turns it on
 * and reads everything once. Resolves the result of that first read, or { ok: false, error }.
 */
export async function connectSource(id, getState, update, types = null) {
  const provider = providerById(id)
  if (!provider || !(await provider.isAvailable())) return { ok: false, error: 'unavailable' }
  const want = (types || provider.getAvailableDataTypes()).filter(t => provider.getAvailableDataTypes().includes(t))
  try {
    const r = await provider.requestPermissions(want)
    if (!r.asked) return { ok: false, error: 'unavailable' }
  } catch { return { ok: false, error: 'denied' } }
  await saveSource(id, { on: true, types: want, at: 0, error: null })
  return syncSource(id, getState, update, { full: true })
}

/** Disconnecting: stops reading. Nothing imported is removed (see removeSourceData). */
export async function disconnectSource(id) {
  if (running.has(id)) await running.get(id)
  return saveSource(id, { on: false, error: null })
}

/** Takes every record a source brought in out of the profile, and the weigh-ins it filled in. */
export function removeSourceData(s, id) {
  s.health = withoutSource(s.health, id)
  s.bodyweight = weighInsWithoutSource(s.bodyweight, id)
}

// Back in the foreground, and once shortly after launch: every connected source reads what is new.
let started = false
export function initHealthSources(getState, update) {
  if (!MOBILE || started) return
  started = true
  const all = () => loadSources().then(f => Promise.all(Object.entries(f.providers)
    .filter(([, st]) => st?.on).map(([id]) => syncSource(id, getState, update)))).catch(() => {})
  import('@capacitor/app').then(({ App }) => {
    App.addListener('appStateChange', ({ isActive }) => { if (isActive) all() })
  }).catch(() => {})
  setTimeout(all, 4000)
}
