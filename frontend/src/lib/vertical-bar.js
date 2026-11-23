// iPhone Duo's outer display puts the status bar in a column on the side and gives that column
// to the app as a side safe-area inset (VerticalBarPlugin.swift). The tab bar moves into it, under
// the system's own region at the top of the column (the camera, the clock): data-vbar on <html>
// names the side and --vbar-top is where that region ends (index.css, "vertical bar").
import { platformNow } from './platform-now.js'

const SIDES = ['left', 'right']

export function applyVerticalBar(bar, root = globalThis.document?.documentElement) {
  if (!root) return
  if (SIDES.includes(bar?.side)) {
    root.dataset.vbar = bar.side
    root.style.setProperty('--vbar-top', `${Math.max(0, Number(bar.top) || 0)}px`)
  } else {
    delete root.dataset.vbar
    root.style.removeProperty('--vbar-top')
  }
}

// Registered once, kept inside an object: a Capacitor plugin proxy answers `then` with a native call
// that never settles, so a promise resolved with the bare proxy would hang (#42).
let pluginP = null
const plugin = () => pluginP || (pluginP = (async () => {
  const { registerPlugin } = await import('@capacitor/core')
  return { p: registerPlugin('VerticalBar') }
})().catch(() => null))

export async function watchVerticalBar() {
  if (platformNow() !== 'ios') return
  try {
    const h = await plugin()
    if (!h) return
    await h.p.addListener('change', bar => applyVerticalBar(bar))
    applyVerticalBar(await h.p.get())
  } catch {
    // An app from before the plugin: the tab bar stays at the bottom.
  }
}
