// Where the onboarding keeps its state for this browser tab (state.js reads and writes it), and the
// one way to throw it away. Its own file so the store (store/useStore.js) can drop it at a
// sign-out without loading the onboarding's screens, plans and starter templates into the app.
export const STORE_KEY = 'gains_onboarding'

/** Drops everything the onboarding kept for this tab. */
export function forget(storage = globalThis.sessionStorage) {
  try { storage?.removeItem(STORE_KEY) } catch { /* nothing kept */ }
}
