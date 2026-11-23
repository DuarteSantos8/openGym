// LIFTIQ-FORK: a tiny non-persisted observable store (connection and live state live here, never in
// openGym's persisted state `S`). useSyncExternalStore based, no dependency.
import { useSyncExternalStore } from 'react'

export function createMiniStore(initial) {
  let state = initial
  const listeners = new Set()
  const store = {
    getState: () => state,
    // Merges a patch; listeners run only when a value really changed.
    setState(patch) {
      const next = typeof patch === 'function' ? patch(state) : patch
      let changed = false
      for (const k of Object.keys(next)) if (!Object.is(state[k], next[k])) { changed = true; break }
      if (!changed) return
      state = { ...state, ...next }
      for (const l of [...listeners]) l(state)
    },
    subscribe(l) { listeners.add(l); return () => listeners.delete(l) },
    use(selector = s => s) {
      return useSyncExternalStore(store.subscribe, () => selector(state))
    },
  }
  return store
}

export const INITIAL_SENSOR_STATE = {
  status: 'idle', // idle | connecting | connected | error
  name: null,
  battery: null, // describeBattery() result
  info: null, // describeInfo() text
  error: null,
  simulated: false,
  // live set state
  mode: 'idle', // idle | ready | recording | review
  ready: { progress: 0, ready: false },
  count: 0,
  counterReady: false,
  elapsedS: 0,
  interrupted: false,
}

// Connection + live state of the sensor. Not persisted, not synced.
export const sensorStore = createMiniStore(INITIAL_SENSOR_STATE)
