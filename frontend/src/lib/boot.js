import { registerPlugin } from '@capacitor/core'

// The boot screen in index.html: markup and CSS only, so the web image's CSP needs no new hash.
// It goes once the app can draw, or on a script error before that, so it never lifts forever.
// Never mid-move: the logo first finishes building (about 0.7 s), and once the bar is going up
// and down it leaves when the bar is back on the floor, not halfway through a rep.
const BUILT_MS = 700, REP_DELAY_MS = 750, REP_MS = 1250

export function bootWait(t, reduced) {
  if (reduced || !Number.isFinite(t)) return 0
  if (t < REP_DELAY_MS) return Math.max(0, BUILT_MS - t)
  return (REP_MS - ((t - REP_DELAY_MS) % REP_MS)) % REP_MS
}

export function hideBoot(e) {
  const b = document.getElementById('boot')
  if (!b || b.dataset.leaving) return
  b.dataset.leaving = '1'
  let wait = 0
  if (!(e instanceof Event)) {
    try {
      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      wait = bootWait(Number(b.querySelector('.db')?.getAnimations?.()[0]?.currentTime), reduced)
    } catch { wait = 0 }
  }
  setTimeout(() => {
    b.className = 'out'
    setTimeout(() => b.remove(), 260)
  }, wait)
}

// The phone's own launch screen stays up until the page has painted the boot screen, so the
// WebView starting up never shows as seconds of plain black (capacitor.config.json SplashScreen
// also drops it by itself after 8 s, should this never run).
export function handOverFromLaunchScreen() {
  try {
    if (!window.Capacitor?.isNativePlatform?.()) return
    registerPlugin('SplashScreen').hide({ fadeOutDuration: 180 }).catch(() => {})
  } catch { /* no plugin in this build: the launch screen goes on its own */ }
}
