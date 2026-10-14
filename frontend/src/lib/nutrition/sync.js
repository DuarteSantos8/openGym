import { create } from 'zustand'
import { HubSync, nutritionAvailable } from './api.js'
import { useStore } from '../../store/useStore.js'

// The hub's openGym ↔ NutriTrace sync, as the app sees it: "sync now" after a workout or a
// weigh-in, so the workout's kcal and the weight reach NutriTrace without waiting for the hub's
// next poll, and its status for the avatar's dot.

// The hub states that need the person (fitness-hub src/sync/engine.ts SyncState).
const TROUBLE = new Set(['error', 'needs_confirmation', 'suspended'])

// The hub itself skips a failing service's backoff at most once per 10 s per person; asking more
// often than this only queues cycles behind each other.
export const SYNC_MIN_INTERVAL_MS = 5000

/** `status` null: not asked yet, or the hub has not stored this person yet. */
export const useHubSync = create(set => ({ status: null, reset: () => set({ status: null }) }))
export const isHubTrouble = status => TROUBLE.has(status?.state)
export const useHubTrouble = () => useHubSync(s => isHubTrouble(s.status))

const available = () => nutritionAvailable(useStore.getState().user)

/** Reads the hub's sync status into useHubSync. Null when unavailable, unreachable or not stored yet. */
export async function refreshHubStatus() {
  if (!available()) return null
  try {
    const status = await HubSync.status()
    useHubSync.setState({ status })
    return status
  } catch {
    return null
  }
}

let inflight = null
let trailing = null
let lastDone = -Infinity

async function runSync() {
  try { await useStore.getState().pushState() } catch { /* the store keeps it owed and retries */ }
  try {
    const status = await HubSync.now()
    useHubSync.setState({ status })
    return status
  } catch {
    return null
  } finally {
    lastDone = Date.now()
  }
}

/**
 * Asks the hub to sync now. The change goes to openGym's server first (the hub reads it from
 * there), then the hub runs a cycle (it waits up to 8 s) and answers with its status.
 * Calls coalesce: one while another runs, or within SYNC_MIN_INTERVAL_MS of the last, waits for
 * a single follow-up run that starts after it, so the latest change is always sent.
 * Never throws: a sync that does not happen now happens on the hub's next poll.
 * @returns {Promise<import('./api.js').SyncStatus|null>}
 */
export function syncNow() {
  if (!available()) return Promise.resolve(null)
  if (trailing) return trailing
  if (inflight || Date.now() - lastDone < SYNC_MIN_INTERVAL_MS) {
    const after = inflight || Promise.resolve()
    trailing = after.then(() => new Promise(resolve => {
      setTimeout(resolve, Math.max(0, SYNC_MIN_INTERVAL_MS - (Date.now() - lastDone)))
    })).then(() => {
      trailing = null
      inflight = runSync().finally(() => { inflight = null })
      return inflight
    })
    return trailing
  }
  inflight = runSync().finally(() => { inflight = null })
  return inflight
}

/** For tests: forget the last run, so the next syncNow goes at once. */
export function resetSyncThrottle() {
  inflight = null
  trailing = null
  lastDone = -Infinity
}

/** The kcal row the hub keeps for a workout (call after syncNow), or null.
 *  @returns {Promise<import('./api.js').WorkoutSyncStatus|null>} */
export async function workoutSyncRow(workoutId) {
  if (!available() || workoutId == null) return null
  try { return await HubSync.workout(String(workoutId)) } catch { return null }
}
