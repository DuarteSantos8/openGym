// The native shell this runs in, known at once: 'ios', 'android', or null (the web, a test).
// Capacitor's native bridge puts window.Capacitor in place before the app's own script runs, so a
// route can decide on the first render, without waiting for the async import lib/mobile.js uses
// (Settings → Apple Watch was sent back to the root by a route that only knew it later).
export function platformNow () {
  try {
    const p = globalThis.Capacitor?.getPlatform?.()
    return p === 'ios' || p === 'android' ? p : null
  } catch { return null }
}
