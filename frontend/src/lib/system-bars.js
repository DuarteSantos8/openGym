// The status bar (and on Android the navigation bar) draws on top of the page: Android 15 runs the
// page edge to edge, iOS always does. The icons are white unless the native side is told the page
// is light, and on the light theme the clock and the battery all but vanished on #f2f2f7. App.jsx
// calls this with every theme it resolves to. Android: BarIconsPlugin.java flips the icons dark on
// light and back (from Android 15, where the page is under the bars). iOS: Capacitor's own
// SystemBars plugin does the same for the status bar.
import { MOBILE } from './mobile.js'

// Registered once, and kept inside an object: a Capacitor plugin proxy answers `then` with a native
// call that never settles, so a promise resolved with the bare proxy would hang (the Coach hang, #42).
let pluginP = null
const barsPlugin = () => pluginP || (pluginP = (async () => {
  if (!MOBILE) return null
  const { Capacitor, registerPlugin, SystemBars } = await import('@capacitor/core')
  const platform = Capacitor.getPlatform()
  if (platform === 'android') {
    const icons = registerPlugin('BarIcons')
    return { setLight: light => icons.setStyle({ light }), setAccent: accent => icons.setAccent({ accent }) }
  }
  if (platform === 'ios' && SystemBars) {
    return { setLight: light => SystemBars.setStyle({ style: light ? 'LIGHT' : 'DARK' }) }
  }
  return null
})().catch(() => null))

let last = null
export async function setSystemBarsLight(light) {
  light = !!light
  if (last === light) return
  last = light
  try {
    const p = await barsPlugin()
    if (p) await p.setLight(light)
  } catch {
    // An older APK without the plugin: the bars stay as they were.
  }
}

// The accent for what Android draws itself on top of the page: the text selection handles and a
// native field's caret (#980; BarIconsPlugin.setAccent, AccentTheme.java). A preset key or the
// user's own '#rrggbb'. iOS takes the page's caret-color and ::selection as they are.
let lastAccent = null
export async function setSystemAccent(accent) {
  if (typeof accent !== 'string' || lastAccent === accent) return
  lastAccent = accent
  try {
    const p = await barsPlugin()
    if (p?.setAccent) await p.setAccent(accent)
  } catch {
    // An APK from before setAccent: the handles keep the theme's green.
  }
}
