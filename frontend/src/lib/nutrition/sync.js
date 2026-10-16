import { useEffect } from 'react'
import { create } from 'zustand'
import { HubSync, nutritionAvailable } from './api.js'
import { useStore } from '../../store/useStore.js'

// The hub's Gains ↔ NutriTrace sync, as the app sees it: "sync now" after a workout or a
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

// How often focus and visibility may re-read the status (every tab root has an avatar).
export const STATUS_REFRESH_MS = 30 * 1000
let lastStatusRead = -Infinity

/** Keeps useHubSync current for the avatar dot: read on mount, and again whenever the app comes
 *  back to the front (visibility or window focus), at most every STATUS_REFRESH_MS. */
export function useHubStatusRefresh() {
  const user = useStore(s => s.user)
  const on = nutritionAvailable(user)
  useEffect(() => {
    if (!on) return undefined
    const read = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      if (Date.now() - lastStatusRead < STATUS_REFRESH_MS) return
      lastStatusRead = Date.now()
      refreshHubStatus()
    }
    read()
    document.addEventListener('visibilitychange', read)
    window.addEventListener('focus', read)
    return () => {
      document.removeEventListener('visibilitychange', read)
      window.removeEventListener('focus', read)
    }
  }, [on])
}

let inflight = null
let trailing = null
let lastDone = -Infinity

async function runSync(push) {
  if (push) {
    try { await useStore.getState().pushState() } catch { /* the store keeps it owed and retries */ }
  }
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
 * Asks the hub to sync now. The change goes to Gains' server first (the hub reads it from
 * there), then the hub runs a cycle (it waits up to 8 s) and answers with its status.
 * Calls coalesce: one while another runs, or within SYNC_MIN_INTERVAL_MS of the last, waits for
 * a single follow-up run that starts after it, so the latest change is always sent.
 * Never throws: a sync that does not happen now happens on the hub's next poll.
 * `pushed`: the caller has just synced Gains itself (Profile's Sync now), so the push is skipped.
 * A follow-up run always pushes: a change may have come in while it waited.
 * @returns {Promise<import('./api.js').SyncStatus|null>} null when the hub did not answer
 */
export function syncNow({ pushed = false } = {}) {
  if (!available()) return Promise.resolve(null)
  if (trailing) return trailing
  if (inflight || Date.now() - lastDone < SYNC_MIN_INTERVAL_MS) {
    const after = inflight || Promise.resolve()
    trailing = after.then(() => new Promise(resolve => {
      setTimeout(resolve, Math.max(0, SYNC_MIN_INTERVAL_MS - (Date.now() - lastDone)))
    })).then(() => {
      trailing = null
      inflight = runSync(true).finally(() => { inflight = null })
      return inflight
    })
    return trailing
  }
  inflight = runSync(!pushed).finally(() => { inflight = null })
  return inflight
}

/** For tests: forget the last run, so the next syncNow goes at once. */
export function resetSyncThrottle() {
  inflight = null
  trailing = null
  lastDone = -Infinity
  lastStatusRead = -Infinity
}

/** The kcal row the hub keeps for a workout (call after syncNow), or null.
 *  @returns {Promise<import('./api.js').WorkoutSyncStatus|null>} */
export async function workoutSyncRow(workoutId) {
  if (!available() || workoutId == null) return null
  try { return await HubSync.workout(String(workoutId)) } catch { return null }
}
