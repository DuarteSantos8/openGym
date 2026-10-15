// Whether the app keeps still: the device's own "reduce motion" setting, or Profile › Appearance ›
// Reduce motion (App.jsx marks the root with data-motion="reduce"). index.css applies the same
// rule to both; anything that animates from script asks here.

/** The device's setting alone. */
export function systemReducesMotion() {
  try { return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false }
}

/** The device's setting or the app's switch. */
export function reducedMotion() {
  if (typeof document !== 'undefined' && document.documentElement.dataset.motion === 'reduce') return true
  return systemReducesMotion()
}
